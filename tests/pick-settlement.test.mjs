import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MockSportsResultsProvider,
    FIXTURE_STATUSES,
    SPORTS_PROVIDER_INTEGRATION_STATE,
    normalizeSportsResult
} from '../server/sports-results-provider.js';
import {
    evaluate1X2,
    evaluateOverUnder,
    evaluateBTTS,
    evaluatePickResult,
    SETTLEMENT_STATUSES,
    isSettlementLiveEnabled
} from '../server/pick-settlement-engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. SPORTS RESULTS PROVIDER ABSTRACTION & CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
test('SportsResultsProvider: normaliza fixture al contrato canónico', () => {
    const rawFixture = {
        id: 'fix_12345',
        sourceEventId: 'fb_evt_999',
        competition: 'LaLiga EA Sports',
        teams: { home: 'Real Betis', away: 'Real Sociedad' },
        kickoff: '2026-09-20T19:00:00.000Z',
        status: 'finished',
        regularTimeScore: { home: 2, away: 1 },
        extraTimeScore: null,
        penalties: null,
        source: 'api-football-v3'
    };

    const norm = normalizeSportsResult(rawFixture);
    assert.equal(norm.fixtureId, 'fix_12345');
    assert.equal(norm.competition, 'LaLiga EA Sports');
    assert.equal(norm.teams.home, 'Real Betis');
    assert.equal(norm.teams.away, 'Real Sociedad');
    assert.equal(norm.status, 'finished');
    assert.deepEqual(norm.regularTimeScore, { home: 2, away: 1 });
    assert.equal(norm.source, 'api-football-v3');
});

test('SportsResultsProvider: Mock provider encuentra fixtures por sourceEventId y por equipos', async () => {
    const provider = new MockSportsResultsProvider([
        {
            fixtureId: 'fx_1',
            sourceEventId: 'src_evt_101',
            competition: 'Premier League',
            teams: { home: 'Arsenal', away: 'Chelsea' },
            status: 'finished',
            regularTimeScore: { home: 3, away: 1 },
            source: 'mock'
        }
    ]);

    // 1. Búsqueda prioritaria por sourceEventId
    const byId = await provider.getFixtureResult({ sourceEventId: 'src_evt_101' });
    assert.ok(byId);
    assert.equal(byId.fixtureId, 'fx_1');

    // 2. Búsqueda por fallback de equipos
    const byTeams = await provider.getFixtureResult({ homeTeam: 'Arsenal', awayTeam: 'Chelsea' });
    assert.ok(byTeams);
    assert.equal(byTeams.fixtureId, 'fx_1');

    // 3. Partido no encontrado devuelve null
    const notFound = await provider.getFixtureResult({ sourceEventId: 'non_existent' });
    assert.equal(notFound, null);
});

test('SportsResultsProvider: estado arquitectónico formal es ENGINE READY / PROVIDER NOT CONNECTED', () => {
    assert.equal(SPORTS_PROVIDER_INTEGRATION_STATE.ENGINE_STATE, 'READY');
    assert.equal(SPORTS_PROVIDER_INTEGRATION_STATE.PROVIDER_STATE, 'NOT_CONNECTED');
    // En entorno de test sin feature flag activa, isSettlementLiveEnabled() es false
    const previous = process.env.SETTLEMENT_LIVE_ENABLED;
    try {
        delete process.env.SETTLEMENT_LIVE_ENABLED;
        assert.equal(isSettlementLiveEnabled(), false);
    } finally {
        if (previous !== undefined) process.env.SETTLEMENT_LIVE_ENABLED = previous;
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. REGLAS DETERMINISTAS: MERCADO 1X2
// ─────────────────────────────────────────────────────────────────────────────
test('Settlement Engine: 1X2 evalúa correctamente victorias locales, empates y visitantes', () => {
    const homeTeam = 'Barcelona';
    const awayTeam = 'Espanyol';

    // Caso A: Victoria local 2-0
    const scoreHome = { home: 2, away: 0 };
    assert.equal(evaluate1X2({ selection: '1', homeTeam, awayTeam, regularTimeScore: scoreHome }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluate1X2({ selection: 'Barcelona', homeTeam, awayTeam, regularTimeScore: scoreHome }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluate1X2({ selection: 'X', homeTeam, awayTeam, regularTimeScore: scoreHome }).status, SETTLEMENT_STATUSES.LOST);
    assert.equal(evaluate1X2({ selection: '2', homeTeam, awayTeam, regularTimeScore: scoreHome }).status, SETTLEMENT_STATUSES.LOST);

    // Caso B: Empate 1-1
    const scoreDraw = { home: 1, away: 1 };
    assert.equal(evaluate1X2({ selection: 'X', homeTeam, awayTeam, regularTimeScore: scoreDraw }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluate1X2({ selection: 'Empate', homeTeam, awayTeam, regularTimeScore: scoreDraw }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluate1X2({ selection: '1', homeTeam, awayTeam, regularTimeScore: scoreDraw }).status, SETTLEMENT_STATUSES.LOST);

    // Caso C: Victoria visitante 1-2
    const scoreAway = { home: 1, away: 2 };
    assert.equal(evaluate1X2({ selection: '2', homeTeam, awayTeam, regularTimeScore: scoreAway }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluate1X2({ selection: 'Espanyol', homeTeam, awayTeam, regularTimeScore: scoreAway }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluate1X2({ selection: '1', homeTeam, awayTeam, regularTimeScore: scoreAway }).status, SETTLEMENT_STATUSES.LOST);

    // Caso D: Selección ambigua escala a pending_human_review
    assert.equal(evaluate1X2({ selection: 'Doble Oportunidad 1X', homeTeam, awayTeam, regularTimeScore: scoreHome }).status, SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REGLAS DETERMINISTAS: MERCADO OVER/UNDER (LÍNEAS DE GOLES)
// ─────────────────────────────────────────────────────────────────────────────
test('Settlement Engine: Over/Under evalúa líneas explícitas y respeta void en líneas asiáticas', () => {
    const score3Goals = { home: 2, away: 1 }; // Total: 3 goles

    // Over 2.5 -> WON (3 > 2.5)
    assert.equal(evaluateOverUnder({ selection: 'Más de 2.5', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluateOverUnder({ selection: 'Over 2.5 goles', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.WON);

    // Under 2.5 -> LOST (3 > 2.5)
    assert.equal(evaluateOverUnder({ selection: 'Menos de 2.5', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.LOST);

    // Over 3.5 -> LOST (3 < 3.5)
    assert.equal(evaluateOverUnder({ selection: 'Más de 3.5', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.LOST);

    // Under 3.5 -> WON (3 < 3.5)
    assert.equal(evaluateOverUnder({ selection: 'Menos de 3.5', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.WON);

    // Línea entera (Over 3.0 con 3 goles) -> VOID
    assert.equal(evaluateOverUnder({ selection: 'Over 3.0', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.VOID);

    // Línea no explícita -> pending_human_review
    assert.equal(evaluateOverUnder({ selection: 'Muchos goles', regularTimeScore: score3Goals }).status, SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. REGLAS DETERMINISTAS: MERCADO BTTS (AMBOS EQUIPOS MARCAN)
// ─────────────────────────────────────────────────────────────────────────────
test('Settlement Engine: BTTS evalúa Sí/No deterministamente', () => {
    // Ambos marcan (2-1)
    const bothScored = { home: 2, away: 1 };
    assert.equal(evaluateBTTS({ selection: 'Sí', regularTimeScore: bothScored }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluateBTTS({ selection: 'Ambos marcan', regularTimeScore: bothScored }).status, SETTLEMENT_STATUSES.WON);
    assert.equal(evaluateBTTS({ selection: 'No', regularTimeScore: bothScored }).status, SETTLEMENT_STATUSES.LOST);

    // Uno no marca (2-0)
    const oneScored = { home: 2, away: 0 };
    assert.equal(evaluateBTTS({ selection: 'Sí', regularTimeScore: oneScored }).status, SETTLEMENT_STATUSES.LOST);
    assert.equal(evaluateBTTS({ selection: 'No', regularTimeScore: oneScored }).status, SETTLEMENT_STATUSES.WON);

    // Ninguno marca (0-0)
    const noneScored = { home: 0, away: 0 };
    assert.equal(evaluateBTTS({ selection: 'Sí', regularTimeScore: noneScored }).status, SETTLEMENT_STATUSES.LOST);
    assert.equal(evaluateBTTS({ selection: 'No', regularTimeScore: noneScored }).status, SETTLEMENT_STATUSES.WON);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REGLA INVIOLABLE: ESTRICTAMENTE 90 MINUTOS REGLAMENTARIOS (score.fulltime)
// ─────────────────────────────────────────────────────────────────────────────
test('Settlement Engine: ignora prórroga y liquida estrictamente según regularTimeScore (90 min)', () => {
    const pick = {
        id: 'op_cup_final_1',
        event: { homeTeam: 'Athletic Club', awayTeam: 'Mallorca' },
        bet: { market: '1X2', selection: 'Empate' }
    };

    // El partido terminó 1-1 en los 90 min reglamentarios, pero 2-1 en la prórroga
    const fixtureWithExtraTime = {
        fixtureId: 'fix_cup_1',
        status: FIXTURE_STATUSES.FINISHED,
        regularTimeScore: { home: 1, away: 1 }, // 90 min
        extraTimeScore: { home: 2, away: 1 },   // Prórroga
        source: 'api-football-v3'
    };

    const evaluation = evaluatePickResult({ pick, fixture: fixtureWithExtraTime });
    assert.equal(evaluation.settled, true);
    assert.equal(evaluation.status, SETTLEMENT_STATUSES.WON);
    assert.deepEqual(evaluation.regularTimeScore, { home: 1, away: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TOLERANCIA A PARTIDOS EN JUEGO VS PARTIDOS SUSPENDIDOS / ANÓMALOS
// ─────────────────────────────────────────────────────────────────────────────
test('Settlement Engine: partido todavía en juego tras +105 min sigue pendiente sin alerta prematura', () => {
    const pick = {
        id: 'op_live_test_1',
        event: { homeTeam: 'Liverpool', awayTeam: 'Manchester City' },
        bet: { market: '1X2', selection: 'Liverpool' }
    };

    // Caso A: Partido en juego (IN_PLAY, prórroga, descanso o demora normal)
    const inPlayFixture = {
        fixtureId: 'fix_live_1',
        status: FIXTURE_STATUSES.IN_PLAY,
        regularTimeScore: { home: 1, away: 1 },
        source: 'api-football-v3'
    };

    const evalInPlay = evaluatePickResult({ pick, fixture: inPlayFixture });
    // REGLA ARQUITECTÓNICA EXIGIDA:
    // Debe permanecer pending y NO pasar a pending_human_review
    assert.equal(evalInPlay.settled, false);
    assert.equal(evalInPlay.status, SETTLEMENT_STATUSES.PENDING);
    assert.ok(evalInPlay.reason.includes('en curso') || evalInPlay.reason.includes('demorado'));

    // Caso B: Partido con prórroga en curso (EXTRA_TIME)
    const extraTimeFixture = {
        fixtureId: 'fix_live_et',
        status: FIXTURE_STATUSES.EXTRA_TIME,
        regularTimeScore: { home: 1, away: 1 },
        source: 'api-football-v3'
    };
    const evalET = evaluatePickResult({ pick, fixture: extraTimeFixture });
    assert.equal(evalET.settled, false);
    assert.equal(evalET.status, SETTLEMENT_STATUSES.PENDING);

    // Caso C: Partido demorado (DELAYED)
    const delayedFixture = {
        fixtureId: 'fix_live_delayed',
        status: FIXTURE_STATUSES.DELAYED,
        regularTimeScore: null,
        source: 'api-football-v3'
    };
    const evalDelayed = evaluatePickResult({ pick, fixture: delayedFixture });
    assert.equal(evalDelayed.settled, false);
    assert.equal(evalDelayed.status, SETTLEMENT_STATUSES.PENDING);
});

test('Settlement Engine: partidos suspendidos, aplazados o cancelados escalan a pending_human_review', () => {
    const pick = {
        id: 'op_postponed_1',
        event: { homeTeam: 'Villarreal', awayTeam: 'Rayo Vallecano' },
        bet: { market: '1X2', selection: 'Villarreal' }
    };

    // 1. Aplazado (POSTPONED)
    const postponedFixture = {
        fixtureId: 'fix_postponed',
        status: FIXTURE_STATUSES.POSTPONED,
        regularTimeScore: null,
        source: 'mock'
    };
    const evalPostponed = evaluatePickResult({ pick, fixture: postponedFixture });
    assert.equal(evalPostponed.settled, false);
    assert.equal(evalPostponed.status, SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW);
    assert.ok(evalPostponed.reason.includes('postponed'));

    // 2. Suspendido (SUSPENDED)
    const suspendedFixture = {
        fixtureId: 'fix_suspended',
        status: FIXTURE_STATUSES.SUSPENDED,
        regularTimeScore: { home: 0, away: 0 },
        source: 'mock'
    };
    const evalSuspended = evaluatePickResult({ pick, fixture: suspendedFixture });
    assert.equal(evalSuspended.settled, false);
    assert.equal(evalSuspended.status, SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW);

    // 3. Cancelado (CANCELLED)
    const cancelledFixture = {
        fixtureId: 'fix_cancelled',
        status: FIXTURE_STATUSES.CANCELLED,
        regularTimeScore: null,
        source: 'mock'
    };
    const evalCancelled = evaluatePickResult({ pick, fixture: cancelledFixture });
    assert.equal(evalCancelled.settled, false);
    assert.equal(evalCancelled.status, SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW);

    // 4. Interrumpido (INTERRUPTED)
    const interruptedFixture = {
        fixtureId: 'fix_interrupted',
        status: FIXTURE_STATUSES.INTERRUPTED,
        regularTimeScore: { home: 1, away: 0 },
        source: 'mock'
    };
    const evalInterrupted = evaluatePickResult({ pick, fixture: interruptedFixture });
    assert.equal(evalInterrupted.settled, false);
    assert.equal(evalInterrupted.status, SETTLEMENT_STATUSES.PENDING_HUMAN_REVIEW);
});
