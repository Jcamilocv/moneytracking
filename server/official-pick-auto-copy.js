import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';
import { updateAgentState, HQ_UNIT_STATUSES, HQ_UNIT_TYPES } from '../api/_lib/agent-state.js';
import { resolveCurrentOfficialSeasonBank, getOfficialOwnerUid } from './official-season-bank.js';
import { assertNoMorningShadowMutation } from './morning/shadow-firewall.js';
import {
    registerOperationsIncident,
    OPERATIONS_INCIDENT_TYPES,
    OPERATIONS_ESCALATION_TARGETS
} from './operations-incidents.js';

export const WORKER_ID = 'official-pick-auto-copy-worker';
export const AUTO_COPY_QUEUE_COLLECTION = 'officialPickAutoCopyQueue';
export const MAX_AUTO_COPY_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]; // 1m, 5m, 15m

export const AUTO_COPY_TASK_STATUSES = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

const formatCalendarDateParts = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) {
        const now = new Date();
        return { date: now.toISOString().slice(0, 10), time: '00:00' };
    }
    const pad = (n) => String(n).padStart(2, '0');
    return {
        date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    };
};

/**
 * Genera el snapshot serializable del pick oficial para embeber en la apuesta.
 */
export const officialPickSnapshotForBank = (pick = {}) => ({
    id: String(pick.id || ''),
    publishedAt: pick.publishedAt || null,
    event: {
        competition: String(pick?.event?.competition || ''),
        homeTeam: String(pick?.event?.homeTeam || ''),
        awayTeam: String(pick?.event?.awayTeam || ''),
        kickoffAt: pick?.event?.kickoffAt || null
    },
    bet: {
        market: String(pick?.bet?.market || ''),
        selection: String(pick?.bet?.selection || ''),
        oddsAtPublication: Number(pick?.bet?.oddsAtPublication) || null,
        recommendedStakePct: Number(pick?.bet?.recommendedStakePct ?? pick?.bet?.stakeUnits ?? 1)
    },
    system: {
        id: String(pick?.system?.id || ''),
        version: String(pick?.system?.version || '')
    }
});

/**
 * Construye el payload canónico de la apuesta para la banca oficial de temporada.
 *
 * POLÍTICA DE DATOS:
 * NO persiste el campo `profit`. Money TracKING calcula el beneficio/pérdida
 * dinámicamente a partir de `status`, `amount` y `odds` (única fuente de verdad).
 */
export const buildOfficialSeasonBetPayload = ({ pick, bank, now = new Date() }) => {
    const kickoffDate = pick?.event?.kickoffAt ? new Date(pick.event.kickoffAt) : now;
    const { date, time } = formatCalendarDateParts(kickoffDate);

    const stake = Number(pick?.bet?.recommendedStakePct ?? pick?.bet?.stakeUnits ?? 1) || 1;
    const initialCapital = Number(bank.initialCapital) || 1000;
    const amount = Math.max(0, Number((initialCapital * stake / 100).toFixed(2)));
    const odds = Number(pick?.bet?.oddsAtPublication) || 1.01;
    const homeTeam = String(pick?.event?.homeTeam || '');
    const awayTeam = String(pick?.event?.awayTeam || '');
    const competition = String(pick?.event?.competition || '');
    const market = String(pick?.bet?.market || '');
    const selection = String(pick?.bet?.selection || '');
    const systemId = String(pick?.system?.id || '');
    const kickoffAt = pick?.event?.kickoffAt ? (pick.event.kickoffAt instanceof Date ? pick.event.kickoffAt.toISOString() : String(pick.event.kickoffAt)) : now.toISOString();
    const publishedAt = pick?.publishedAt ? (pick.publishedAt instanceof Date ? pick.publishedAt.toISOString() : String(pick.publishedAt)) : now.toISOString();

    return {
        schemaVersion: 1,
        bankId: bank.id,
        date,
        time,
        bookmaker: 'Bet365',
        betMode: 'simple',
        title: `${homeTeam} vs ${awayTeam}`,
        market,
        selection,
        displayMarket: market,
        displaySelection: selection,
        status: 'pending',
        category: 'Money Tips',
        odds,
        amount,
        stake,
        officialPickId: String(pick.id || ''),
        officialPublishedAt: publishedAt,
        officialRecommendedStakePct: stake,
        officialPickSnapshot: officialPickSnapshotForBank(pick),
        copiedOdds: odds,
        isOfficialPickCopy: true,
        source: 'OFFICIAL_MONEY_TIPS',
        competition,
        systemId,
        kickoffAt,
        publishedAt,
        event: {
            homeTeam,
            awayTeam,
            competition,
            kickoffAt
        },
        isBack: true,
        isLive: false,
        isFreebet: false,
        isEachWay: false,
        isHidden: false,
        createdAt: now.toISOString(),
        copiedAt: FieldValue.serverTimestamp(),
        selections: [{
            id: `official-${pick.id}`,
            title: `${homeTeam} vs ${awayTeam}`,
            selection,
            market,
            displayMarket: market,
            displaySelection: selection,
            sport: 'Fútbol',
            status: 'pending',
            category: 'Money Tips',
            competition,
            odds,
            isOpen: true
        }]
    };
};

/**
 * Encola una tarea durable de auto-copia en Firestore.
 * 
 * REGLA ARQUITECTÓNICA:
 * La tarea se persiste de forma durable con ID = pick.id antes de procesarse.
 * Idempotencia estricta: si ya existe la tarea, no se sobrescribe un estado completado.
 */
export const enqueueOfficialPickAutoCopyTask = async ({
    pick,
    db = null,
    now = new Date()
} = {}) => {
    if (!pick?.id) throw new Error('Falta identificador del pick oficial para encolar tarea de auto-copia');

    const database = db || getAdminDb();
    const taskRef = database.collection(AUTO_COPY_QUEUE_COLLECTION).doc(String(pick.id));
    const snap = await taskRef.get();

    if (snap.exists) {
        const data = snap.data();
        if (data.status === AUTO_COPY_TASK_STATUSES.COMPLETED) {
            return { enqueued: false, duplicate: true, status: data.status, taskId: snap.id };
        }
        return { enqueued: false, duplicate: true, status: data.status, taskId: snap.id };
    }

    const taskPayload = {
        schemaVersion: 1,
        officialPickId: String(pick.id),
        status: AUTO_COPY_TASK_STATUSES.PENDING,
        attempts: 0,
        maxAttempts: MAX_AUTO_COPY_ATTEMPTS,
        nextAttemptAt: FieldValue.serverTimestamp(),
        pickSnapshot: officialPickSnapshotForBank(pick),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    };

    await taskRef.set(taskPayload);

    await logSystemEvent({
        department: DEPARTMENTS.DATA_PERFORMANCE,
        workerId: WORKER_ID,
        eventType: 'official_pick.auto_copy_task_enqueued',
        status: EVENT_STATUSES.SUCCESS,
        payload: { officialPickId: pick.id, taskId: taskRef.id },
        rulesApplied: ['rule_durable_auto_copy_queue']
    }).catch(() => {});

    return { enqueued: true, duplicate: false, status: AUTO_COPY_TASK_STATUSES.PENDING, taskId: taskRef.id };
};

/**
 * Copia un pick oficial a la banca de temporada.
 * Idempotente por officialPickId en users/{ownerUid}/bets.
 */
export const copyOfficialPickToSeasonBank = async ({
    pick,
    db = null,
    ownerUid = null,
    now = new Date()
} = {}) => {
    if (!pick?.id) throw new Error('Falta identificador del pick oficial para auto-copia');

    const database = db || getAdminDb();
    const uid = ownerUid || getOfficialOwnerUid();

    const startedAt = now;
    await updateAgentState({
        id: WORKER_ID,
        name: 'Official Pick Auto-Copy Worker',
        department: DEPARTMENTS.DATA_PERFORMANCE,
        type: HQ_UNIT_TYPES.WORKER,
        status: HQ_UNIT_STATUSES.WORKING,
        currentTask: `Copiando pick oficial ${pick.id} a banca de temporada`,
        startedAt,
        actionsAvailable: ['copy_official_pick', 'retry_uncopied_picks']
    }).catch(() => {});

    const bank = await resolveCurrentOfficialSeasonBank({ db: database, ownerUid: uid });
    const userBetsCollection = database.collection('users').doc(uid).collection('bets');

    // 1. DEDUPLICACIÓN ESTRICTA: comprobar si ya existe en la banca
    const existingQuery = await userBetsCollection
        .where('officialPickId', '==', String(pick.id))
        .limit(1)
        .get();

    if (!existingQuery.empty) {
        const existingDoc = existingQuery.docs[0];
        const completedAt = new Date();
        await updateAgentState({
            id: WORKER_ID,
            status: HQ_UNIT_STATUSES.IDLE,
            currentTask: 'Auto-copia finalizada (duplicado omitido)',
            startedAt,
            completedAt,
            lastActivity: completedAt,
            result: { copied: false, duplicate: true, betId: existingDoc.id, bankId: bank.id }
        }).catch(() => {});

        return { copied: false, duplicate: true, betId: existingDoc.id, bankId: bank.id };
    }

    // 2. Inserción de la nueva apuesta
    const betPayload = buildOfficialSeasonBetPayload({ pick, bank, now });
    const newBetRef = await userBetsCollection.add(betPayload);

    // 3. Registro auditable en systemEvents para Money Tips HQ
    await logSystemEvent({
        department: DEPARTMENTS.DATA_PERFORMANCE,
        workerId: WORKER_ID,
        eventType: 'official_pick.copied',
        status: EVENT_STATUSES.SUCCESS,
        payload: {
            officialPickId: pick.id,
            betId: newBetRef.id,
            bankId: bank.id,
            bankName: bank.name,
            amount: betPayload.amount,
            odds: betPayload.odds,
            stake: betPayload.stake
        },
        rulesApplied: ['rule_auto_copy_season_bank', 'rule_single_source_of_truth_pnl'],
        output: { copied: true, betId: newBetRef.id, bankId: bank.id }
    }).catch((err) => console.error('Error emitiendo evento de auto-copia:', err));

    const completedAt = new Date();
    await updateAgentState({
        id: WORKER_ID,
        status: HQ_UNIT_STATUSES.IDLE,
        currentTask: 'Auto-copia completada con éxito',
        startedAt,
        completedAt,
        lastActivity: completedAt,
        result: { copied: true, duplicate: false, betId: newBetRef.id, bankId: bank.id }
    }).catch(() => {});

    return { copied: true, duplicate: false, betId: newBetRef.id, bankId: bank.id };
};

/**
 * Procesa una tarea durable individual de auto-copia con soporte completo
 * de reintentos con backoff exponencial e informe de incidencias en operationsIncidents.
 */
export const processOfficialPickAutoCopyTask = async ({
    pickId,
    pick = null,
    db = null,
    ownerUid = null,
    now = new Date()
} = {}) => {
    if (!pickId && !pick?.id) throw new Error('Falta identificador de tarea / pick');
    const id = String(pickId || pick.id);
    const database = db || getAdminDb();
    const uid = ownerUid || getOfficialOwnerUid();
    const taskRef = database.collection(AUTO_COPY_QUEUE_COLLECTION).doc(id);

    let taskSnap = await taskRef.get();
    if (!taskSnap.exists) {
        // Si no existía tarea durable previa, garantizar persistencia
        await enqueueOfficialPickAutoCopyTask({ pick: pick || { id }, db, now });
        taskSnap = await taskRef.get();
    }

    const taskData = taskSnap.data() || {};
    if (taskData.status === AUTO_COPY_TASK_STATUSES.COMPLETED) {
        return { copied: false, duplicate: true, status: AUTO_COPY_TASK_STATUSES.COMPLETED, betId: taskData.betId };
    }

    // Resolver datos del pick si no fueron pasados en memoria
    let pickToCopy = pick;
    if (!pickToCopy) {
        const officialSnap = await db.collection('officialPicks').doc(id).get();
        if (officialSnap.exists) {
            pickToCopy = { ...officialSnap.data(), id: officialSnap.id };
        } else if (taskData.pickSnapshot) {
            pickToCopy = { ...taskData.pickSnapshot, id };
        }
    }

    // Marcamos tarea en procesamiento
    await taskRef.update({
        status: AUTO_COPY_TASK_STATUSES.PROCESSING,
        updatedAt: FieldValue.serverTimestamp()
    }).catch(() => {});

    try {
        const outcome = await copyOfficialPickToSeasonBank({ pick: pickToCopy, db, ownerUid, now });

        // Tarea completada con éxito
        await taskRef.update({
            status: AUTO_COPY_TASK_STATUSES.COMPLETED,
            betId: outcome.betId || null,
            bankId: outcome.bankId || null,
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            lastError: FieldValue.delete()
        });

        return {
            copied: outcome.copied,
            duplicate: outcome.duplicate,
            status: AUTO_COPY_TASK_STATUSES.COMPLETED,
            betId: outcome.betId,
            bankId: outcome.bankId
        };
    } catch (error) {
        console.error(`[AutoCopyWorker] Error procesando tarea ${id}:`, error);

        const currentAttempts = Number(taskData.attempts || 0) + 1;
        const canRetry = currentAttempts < MAX_AUTO_COPY_ATTEMPTS;

        if (canRetry) {
            const delay = RETRY_DELAYS_MS[Math.min(currentAttempts - 1, RETRY_DELAYS_MS.length - 1)];
            const nextAttemptAt = new Date(now.getTime() + delay);

            await taskRef.update({
                status: AUTO_COPY_TASK_STATUSES.PENDING,
                attempts: currentAttempts,
                nextAttemptAt: Timestamp.fromDate(nextAttemptAt),
                lastError: String(error.message || '').slice(0, 300),
                updatedAt: FieldValue.serverTimestamp()
            });

            await logSystemEvent({
                department: DEPARTMENTS.DATA_PERFORMANCE,
                workerId: WORKER_ID,
                eventType: 'official_pick.copy_retry_scheduled',
                status: EVENT_STATUSES.WARNING,
                payload: {
                    officialPickId: id,
                    attempts: currentAttempts,
                    nextAttemptAt: nextAttemptAt.toISOString(),
                    error: error.message
                },
                rulesApplied: ['rule_auto_copy_retry_backoff']
            }).catch(() => {});

            await updateAgentState({
                id: WORKER_ID,
                status: HQ_UNIT_STATUSES.WORKING,
                currentTask: `Reintento programado para pick ${id} (intento ${currentAttempts}/${MAX_AUTO_COPY_ATTEMPTS})`,
                lastActivity: new Date(),
                error: { message: error.message, attempts: currentAttempts }
            }).catch(() => {});

            return {
                copied: false,
                status: AUTO_COPY_TASK_STATUSES.PENDING,
                retryRequired: true,
                attempts: currentAttempts,
                nextAttemptAt,
                error: error.message
            };
        } else {
            // Intentos agotados -> marcar FAILED y registrar incidencia en operationsIncidents
            await taskRef.update({
                status: AUTO_COPY_TASK_STATUSES.FAILED,
                attempts: currentAttempts,
                failedAt: FieldValue.serverTimestamp(),
                lastError: String(error.message || '').slice(0, 300),
                updatedAt: FieldValue.serverTimestamp()
            });

            await logSystemEvent({
                department: DEPARTMENTS.DATA_PERFORMANCE,
                workerId: WORKER_ID,
                eventType: 'official_pick.copy_failed',
                status: EVENT_STATUSES.ERROR,
                payload: {
                    officialPickId: id,
                    attempts: currentAttempts,
                    error: error.message
                },
                rulesApplied: ['rule_auto_copy_exhausted_retries']
            }).catch(() => {});

            await updateAgentState({
                id: WORKER_ID,
                status: HQ_UNIT_STATUSES.ERROR,
                currentTask: `Error definitivo en auto-copia del pick ${id}`,
                lastActivity: new Date(),
                error: { message: error.message, attempts: currentAttempts }
            }).catch(() => {});

            // REGLA ARQUITECTÓNICA: Registrar en operationsIncidents con department: data_performance
            await registerOperationsIncident({
                department: DEPARTMENTS.DATA_PERFORMANCE,
                incidentType: OPERATIONS_INCIDENT_TYPES.AUTO_COPY_FAILED,
                targetId: id,
                reason: `Auto-copia fallida tras ${currentAttempts} intentos: ${error.message}. El pick permanece publicado y requiere intervención técnica.`,
                escalateTo: OPERATIONS_ESCALATION_TARGETS.KAREN,
                details: { officialPickId: id, attempts: currentAttempts, error: error.message },
                db
            }).catch(() => {});

            return {
                copied: false,
                status: AUTO_COPY_TASK_STATUSES.FAILED,
                retryRequired: false,
                failed: true,
                attempts: currentAttempts,
                error: error.message
            };
        }
    }
};

/**
 * Escanea y procesa tareas vencidas en la cola durable officialPickAutoCopyQueue.
 */
export const processDueOfficialPickAutoCopyTasks = async ({
    db = null,
    ownerUid = null,
    now = new Date(),
    limit = 20
} = {}) => {
    const dueSnap = await db.collection(AUTO_COPY_QUEUE_COLLECTION)
        .where('status', '==', AUTO_COPY_TASK_STATUSES.PENDING)
        .where('nextAttemptAt', '<=', Timestamp.fromDate(now))
        .limit(limit)
        .get();

    const summary = {
        scanned: dueSnap.size,
        completed: 0,
        retried: 0,
        failed: 0,
        errors: 0
    };

    for (const docSnapshot of dueSnap.docs) {
        try {
            const result = await processOfficialPickAutoCopyTask({
                pickId: docSnapshot.id,
                db,
                ownerUid,
                now
            });
            if (result.status === AUTO_COPY_TASK_STATUSES.COMPLETED) summary.completed += 1;
            else if (result.retryRequired) summary.retried += 1;
            else if (result.failed) summary.failed += 1;
        } catch (err) {
            summary.errors += 1;
            console.error(`Error procesando tarea debida ${docSnapshot.id}:`, err);
        }
    }

    return summary;
};

/**
 * Despachador desacoplado y seguro invocado tras la publicación de un pick oficial.
 *
 * REGLA DE ORO:
 * 1. Primero persiste la tarea durable en Firestore (garantía ante caída de serverless).
 * 2. Intenta el copiado inmediato.
 * 3. Si falla, el error es atrapado y la publicación oficial NUNCA se revierte ni se detiene.
 */
export const dispatchOfficialPickAutoCopy = async (pick, {
    db = null,
    ownerUid = null,
    now = new Date()
} = {}) => {
    assertNoMorningShadowMutation();
    if (!pick?.id) return { copied: false, error: 'Falta identificador del pick', retryRequired: true };

    try {
        const database = db || getAdminDb();
        const uid = ownerUid || getOfficialOwnerUid();

        // Paso 1: Encolar de forma durable en Firestore
        await enqueueOfficialPickAutoCopyTask({ pick, db: database, now });

        // Paso 2: Procesar la tarea de inmediato
        return await processOfficialPickAutoCopyTask({ pickId: pick.id, pick, db: database, ownerUid: uid, now });
    } catch (error) {
        console.error(`[AutoCopyDispatcher] Excepción no bloqueante en pick ${pick?.id}:`, error);
        return { copied: false, error: error.message, nonBlocking: true, retryRequired: true };
    }
};

/**
 * Escáner de reconciliación de seguridad secundaria.
 * Revisa picks oficiales publicados que por alguna razón no estén en la banca de temporada.
 */
export const catchUpUncopiedOfficialPicks = async ({
    db = null,
    ownerUid = null,
    limit = 20,
    now = new Date()
} = {}) => {
    const userBetsCollection = db.collection('users').doc(ownerUid).collection('bets');

    const picksSnapshot = await db.collection('officialPicks')
        .where('status', '==', 'published')
        .orderBy('publishedAt', 'desc')
        .limit(limit)
        .get();

    const results = {
        scanned: picksSnapshot.size,
        enqueued: 0,
        copied: 0,
        alreadyCopied: 0,
        errors: 0
    };

    for (const docSnapshot of picksSnapshot.docs) {
        const pick = { ...docSnapshot.data(), id: docSnapshot.id };
        try {
            // Comprobar si ya existe en la banca
            const betSnap = await userBetsCollection
                .where('officialPickId', '==', pick.id)
                .limit(1)
                .get();

            if (!betSnap.empty) {
                results.alreadyCopied += 1;
                continue;
            }

            // Si falta, encolar y procesar mediante la cola durable
            const outcome = await dispatchOfficialPickAutoCopy(pick, { db, ownerUid, now });
            if (outcome.copied) results.copied += 1;
            else results.enqueued += 1;
        } catch (err) {
            results.errors += 1;
            console.error(`Error durante catch-up para pick ${pick.id}:`, err);
        }
    }

    return results;
};
