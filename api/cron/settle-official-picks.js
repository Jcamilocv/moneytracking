/**
 * @file api/cron/settle-official-picks.js
 * 
 * Endpoint de liquidación canónica diaria a las 01:00 Europe/Madrid (P1.5 / P2.1).
 * 
 * Reglas de producción:
 * 1. Solo picks PENDING.
 * 2. TheSportsDB como provider principal.
 * 3. Reglas Bet365 aprobadas (FT 90min, 5 días aplazado -> VOID, 48h suspendido, AET/PEN -> bloqueado).
 * 4. Idempotente (no vuelve a liquidar picks resueltos).
 * 5. DST-safe durante todo el año:
 *    - Programado a las 23:00 UTC (01:00 CEST en verano) y a las 00:00 UTC (01:00 CET en invierno).
 *    - Handler valida que en Europe/Madrid sea estrictamente la hora 01:xx.
 *    - Lock por fecha Madrid en cronLocks/settlement-YYYY-MM-DD previene doble ejecución.
 * 6. SPORTS_DATA_UNMATCHED -> reintento de matching.
 * 7. REGULATION_SCORE_UNAVAILABLE -> no liquidar (bloqueado para revisión).
 */

import { TheSportsDbProvider, CanonicalSettlementScheduler, SETTLEMENT_CYCLE_STATUSES, SETTLEMENT_OUTCOMES } from '../../server/sports-data/index.js';
import { getAdminDb } from '../_lib/firebase-admin.js';
import { getOfficialOwnerUid } from '../../server/official-season-bank.js';
import { FieldValue } from 'firebase-admin/firestore';

export const getMadridDateTime = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);

    const get = (type) => parts.find(p => p.type === type)?.value;
    const year = get('year');
    const month = get('month');
    const day = get('day');
    let hour = get('hour');
    if (hour === '24') hour = '00';
    const minute = get('minute');
    const second = get('second');

    return {
        dateStr: `${year}-${month}-${day}`, // YYYY-MM-DD
        hour, // '00' to '23'
        minute,
        second,
        fullMadridTime: `${year}-${month}-${day} ${hour}:${minute}:${second}`
    };
};

const isAuthorizedCron = (req) => {
    const authHeader = req.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET || process.env.OFFICIAL_PICKS_DISPATCHER_SECRET;
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const isBearer = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
    const isQuerySecret = Boolean(cronSecret) && req.query?.secret === cronSecret;
    return isVercelCron || isBearer || isQuerySecret;
};

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { dateStr: madridDate, hour: madridHour, fullMadridTime } = getMadridDateTime();

    // Health check público / comprobación de estado
    if (req.method === 'GET' && !isAuthorizedCron(req) && (req.query?.status === '1' || !req.headers.authorization)) {
        return res.status(200).json({
            ok: true,
            service: 'settle-official-picks',
            scheduler: '01:00 Europe/Madrid',
            active: true,
            timezone: 'Europe/Madrid',
            currentMadridDate: madridDate,
            currentMadridHour: madridHour,
            currentMadridTime: fullMadridTime,
            provider: 'TheSportsDB',
            bet365Rules: 'ENABLED',
            schedulesUtc: ['0 23 * * *', '0 0 * * *'],
            dstSafe: true,
            doubleRunProtection: 'ENABLED'
        });
    }

    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'No autorizado para ejecutar liquidación de picks.' });
    }

    try {
        const isForced = req.query?.force === 'true' || req.query?.force === '1';

        // 1. Verificación DST-Safe: Solo ejecutar si en Madrid es exactamente la hora 01:xx
        if (!isForced && madridHour !== '01') {
            return res.status(200).json({
                ok: true,
                executed: false,
                skipped: true,
                reason: `Hora actual en Madrid es ${madridHour}:xx. El scheduler se ejecuta exclusivamente a las 01:00 Europe/Madrid.`,
                madridHour,
                madridDate,
                timezone: 'Europe/Madrid'
            });
        }

        const db = getAdminDb();
        const ownerUid = getOfficialOwnerUid();

        // 2. Lock / Prevención de doble ejecución por fecha Madrid
        const lockRef = db.collection('cronLocks').doc(`settlement-${madridDate}`);
        if (!isForced) {
            const lockSnap = await lockRef.get();
            if (lockSnap.exists && lockSnap.data()?.status === 'completed') {
                return res.status(200).json({
                    ok: true,
                    executed: false,
                    skipped: true,
                    doubleRunPrevented: true,
                    reason: `Liquidación para la fecha Madrid ${madridDate} ya fue completada a las ${lockSnap.data()?.completedAt}. Doble ejecución prevenida.`,
                    madridDate,
                    completedAt: lockSnap.data()?.completedAt
                });
            }
        }

        // 3. Escanear picks pendientes en la banca de temporada
        const userBetsRef = db.collection('users').doc(ownerUid).collection('bets');
        const pendingBetsSnap = await userBetsRef.where('status', '==', 'pending').get();

        if (pendingBetsSnap.empty) {
            // Registrar ejecución completada para evitar doble ejecución el mismo día
            if (!isForced) {
                await lockRef.set({
                    status: 'completed',
                    madridDate,
                    madridHour,
                    completedAt: new Date().toISOString(),
                    scanned: 0,
                    settled: 0,
                    pending: 0
                }, { merge: true });
            }

            return res.status(200).json({
                ok: true,
                executed: true,
                scheduler: '01:00 Europe/Madrid',
                scanned: 0,
                settled: 0,
                pending: 0,
                madridDate,
                message: 'No hay picks pendientes en la banca para liquidar.',
                timestamp: new Date().toISOString()
            });
        }

        // 4. Inicializar TheSportsDbProvider y CanonicalSettlementScheduler
        const theSportsDb = new TheSportsDbProvider({
            apiKey: process.env.THESPORTSDB_API_KEY || '3'
        });

        const scheduler = new CanonicalSettlementScheduler({
            sportsDataProvider: theSportsDb,
            cronActive: true,
            scheduleTime: '01:00',
            timezone: 'Europe/Madrid',
            dryRun: false
        });

        // 5. Mapear picks pendientes al formato requerido por el evaluador
        const pendingPicks = pendingBetsSnap.docs.map(doc => {
            const bet = doc.data();
            const firstSel = bet.selections?.[0] || {};
            const title = bet.title || firstSel.title || '';
            const teams = title.includes(' vs ') ? title.split(' vs ') : title.split(' - ');
            const homeTeam = teams[0]?.trim() || '';
            const awayTeam = teams[1]?.trim() || '';

            return {
                id: doc.id,
                betDocId: doc.id,
                officialPickId: bet.officialPickId || null,
                fixtureId: bet.providerEventId || bet.officialPickSnapshot?.event?.sourceEventId || null,
                sportsDataStatus: bet.sportsDataStatus || (bet.providerEventId ? 'MATCHED' : 'SPORTS_DATA_UNMATCHED'),
                homeTeam,
                awayTeam,
                competitionCode: bet.competition || bet.officialPickSnapshot?.event?.competition || '',
                kickoffAt: bet.kickoffAt || bet.date,
                market: bet.market || bet.displayMarket || firstSel.market || '',
                selection: bet.selection || bet.displaySelection || firstSel.selection || ''
            };
        });

        // 6. Ejecutar ciclo de liquidación
        const cycleResult = await scheduler.runSettlementCycle(pendingPicks);

        // 7. Aplicar mutaciones en Firestore solo para los picks que resultaron SETTLED
        let mutatedCount = 0;
        for (const item of cycleResult.results) {
            const { candidate, evaluation } = item;
            if (evaluation.status === SETTLEMENT_CYCLE_STATUSES.SETTLED) {
                const outcome = evaluation.outcome.toLowerCase(); // 'won', 'lost', 'void'
                const finalScore = (evaluation.homeScore !== null && evaluation.awayScore !== null)
                    ? `${evaluation.homeScore}-${evaluation.awayScore}`
                    : null;

                const betDocRef = userBetsRef.doc(candidate.betDocId);
                await betDocRef.update({
                    status: outcome,
                    settlementOutcome: evaluation.outcome,
                    settlementReason: evaluation.explanation,
                    finalScore: finalScore || FieldValue.delete(),
                    providerEventId: evaluation.fixtureId || FieldValue.delete(),
                    settledAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });

                // Si está vinculado a officialPicks, actualizar también el ledger oficial
                if (candidate.officialPickId) {
                    const pickRef = db.collection('officialPicks').doc(candidate.officialPickId);
                    const pickSnap = await pickRef.get();
                    if (pickSnap.exists && !pickSnap.data()?.settlement?.status) {
                        await pickRef.update({
                            settlement: {
                                status: outcome,
                                outcome: evaluation.outcome,
                                reason: evaluation.explanation,
                                finalScore: finalScore || null,
                                providerEventId: evaluation.fixtureId || null,
                                settledAt: FieldValue.serverTimestamp()
                            }
                        });
                    }
                }

                mutatedCount++;
            }
        }

        // 8. Registrar lock de ejecución completada para la fecha Madrid
        if (!isForced) {
            await lockRef.set({
                status: 'completed',
                madridDate,
                madridHour,
                completedAt: new Date().toISOString(),
                scanned: pendingPicks.length,
                settled: mutatedCount
            }, { merge: true });
        }

        return res.status(200).json({
            ok: true,
            executed: true,
            scheduler: '01:00 Europe/Madrid',
            scanned: pendingPicks.length,
            settled: mutatedCount,
            blocked: cycleResult.stats.picksBlocked,
            pendingData: cycleResult.stats.picksPendingData,
            stats: cycleResult.stats,
            madridDate,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en scheduler 01:00 de liquidación:', error);
        return res.status(500).json({
            ok: false,
            error: error.message || 'Error interno en scheduler de liquidación'
        });
    }
}
