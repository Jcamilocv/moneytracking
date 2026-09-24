/**
 * @file Pipeline de Shadow Integration para TheSportsDB (P1.3).
 * 
 * Flujo de ejecución en modo 100% DRY_RUN / SHADOW_MODE:
 * FutbolBrain candidate
 * → TheSportsDB search
 * → strict fixture match
 * → idEvent
 * → kickoff reconciliation
 * → simulated publication decision
 * → simulated post-match lookup
 * → simulated settlement
 * 
 * REGLAS INVIOLABLES:
 * 1. Solo aceptar match inequívoco por competición + equipos + fecha.
 * 2. FALSE POSITIVE debe ser 0. Si hay ambigüedad: FIXTURE_MATCH_UNCERTAIN.
 * 3. Si el kickoff difiere de forma relevante: KICKOFF_MISMATCH_REVIEW (no auto-publicar ni auto-corregir).
 * 4. Adopción de providerKickoffAt solo cuando el fixture está inequívocamente identificado.
 * 5. Para AET/PEN sin score a 90 min: REGULATION_SCORE_UNAVAILABLE (settlement bloqueado).
 * 6. Reglas Bet365 aplicadas (5 días postponed, 48h interrupted, abandoned con mercados determinados).
 * 7. CERO escrituras en Firestore, CERO mensajes a Telegram, CERO cambios en producción.
 */

import { matchTheSportsDbEvent } from './thesportsdb-fixture-matcher.js';
import { buildCanonicalSearchQuery, inferSeason } from './team-normalizer.js';
import { getTheSportsDbStatusInfo, BET365_RULES, evaluateBet365Postponed, evaluateBet365Interrupted } from './thesportsdb-status-registry.js';
import { evaluatePickSettlement, SETTLEMENT_OUTCOMES } from './settlement-evaluator.js';

export const SHADOW_PIPELINE_DECISIONS = {
    WOULD_PUBLISH: 'WOULD_PUBLISH',
    WOULD_RECORD_PAPER: 'WOULD_RECORD_PAPER',
    HELD_FOR_REVIEW: 'HELD_FOR_REVIEW',
    BLOCKED_UNCERTAIN: 'BLOCKED_UNCERTAIN'
};

export const SHADOW_FIXTURE_MATCH_STATUS = {
    MATCHED: 'MATCHED',
    UNCERTAIN: 'FIXTURE_MATCH_UNCERTAIN',
    NOT_FOUND: 'NOT_FOUND'
};

export const SHADOW_KICKOFF_STATUS = {
    RECONCILED: 'KICKOFF_RECONCILED',
    MISMATCH_REVIEW: 'KICKOFF_MISMATCH_REVIEW',
    UNKNOWN: 'KICKOFF_UNKNOWN'
};

export class TheSportsDbShadowPipeline {
    constructor({ provider, dryRun = true } = {}) {
        if (!provider) {
            throw new Error('TheSportsDbShadowPipeline requiere una instancia de TheSportsDbProvider');
        }
        this.provider = provider;
        this.dryRun = Boolean(dryRun);

        this.telemetry = {
            candidatesSeen: 0,
            fixturesMatched: 0,
            fixturesUncertain: 0,
            kickoffReconciled: 0,
            kickoffExplicableTimezone: 0,
            kickoffMismatch: 0,
            resultFound: 0,
            settlementSimulated: 0,
            settlementBlocked: 0,
            falsePositives: 0
        };
    }

    getTelemetry() {
        return { ...this.telemetry };
    }

    resetTelemetry() {
        for (const key of Object.keys(this.telemetry)) {
            this.telemetry[key] = 0;
        }
    }

    /**
     * Procesa un candidato de FutbolBrain a través del pipeline de Shadow Mode.
     * 
     * @param {Object} candidate
     * @param {string} candidate.homeTeam
     * @param {string} candidate.awayTeam
     * @param {string} [candidate.competitionCode]
     * @param {string|Date} candidate.kickoffAt
     * @param {string} [candidate.market]
     * @param {string} [candidate.selection]
     * @param {string} [candidate.executionMode] 'PRODUCTION' | 'PAPER'
     * @returns {Promise<Object>}
     */
    async processCandidate(candidate = {}) {
        this.telemetry.candidatesSeen++;

        const home = String(candidate.homeTeam || '').trim();
        const away = String(candidate.awayTeam || '').trim();
        const kickoff = candidate.kickoffAt instanceof Date
            ? candidate.kickoffAt.toISOString()
            : (candidate.kickoffAt ? String(candidate.kickoffAt) : null);
        const compCode = candidate.competitionCode || null;
        const market = candidate.market || null;
        const selection = candidate.selection || null;
        const executionMode = candidate.executionMode || 'PRODUCTION';

        if (!home || !away) {
            this.telemetry.fixturesUncertain++;
            return {
                status: SHADOW_FIXTURE_MATCH_STATUS.UNCERTAIN,
                reason: 'Candidato inválido: faltan nombres de equipos',
                telemetry: this.getTelemetry()
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        // 1. Búsqueda en TheSportsDB
        // ─────────────────────────────────────────────────────────────────────
        const season = inferSeason(kickoff);
        let rawEvents = [];
        let match = null;

        try {
            // Estrategia 1: Búsqueda con nombres originales y temporada
            const queryRaw = `${home} vs ${away}`;
            rawEvents = await this.provider.searchEvents(queryRaw, season || '');

            match = matchTheSportsDbEvent({
                competitionCode: compCode,
                homeTeam: home,
                awayTeam: away,
                kickoffAt: kickoff
            }, rawEvents);

            // Estrategia 2: Búsqueda canónica si no hay match
            if (!match.theSportsDbMatchFound) {
                const queryCanonical = buildCanonicalSearchQuery(home, away);
                if (queryCanonical !== queryRaw) {
                    const canonicalEvents = await this.provider.searchEvents(queryCanonical, season || '');
                    const canMatch = matchTheSportsDbEvent({
                        competitionCode: compCode,
                        homeTeam: home,
                        awayTeam: away,
                        kickoffAt: kickoff
                    }, canonicalEvents);

                    if (canMatch.theSportsDbMatchFound) {
                        rawEvents = canonicalEvents;
                        match = canMatch;
                    }
                }
            }

            // Estrategia 3: Búsqueda sin temporada si aún no hay match (ciertos eventos en TheSportsDB carecen de strSeason)
            if (!match.theSportsDbMatchFound && season) {
                const queryCanonical = buildCanonicalSearchQuery(home, away);
                const fallbackEvents = await this.provider.searchEvents(queryCanonical);
                const fbMatch = matchTheSportsDbEvent({
                    competitionCode: compCode,
                    homeTeam: home,
                    awayTeam: away,
                    kickoffAt: kickoff
                }, fallbackEvents);

                if (fbMatch.theSportsDbMatchFound) {
                    rawEvents = fallbackEvents;
                    match = fbMatch;
                } else if (queryCanonical !== queryRaw) {
                    const fallbackRaw = await this.provider.searchEvents(queryRaw);
                    const fbRawMatch = matchTheSportsDbEvent({
                        competitionCode: compCode,
                        homeTeam: home,
                        awayTeam: away,
                        kickoffAt: kickoff
                    }, fallbackRaw);
                    if (fbRawMatch.theSportsDbMatchFound) {
                        rawEvents = fallbackRaw;
                        match = fbRawMatch;
                    }
                }
            }
        } catch (err) {
            this.telemetry.fixturesUncertain++;
            return {
                status: SHADOW_FIXTURE_MATCH_STATUS.UNCERTAIN,
                reason: `Error de búsqueda en TheSportsDB: ${err.message}`,
                telemetry: this.getTelemetry()
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. Strict Fixture Match
        // ─────────────────────────────────────────────────────────────────────
        if (!match || !match.theSportsDbMatchFound) {
            this.telemetry.fixturesUncertain++;
            return {
                status: SHADOW_FIXTURE_MATCH_STATUS.NOT_FOUND,
                fixtureMatchStatus: SHADOW_FIXTURE_MATCH_STATUS.NOT_FOUND,
                candidate: { home, away, compCode, kickoff, market, selection },
                publicationDecision: SHADOW_PIPELINE_DECISIONS.BLOCKED_UNCERTAIN,
                telemetry: this.getTelemetry()
            };
        }

        // Validación estricta contra falsos positivos
        const providerHome = String(match.providerHome || '').toLowerCase();
        const providerAway = String(match.providerAway || '').toLowerCase();
        const cHome = home.toLowerCase();
        const cAway = away.toLowerCase();

        const isExactOrKnownMatch = match.matchConfidence === 'EXACT' ||
            match.matchConfidence === 'ALIAS' ||
            match.matchConfidence === 'NORMALIZED';

        if (!isExactOrKnownMatch) {
            this.telemetry.falsePositives++;
            this.telemetry.fixturesUncertain++;
            return {
                status: SHADOW_FIXTURE_MATCH_STATUS.UNCERTAIN,
                fixtureMatchStatus: SHADOW_FIXTURE_MATCH_STATUS.UNCERTAIN,
                reason: 'Coincidencia ambigua rechazada para evitar falsos positivos',
                matchConfidence: match.matchConfidence,
                publicationDecision: SHADOW_PIPELINE_DECISIONS.BLOCKED_UNCERTAIN,
                telemetry: this.getTelemetry()
            };
        }

        this.telemetry.fixturesMatched++;
        const f = match.event;
        const statusInfo = getTheSportsDbStatusInfo(f.status);

        // ─────────────────────────────────────────────────────────────────────
        // 3. Kickoff Reconciliation
        // ─────────────────────────────────────────────────────────────────────
        let kickoffReconciliationStatus = SHADOW_KICKOFF_STATUS.UNKNOWN;
        let publicationDecision = SHADOW_PIPELINE_DECISIONS.BLOCKED_UNCERTAIN;
        let adoptedKickoffAt = null;

        if (match.differenceMinutes === 0) {
            this.telemetry.kickoffReconciled++;
            kickoffReconciliationStatus = SHADOW_KICKOFF_STATUS.RECONCILED;
            adoptedKickoffAt = f.kickoffAt;
            publicationDecision = executionMode === 'PAPER'
                ? SHADOW_PIPELINE_DECISIONS.WOULD_RECORD_PAPER
                : SHADOW_PIPELINE_DECISIONS.WOULD_PUBLISH;
        } else {
            this.telemetry.kickoffMismatch++;
            if (match.differenceMinutes === 60 || match.differenceMinutes === 120) {
                this.telemetry.kickoffExplicableTimezone++;
            }
            kickoffReconciliationStatus = SHADOW_KICKOFF_STATUS.MISMATCH_REVIEW;
            // Regla: No corregir ni publicar automáticamente casos con discrepancia
            adoptedKickoffAt = null;
            publicationDecision = SHADOW_PIPELINE_DECISIONS.HELD_FOR_REVIEW;
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4. Simulated Post-Match Lookup & Settlement
        // ─────────────────────────────────────────────────────────────────────
        let settlementResult = null;
        let settlementBlockedReason = null;

        const hasScores = f.homeScore !== null && f.awayScore !== null;
        if (hasScores) {
            this.telemetry.resultFound++;
        }

        // AET / PEN / AP sin score a 90 min: REGULATION_SCORE_UNAVAILABLE
        if (f.status === 'AET' || f.status === 'PEN' || f.status === 'AP') {
            this.telemetry.settlementBlocked++;
            settlementBlockedReason = BET365_RULES.REGULATION_SCORE_UNAVAILABLE_CODE;
            settlementResult = {
                status: 'BLOCKED',
                reason: BET365_RULES.REGULATION_SCORE_UNAVAILABLE_CODE,
                explanation: 'Marcador en TheSportsDB incluye prórroga (120 min). Bloqueado para evitar liquidación errónea.'
            };
        } else if (f.status === 'FT') {
            if (hasScores && market && selection) {
                try {
                    const evaluation = evaluatePickSettlement({
                        market,
                        selection,
                        homeGoals: f.homeScore,
                        awayGoals: f.awayScore
                    });
                    this.telemetry.settlementSimulated++;
                    settlementResult = {
                        status: 'SIMULATED',
                        outcome: evaluation.outcome,
                        explanation: evaluation.explanation,
                        homeScore: f.homeScore,
                        awayScore: f.awayScore
                    };
                } catch (evalErr) {
                    this.telemetry.settlementBlocked++;
                    settlementBlockedReason = evalErr.message;
                    settlementResult = {
                        status: 'BLOCKED',
                        reason: evalErr.message
                    };
                }
            } else if (!hasScores) {
                this.telemetry.settlementBlocked++;
                settlementBlockedReason = 'SCORES_MISSING_IN_FT_EVENT';
                settlementResult = {
                    status: 'BLOCKED',
                    reason: 'SCORES_MISSING_IN_FT_EVENT'
                };
            }
        } else if (f.status === 'PST' || f.status === 'CANC') {
            const postEvaluation = evaluateBet365Postponed({
                originalKickoff: kickoff
            });
            if (postEvaluation.outcome === 'VOID') {
                this.telemetry.settlementSimulated++;
                settlementResult = {
                    status: 'SIMULATED',
                    outcome: SETTLEMENT_OUTCOMES.VOID,
                    explanation: postEvaluation.explanation
                };
            } else {
                this.telemetry.settlementBlocked++;
                settlementBlockedReason = `POSTPONED_${postEvaluation.outcome}`;
                settlementResult = {
                    status: 'PENDING_POSTPONED',
                    explanation: postEvaluation.explanation
                };
            }
        } else if (f.status === 'ABD') {
            // Regla Bet365 para abandonados
            if (market && selection && hasScores) {
                // Verificar si está matemáticamente determinado (ej: Over 2.5 con 3+ goles)
                try {
                    const evalCandidate = evaluatePickSettlement({
                        market,
                        selection,
                        homeGoals: f.homeScore,
                        awayGoals: f.awayScore
                    });
                    if (evalCandidate.outcome === SETTLEMENT_OUTCOMES.WON && (market.toLowerCase().includes('total') || market.toLowerCase().includes('over'))) {
                        this.telemetry.settlementSimulated++;
                        settlementResult = {
                            status: 'SIMULATED',
                            outcome: SETTLEMENT_OUTCOMES.WON,
                            explanation: 'Mercado matemáticamente determinado antes del abandono según regla Bet365.'
                        };
                    } else {
                        this.telemetry.settlementSimulated++;
                        settlementResult = {
                            status: 'SIMULATED',
                            outcome: SETTLEMENT_OUTCOMES.VOID,
                            explanation: 'Mercado no determinado matemáticamente antes del abandono: liquidado como VOID según Bet365.'
                        };
                    }
                } catch (err) {
                    this.telemetry.settlementBlocked++;
                    settlementBlockedReason = err.message;
                }
            } else {
                this.telemetry.settlementSimulated++;
                settlementResult = {
                    status: 'SIMULATED',
                    outcome: SETTLEMENT_OUTCOMES.VOID,
                    explanation: 'Partido abandonado sin marcador suficiente: VOID según Bet365.'
                };
            }
        } else {
            // NS, 1H, HT, 2H, SUSP, INT -> Pendiente
            settlementResult = {
                status: 'PENDING',
                reason: `Partido en estado ${f.status} (${statusInfo.meaning})`
            };
        }

        return {
            status: SHADOW_FIXTURE_MATCH_STATUS.MATCHED,
            fixtureMatchStatus: SHADOW_FIXTURE_MATCH_STATUS.MATCHED,
            eventId: f.idEvent,
            providerCompetition: f.leagueName,
            providerHome: f.homeTeam,
            providerAway: f.awayTeam,
            providerKickoffAt: f.kickoffAt,
            differenceMinutes: match.differenceMinutes,
            kickoffStatus: kickoffReconciliationStatus,
            kickoffClassification: match.kickoffClassification,
            isKickoffExactOrExplicable: match.isKickoffExactOrExplicable,
            adoptedKickoffAt,
            matchConfidence: match.matchConfidence,
            finalStatus: f.status,
            finalScore: hasScores ? `${f.homeScore} - ${f.awayScore}` : null,
            publicationDecision,
            settlementResult,
            settlementBlockedReason,
            telemetry: this.getTelemetry()
        };
    }
}
