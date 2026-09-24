// Centralised, server-owned stake policy for the 2026/27 forward test.
// Browser data can identify a visible pick, but never determines its stake.
import { SYSTEM_REGISTRY, getSystemDefinition } from './system-registry.js';

export const MONEY_TIPS_STAKE_POLICY_VERSION = '2026-27-forward-v1';

export const SYSTEM_STAKE_STATES = Object.freeze(
    Object.fromEntries(
        Object.entries(SYSTEM_REGISTRY).map(([id, def]) => [id, def.stakePolicy.tier])
    )
);

const STAKE_MULTIPLIERS = Object.freeze({
    production_validated: 1,
    production_controlled: 0.75,
    paper: 0
});

const baseStakePctForOdds = (odds) => {
    if (odds < 1.4) return 1.5;
    if (odds < 3) return 1;
    return 0.5;
};

const cleanOdds = (value) => {
    const odds = Number(value);
    if (!Number.isFinite(odds) || odds < 1.01 || odds > 1000) throw new Error('La cuota no es válida para calcular el stake');
    return odds;
};

export const stakeRecommendationForOfficialPick = ({ systemId, oddsAtPublication }) => {
    const odds = cleanOdds(oddsAtPublication);
    const systemDef = getSystemDefinition(systemId);
    const systemState = systemDef?.stakePolicy?.tier || SYSTEM_STAKE_STATES[systemId] || 'paper';
    const baseStakePct = baseStakePctForOdds(odds);
    const confidenceFactor = STAKE_MULTIPLIERS[systemState] ?? 0;
    const recommendedStakePct = Number((baseStakePct * confidenceFactor).toFixed(3));

    return {
        policyVersion: MONEY_TIPS_STAKE_POLICY_VERSION,
        systemState,
        baseStakePct,
        confidenceFactor,
        recommendedStakePct
    };
};
