/**
 * @file Exportaciones principales del módulo sports-data.
 */

export { SportsDataProvider } from './sports-data-provider.js';
export { ApiFootballProvider, BudgetExceededError, ApiFootballError } from './api-football-provider.js';
export { MONEY_TIPS_COMPETITIONS, discoverCompetitionRegistry } from './competition-registry.js';
export { matchTeamNames, sanitizeTeamName, getStrippedTokensName, MATCH_CONFIDENCE } from './team-normalizer.js';
export { matchFutbolBrainFixture } from './fixture-matcher.js';
export { API_FOOTBALL_STATUSES, API_FOOTBALL_STATUS_CATEGORIES, getMatchStatusInfo } from './match-status-registry.js';
export { evaluatePickSettlement, areCurrentMarketsSettleableFromFinalScore, SETTLEMENT_OUTCOMES } from './settlement-evaluator.js';
export { TheSportsDbProvider } from './thesportsdb-provider.js';
export { THESPORTSDB_COMPETITIONS, discoverTheSportsDbRegistry } from './thesportsdb-competition-registry.js';
export { normalizeTheSportsDbEvent, matchTheSportsDbEvent } from './thesportsdb-fixture-matcher.js';
export { THESPORTSDB_STATUSES, getTheSportsDbStatusInfo, BET365_RULES, evaluateBet365Postponed, evaluateBet365Interrupted } from './thesportsdb-status-registry.js';
export {
    TheSportsDbShadowPipeline,
    SHADOW_PIPELINE_DECISIONS,
    SHADOW_FIXTURE_MATCH_STATUS,
    SHADOW_KICKOFF_STATUS
} from './thesportsdb-shadow-pipeline.js';
export {
    reconcileCandidateWithSportsData,
    RECONCILIATION_STATUSES,
    KICKOFF_CLASSIFICATIONS
} from './sports-data-reconciler.js';
export {
    CanonicalSettlementScheduler,
    SETTLEMENT_CYCLE_STATUSES
} from './canonical-settlement-scheduler.js';

