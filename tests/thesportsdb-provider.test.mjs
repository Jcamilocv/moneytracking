import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TheSportsDbProvider,
    THESPORTSDB_COMPETITIONS,
    discoverTheSportsDbRegistry,
    normalizeTheSportsDbEvent,
    matchTheSportsDbEvent,
    THESPORTSDB_STATUSES,
    getTheSportsDbStatusInfo,
    BET365_RULES,
    evaluateBet365Postponed,
    evaluateBet365Interrupted,
    evaluatePickSettlement,
    areCurrentMarketsSettleableFromFinalScore,
    SETTLEMENT_OUTCOMES
} from '../server/sports-data/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. PROVIDER, CONFIG & BUDGET GUARD
// ─────────────────────────────────────────────────────────────────────────────

test('TheSportsDbProvider: Initializes with default free key and handles budget guard', async () => {
    let callCount = 0;
    const mockFetch = async () => {
        callCount++;
        return {
            ok: true,
            status: 200,
            json: async () => ({ leagues: [] })
        };
    };

    const provider = new TheSportsDbProvider({
        apiKey: '3',
        maxRequests: 2,
        fetchFn: mockFetch,
        silent: true
    });

    assert.equal(provider.isKeyPresent(), true);
    assert.equal(provider.name, 'TheSportsDbProvider');

    await provider.getLeagues(); // 1
    await provider.getLeagueDetails('4328'); // 2

    // 3ra llamada bloqueada por el budget guard (usar llamada no cacheada)
    await assert.rejects(() => provider.getLeagueDetails('4335'), /Presupuesto de requests TheSportsDB alcanzado/);
    assert.equal(callCount, 2);
});

test('TheSportsDbProvider: Cache HIT returns data without executing network fetch', async () => {
    let fetchCalls = 0;
    const mockFetch = async () => {
        fetchCalls++;
        return {
            ok: true,
            status: 200,
            json: async () => ({ leagues: [{ idLeague: '4335', strLeague: 'Spanish La Liga' }] })
        };
    };

    const provider = new TheSportsDbProvider({ fetchFn: mockFetch, silent: true });
    const res1 = await provider.getLeagueDetails('4335');
    const res2 = await provider.getLeagueDetails('4335');

    assert.equal(fetchCalls, 1);
    assert.deepEqual(res1, res2);
});

test('TheSportsDbProvider: Handles HTTP errors gracefully', async () => {
    const mockFetch = async () => ({
        ok: false,
        status: 500
    });

    const provider = new TheSportsDbProvider({ fetchFn: mockFetch, silent: true });
    await assert.rejects(() => provider.getLeagues(), /TheSportsDB respondió con HTTP 500/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LEAGUE REGISTRY MAPPING
// ─────────────────────────────────────────────────────────────────────────────

test('TheSportsDbCompetitionRegistry: Maps all 12 Money Tips competitions', async () => {
    const mockFetch = async (url) => {
        const idMatch = url.match(/id=(\d+)/);
        const id = idMatch ? idMatch[1] : null;
        const comp = THESPORTSDB_COMPETITIONS.find(c => c.theSportsDbId === id);
        return {
            ok: true,
            status: 200,
            json: async () => ({
                leagues: comp ? [{ idLeague: comp.theSportsDbId, strLeague: comp.theSportsDbName, strCountry: comp.country, strCurrentSeason: '2026-2027' }] : []
            })
        };
    };

    const provider = new TheSportsDbProvider({ fetchFn: mockFetch, silent: true, maxRequests: 50 });
    const discovery = await discoverTheSportsDbRegistry(provider);

    assert.equal(discovery.total, 12);
    assert.equal(discovery.coverageCount, 12);
    assert.equal(discovery.isCompleteCoverage, true);

    const esp = discovery.registry.find(r => r.internalCode === 'ESP-PRE');
    assert.equal(esp.providerLeagueId, '4335');
    assert.equal(esp.currentSeason, '2026-2027');

    const ucl = discovery.registry.find(r => r.internalCode === 'EUR-CHL');
    assert.equal(ucl.providerLeagueId, '4480');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EVENT NORMALIZATION & KICKOFF RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────

test('TheSportsDbNormalizer: Normalizes raw event into canonical structure with UTC kickoff', () => {
    const raw = {
        idEvent: '2506229',
        idLeague: '4335',
        strLeague: 'Spanish La Liga',
        strSeason: '2026-2027',
        strHomeTeam: 'Atlético Madrid',
        strAwayTeam: 'Real Madrid',
        idHomeTeam: '133729',
        idAwayTeam: '133738',
        intHomeScore: '2',
        intAwayScore: '1',
        dateEvent: '2026-09-20',
        dateEventLocal: '2026-09-20',
        strTime: '14:15:00',
        strTimeLocal: '16:15:00',
        strStatus: 'FT',
        strPostponed: 'no'
    };

    const normalized = normalizeTheSportsDbEvent(raw);
    assert.equal(normalized.idEvent, '2506229');
    assert.equal(normalized.homeTeam, 'Atlético Madrid');
    assert.equal(normalized.awayTeam, 'Real Madrid');
    assert.equal(normalized.kickoffAt, '2026-09-20T14:15:00.000Z');
    assert.equal(normalized.homeScore, 2);
    assert.equal(normalized.awayScore, 1);
    assert.equal(normalized.status, 'FT');
    assert.equal(normalized.postponed, false);
});

test('TheSportsDbMatcher: Reconciles kickoff and handles exact and alias matches', () => {
    const fbEvent = {
        homeTeam: 'Atlético Madrid',
        awayTeam: 'Real Madrid',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-20T14:15:00.000Z'
    };

    const rawEvent = {
        idEvent: '2506229',
        idLeague: '4335',
        strLeague: 'Spanish La Liga',
        strHomeTeam: 'Atlético Madrid',
        strAwayTeam: 'Real Madrid',
        intHomeScore: '2',
        intAwayScore: '1',
        dateEvent: '2026-09-20',
        strTime: '14:15:00',
        strStatus: 'FT'
    };

    const match = matchTheSportsDbEvent(fbEvent, rawEvent);
    assert.equal(match.status, 'MATCHED');
    assert.equal(match.theSportsDbMatchFound, true);
    assert.equal(match.eventId, '2506229');
    assert.equal(match.kickoffMatch, 'KICKOFF_RECONCILED');
    assert.equal(match.differenceMinutes, 0);
    assert.equal(match.strongIdentity.sportsProvider, 'THE_SPORTS_DB');
    assert.equal(match.strongIdentity.providerEventId, '2506229');
});

test('TheSportsDbMatcher: Detects KICKOFF_MISMATCH when kickoff differs', () => {
    const fbEvent = {
        homeTeam: 'Bayer Leverkusen',
        awayTeam: 'RB Leipzig',
        competitionCode: 'GER-BUN',
        kickoffAt: '2026-09-20T13:30:00.000Z'
    };

    const rawEvent = {
        idEvent: '2508363',
        strHomeTeam: 'Bayer Leverkusen',
        strAwayTeam: 'RB Leipzig',
        dateEvent: '2026-09-20',
        strTime: '15:30:00', // +120m
        strStatus: 'NS'
    };

    const match = matchTheSportsDbEvent(fbEvent, rawEvent);
    assert.equal(match.status, 'MATCHED');
    assert.equal(match.kickoffMatch, 'KICKOFF_MISMATCH');
    assert.equal(match.differenceMinutes, 120);
});

test('TheSportsDbMatcher: Returns NOT_FOUND when teams do not match', () => {
    const fbEvent = {
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        kickoffAt: '2026-09-20T15:00:00.000Z'
    };

    const rawEvent = {
        idEvent: '999',
        strHomeTeam: 'Liverpool',
        strAwayTeam: 'Everton',
        dateEvent: '2026-09-20',
        strTime: '15:00:00'
    };

    const match = matchTheSportsDbEvent(fbEvent, rawEvent);
    assert.equal(match.status, 'NOT_FOUND');
    assert.equal(match.theSportsDbMatchFound, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. STATUS REGISTRY & BET365 POLICY
// ─────────────────────────────────────────────────────────────────────────────

test('TheSportsDbStatusRegistry: Classifies statuses and maps Bet365 rules', () => {
    assert.equal(getTheSportsDbStatusInfo('FT').isSettleable, true);
    assert.equal(getTheSportsDbStatusInfo('FT').regulationScoreSafe, true);

    // AET / PEN / AP NO son seguros para liquidación a 90 min en TheSportsDB
    const aet = getTheSportsDbStatusInfo('AET');
    assert.equal(aet.isSettleable, false);
    assert.equal(aet.regulationScoreSafe, false);
    assert.equal(aet.errorCode, 'REGULATION_SCORE_UNAVAILABLE');

    const pen = getTheSportsDbStatusInfo('PEN');
    assert.equal(pen.isSettleable, false);
    assert.equal(pen.regulationScoreSafe, false);
    assert.equal(pen.errorCode, 'REGULATION_SCORE_UNAVAILABLE');

    assert.equal(getTheSportsDbStatusInfo('NS').isSettleable, false);

    const pst = getTheSportsDbStatusInfo('PST');
    assert.equal(pst.isSettleable, false);
    assert.match(pst.bet365Policy, /5 días/);

    const canc = getTheSportsDbStatusInfo('CANC');
    assert.equal(canc.isSettleable, false);
    assert.match(canc.bet365Policy, /5 días/);

    const abd = getTheSportsDbStatusInfo('ABD');
    assert.equal(abd.isSettleable, false);
    assert.match(abd.bet365Policy, /matemáticamente/);
});

test('TheSportsDbStatusRegistry: Bet365 Postponed 5-day rule evaluation', () => {
    const origKickoff = '2026-09-20T14:15:00.000Z';

    // 1. Reprogramado dentro de 5 días (ej: 3 días después) -> REMAINS_VALID
    const reschedWithin = '2026-09-23T14:15:00.000Z';
    const resWithin = evaluateBet365Postponed({ originalKickoff: origKickoff, rescheduledKickoff: reschedWithin });
    assert.equal(resWithin.outcome, 'REMAINS_VALID');

    // 2. Reprogramado fuera de 5 días (ej: 6 días después) -> VOID
    const reschedBeyond = '2026-09-27T14:15:00.000Z';
    const resBeyond = evaluateBet365Postponed({ originalKickoff: origKickoff, rescheduledKickoff: reschedBeyond });
    assert.equal(resBeyond.outcome, 'VOID');

    // 3. Sin reprogramar, transcurridos 2 días -> PENDING
    const currPending = '2026-09-22T14:15:00.000Z';
    const resPending = evaluateBet365Postponed({ originalKickoff: origKickoff, currentTime: currPending });
    assert.equal(resPending.outcome, 'PENDING');

    // 4. Sin reprogramar, transcurridos 6 días -> VOID
    const currVoid = '2026-09-27T14:15:00.000Z';
    const resElapsedVoid = evaluateBet365Postponed({ originalKickoff: origKickoff, currentTime: currVoid });
    assert.equal(resElapsedVoid.outcome, 'VOID');
});

test('TheSportsDbStatusRegistry: Bet365 Interrupted 48h rule evaluation', () => {
    const origKickoff = '2026-09-20T14:15:00.000Z';

    // 1. Finalizado dentro de 48h (ej: 24h después) -> REMAINS_VALID
    const finishedWithin = '2026-09-21T14:15:00.000Z';
    const resWithin = evaluateBet365Interrupted({ originalKickoff: origKickoff, resumedFinishTime: finishedWithin });
    assert.equal(resWithin.outcome, 'REMAINS_VALID');

    // 2. Finalizado fuera de 48h (ej: 50h después) -> ABANDONED
    const finishedBeyond = '2026-09-22T17:15:00.000Z';
    const resBeyond = evaluateBet365Interrupted({ originalKickoff: origKickoff, resumedFinishTime: finishedBeyond });
    assert.equal(resBeyond.outcome, 'ABANDONED');

    // 3. Transcurridas 50h sin reanudar -> ABANDONED
    const currAbandoned = '2026-09-22T17:15:00.000Z';
    const resElapsed = evaluateBet365Interrupted({ originalKickoff: origKickoff, currentTime: currAbandoned });
    assert.equal(resElapsed.outcome, 'ABANDONED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SETTLEMENT EVALUATION WITH THESPORTSDB SCORES
// ─────────────────────────────────────────────────────────────────────────────

test('SettlementEvaluator: Evaluates markets with TheSportsDB scores', () => {
    // Caso real: Atlético 2 - 1 Real Madrid
    const hg = 2;
    const ag = 1;

    // BTTS Yes
    assert.equal(evaluatePickSettlement({ market: 'Ambos equipos marcan', selection: 'Sí', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.WON);
    // Over 2.5
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Más de 2,5 goles', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.WON);
    // Under 2.5
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Menos de 2,5 goles', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.LOST);
    // 1X2 Local
    assert.equal(evaluatePickSettlement({ market: 'Resultado final', selection: 'Local', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.WON);
    // 1X2 Visitante
    assert.equal(evaluatePickSettlement({ market: 'Resultado final', selection: 'Visitante', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.LOST);
    // Doble oportunidad 1X
    assert.equal(evaluatePickSettlement({ market: 'Doble oportunidad', selection: '1X', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.WON);
    // DNB Local
    assert.equal(evaluatePickSettlement({ market: 'Empate no válido', selection: 'Local', homeGoals: hg, awayGoals: ag }).outcome, SETTLEMENT_OUTCOMES.WON);
    // DNB Empate -> VOID
    assert.equal(evaluatePickSettlement({ market: 'Empate no válido', selection: 'Local', homeGoals: 1, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.VOID);
});

