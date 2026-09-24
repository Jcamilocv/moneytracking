/**
 * @file Scheduler Canónico de Settlement a las 01:00 Europe/Madrid (P1.5).
 * 
 * Responsabilidades:
 * 1. Revisión programada diaria de picks pendientes a las 01:00 Europe/Madrid.
 * 2. Aplicación de las reglas oficiales Bet365:
 *    - FT → Settlement según mercado y selección.
 *    - PST / CANC → Política Bet365 (5 días: PENDING si <= 5 días, VOID si > 5 días).
 *    - INT / SUSP → Política Bet365 (48h: REMAINS_VALID si finaliza en 48h, sino tratar como ABD).
 *    - ABD → VOID, salvo mercados matemáticamente determinados previamente (ej. Over con goles cumplidos).
 *    - AET / PEN / AP sin score a 90' → REGULATION_SCORE_UNAVAILABLE (bloqueado para evitar error).
 *    - Resultado no disponible → PENDING_DATA.
 *    - SPORTS_DATA_UNMATCHED → Reintentar matching con el proveedor antes de bloquear.
 * 
 * SEGURIDAD ABSOLUTA:
 * - Feature flag real en OFF: CRON_ACTIVE = false.
 * - 0 escrituras en Firestore en modo simulación/dry-run.
 * - 0 mensajes salientes a Telegram.
 * - 0 mutaciones en producción.
 * 
 * Provider-agnostic: Opera sobre SportsDataProvider (TheSportsDbProvider, ApiFootballProvider).
 */

import { evaluatePickSettlement, SETTLEMENT_OUTCOMES } from './settlement-evaluator.js';
import { getTheSportsDbStatusInfo, BET365_RULES, evaluateBet365Postponed, evaluateBet365Interrupted } from './thesportsdb-status-registry.js';
import { reconcileCandidateWithSportsData, RECONCILIATION_STATUSES } from './sports-data-reconciler.js';

export const SETTLEMENT_CYCLE_STATUSES = {
    SETTLED: 'SETTLED',
    BLOCKED: 'BLOCKED',
    PENDING_DATA: 'PENDING_DATA'
};

export class CanonicalSettlementScheduler {
    constructor({
        sportsDataProvider,
        cronActive = false, // Feature flag canónica: OFF por defecto
        scheduleTime = '01:00',
        timezone = 'Europe/Madrid',
        dryRun = true
    } = {}) {
        if (!sportsDataProvider) {
            throw new Error('CanonicalSettlementScheduler requiere una instancia de SportsDataProvider');
        }
        this.provider = sportsDataProvider;
        this.cronActive = Boolean(cronActive && process.env.CANONICAL_SETTLEMENT_CRON_ENABLED === 'true');
        this.scheduleTime = scheduleTime;
        this.timezone = timezone;
        this.dryRun = Boolean(dryRun);

        this.stats = {
            cyclesRun: 0,
            picksProcessed: 0,
            picksSettled: 0,
            picksBlocked: 0,
            picksPendingData: 0,
            unmatchedRetried: 0,
            unmatchedRecovered: 0,
            firestoreWrites: 0,
            telegramOutbound: 0,
            productionMutations: 0
        };
    }

    isCronActive() {
        return this.cronActive;
    }

    getSafetyReport() {
        return {
            cronActive: this.cronActive,
            dryRun: this.dryRun,
            firestoreWrites: this.stats.firestoreWrites,
            telegramOutbound: this.stats.telegramOutbound,
            productionMutations: this.stats.productionMutations,
            scheduleTime: `${this.scheduleTime} ${this.timezone}`
        };
    }

    /**
     * Ejecuta el ciclo de liquidación para un lote de picks pendientes.
     * 
     * @param {Array<Object>} pendingPicks
     * @param {Object} [options]
     * @param {Date} [options.referenceDate] Fecha de referencia de ejecución (por defecto: now)
     * @returns {Promise<Object>}
     */
    async runSettlementCycle(pendingPicks = [], { referenceDate = new Date() } = {}) {
        this.stats.cyclesRun++;
        const results = [];

        for (const pick of pendingPicks) {
            this.stats.picksProcessed++;
            const evaluated = await this.evaluatePick(pick, { referenceDate });
            results.push({
                pickId: pick.id || pick.fingerprint || pick.telegramMessageId,
                candidate: pick,
                evaluation: evaluated
            });

            if (evaluated.status === SETTLEMENT_CYCLE_STATUSES.SETTLED) {
                this.stats.picksSettled++;
            } else if (evaluated.status === SETTLEMENT_CYCLE_STATUSES.BLOCKED) {
                this.stats.picksBlocked++;
            } else if (evaluated.status === SETTLEMENT_CYCLE_STATUSES.PENDING_DATA) {
                this.stats.picksPendingData++;
            }
        }

        return {
            cycleTimestamp: referenceDate.toISOString(),
            scheduleConfig: `${this.scheduleTime} ${this.timezone}`,
            cronActive: this.cronActive,
            dryRun: this.dryRun,
            stats: { ...this.stats },
            results,
            safety: this.getSafetyReport()
        };
    }

    /**
     * Evalúa individualmente un pick pendiente contra el proveedor de datos.
     */
    async evaluatePick(pick = {}, { referenceDate = new Date() } = {}) {
        let fixtureId = pick.fixtureId || pick.sportsData?.fixtureId || null;
        let sportsDataStatus = pick.sportsDataStatus || pick.sportsData?.status || 'UNKNOWN';

        // 1. Si el pick estaba SPORTS_DATA_UNMATCHED o sin fixtureId:
        // Reintentar matching antes de bloquear
        if (!fixtureId || sportsDataStatus === RECONCILIATION_STATUSES.SPORTS_DATA_UNMATCHED) {
            this.stats.unmatchedRetried++;
            try {
                const retryReconciliation = await reconcileCandidateWithSportsData(pick, this.provider);
                if (retryReconciliation.status === RECONCILIATION_STATUSES.MATCHED && retryReconciliation.fixtureId) {
                    this.stats.unmatchedRecovered++;
                    fixtureId = retryReconciliation.fixtureId;
                    sportsDataStatus = RECONCILIATION_STATUSES.MATCHED;
                } else {
                    return {
                        status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                        reason: 'SPORTS_DATA_UNMATCHED_RETRY_FAILED',
                        explanation: 'El pick no pudo ser emparejado con el proveedor en el reintento de las 01:00. Queda pendiente para revisión.',
                        fixtureId: null
                    };
                }
            } catch (retryErr) {
                return {
                    status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                    reason: 'SPORTS_DATA_RETRY_ERROR',
                    explanation: `Error al reintentar matching: ${retryErr.message}`,
                    fixtureId: null
                };
            }
        }

        // 2. Consulta de evento en el SportsDataProvider
        let event = null;
        try {
            event = await this.provider.getEvent(fixtureId);
        } catch (netErr) {
            return {
                status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                reason: 'PROVIDER_LOOKUP_ERROR',
                explanation: `Error de red al consultar fixture ${fixtureId}: ${netErr.message}`,
                fixtureId
            };
        }

        if (!event || !event.strStatus) {
            return {
                status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                reason: 'RESULT_NOT_AVAILABLE',
                explanation: `Evento ${fixtureId} no encontrado o sin estado en el proveedor`,
                fixtureId
            };
        }

        const rawStatus = event.strStatus;
        const statusInfo = getTheSportsDbStatusInfo(rawStatus);
        const hasScores = event.intHomeScore !== null && event.intHomeScore !== undefined &&
                          event.intAwayScore !== null && event.intAwayScore !== undefined &&
                          event.intHomeScore !== '' && event.intAwayScore !== '';

        const homeScore = hasScores ? Number(event.intHomeScore) : null;
        const awayScore = hasScores ? Number(event.intAwayScore) : null;

        // 3. Casos de liquidación según reglas Bet365

        // CASO A: FT (Final Time)
        if (rawStatus === 'FT') {
            if (hasScores && pick.market && pick.selection) {
                try {
                    const evalResult = evaluatePickSettlement({
                        market: pick.market,
                        selection: pick.selection,
                        homeGoals: homeScore,
                        awayGoals: awayScore
                    });

                    return {
                        status: SETTLEMENT_CYCLE_STATUSES.SETTLED,
                        outcome: evalResult.outcome,
                        explanation: evalResult.explanation,
                        homeScore,
                        awayScore,
                        fixtureId,
                        eventStatus: rawStatus
                    };
                } catch (settleErr) {
                    return {
                        status: SETTLEMENT_CYCLE_STATUSES.BLOCKED,
                        reason: 'MARKET_EVALUATION_ERROR',
                        explanation: settleErr.message,
                        fixtureId
                    };
                }
            } else {
                return {
                    status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                    reason: 'SCORES_MISSING_IN_FT_EVENT',
                    explanation: 'Partido en FT pero sin goles registrados en el proveedor',
                    fixtureId
                };
            }
        }

        // CASO B: AET / PEN / AP (Prórroga o penaltis sin marcador 90 min)
        if (rawStatus === 'AET' || rawStatus === 'PEN' || rawStatus === 'AP') {
            return {
                status: SETTLEMENT_CYCLE_STATUSES.BLOCKED,
                reason: BET365_RULES.REGULATION_SCORE_UNAVAILABLE_CODE,
                explanation: 'Marcador en el proveedor incluye prórroga (120 min). Bloqueado por regla Bet365 de tiempo reglamentario.',
                fixtureId,
                eventStatus: rawStatus
            };
        }

        // CASO C: PST / CANC (Aplazado / Cancelado)
        if (rawStatus === 'PST' || rawStatus === 'CANC') {
            const postEval = evaluateBet365Postponed({
                originalKickoff: pick.kickoffAt || event.dateEvent,
                rescheduledKickoff: event.strTimestamp,
                currentTime: referenceDate
            });

            if (postEval.outcome === 'VOID') {
                return {
                    status: SETTLEMENT_CYCLE_STATUSES.SETTLED,
                    outcome: SETTLEMENT_OUTCOMES.VOID,
                    explanation: postEval.explanation,
                    fixtureId,
                    eventStatus: rawStatus
                };
            } else {
                return {
                    status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                    reason: 'POSTPONED_PENDING_RESCHEDULE',
                    explanation: postEval.explanation,
                    fixtureId,
                    eventStatus: rawStatus
                };
            }
        }

        // CASO D: INT / SUSP (Interrumpido / Suspendido)
        if (rawStatus === 'INT' || rawStatus === 'SUSP') {
            const intEval = evaluateBet365Interrupted({
                originalKickoff: pick.kickoffAt || event.dateEvent,
                resumedFinishTime: event.resumedFinishTime,
                currentTime: referenceDate
            });

            if (intEval.outcome === 'ABANDONED') {
                // Tratar como abandonado
                return this._evaluateAbandoned({ pick, homeScore, awayScore, fixtureId, rawStatus });
            } else {
                return {
                    status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
                    reason: 'INTERRUPTED_AWAITING_RESUME_48H',
                    explanation: intEval.explanation,
                    fixtureId,
                    eventStatus: rawStatus
                };
            }
        }

        // CASO E: ABD (Abandonado)
        if (rawStatus === 'ABD') {
            return this._evaluateAbandoned({ pick, homeScore, awayScore, fixtureId, rawStatus });
        }

        // CASO F: Otros estados (NS, 1H, HT, 2H) -> Pendiente de finalización
        return {
            status: SETTLEMENT_CYCLE_STATUSES.PENDING_DATA,
            reason: 'MATCH_IN_PROGRESS_OR_NOT_STARTED',
            explanation: `Partido en estado ${rawStatus} (${statusInfo.meaning})`,
            fixtureId,
            eventStatus: rawStatus
        };
    }

    /**
     * Aplica la regla Bet365 para partidos abandonados.
     */
    _evaluateAbandoned({ pick, homeScore, awayScore, fixtureId, rawStatus }) {
        if (pick.market && pick.selection && homeScore !== null && awayScore !== null) {
            try {
                const evalCandidate = evaluatePickSettlement({
                    market: pick.market,
                    selection: pick.selection,
                    homeGoals: homeScore,
                    awayGoals: awayScore
                });

                // Si el resultado ya estaba determinado matemáticamente antes del abandono
                // (ej. Over 2.5 con 3+ goles anotados)
                const isOverMarket = /total|over|mas/i.test(pick.market);
                if (evalCandidate.outcome === SETTLEMENT_OUTCOMES.WON && isOverMarket) {
                    return {
                        status: SETTLEMENT_CYCLE_STATUSES.SETTLED,
                        outcome: SETTLEMENT_OUTCOMES.WON,
                        explanation: 'Mercado matemáticamente determinado antes del abandono según regla Bet365.',
                        homeScore,
                        awayScore,
                        fixtureId,
                        eventStatus: rawStatus
                    };
                }
            } catch {
                // Proceder a VOID
            }
        }

        // Mercado no determinado matemáticamente -> VOID según Bet365
        return {
            status: SETTLEMENT_CYCLE_STATUSES.SETTLED,
            outcome: SETTLEMENT_OUTCOMES.VOID,
            explanation: 'Partido abandonado sin determinación matemática previa del mercado. Liquidado como VOID según Bet365.',
            fixtureId,
            eventStatus: rawStatus
        };
    }
}
