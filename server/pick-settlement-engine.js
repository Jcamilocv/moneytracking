import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';
import { updateAgentState, HQ_UNIT_STATUSES, HQ_UNIT_TYPES } from '../api/_lib/agent-state.js';
import { FIXTURE_STATUSES } from './sports-results-provider.js';
import { getOfficialOwnerUid } from './official-season-bank.js';
import { registerOperationsIncident, OPERATIONS_INCIDENT_TYPES, OPERATIONS_ESCALATION_TARGETS } from './operations-incidents.js';

export const isSettlementLiveEnabled = () => {
    return process.env.SETTLEMENT_LIVE_ENABLED === 'true';
};

const SETTLEMENT_WORKER_ID = 'pick-settlement-worker';

export const SETTLEMENT_STATUSES = {
    WON: 'won',
    LOST: 'lost',
    VOID: 'void',
    HALF_WON: 'half-won',
    HALF_LOST: 'half-lost',
    PENDING: 'pending',
    PENDING_HUMAN_REVIEW: 'pending_human_review'
};

const cleanString = (val) => String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * Evalúa mercados 1X2 (Ganador del partido / Moneyline).
 */
export const evaluate1X2 = ({ selection, homeTeam, awayTeam, regularTimeScore }) => {
    if (!regularTimeScore) {
        return { status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW, reason: 'Falta marcador a tiempo reglamentario' };
    }

    const { home, away } = regularTimeScore;
    let winnerOutcome; // '1', 'X', '2'
    if (home > away) winnerOutcome = '1';
    else if (home === away) winnerOutcome = 'X';
    else winnerOutcome = '2';

    const sel = cleanString(selection);
    const homeClean = cleanString(homeTeam);
    const awayClean = cleanString(awayTeam);

    let chosenOutcome = null;
    if (['1', 'local', 'home', 'gana local', homeClean].includes(sel) || sel.startsWith(homeClean)) {
        chosenOutcome = '1';
    } else if (['x', 'empate', 'draw', 'tie'].includes(sel)) {
        chosenOutcome = 'X';
    } else if (['2', 'visitante', 'away', 'gana visitante', awayClean].includes(sel) || sel.startsWith(awayClean)) {
        chosenOutcome = '2';
    }

    if (!chosenOutcome) {
        return {
            status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
            reason: `Selección 1X2 '${selection}' no identificada de forma unívoca para ${homeTeam} vs ${awayTeam}`
        };
    }

    return {
        status: chosenOutcome === winnerOutcome ? SETTLEMENT_STATUSES.WON : SETTLEMENT_STATUSES.LOST,
        reason: `Resultado reglamentario: ${home}-${away}. Ganador: ${winnerOutcome}. Pronóstico: ${chosenOutcome}`
    };
};

/**
 * Evalúa mercados Over/Under con línea de goles explícita.
 */
export const evaluateOverUnder = ({ selection, regularTimeScore }) => {
    if (!regularTimeScore) {
        return { status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW, reason: 'Falta marcador a tiempo reglamentario' };
    }

    const sel = cleanString(selection);
    const overMatch = sel.match(/(?:mas de|over|\+)\s*(\d+(?:\.\d+)?)/i);
    const underMatch = sel.match(/(?:menos de|under|-)\s*(\d+(?:\.\d+)?)/i);

    if (!overMatch && !underMatch) {
        return {
            status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
            reason: `Línea Over/Under no detectada de forma explícita en '${selection}'`
        };
    }

    const isOver = Boolean(overMatch);
    const line = parseFloat(isOver ? overMatch[1] : underMatch[1]);
    if (!Number.isFinite(line)) {
        return { status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW, reason: 'Línea numérica inválida' };
    }

    const totalGoals = regularTimeScore.home + regularTimeScore.away;

    if (totalGoals === line) {
        return { status: SETTLEMENT_STATUSES.VOID, reason: `Total goles ${totalGoals} igual a línea asiática ${line}` };
    }

    const won = isOver ? totalGoals > line : totalGoals < line;
    return {
        status: won ? SETTLEMENT_STATUSES.WON : SETTLEMENT_STATUSES.LOST,
        reason: `Total goles: ${totalGoals} (${regularTimeScore.home}-${regularTimeScore.away}). Línea: ${isOver ? 'Over' : 'Under'} ${line}`
    };
};

/**
 * Evalúa mercados Ambos Equipos Marcan (BTTS).
 */
export const evaluateBTTS = ({ selection, regularTimeScore }) => {
    if (!regularTimeScore) {
        return { status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW, reason: 'Falta marcador a tiempo reglamentario' };
    }

    const sel = cleanString(selection);
    const bothScored = regularTimeScore.home > 0 && regularTimeScore.away > 0;

    if (['si', 'yes', 'ambos marcan', 'ambos equipos marcan'].includes(sel) || sel.startsWith('si') || sel.includes('marcan')) {
        return {
            status: bothScored ? SETTLEMENT_STATUSES.WON : SETTLEMENT_STATUSES.LOST,
            reason: `Marcador: ${regularTimeScore.home}-${regularTimeScore.away}. Ambos anotaron: ${bothScored}`
        };
    }

    if (['no', 'no marcan', 'ambos no marcan'].includes(sel) || sel.startsWith('no')) {
        return {
            status: !bothScored ? SETTLEMENT_STATUSES.WON : SETTLEMENT_STATUSES.LOST,
            reason: `Marcador: ${regularTimeScore.home}-${regularTimeScore.away}. Ambos anotaron: ${bothScored}`
        };
    }

    return {
        status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
        reason: `Selección BTTS '${selection}' no reconocida de forma unívoca`
    };
};

/**
 * Evalúa deterministamente el resultado de un pick oficial contrastado con un resultado deportivo.
 */
export const evaluatePickResult = ({ pick, fixture }) => {
    if (!fixture) {
        return { settled: false, status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW, reason: 'Partido no encontrado en el proveedor' };
    }

    // 1. Comprobación del estado del partido
    if (fixture.status !== FIXTURE_STATUSES.FINISHED) {
        if ([
            FIXTURE_STATUSES.POSTPONED,
            FIXTURE_STATUSES.CANCELLED,
            FIXTURE_STATUSES.INTERRUPTED,
            FIXTURE_STATUSES.SUSPENDED,
            'postponed', 'cancelled', 'interrupted', 'suspended', 'abandoned'
        ].includes(fixture.status)) {
            return {
                settled: false,
                status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
                reason: `Partido con estado '${fixture.status}'. Requiere revisión de política de suspensión de casas.`
            };
        }

        // Partidos en juego, descanso, prórroga, retrasados o no iniciados:
        // Mantener estrictamente como pending para reintentar más tarde.
        // REGLA ARQUITECTÓNICA: CERO falsas alarmas de revisión humana si el partido sigue en juego o demorado.
        return {
            settled: false,
            status: SETTLEMENT_STATUSES.PENDING,
            reason: `Partido en curso o demorado (estado: ${fixture.status}). Reintentar más tarde sin alerta prematura.`
        };
    }

    // 2. Comprobación de marcador reglamentario
    if (!fixture.regularTimeScore) {
        return {
            settled: false,
            status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
            reason: 'El partido figura como finalizado pero carece de marcador regularTimeScore'
        };
    }

    const marketClean = cleanString(pick?.bet?.market);
    const selection = pick?.bet?.selection;
    const homeTeam = pick?.event?.homeTeam;
    const awayTeam = pick?.event?.awayTeam;
    const regularTimeScore = fixture.regularTimeScore;

    // 3. Reglas de mercado soportadas en v1
    // REGLA: No evaluar heurísticas libres sobre mercados de estadísticas (córners, tarjetas, etc.)
    if (marketClean.includes('corner') || marketClean.includes('tarjeta') || marketClean.includes('falta') || marketClean.includes('tiro')) {
        return {
            settled: false,
            status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
            reason: `Mercado de estadísticas '${pick?.bet?.market}' no soportado en motor determinista v1. Escalado a revisión humana.`
        };
    }

    let evalResult;
    if (['1x2', 'ganador del partido', 'moneyline', 'resultado final'].includes(marketClean)) {
        evalResult = evaluate1X2({ selection, homeTeam, awayTeam, regularTimeScore });
    } else if (
        marketClean.includes('goles') ||
        marketClean.includes('over/under') ||
        marketClean.includes('over / under') ||
        marketClean.includes('total de goles') ||
        marketClean.includes('linea de gol') ||
        ['over', 'under', 'mas de', 'menos de'].includes(marketClean)
    ) {
        evalResult = evaluateOverUnder({ selection, regularTimeScore });
    } else if (marketClean.includes('btts') || marketClean.includes('ambos marcan') || marketClean.includes('ambos equipos')) {
        evalResult = evaluateBTTS({ selection, regularTimeScore });
    } else {
        return {
            settled: false,
            status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
            reason: `Mercado '${pick?.bet?.market}' no soportado en motor determinista v1. Escalado a revisión humana.`
        };
    }

    if (evalResult.status === SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW) {
        return { settled: false, status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW, reason: evalResult.reason };
    }

    return {
        settled: true,
        status: evalResult.status,
        regularTimeScore,
        reason: evalResult.reason,
        resultEvidence: {
            fixtureId: fixture.fixtureId,
            regularTimeScore,
            source: fixture.source,
            fetchedAt: fixture.fetchedAt
        }
    };
};

/**
 * Ejecuta la liquidación de un pick oficial y su correspondiente apuesta en la banca de temporada.
 */
export const settleOfficialPick = async ({
    pickId,
    pick,
    sportsProvider,
    db = getAdminDb(),
    ownerUid = getOfficialOwnerUid(),
    now = new Date()
} = {}) => {
    if (!pickId && !pick?.id) throw new Error('Falta ID del pick para liquidación');
    const id = pickId || pick.id;

    let pickData = pick;
    if (!pickData) {
        const snap = await db.collection('officialPicks').doc(id).get();
        if (!snap.exists) throw new Error(`El pick oficial ${id} no existe`);
        pickData = { ...snap.data(), id: snap.id };
    }

    // Si ya está liquidado, abortar por idempotencia
    if (pickData.settlement?.status && [SETTLEMENT_STATUSES.WON, SETTLEMENT_STATUSES.LOST, SETTLEMENT_STATUSES.VOID].includes(pickData.settlement.status)) {
        return { settled: true, duplicate: true, status: pickData.settlement.status };
    }

    // 1. Consultar resultado al proveedor deportivo
    const query = {
        fixtureId: pickData.event?.sourceEventId,
        sourceEventId: pickData.event?.sourceEventId,
        competition: pickData.event?.competition,
        homeTeam: pickData.event?.homeTeam,
        awayTeam: pickData.event?.awayTeam,
        kickoffAt: pickData.event?.kickoffAt ? new Date(pickData.event.kickoffAt) : null
    };

    const fixture = await sportsProvider.getFixtureResult(query);
    const evaluation = evaluatePickResult({ pick: pickData, fixture });

    // 2. Si requiere revisión humana o aún está pendiente:
    if (!evaluation.settled) {
        if (evaluation.status === SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW) {
            await db.collection('officialPicks').doc(id).update({
                'settlementReview': {
                    status: SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW,
                    reason: evaluation.reason,
                    checkedAt: FieldValue.serverTimestamp()
                }
            });

            await registerOperationsIncident({
                department: DEPARTMENTS.DATA_PERFORMANCE,
                incidentType: OPERATIONS_INCIDENT_TYPES.SETTLEMENT_AMBIGUOUS,
                targetId: id,
                reason: `Liquidación ambigua de pick oficial: ${evaluation.reason}`,
                escalateTo: OPERATIONS_ESCALATION_TARGETS.KAREN,
                details: { pickId: id, evaluation }
            }).catch(() => {});
        }
        return evaluation;
    }

    // 3. Transacción atómica de liquidación
    const pickRef = db.collection('officialPicks').doc(id);
    const eventRef = pickRef.collection('events').doc('settled');
    const userBetsCollection = db.collection('users').doc(ownerUid).collection('bets');

    await db.runTransaction(async (transaction) => {
        const freshPickSnap = await transaction.get(pickRef);
        if (freshPickSnap.data()?.settlement?.status) return; // idempotencia

        // Actualizar ledger oficial
        transaction.update(pickRef, {
            settlement: {
                status: evaluation.status,
                regularTimeScore: evaluation.regularTimeScore,
                reason: evaluation.reason,
                resultEvidence: evaluation.resultEvidence,
                settledAt: FieldValue.serverTimestamp()
            },
            settlementReview: FieldValue.delete()
        });

        // Registrar evento inmutable de liquidación
        transaction.set(eventRef, {
            type: 'settled',
            status: evaluation.status,
            regularTimeScore: evaluation.regularTimeScore,
            reason: evaluation.reason,
            evidence: evaluation.resultEvidence,
            createdAt: FieldValue.serverTimestamp()
        });

        // Localizar y actualizar la apuesta correspondiente en la banca de temporada
        const betsQuery = await userBetsCollection.where('officialPickId', '==', id).limit(1).get();
        if (!betsQuery.empty) {
            const betDocRef = betsQuery.docs[0].ref;
            const betData = betsQuery.docs[0].data();

            const updatedSelections = Array.isArray(betData.selections)
                ? betData.selections.map((sel) => ({ ...sel, status: evaluation.status, isOpen: false }))
                : [];

            transaction.update(betDocRef, {
                status: evaluation.status,
                settledAt: FieldValue.serverTimestamp(),
                resultEvidence: evaluation.resultEvidence,
                selections: updatedSelections,
                updatedAt: FieldValue.serverTimestamp()
                // REGLA: NO escribir campo profit (única fuente de verdad calculada dinámicamente)
            });
        }
    });

    // 4. Auditoría para Money Tips HQ
    await logSystemEvent({
        department: DEPARTMENTS.DATA_PERFORMANCE,
        workerId: SETTLEMENT_WORKER_ID,
        eventType: 'official_pick.settled',
        status: EVENT_STATUSES.SUCCESS,
        payload: {
            officialPickId: id,
            status: evaluation.status,
            regularTimeScore: evaluation.regularTimeScore,
            reason: evaluation.reason
        },
        rulesApplied: ['rule_deterministic_settlement_90min', 'rule_single_source_of_truth_pnl'],
        output: { settled: true, status: evaluation.status }
    }).catch(() => {});

    await updateAgentState({
        id: SETTLEMENT_WORKER_ID,
        name: 'Pick Settlement Engine Worker',
        department: DEPARTMENTS.DATA_PERFORMANCE,
        type: HQ_UNIT_TYPES.WORKER,
        status: HQ_UNIT_STATUSES.IDLE,
        currentTask: `Pick ${id} liquidado como ${evaluation.status}`,
        lastActivity: new Date(),
        result: { officialPickId: id, status: evaluation.status }
    }).catch(() => {});

    return { settled: true, duplicate: false, status: evaluation.status, regularTimeScore: evaluation.regularTimeScore };
};

/**
 * Escanea y liquida picks oficiales concluidos.
 */
export const scanAndSettleFinishedPicks = async ({
    sportsProvider,
    db = getAdminDb(),
    ownerUid = getOfficialOwnerUid(),
    limit = 20,
    now = new Date()
} = {}) => {
    // Escanear picks publicados sin liquidar cuyo partido inició hace más de 105 minutos
    const minFinishTime = new Date(now.getTime() - 105 * 60 * 1000);

    const snapshot = await db.collection('officialPicks')
        .where('status', '==', 'published')
        .where('event.kickoffAt', '<=', Timestamp.fromDate(minFinishTime))
        .limit(limit)
        .get();

    const summary = {
        scanned: snapshot.size,
        settled: 0,
        pendingReview: 0,
        inPlayOrPending: 0,
        errors: 0
    };

    for (const docSnapshot of snapshot.docs) {
        const pick = { ...docSnapshot.data(), id: docSnapshot.id };
        if (pick.settlement?.status) continue;

        try {
            const outcome = await settleOfficialPick({
                pickId: pick.id,
                pick,
                sportsProvider,
                db,
                ownerUid,
                now
            });

            if (outcome.settled && !outcome.duplicate) summary.settled += 1;
            else if (outcome.status === SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW) summary.pendingReview += 1;
            else summary.inPlayOrPending += 1;
        } catch (err) {
            summary.errors += 1;
            console.error(`Error liquidando pick ${pick.id}:`, err);
        }
    }

    return summary;
};
