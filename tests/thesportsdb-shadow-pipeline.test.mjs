import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TheSportsDbShadowPipeline,
    SHADOW_PIPELINE_DECISIONS,
    SHADOW_FIXTURE_MATCH_STATUS,
    SHADOW_KICKOFF_STATUS,
    SETTLEMENT_OUTCOMES
} from '../server/sports-data/index.js';

class MockTheSportsDbProvider {
    constructor(events = []) {
        this.events = events;
        this.searchCalls = [];
    }

    async searchEvents(query) {
        this.searchCalls.push(query);
        return this.events;
    }
}

test('ShadowPipeline: Exact match -> Reconciled kickoff -> WOULD_PUBLISH -> Simulated settlement', async () => {
    const mockProvider = new MockTheSportsDbProvider([
        {
            idEvent: '1001',
            strEvent: 'Real Madrid vs Barcelona',
            strHomeTeam: 'Real Madrid',
            strAwayTeam: 'Barcelona',
            strLeague: 'Spanish La Liga',
            dateEvent: '2026-09-20',
            strTime: '19:00:00',
            intHomeScore: '2',
            intAwayScore: '1',
            strStatus: 'FT'
        }
    ]);

    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider, dryRun: true });

    const result = await pipeline.processCandidate({
        homeTeam: 'Real Madrid',
        awayTeam: 'Barcelona',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-20T19:00:00.000Z',
        market: 'Resultado final',
        selection: 'Local',
        executionMode: 'PRODUCTION'
    });

    assert.equal(result.status, SHADOW_FIXTURE_MATCH_STATUS.MATCHED);
    assert.equal(result.eventId, '1001');
    assert.equal(result.kickoffStatus, SHADOW_KICKOFF_STATUS.RECONCILED);
    assert.equal(result.publicationDecision, SHADOW_PIPELINE_DECISIONS.WOULD_PUBLISH);
    assert.equal(result.settlementResult.status, 'SIMULATED');
    assert.equal(result.settlementResult.outcome, SETTLEMENT_OUTCOMES.WON);

    const t = pipeline.getTelemetry();
    assert.equal(t.candidatesSeen, 1);
    assert.equal(t.fixturesMatched, 1);
    assert.equal(t.fixturesUncertain, 0);
    assert.equal(t.kickoffReconciled, 1);
    assert.equal(t.kickoffMismatch, 0);
    assert.equal(t.resultFound, 1);
    assert.equal(t.settlementSimulated, 1);
    assert.equal(t.settlementBlocked, 0);
    assert.equal(t.falsePositives, 0);
});

test('ShadowPipeline: Paper candidate -> WOULD_RECORD_PAPER', async () => {
    const mockProvider = new MockTheSportsDbProvider([
        {
            idEvent: '1002',
            strEvent: 'Bayern Munich vs Borussia Dortmund',
            strHomeTeam: 'Bayern Munich',
            strAwayTeam: 'Borussia Dortmund',
            strLeague: 'German Bundesliga',
            dateEvent: '2026-09-20',
            strTime: '16:30:00',
            intHomeScore: '3',
            intAwayScore: '2',
            strStatus: 'FT'
        }
    ]);

    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider });

    const result = await pipeline.processCandidate({
        homeTeam: 'Bayern Munich',
        awayTeam: 'Borussia Dortmund',
        competitionCode: 'GER-BUN',
        kickoffAt: '2026-09-20T16:30:00.000Z',
        market: 'Total de goles',
        selection: 'Más de 2,5 goles',
        executionMode: 'PAPER'
    });

    assert.equal(result.publicationDecision, SHADOW_PIPELINE_DECISIONS.WOULD_RECORD_PAPER);
    assert.equal(result.settlementResult.outcome, SETTLEMENT_OUTCOMES.WON);
});

test('ShadowPipeline: Kickoff mismatch -> HELD_FOR_REVIEW (never auto-publish)', async () => {
    const mockProvider = new MockTheSportsDbProvider([
        {
            idEvent: '1003',
            strEvent: 'Chelsea vs Arsenal',
            strHomeTeam: 'Chelsea',
            strAwayTeam: 'Arsenal',
            strLeague: 'English Premier League',
            dateEvent: '2026-09-20',
            strTime: '15:00:00', // Provider: 15:00 UTC
            intHomeScore: '1',
            intAwayScore: '1',
            strStatus: 'FT'
        }
    ]);

    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider });

    const result = await pipeline.processCandidate({
        homeTeam: 'Chelsea',
        awayTeam: 'Arsenal',
        competitionCode: 'ENG-PRE',
        kickoffAt: '2026-09-20T17:00:00.000Z', // Candidate: 17:00 UTC (diff 120m)
        market: 'Resultado final',
        selection: 'Empate'
    });

    assert.equal(result.status, SHADOW_FIXTURE_MATCH_STATUS.MATCHED);
    assert.equal(result.kickoffStatus, SHADOW_KICKOFF_STATUS.MISMATCH_REVIEW);
    assert.equal(result.publicationDecision, SHADOW_PIPELINE_DECISIONS.HELD_FOR_REVIEW);
    assert.equal(result.differenceMinutes, 120);

    const t = pipeline.getTelemetry();
    assert.equal(t.kickoffMismatch, 1);
    assert.equal(t.kickoffReconciled, 0);
});

test('ShadowPipeline: Uncertain / Not found -> BLOCKED_UNCERTAIN', async () => {
    const mockProvider = new MockTheSportsDbProvider([]); // Ningún evento devuelto
    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider });

    const result = await pipeline.processCandidate({
        homeTeam: 'Equipo Inexistente',
        awayTeam: 'Otro Desconocido',
        kickoffAt: '2026-09-20T18:00:00.000Z'
    });

    assert.equal(result.status, SHADOW_FIXTURE_MATCH_STATUS.NOT_FOUND);
    assert.equal(result.publicationDecision, SHADOW_PIPELINE_DECISIONS.BLOCKED_UNCERTAIN);

    const t = pipeline.getTelemetry();
    assert.equal(t.fixturesUncertain, 1);
    assert.equal(t.fixturesMatched, 0);
});

test('ShadowPipeline: AET / PEN match -> REGULATION_SCORE_UNAVAILABLE -> settlement BLOCKED', async () => {
    const mockProvider = new MockTheSportsDbProvider([
        {
            idEvent: '1005',
            strEvent: 'Inter vs Atletico Madrid',
            strHomeTeam: 'Inter',
            strAwayTeam: 'Atletico Madrid',
            strLeague: 'UEFA Champions League',
            dateEvent: '2026-09-20',
            strTime: '20:00:00',
            intHomeScore: '2', // Score tras prórroga (120 min)
            intAwayScore: '1',
            strStatus: 'AET'
        }
    ]);

    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider });

    const result = await pipeline.processCandidate({
        homeTeam: 'Inter',
        awayTeam: 'Atletico Madrid',
        competitionCode: 'EUR-CHL',
        kickoffAt: '2026-09-20T20:00:00.000Z',
        market: 'Resultado final',
        selection: 'Local'
    });

    assert.equal(result.status, SHADOW_FIXTURE_MATCH_STATUS.MATCHED);
    assert.equal(result.settlementResult.status, 'BLOCKED');
    assert.equal(result.settlementResult.reason, 'REGULATION_SCORE_UNAVAILABLE');

    const t = pipeline.getTelemetry();
    assert.equal(t.settlementBlocked, 1);
    assert.equal(t.settlementSimulated, 0);
});

test('ShadowPipeline: Postponed > 5 days -> Bet365 VOID', async () => {
    const mockProvider = new MockTheSportsDbProvider([
        {
            idEvent: '1006',
            strEvent: 'Valencia vs Getafe',
            strHomeTeam: 'Valencia',
            strAwayTeam: 'Getafe',
            strLeague: 'Spanish La Liga',
            dateEvent: '2026-09-10',
            strTime: '19:00:00',
            intHomeScore: null,
            intAwayScore: null,
            strStatus: 'PST'
        }
    ]);

    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider });

    // Kickoff hace 10 días (más de 5 días transcurridos)
    const result = await pipeline.processCandidate({
        homeTeam: 'Valencia',
        awayTeam: 'Getafe',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-10T19:00:00.000Z',
        market: 'Resultado final',
        selection: 'Local'
    });

    assert.equal(result.settlementResult.status, 'SIMULATED');
    assert.equal(result.settlementResult.outcome, SETTLEMENT_OUTCOMES.VOID);
});

test('ShadowPipeline: Abandoned with mathematically determined market -> Bet365 WON', async () => {
    const mockProvider = new MockTheSportsDbProvider([
        {
            idEvent: '1007',
            strEvent: 'Sevilla vs Real Betis',
            strHomeTeam: 'Sevilla',
            strAwayTeam: 'Real Betis',
            strLeague: 'Spanish La Liga',
            dateEvent: '2026-09-20',
            strTime: '19:00:00',
            intHomeScore: '2',
            intAwayScore: '1', // 3 goles en total al momento del abandono
            strStatus: 'ABD'
        }
    ]);

    const pipeline = new TheSportsDbShadowPipeline({ provider: mockProvider });

    // Over 2.5 con marcador 2-1 al abandono -> determinado matemáticamente
    const result = await pipeline.processCandidate({
        homeTeam: 'Sevilla',
        awayTeam: 'Real Betis',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-20T19:00:00.000Z',
        market: 'Total de goles',
        selection: 'Más de 2,5 goles'
    });

    assert.equal(result.settlementResult.status, 'SIMULATED');
    assert.equal(result.settlementResult.outcome, SETTLEMENT_OUTCOMES.WON);
});
