import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SportsDataProvider,
    ApiFootballProvider,
    BudgetExceededError,
    ApiFootballError,
    MONEY_TIPS_COMPETITIONS,
    discoverCompetitionRegistry,
    matchTeamNames,
    sanitizeTeamName,
    getStrippedTokensName,
    MATCH_CONFIDENCE,
    matchFutbolBrainFixture,
    getMatchStatusInfo,
    evaluatePickSettlement,
    areCurrentMarketsSettleableFromFinalScore,
    SETTLEMENT_OUTCOMES
} from '../server/sports-data/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTH & CONFIG & REDACTION
// ─────────────────────────────────────────────────────────────────────────────

test('SportsDataProvider: Base class throws not implemented for all abstract methods', async () => {
    const base = new SportsDataProvider();
    await assert.rejects(() => base.getLeagues(), /no implementa getLeagues/);
    await assert.rejects(() => base.getFixtures(), /no implementa getFixtures/);
    await assert.rejects(() => base.getFixture(123), /no implementa getFixture/);
    assert.deepEqual(base.getRateLimitStatus(), {
        requestsMade: 0,
        dailyLimit: null,
        dailyRemaining: null,
        minuteLimit: null,
        minuteRemaining: null,
        lastRequestAt: null
    });
});

test('ApiFootballProvider: Rejects execution if API key is missing', async () => {
    const provider = new ApiFootballProvider({ apiKey: null });
    assert.equal(provider.isKeyPresent(), false);
    await assert.rejects(() => provider.getLeagues(), (err) => {
        assert.equal(err.name, 'ApiFootballError');
        assert.equal(err.statusCode, 401);
        return true;
    });
});

test('ApiFootballProvider: Redacts API key from error messages and logs', async () => {
    const fakeKey = 'super_secret_api_key_1234567890';
    const mockFetch = async () => ({
        ok: false,
        status: 403,
        text: async () => `Access denied for key ${fakeKey}`
    });

    const provider = new ApiFootballProvider({ apiKey: fakeKey, fetchFn: mockFetch, silent: true });
    assert.equal(provider.isKeyPresent(), true);

    await assert.rejects(() => provider.getLeagues(), (err) => {
        assert.ok(!err.message.includes(fakeKey), 'La key real no debe aparecer en el error');
        return true;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RATE LIMIT, CACHING & BUDGET GUARD
// ─────────────────────────────────────────────────────────────────────────────

test('ApiFootballProvider: Parses rate limit headers accurately', async () => {
    const mockHeaders = new Map([
        ['x-ratelimit-requests-limit', '100'],
        ['x-ratelimit-requests-remaining', '84'],
        ['x-ratelimit-limit', '10'],
        ['x-ratelimit-remaining', '7']
    ]);

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: (k) => mockHeaders.get(k) || null },
        json: async () => ({ response: [{ id: 140, name: 'La Liga' }] })
    });

    const provider = new ApiFootballProvider({ apiKey: 'test_key_12345678', fetchFn: mockFetch, silent: true });
    await provider.getLeagues({ country: 'Spain' });

    const status = provider.getRateLimitStatus();
    assert.equal(status.requestsMade, 1);
    assert.equal(status.dailyLimit, 100);
    assert.equal(status.dailyRemaining, 84);
    assert.equal(status.minuteLimit, 10);
    assert.equal(status.minuteRemaining, 7);
    assert.ok(status.lastRequestAt instanceof Date);
});

test('ApiFootballProvider: Budget Guard halts execution before exceeding maxRequests', async () => {
    let callCount = 0;
    const mockFetch = async () => {
        callCount++;
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ response: [] })
        };
    };

    const provider = new ApiFootballProvider({
        apiKey: 'test_key_12345678',
        maxRequests: 2,
        fetchFn: mockFetch,
        silent: true
    });

    await provider.getLeagues({ country: 'Spain' }); // Request 1
    await provider.getLeagues({ country: 'England' }); // Request 2

    // Request 3 debe ser bloqueada por el budget guard
    await assert.rejects(() => provider.getLeagues({ country: 'Italy' }), (err) => {
        assert.equal(err.name, 'BudgetExceededError');
        assert.equal(err.requestsMade, 2);
        assert.equal(err.maxRequests, 2);
        return true;
    });

    assert.equal(callCount, 2, 'No debe haberse enviado la 3ra petición HTTP');
});

test('ApiFootballProvider: Cache HIT returns cached data without consuming rate limit', async () => {
    let fetchCalls = 0;
    const mockFetch = async () => {
        fetchCalls++;
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ response: [{ id: 140, name: 'La Liga' }] })
        };
    };

    const provider = new ApiFootballProvider({
        apiKey: 'test_key_12345678',
        fetchFn: mockFetch,
        silent: true
    });

    const res1 = await provider.getLeagues({ id: 140 });
    const res2 = await provider.getLeagues({ id: 140 });

    assert.equal(fetchCalls, 1, 'Solo 1 llamada HTTP realizada');
    assert.equal(provider.getRateLimitStatus().requestsMade, 1);
    assert.deepEqual(res1, res2);
});

test('ApiFootballProvider: Handles API errors (429 and response.errors)', async () => {
    // Caso 1: HTTP 429
    const mock429 = async () => ({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded'
    });
    const prov429 = new ApiFootballProvider({ apiKey: 'test_key_12345678', fetchFn: mock429, silent: true });
    await assert.rejects(() => prov429.getLeagues(), (err) => {
        assert.equal(err.statusCode, 429);
        return true;
    });

    // Caso 2: HTTP 200 pero errors en body
    const mockBodyError = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ errors: { rateLimit: 'Too many requests' } })
    });
    const provBodyErr = new ApiFootballProvider({ apiKey: 'test_key_12345678', fetchFn: mockBodyError, silent: true });
    await assert.rejects(() => provBodyErr.getLeagues(), (err) => {
        assert.match(err.message, /Too many requests/);
        return true;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. COMPETITION REGISTRY DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────

test('CompetitionRegistry: Discovers and maps the 12 Money Tips competitions', async () => {
    // Fixture mockeada con las 12 ligas
    const mockLeagues = [
        { league: { id: 2, name: 'UEFA Champions League', type: 'Cup' }, country: { name: 'World' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 3, name: 'UEFA Europa League', type: 'Cup' }, country: { name: 'World' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 39, name: 'Premier League', type: 'League' }, country: { name: 'England' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 40, name: 'Championship', type: 'League' }, country: { name: 'England' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 135, name: 'Serie A', type: 'League' }, country: { name: 'Italy' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 61, name: 'Ligue 1', type: 'League' }, country: { name: 'France' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 62, name: 'Ligue 2', type: 'League' }, country: { name: 'France' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 140, name: 'La Liga', type: 'League' }, country: { name: 'Spain' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 141, name: 'Segunda Division', type: 'League' }, country: { name: 'Spain' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 94, name: 'Primeira Liga', type: 'League' }, country: { name: 'Portugal' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 78, name: 'Bundesliga', type: 'League' }, country: { name: 'Germany' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] },
        { league: { id: 203, name: 'Süper Lig', type: 'League' }, country: { name: 'Turkey' }, seasons: [{ year: 2026, current: true, coverage: { fixtures: { events: true, lineups: true } } }] }
    ];

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ response: mockLeagues })
    });

    const provider = new ApiFootballProvider({ apiKey: 'test_key_12345678', fetchFn: mockFetch, silent: true });
    const result = await discoverCompetitionRegistry(provider);

    assert.equal(result.total, 12);
    assert.equal(result.coverageCount, 12);
    assert.equal(result.isCompleteCoverage, true);

    const espPre = result.registry.find(r => r.internalCode === 'ESP-PRE');
    assert.ok(espPre);
    assert.equal(espPre.providerLeagueId, 140);
    assert.equal(espPre.currentSeason, 2026);
    assert.equal(espPre.coverageAvailable, true);

    const gerBun = result.registry.find(r => r.internalCode === 'GER-BUN');
    assert.equal(gerBun.providerLeagueId, 78);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TEAM NORMALIZATION & ALIASES
// ─────────────────────────────────────────────────────────────────────────────

test('TeamNormalizer: Matches exact, normalized, aliases, and flags uncertain', () => {
    // 1. Exacto
    const m1 = matchTeamNames('Real Madrid', 'real madrid');
    assert.equal(m1.matched, true);
    assert.equal(m1.confidence, MATCH_CONFIDENCE.EXACT);

    // 2. Acentos
    const m2 = matchTeamNames('Atlético Madrid', 'Atletico Madrid');
    assert.equal(m2.matched, true);
    assert.equal(m2.confidence, MATCH_CONFIDENCE.EXACT);

    // 3. Sufijos/Prefijos de club
    const m3 = matchTeamNames('Valencia CF', 'Valencia');
    assert.equal(m3.matched, true);
    assert.equal(m3.confidence, MATCH_CONFIDENCE.NORMALIZED);

    // 4. Alias
    const m4 = matchTeamNames('Man City', 'Manchester City');
    assert.equal(m4.matched, true);
    assert.equal(m4.confidence, MATCH_CONFIDENCE.ALIAS);

    const m5 = matchTeamNames('Ceuta', 'AD Ceuta FC');
    assert.equal(m5.matched, true);

    const m6 = matchTeamNames('Bayer Leverkusen', 'Leverkusen');
    assert.equal(m6.matched, true);

    // 5. No match / Incierto
    const m7 = matchTeamNames('Barcelona', 'Real Madrid');
    assert.equal(m7.matched, false);
    assert.equal(m7.confidence, MATCH_CONFIDENCE.UNCERTAIN);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. FIXTURE MATCHING & KICKOFF RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────

test('FixtureMatcher: Reconciles identical kickoff as KICKOFF_RECONCILED', () => {
    const fbEvent = {
        homeTeam: 'Atlético Madrid',
        awayTeam: 'Real Madrid',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-20T14:15:00.000Z'
    };

    const candidateFixtures = [
        {
            fixture: {
                id: 1001,
                date: '2026-09-20T16:15:00+02:00', // 16:15 CEST = 14:15 UTC
                timestamp: 1789990500,
                timezone: 'Europe/Madrid',
                status: { short: 'FT', long: 'Match Finished' }
            },
            league: { id: 140, name: 'La Liga' },
            teams: {
                home: { id: 530, name: 'Atletico Madrid' },
                away: { id: 541, name: 'Real Madrid' }
            },
            goals: { home: 1, away: 1 }
        }
    ];

    const match = matchFutbolBrainFixture(fbEvent, candidateFixtures);
    assert.equal(match.status, 'MATCHED');
    assert.equal(match.apiFootballMatchFound, true);
    assert.equal(match.fixtureId, 1001);
    assert.equal(match.kickoffMatch, 'KICKOFF_RECONCILED');
    assert.equal(match.differenceMinutes, 0);
    assert.equal(match.strongIdentity.sportsProvider, 'API_FOOTBALL');
    assert.equal(match.strongIdentity.providerFixtureId, 1001);
});

test('FixtureMatcher: Detects kickoff difference as KICKOFF_MISMATCH', () => {
    const fbEvent = {
        homeTeam: 'Bayer Leverkusen',
        awayTeam: 'RB Leipzig',
        competitionCode: 'GER-BUN',
        kickoffAt: '2026-09-20T13:30:00.000Z' // 15:30 CEST
    };

    const candidateFixtures = [
        {
            fixture: {
                id: 2002,
                date: '2026-09-20T17:30:00+02:00', // Movido a 17:30 CEST = 15:30 UTC (+120 min)
                timestamp: 1789995000,
                status: { short: 'NS', long: 'Not Started' }
            },
            league: { id: 78, name: 'Bundesliga' },
            teams: {
                home: { id: 168, name: 'Bayer Leverkusen' },
                away: { id: 173, name: 'RB Leipzig' }
            }
        }
    ];

    const match = matchFutbolBrainFixture(fbEvent, candidateFixtures);
    assert.equal(match.status, 'MATCHED');
    assert.equal(match.kickoffMatch, 'KICKOFF_MISMATCH');
    assert.equal(match.differenceMinutes, 120);
});

test('FixtureMatcher: Returns NOT_FOUND when no matching fixture exists', () => {
    const fbEvent = {
        homeTeam: 'Sevilla',
        awayTeam: 'Betis',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-20T19:00:00.000Z'
    };

    const candidateFixtures = [
        {
            fixture: { id: 3003 },
            teams: {
                home: { name: 'Villarreal' },
                away: { name: 'Levante' }
            }
        }
    ];

    const match = matchFutbolBrainFixture(fbEvent, candidateFixtures);
    assert.equal(match.status, 'NOT_FOUND');
    assert.equal(match.apiFootballMatchFound, false);
    assert.equal(match.fixtureId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATCH STATUS & SETTLEMENT
// ─────────────────────────────────────────────────────────────────────────────

test('MatchStatusRegistry: Correctly classifies settleable vs pending vs exception states', () => {
    assert.equal(getMatchStatusInfo('FT').isSettleable, true);
    assert.equal(getMatchStatusInfo('AET').isSettleable, true);
    assert.equal(getMatchStatusInfo('PEN').isSettleable, true);

    assert.equal(getMatchStatusInfo('NS').isSettleable, false);
    assert.equal(getMatchStatusInfo('1H').isSettleable, false);
    assert.equal(getMatchStatusInfo('HT').isSettleable, false);

    const pst = getMatchStatusInfo('PST');
    assert.equal(pst.isSettleable, false);
    assert.ok(pst.ceoDecisionRequired);

    const canc = getMatchStatusInfo('CANC');
    assert.equal(canc.isSettleable, false);
    assert.ok(canc.ceoDecisionRequired);
});

test('SettlementEvaluator: Evaluates 100% of current Money Tips markets from final score', () => {
    assert.equal(areCurrentMarketsSettleableFromFinalScore(), true);

    // BTTS Yes
    assert.equal(evaluatePickSettlement({ market: 'Ambos equipos marcan', selection: 'Sí', homeGoals: 1, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Ambos equipos marcan', selection: 'Sí', homeGoals: 2, awayGoals: 0 }).outcome, SETTLEMENT_OUTCOMES.LOST);

    // BTTS No
    assert.equal(evaluatePickSettlement({ market: 'Ambos equipos marcan', selection: 'No', homeGoals: 2, awayGoals: 0 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Ambos equipos marcan', selection: 'No', homeGoals: 1, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.LOST);

    // Over 2.5
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Más de 2,5 goles', homeGoals: 2, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Más de 2,5 goles', homeGoals: 1, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.LOST);

    // Over 3.5
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Más de 3,5 goles', homeGoals: 2, awayGoals: 2 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Más de 3,5 goles', homeGoals: 2, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.LOST);

    // Under 3.5
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Menos de 3,5 goles', homeGoals: 2, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Total de goles', selection: 'Menos de 3,5 goles', homeGoals: 2, awayGoals: 2 }).outcome, SETTLEMENT_OUTCOMES.LOST);

    // Resultado final (1X2)
    assert.equal(evaluatePickSettlement({ market: 'Resultado final', selection: 'Local', homeGoals: 2, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Resultado final', selection: 'Visitante', homeGoals: 0, awayGoals: 1 }).outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(evaluatePickSettlement({ market: 'Resultado final', selection: 'Empate', homeGoals: 2, awayGoals: 2 }).outcome, SETTLEMENT_OUTCOMES.WON);
});
