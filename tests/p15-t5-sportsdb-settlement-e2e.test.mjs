/**
 * @file Tests E2E de Integración P1.5: T-5 + TheSportsDB + Settlement 01:00.
 * 
 * Verifica los 11 casos obligatorios:
 * 1. ESP Production T-5 (WOULD_PUBLISH)
 * 2. FRA Production T-5 (WOULD_PUBLISH)
 * 3. GER Paper (WOULD_RECORD_PAPER, stake 0)
 * 4. TUR Paper (WOULD_RECORD_PAPER, stake 0)
 * 5. TheSportsDB matched (kickoff exacto adoptado)
 * 6. timezone +60/+120 autocorregido (adopción automática providerKickoffAt)
 * 7. TheSportsDB NOT_FOUND con fallback FutbolBrain (SPORTS_DATA_UNMATCHED, no bloquea pick)
 * 8. FT settlement (liquidación automática 90 min)
 * 9. postponed (regla 5 días Bet365)
 * 10. interrupted/abandoned (regla 48h / mercados determinados Bet365)
 * 11. AET/PEN bloqueado (REGULATION_SCORE_UNAVAILABLE)
 * 
 * Y verifica las restricciones de seguridad:
 * - Feature flags reales en OFF
 * - 0 Firestore writes
 * - 0 Telegram outbound
 * - 0 mutaciones en producción
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TelegramPocRouter
} from '../server/futbolbrain-telegram-poc/poc-router.js';

import {
    SportsDataProvider,
    TheSportsDbProvider,
    ApiFootballProvider,
    CanonicalSettlementScheduler,
    SETTLEMENT_CYCLE_STATUSES,
    SETTLEMENT_OUTCOMES,
    RECONCILIATION_STATUSES,
    KICKOFF_CLASSIFICATIONS
} from '../server/sports-data/index.js';

import { TelegramDeduplicationLedger } from '../server/futbolbrain-telegram-poc/deduplication-ledger.js';

// Mock Provider para pruebas deterministas controladas
class MockSportsDataProvider extends SportsDataProvider {
    constructor({ events = [], eventLookups = {} } = {}) {
        super('MockTheSportsDbProvider');
        this.events = events;
        this.eventLookups = eventLookups;
        this.searchCalls = [];
        this.getEventCalls = [];
    }

    async searchEvents(query, season) {
        this.searchCalls.push({ query, season });
        return this.events;
    }

    async getEvent(idEvent) {
        this.getEventCalls.push(idEvent);
        return this.eventLookups[String(idEvent)] || null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 1: ESP Production T-5 -> WOULD_PUBLISH
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 1: ESP Production T-5 emite WOULD_PUBLISH en publish path', async () => {
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: '2506229',
            strEvent: 'Atlético Madrid vs Real Madrid',
            strHomeTeam: 'Atlético Madrid',
            strAwayTeam: 'Real Madrid',
            strLeague: 'Spanish La Liga',
            dateEvent: '2026-09-20',
            strTime: '14:15:00',
            strStatus: 'FT'
        }]
    });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger(),
        dryRun: true
    });

    const msgText = [
        'AI Model MT-LAB-BTTS-ESP-v0.1',
        'Yield: 7.2% Hit Rate: 65.0%',
        '',
        'ESP-PRE: Atlético Madrid VS Real Madrid',
        '    -Predicted Probability: 66%',
        '    -Kickoff: 16:15',
        '',
        'Market BTTS Yes (Bet365): 1.50',
        '',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28440,
        observedAt: new Date('2026-09-20T14:10:00.000Z')
    });

    assert.equal(routed.action, 'WOULD_PUBLISH');
    assert.equal(routed.executionMode, 'PRODUCTION');
    assert.equal(routed.candidate.systemId, 'MT-LAB-BTTS-ESP-v0.1');
    assert.equal(routed.candidate.sportsDataStatus, 'MATCHED');
    assert.equal(routed.candidate.fixtureId, '2506229');
    assert.equal(routed.candidate.kickoffAt, '2026-09-20T14:15:00.000Z');

    const safety = routed.safety;
    assert.equal(safety.externalFirestoreWrites, 0);
    assert.equal(safety.outboundTelegramMessages, 0);
    assert.equal(safety.productionMutations, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 2: FRA Production T-5 -> WOULD_PUBLISH
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 2: FRA Production T-5 emite WOULD_PUBLISH en publish path', async () => {
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: '2489499',
            strEvent: 'Lyon vs Rennes',
            strHomeTeam: 'Lyon',
            strAwayTeam: 'Rennes',
            strLeague: 'French Ligue 1',
            dateEvent: '2026-09-19',
            strTime: '18:45:00',
            strStatus: 'NS'
        }]
    });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger(),
        dryRun: true
    });

    const msgText = [
        'AI Model MT - FRA1 FRA2 - V1.0',
        'Yield: 6.5% Hit Rate: 62.0%',
        '',
        'FRA-LG1: Olympique Lyonnais VS Rennes',
        '    -Predicted Probability: 68%',
        '    -Kickoff: 20:45',
        '',
        'Market Over 2.5 (Bet365): 1.75',
        '',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28450,
        observedAt: new Date('2026-09-19T18:40:00.000Z')
    });

    assert.equal(routed.action, 'WOULD_PUBLISH');
    assert.equal(routed.executionMode, 'PRODUCTION');
    assert.equal(routed.candidate.systemId, 'MT - FRA1 FRA2 - V1.0');
    assert.equal(routed.candidate.sportsDataStatus, 'MATCHED');
    assert.equal(routed.candidate.fixtureId, '2489499');
    assert.equal(routed.safety.externalFirestoreWrites, 0);
    assert.equal(routed.safety.outboundTelegramMessages, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 3: GER Paper -> WOULD_RECORD_PAPER, stake 0, nunca publicar
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 3: GER Paper emite WOULD_RECORD_PAPER con stake 0 y nunca publica', async () => {
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: '2508363',
            strEvent: 'Bayer Leverkusen vs RB Leipzig',
            strHomeTeam: 'Bayer Leverkusen',
            strAwayTeam: 'RB Leipzig',
            strLeague: 'German Bundesliga',
            dateEvent: '2026-09-20',
            strTime: '13:30:00',
            strStatus: 'FT'
        }]
    });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger(),
        dryRun: true
    });

    const msgText = [
        'AI Model MT - GER1 - v1.1',
        'Yield: 4.8% Hit Rate: 58.0%',
        '',
        'GER-BUN: Bayer Leverkusen VS RB Leipzig',
        '    -Predicted Probability: 64%',
        '    -Kickoff: 15:30',
        '',
        'Market Over 3.5 (Bet365): 1.80',
        '',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28437,
        observedAt: new Date('2026-09-20T13:25:00.000Z')
    });

    assert.equal(routed.action, 'WOULD_RECORD_PAPER');
    assert.equal(routed.executionMode, 'PAPER');
    assert.equal(routed.stake, 0);
    assert.equal(routed.candidate.systemId, 'MT - GER1 - v1.1');
    assert.equal(routed.candidate.sportsDataStatus, 'MATCHED');
    assert.equal(routed.candidate.fixtureId, '2508363');
    assert.equal(routed.safety.outboundTelegramMessages, 0);
    assert.equal(routed.safety.externalFirestoreWrites, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 4: TUR Paper -> WOULD_RECORD_PAPER, stake 0, nunca publicar
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 4: TUR Paper emite WOULD_RECORD_PAPER con stake 0 y nunca publica', async () => {
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: '2527771',
            strEvent: 'Göztepe vs Rizespor',
            strHomeTeam: 'Göztepe',
            strAwayTeam: 'Rizespor',
            strLeague: 'Turkish Super Lig',
            dateEvent: '2026-09-20',
            strTime: '17:00:00',
            strStatus: 'FT'
        }]
    });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger(),
        dryRun: true
    });

    const msgText = [
        'AI Model MT - TUR1 - V1.0',
        'Yield: 5.2% Hit Rate: 55.0%',
        '',
        'TUR-SUP: Göztepe VS Rizespor',
        '    -Predicted Probability: 52%',
        '    -Kickoff: 19:00',
        '',
        'Market Away FT (Bet365): 2.40',
        '',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28455,
        observedAt: new Date('2026-09-20T16:55:00.000Z')
    });

    assert.equal(routed.action, 'WOULD_RECORD_PAPER');
    assert.equal(routed.executionMode, 'PAPER');
    assert.equal(routed.stake, 0);
    assert.equal(routed.candidate.systemId, 'MT - TUR1 - V1.0');
    assert.equal(routed.candidate.sportsDataStatus, 'MATCHED');
    assert.equal(routed.candidate.fixtureId, '2527771');
    assert.equal(routed.safety.outboundTelegramMessages, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 5: TheSportsDB matched -> Kickoff exacto adoptado
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 5: TheSportsDB matched con kickoff exacto adopta providerKickoffAt y fixtureId', async () => {
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: '99001',
            strEvent: 'Athletic Bilbao vs Elche',
            strHomeTeam: 'Athletic Bilbao',
            strAwayTeam: 'Elche',
            strLeague: 'Spanish La Liga',
            dateEvent: '2026-09-12',
            strTime: '16:30:00',
            strStatus: 'NS'
        }]
    });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger()
    });

    const msgText = [
        'AI Model MT-LAB-BTTS-ESP-v0.1',
        'ESP-PRE: Athletic Club VS Elche',
        '    -Kickoff: 18:30', // 18:30 Madrid CEST = 16:30 UTC
        'Market BTTS Yes (Bet365): 1.70',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28460,
        observedAt: new Date('2026-09-12T16:25:00.000Z')
    });

    assert.equal(routed.candidate.sportsData.status, 'MATCHED');
    assert.equal(routed.candidate.sportsData.kickoffClassification, 'EXACT');
    assert.equal(routed.candidate.fixtureId, '99001');
    assert.equal(routed.candidate.kickoffAt, '2026-09-12T16:30:00.000Z');
    assert.equal(routed.candidate.sportsData.differenceMinutes, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 6: Timezone +60/+120 autocorregido -> Adopción automática
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 6: Timezone +60/+120 compatible CET/CEST adopta automáticamente providerKickoffAt', async () => {
    // Escenario: El pick viene con 18:00 UTC (desfase de 120m respecto a 16:00 UTC en TheSportsDB)
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: '2482180',
            strEvent: 'Juventus vs Atalanta',
            strHomeTeam: 'Juventus',
            strAwayTeam: 'Atalanta',
            strLeague: 'Italian Serie A',
            dateEvent: '2026-09-20',
            strTime: '16:00:00', // 16:00 UTC
            strStatus: 'FT'
        }]
    });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger()
    });

    const msgText = [
        'AI Model MT-LAB-BTTS-ESP-v0.1', // Usamos sistema T-5
        'ESP-PRE: Juventus VS Atalanta',
        '    -Kickoff: 20:00', // 20:00 Madrid = 18:00 UTC (diff 120m vs 16:00 UTC)
        'Market BTTS Yes (Bet365): 1.65',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28465,
        observedAt: new Date('2026-09-20T15:55:00.000Z')
    });

    assert.equal(routed.candidate.sportsData.status, 'MATCHED');
    assert.equal(routed.candidate.sportsData.kickoffClassification, 'EXPLICABLE_TIMEZONE');
    assert.equal(routed.candidate.sportsData.differenceMinutes, 120);
    // Adopción automática de la hora canónica UTC de TheSportsDB
    assert.equal(routed.candidate.kickoffAt, '2026-09-20T16:00:00.000Z');
    assert.equal(routed.candidate.fixtureId, '2482180');
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 7: TheSportsDB NOT_FOUND con fallback FutbolBrain (SPORTS_DATA_UNMATCHED)
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 7: TheSportsDB NOT_FOUND NO bloquea el pick, usa fallback FutbolBrain y marca SPORTS_DATA_UNMATCHED', async () => {
    // Proveedor no encuentra el evento
    const mockProvider = new MockSportsDataProvider({ events: [] });

    const router = new TelegramPocRouter({
        sportsDataProvider: mockProvider,
        dedupLedger: new TelegramDeduplicationLedger()
    });

    const msgText = [
        'AI Model MT - FRA1 FRA2 - V1.0',
        'FRA-LG1: Paris FC VS Pau FC',
        '    -Kickoff: 20:00', // 20:00 Madrid CEST = 18:00 UTC
        'Market Over 2.5 (Bet365): 1.85',
        'Active Pick'
    ].join('\n');

    const routed = await router.processMessage({
        text: msgText,
        telegramMessageId: 28470,
        observedAt: new Date('2026-09-20T17:55:00.000Z')
    });

    // NO se bloquea: sigue el flujo normal
    assert.equal(routed.action, 'WOULD_PUBLISH');
    assert.equal(routed.executionMode, 'PRODUCTION');
    assert.equal(routed.candidate.sportsDataStatus, 'SPORTS_DATA_UNMATCHED');
    assert.equal(routed.candidate.fixtureId, null);
    // Usa kickoff de FutbolBrain como fallback
    assert.equal(routed.candidate.kickoffAt, '2026-09-20T18:00:00.000Z');
    assert.equal(routed.candidate.sportsData.kickoffClassification, 'NOT_FOUND');
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 8: FT Settlement (Liquidación con marcador final 90 min)
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 8: FT Settlement liquida automáticamente a WON/LOST con marcador reglamentario', async () => {
    const mockProvider = new MockSportsDataProvider({
        eventLookups: {
            '10001': {
                idEvent: '10001',
                strStatus: 'FT',
                intHomeScore: '2',
                intAwayScore: '1'
            }
        }
    });

    const scheduler = new CanonicalSettlementScheduler({
        sportsDataProvider: mockProvider,
        cronActive: false,
        dryRun: true
    });

    const pendingPicks = [
        {
            id: 'pick-1',
            fixtureId: '10001',
            market: 'Ambos equipos marcan',
            selection: 'Sí',
            homeTeam: 'Atlético Madrid',
            awayTeam: 'Real Madrid'
        },
        {
            id: 'pick-2',
            fixtureId: '10001',
            market: 'Resultado final',
            selection: 'Visitante',
            homeTeam: 'Atlético Madrid',
            awayTeam: 'Real Madrid'
        }
    ];

    const cycleResult = await scheduler.runSettlementCycle(pendingPicks);

    assert.equal(cycleResult.stats.picksSettled, 2);
    assert.equal(cycleResult.results[0].evaluation.status, 'SETTLED');
    assert.equal(cycleResult.results[0].evaluation.outcome, SETTLEMENT_OUTCOMES.WON);
    assert.equal(cycleResult.results[1].evaluation.status, 'SETTLED');
    assert.equal(cycleResult.results[1].evaluation.outcome, SETTLEMENT_OUTCOMES.LOST);

    assert.equal(cycleResult.safety.firestoreWrites, 0);
    assert.equal(cycleResult.safety.cronActive, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 9: Postponed (Regla Bet365 de 5 días)
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 9: Postponed aplica regla de 5 días Bet365 (<= 5d PENDING, > 5d VOID)', async () => {
    const origKickoff = '2026-09-20T14:00:00.000Z';

    const mockProvider = new MockSportsDataProvider({
        eventLookups: {
            'pst-within-5d': {
                idEvent: 'pst-within-5d',
                strStatus: 'PST',
                dateEvent: '2026-09-20'
            },
            'pst-beyond-5d': {
                idEvent: 'pst-beyond-5d',
                strStatus: 'PST',
                dateEvent: '2026-09-20'
            }
        }
    });

    const scheduler = new CanonicalSettlementScheduler({ sportsDataProvider: mockProvider });

    // 1. Evaluación a los 2 días (<= 5 días) -> PENDING_DATA
    const day2 = new Date('2026-09-22T01:00:00.000Z');
    const resWithin = await scheduler.runSettlementCycle([
        { id: 'pick-pst-1', fixtureId: 'pst-within-5d', kickoffAt: origKickoff }
    ], { referenceDate: day2 });

    assert.equal(resWithin.results[0].evaluation.status, 'PENDING_DATA');
    assert.equal(resWithin.results[0].evaluation.reason, 'POSTPONED_PENDING_RESCHEDULE');

    // 2. Evaluación a los 6 días (> 5 días) -> SETTLED VOID según Bet365
    const day6 = new Date('2026-09-26T01:00:00.000Z');
    const resBeyond = await scheduler.runSettlementCycle([
        { id: 'pick-pst-2', fixtureId: 'pst-beyond-5d', kickoffAt: origKickoff }
    ], { referenceDate: day6 });

    assert.equal(resBeyond.results[0].evaluation.status, 'SETTLED');
    assert.equal(resBeyond.results[0].evaluation.outcome, SETTLEMENT_OUTCOMES.VOID);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 10: Interrupted / Abandoned (Reglas Bet365 48h y mercados determinados)
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 10: Interrupted (48h) y Abandoned (mercado determinado WON, no determinado VOID)', async () => {
    const origKickoff = '2026-09-20T14:00:00.000Z';

    const mockProvider = new MockSportsDataProvider({
        eventLookups: {
            'int-within-48h': {
                idEvent: 'int-within-48h',
                strStatus: 'INT',
                dateEvent: '2026-09-20'
            },
            'abd-over-determined': {
                idEvent: 'abd-over-determined',
                strStatus: 'ABD',
                intHomeScore: '2',
                intAwayScore: '1' // 3 goles antes de la suspensión
            },
            'abd-undetermined': {
                idEvent: 'abd-undetermined',
                strStatus: 'ABD',
                intHomeScore: '0',
                intAwayScore: '0'
            }
        }
    });

    const scheduler = new CanonicalSettlementScheduler({ sportsDataProvider: mockProvider });

    // 1. Interrumpido dentro de 48h -> PENDING_DATA
    const day1 = new Date('2026-09-21T01:00:00.000Z');
    const resInt = await scheduler.runSettlementCycle([
        { id: 'pick-int', fixtureId: 'int-within-48h', kickoffAt: origKickoff }
    ], { referenceDate: day1 });
    assert.equal(resInt.results[0].evaluation.status, 'PENDING_DATA');
    assert.equal(resInt.results[0].evaluation.reason, 'INTERRUPTED_AWAITING_RESUME_48H');

    // 2. Abandonado con mercado Over 2.5 matemáticamente determinado (2-1) -> WON
    const resAbdWon = await scheduler.runSettlementCycle([
        {
            id: 'pick-abd-won',
            fixtureId: 'abd-over-determined',
            market: 'Total de goles',
            selection: 'Más de 2,5 goles',
            kickoffAt: origKickoff
        }
    ]);
    assert.equal(resAbdWon.results[0].evaluation.status, 'SETTLED');
    assert.equal(resAbdWon.results[0].evaluation.outcome, SETTLEMENT_OUTCOMES.WON);

    // 3. Abandonado con mercado 1X2 indeterminado (0-0) -> VOID
    const resAbdVoid = await scheduler.runSettlementCycle([
        {
            id: 'pick-abd-void',
            fixtureId: 'abd-undetermined',
            market: 'Resultado final',
            selection: 'Local',
            kickoffAt: origKickoff
        }
    ]);
    assert.equal(resAbdVoid.results[0].evaluation.status, 'SETTLED');
    assert.equal(resAbdVoid.results[0].evaluation.outcome, SETTLEMENT_OUTCOMES.VOID);
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO 11: AET/PEN bloqueado -> REGULATION_SCORE_UNAVAILABLE
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso 11: AET/PEN sin marcador a 90 min es bloqueado como REGULATION_SCORE_UNAVAILABLE', async () => {
    const mockProvider = new MockSportsDataProvider({
        eventLookups: {
            'aet-event': {
                idEvent: 'aet-event',
                strStatus: 'AET',
                intHomeScore: '2', // Marcador tras 120 min
                intAwayScore: '1'
            },
            'pen-event': {
                idEvent: 'pen-event',
                strStatus: 'PEN',
                intHomeScore: '5',
                intAwayScore: '4'
            }
        }
    });

    const scheduler = new CanonicalSettlementScheduler({ sportsDataProvider: mockProvider });

    const res = await scheduler.runSettlementCycle([
        { id: 'pick-aet', fixtureId: 'aet-event', market: 'Resultado final', selection: 'Local' },
        { id: 'pick-pen', fixtureId: 'pen-event', market: 'Resultado final', selection: 'Local' }
    ]);

    assert.equal(res.stats.picksBlocked, 2);
    assert.equal(res.results[0].evaluation.status, 'BLOCKED');
    assert.equal(res.results[0].evaluation.reason, 'REGULATION_SCORE_UNAVAILABLE');
    assert.equal(res.results[1].evaluation.status, 'BLOCKED');
    assert.equal(res.results[1].evaluation.reason, 'REGULATION_SCORE_UNAVAILABLE');
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO EXTRA: Reintento de SPORTS_DATA_UNMATCHED en el ciclo de las 01:00
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Caso Reintento: SPORTS_DATA_UNMATCHED reintenta matching en las 01:00 y liquida si se recupera', async () => {
    const mockProvider = new MockSportsDataProvider({
        events: [{
            idEvent: 'recovered-101',
            strEvent: 'Valencia vs Getafe',
            strHomeTeam: 'Valencia',
            strAwayTeam: 'Getafe',
            strLeague: 'Spanish La Liga',
            dateEvent: '2026-09-20',
            strTime: '19:00:00',
            strStatus: 'FT',
            intHomeScore: '1',
            intAwayScore: '0'
        }],
        eventLookups: {
            'recovered-101': {
                idEvent: 'recovered-101',
                strStatus: 'FT',
                intHomeScore: '1',
                intAwayScore: '0'
            }
        }
    });

    const scheduler = new CanonicalSettlementScheduler({ sportsDataProvider: mockProvider });

    // Pick que entró como SPORTS_DATA_UNMATCHED (sin fixtureId)
    const unmatchedPick = {
        id: 'pick-unmatched',
        homeTeam: 'Valencia',
        awayTeam: 'Getafe',
        competitionCode: 'ESP-PRE',
        kickoffAt: '2026-09-20T19:00:00.000Z',
        market: 'Resultado final',
        selection: 'Local',
        sportsDataStatus: 'SPORTS_DATA_UNMATCHED',
        fixtureId: null
    };

    const res = await scheduler.runSettlementCycle([unmatchedPick]);

    assert.equal(res.stats.unmatchedRetried, 1);
    assert.equal(res.stats.unmatchedRecovered, 1);
    assert.equal(res.stats.picksSettled, 1);
    assert.equal(res.results[0].evaluation.status, 'SETTLED');
    assert.equal(res.results[0].evaluation.outcome, SETTLEMENT_OUTCOMES.WON);
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICACIÓN DE ARQUITECTURA Y SEGURIDAD
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Seguridad: Feature flags en OFF, provider-agnostic, 0 escrituras Firestore, 0 Telegram', () => {
    const theSportsDb = new TheSportsDbProvider({ apiKey: '3' });
    const apiFootball = new ApiFootballProvider({ apiKey: 'dummy' });

    assert.ok(theSportsDb instanceof SportsDataProvider, 'TheSportsDbProvider debe heredar de SportsDataProvider');
    assert.ok(apiFootball instanceof SportsDataProvider, 'ApiFootballProvider debe heredar de SportsDataProvider');

    const scheduler = new CanonicalSettlementScheduler({
        sportsDataProvider: theSportsDb,
        cronActive: false,
        dryRun: true
    });

    assert.equal(scheduler.isCronActive(), false, 'El cron real DEBE estar en OFF');
    const safety = scheduler.getSafetyReport();
    assert.equal(safety.cronActive, false);
    assert.equal(safety.dryRun, true);
    assert.equal(safety.firestoreWrites, 0);
    assert.equal(safety.telegramOutbound, 0);
    assert.equal(safety.productionMutations, 0);
});
