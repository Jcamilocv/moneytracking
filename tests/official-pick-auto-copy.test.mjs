import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildOfficialSeasonBetPayload,
    officialPickSnapshotForBank,
    copyOfficialPickToSeasonBank,
    dispatchOfficialPickAutoCopy,
    enqueueOfficialPickAutoCopyTask,
    processOfficialPickAutoCopyTask,
    AUTO_COPY_TASK_STATUSES,
    AUTO_COPY_QUEUE_COLLECTION,
    MAX_AUTO_COPY_ATTEMPTS,
    RETRY_DELAYS_MS
} from '../server/official-pick-auto-copy.js';
import {
    OFFICIAL_BANK_CONFIG
} from '../server/official-season-bank.js';
import {
    OPERATIONS_INCIDENT_TYPES
} from '../server/operations-incidents.js';
import { DEPARTMENTS } from '../api/_lib/system-events.js';

const mockNow = new Date('2026-09-17T15:00:00.000Z');

test('Auto-Copy: buildOfficialSeasonBetPayload construye el contrato canónico sin persistir profit', () => {
    const mockPick = {
        id: 'op_test_auto_copy_001',
        publishedAt: '2026-09-17T14:30:00.000Z',
        event: {
            competition: 'LaLiga EA Sports',
            homeTeam: 'Sevilla',
            awayTeam: 'Valencia',
            kickoffAt: new Date('2026-09-17T19:00:00.000Z')
        },
        bet: {
            market: 'Ganador del partido',
            selection: 'Sevilla',
            oddsAtPublication: 2.15,
            recommendedStakePct: 1.5
        },
        system: {
            id: 'sys_val_laliga',
            version: '1.0'
        }
    };

    const mockBank = {
        id: 'bank_season_2627',
        name: 'Money Tips 26/27',
        initialCapital: 10000,
        currency: 'EUR'
    };

    const payload = buildOfficialSeasonBetPayload({ pick: mockPick, bank: mockBank, now: mockNow });

    // 1. Verificación de identidad y asociación
    assert.equal(payload.bankId, 'bank_season_2627');
    assert.equal(payload.officialPickId, 'op_test_auto_copy_001');
    assert.equal(payload.isOfficialPickCopy, true);
    assert.equal(payload.status, 'pending');

    // 2. Metadatos de partido y mercado
    assert.equal(payload.title, 'Sevilla vs Valencia');
    assert.equal(payload.market, 'Ganador del partido');
    assert.equal(payload.selection, 'Sevilla');
    assert.equal(payload.odds, 2.15);
    assert.equal(payload.bookmaker, 'Bet365');
    assert.equal(payload.category, 'Money Tips');

    // 3. Cálculo de stake determinista: 10000 * 1.5% = 150.00 EUR
    assert.equal(payload.stake, 1.5);
    assert.equal(payload.amount, 150);

    // 4. REGLA INVIOLABLE: NO debe existir campo `profit` persistido. Money TracKING lo calcula al vuelo.
    assert.equal(payload.profit, undefined);
    assert.equal('profit' in payload, false);

    // 5. Selections anidada
    assert.equal(payload.selections.length, 1);
    assert.equal(payload.selections[0].selection, 'Sevilla');
    assert.equal(payload.selections[0].status, 'pending');
    assert.equal(payload.selections[0].odds, 2.15);
    assert.equal('profit' in payload.selections[0], false);

    // 6. Snapshot auditado
    assert.equal(payload.officialPickSnapshot.id, 'op_test_auto_copy_001');
    assert.equal(payload.officialPickSnapshot.system.id, 'sys_val_laliga');
});

test('Auto-Copy: oficialPickSnapshotForBank aísla los campos de auditoría', () => {
    const pick = {
        id: 'op_999',
        publishedAt: '2026-09-17T10:00:00.000Z',
        event: { homeTeam: 'Arsenal', awayTeam: 'Chelsea', competition: 'Premier League', kickoffAt: '2026-09-18T16:30:00.000Z' },
        bet: { market: 'Over 2.5', selection: 'Más de 2.5', oddsAtPublication: 1.85, recommendedStakePct: 2 },
        system: { id: 'sys_goals', version: '2.1' },
        extraInternalData: 'should_not_leak'
    };

    const snapshot = officialPickSnapshotForBank(pick);
    assert.equal(snapshot.id, 'op_999');
    assert.equal(snapshot.event.homeTeam, 'Arsenal');
    assert.equal(snapshot.bet.market, 'Over 2.5');
    assert.equal(snapshot.system.id, 'sys_goals');
    assert.equal(snapshot.extraInternalData, undefined);
});

test('Auto-Copy: configuración canónica por defecto es Money Tips 26/27', () => {
    assert.equal(OFFICIAL_BANK_CONFIG.DEFAULT_BANK_NAME, 'Money Tips 26/27');
    assert.equal(OFFICIAL_BANK_CONFIG.COLLECTION, 'systemConfiguration');
    assert.equal(OFFICIAL_BANK_CONFIG.DOCUMENT, 'officialSeasonBank');
});

test('Auto-Copy Durable: contrato de cola, estados y reintentos con backoff', () => {
    assert.equal(AUTO_COPY_QUEUE_COLLECTION, 'officialPickAutoCopyQueue');
    assert.equal(MAX_AUTO_COPY_ATTEMPTS, 3);
    assert.deepEqual(RETRY_DELAYS_MS, [60000, 300000, 900000]); // 1m, 5m, 15m
    assert.equal(AUTO_COPY_TASK_STATUSES.PENDING, 'pending');
    assert.equal(AUTO_COPY_TASK_STATUSES.PROCESSING, 'processing');
    assert.equal(AUTO_COPY_TASK_STATUSES.COMPLETED, 'completed');
    assert.equal(AUTO_COPY_TASK_STATUSES.FAILED, 'failed');
});

test('Auto-Copy Durable: resiliencia desacoplada — fallo de copia nunca propaga excepción a publicación', async () => {
    // Si pasamos un objeto inválido sin ID, dispatchOfficialPickAutoCopy captura el error
    // y devuelve { copied: false, error: ... } sin arrojar excepción
    const result = await dispatchOfficialPickAutoCopy(null);
    assert.equal(result.copied, false);
    assert.ok(result.error);
});
