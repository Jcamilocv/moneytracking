import { createHash } from 'node:crypto';
import { getSystemDefinition, mapSystemSelection, SYSTEM_EXECUTION_MODES } from '../system-registry.js';
import { validateCanonicalCandidate } from '../canonical-candidate-validation.js';
import { PUBLICATION_POLICIES } from '../official-pick-scheduling.js';

const MARKET_CATEGORIES = Object.freeze({
    // This is the only category observed in authenticated active-alarms data.
    'Both Teams To Score': 'Ambos equipos marcan'
});
const SYSTEM_MARKET_CATEGORIES = Object.freeze({
    // Exact categories observed in authenticated active-alarms data. Scope these
    // aliases to their systems; other markets and systems remain unverified.
    'MT - ENG2 - v1.0': Object.freeze({ 'Match Odds': 'Resultado final' }),
    'MT - Premier League 02.5': Object.freeze({ 'Over/Under 3.5': 'Total de goles' })
});

const requiredText = (value) => typeof value === 'string' && value.trim()
    && value.length <= 160 && !Array.from(value).some((char) => char.charCodeAt(0) < 32)
    ? value.trim() : null;
const sourceId = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) ? value : null;
const madridClock = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export const parseFutbolBrainKickoff = (value) => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const [, year, month, day, hour, minute, second = '00'] = match;
    const local = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    const naive = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
    const possibilities = [1, 2].map((offset) => new Date(naive - offset * 3_600_000))
        .filter((date) => madridClock.format(date) === local);
    // Nonexistent spring hours and ambiguous autumn hours must not be guessed.
    return possibilities.length === 1 ? possibilities[0] : null;
};
const stableSnapshot = (item) => ({
    MatchId: sourceId(item?.MatchId), SystemId: sourceId(item?.SystemId),
    SystemName: requiredText(item?.SystemName), League: requiredText(item?.League?.ShortName),
    HomeTeam: requiredText(item?.HomeTeam?.TeamName), AwayTeam: requiredText(item?.AwayTeam?.TeamName),
    DateOfMatch: requiredText(item?.DateOfMatch),
    MarketCategory: requiredText(item?.TargetMarket?.MarketCategory),
    MarketName: requiredText(item?.TargetMarket?.MarketName),
    MarketShortName: requiredText(item?.TargetMarket?.MarketShortName),
    Odds: typeof item?.TargetMarket?.Odds === 'number' || typeof item?.TargetMarket?.Odds === 'string'
        ? item.TargetMarket.Odds : null,
    Probability: typeof item?.Probability === 'number' && Number.isFinite(item.Probability)
        ? item.Probability : null
});

const unknownFieldNames = (item) => {
    const known = {
        '': ['MatchId', 'SystemId', 'SystemName', 'League', 'HomeTeam', 'AwayTeam',
            'DateOfMatch', 'Probability', 'TargetMarket'],
        League: ['LeagueId', 'LeagueName', 'ShortName', 'RegionId', 'Region'],
        HomeTeam: ['TeamId', 'TeamName'], AwayTeam: ['TeamId', 'TeamName'],
        TargetMarket: ['InOddsRanges', 'MarketCategory', 'MarketId', 'MarketName',
            'MarketShortName', 'Odds']
    };
    const found = [];
    for (const [path, allowed] of Object.entries(known)) {
        const value = path ? item?.[path] : item;
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        for (const key of Object.keys(value)) {
            if (!allowed.includes(key) && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
                found.push(path ? `${path}.${key}` : key);
            }
        }
    }
    return found.sort().slice(0, 20);
};

export const adaptMorningCandidate = (item, { observedAt, now = new Date(observedAt) } = {}) => {
    const snapshot = stableSnapshot(item);
    const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const systemId = requiredText(snapshot.SystemName);
    const market = MARKET_CATEGORIES[snapshot.MarketCategory]
        || SYSTEM_MARKET_CATEGORIES[systemId]?.[snapshot.MarketCategory] || null;
    const selection = systemId ? [snapshot.MarketName, snapshot.MarketShortName]
        .map((value) => requiredText(value) && mapSystemSelection(systemId, value))
        .find(Boolean) || null : null;
    const kickoffAt = parseFutbolBrainKickoff(snapshot.DateOfMatch);
    const candidate = {
        source: 'FUTBOLBRAIN_ACTIVE_ALARMS', matchId: snapshot.MatchId,
        sourceSystemId: snapshot.SystemId, systemId,
        competition: requiredText(snapshot.League),
        homeTeam: requiredText(snapshot.HomeTeam), awayTeam: requiredText(snapshot.AwayTeam),
        kickoffAt: kickoffAt?.toISOString() || null,
        market, selection, odds: snapshot.Odds, probability: snapshot.Probability,
        observedAt, snapshotHash, snapshot,
        unknownFields: unknownFieldNames(item),
        sourceDateFormat: /(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.DateOfMatch || '')
            ? 'explicit_offset' : 'madrid_naive_or_missing'
    };
    if (!getSystemDefinition(systemId)) return { candidate, validation: { ok: false, reason: 'UNKNOWN_SYSTEM' } };
    if (systemId === 'MT - CHA EUR - V1.0') return {
        candidate, validation: { ok: false, reason: 'UNVERIFIED_MARKET_TUPLE' }
    };
    if (snapshot.MatchId === null || snapshot.SystemId === null) return { candidate, validation: { ok: false, reason: 'MISSING_SOURCE_ID' } };
    if (!market) return { candidate, validation: { ok: false, reason: 'MISSING_OR_UNKNOWN_MARKET' } };
    const validation = validateCanonicalCandidate({ ...candidate, selectionIsCanonical: true }, { now });
    return { candidate, validation };
};

// Pure mapping to the existing queue contract. Never queues or writes itself.
export const toMorningQueueInput = ({ candidate, validation }) => {
    if (!validation?.ok || validation.definition.executionMode !== SYSTEM_EXECUTION_MODES.EARLY
        || validation.definition.requiresT5) throw new Error('MORNING_NOT_OFFICIAL_ELIGIBLE');
    return {
        event: {
            sourceEventId: String(candidate.matchId), competition: validation.league,
            homeTeam: candidate.homeTeam, awayTeam: candidate.awayTeam,
            kickoffAt: validation.kickoffAt
        },
        bet: { market: candidate.market, selection: validation.selection,
            oddsAtPublication: validation.odds },
        system: { id: candidate.systemId, version: 'active-alarms-v1' },
        source: { provider: 'futbolbrain-active-alarms',
            observedAt: new Date(candidate.observedAt) },
        publicationPolicy: PUBLICATION_POLICIES.IMMEDIATE
    };
};
