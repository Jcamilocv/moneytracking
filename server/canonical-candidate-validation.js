import { getSystemDefinition, mapSystemSelection } from './system-registry.js';
import { cleanDateWithMadridFallback } from '../api/lib/timezone.js';

const LEAGUE_ALIASES = Object.freeze({
    'FRA-L1': 'FRA-LG1', 'FRA-L2': 'FRA-LG2', 'GER-BL': 'GER-BUN',
    'ENG-Premier League': 'ENG-PRE'
});

export const madridDayKey = (date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

export const validateCanonicalCandidate = (candidate, {
    now = new Date(), requireToday = true, minLeadMs = 60_000, enforceKickoffGuard = true
} = {}) => {
    const systemId = candidate?.systemId;
    const definition = getSystemDefinition(systemId);
    if (!definition) return { ok: false, reason: 'UNKNOWN_SYSTEM' };
    const league = LEAGUE_ALIASES[candidate?.competition] || candidate?.competition;
    if (!definition.allowedLeagues.includes(league)) return { ok: false, reason: 'LEAGUE_MISMATCH' };
    if (candidate?.market !== definition.market) return { ok: false, reason: 'MARKET_MISMATCH' };
    const selection = candidate?.selectionIsCanonical
        ? candidate.selection
        : mapSystemSelection(systemId, candidate?.selection);
    if (!Object.values(definition.selections).includes(selection)) return { ok: false, reason: 'SELECTION_MISMATCH' };
    if (candidate?.odds === null || candidate?.odds === undefined || candidate?.odds === '') return { ok: false, reason: 'MISSING_ODDS' };
    const odds = Number(candidate.odds);
    if (!Number.isFinite(odds) || odds < 1.01 || odds > 1000) return { ok: false, reason: 'INVALID_ODDS' };
    if (!candidate?.kickoffAt) return { ok: false, reason: 'MISSING_KICKOFF' };
    let kickoffAt;
    try { kickoffAt = cleanDateWithMadridFallback(candidate.kickoffAt, 'kickoffAt'); }
    catch { return { ok: false, reason: 'INVALID_KICKOFF' }; }
    if (requireToday && madridDayKey(kickoffAt) !== madridDayKey(now)) return { ok: false, reason: 'NOT_TODAY_MADRID' };
    if (enforceKickoffGuard && kickoffAt.getTime() <= now.getTime() + minLeadMs) return { ok: false, reason: 'KICKOFF_EXPIRED' };
    if (!candidate?.homeTeam || !candidate?.awayTeam) return { ok: false, reason: 'MISSING_TEAMS' };
    return { ok: true, definition, league, selection, odds: Number(odds.toFixed(2)), kickoffAt };
};
