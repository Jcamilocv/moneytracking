import assert from 'node:assert/strict';
import test from 'node:test';
import { pickForAudience } from '../api/lib/official-picks.js';

const activePick = {
    id: 'op_test',
    event: { kickoffAt: '2026-09-03T18:00:00.000Z' },
    bet: { market: 'Ambos marcan', selection: 'Sí', oddsAtPublication: 1.7 },
    system: { id: 'MT-ESP', version: 'v1' },
    source: { evidenceHash: 'proof-hash' }
};

test('un visitante conserva la prueba pública pero no los detalles de un pick activo', () => {
    const visible = pickForAudience(activePick, { now: new Date('2026-09-03T17:00:00.000Z') });
    assert.equal(visible.isLocked, true);
    assert.equal(visible.bet.selection, null);
    assert.equal(visible.bet.oddsAtPublication, null);
    assert.equal(visible.source.evidenceHash, 'proof-hash');
});

test('Premium ve el detalle activo y el público conserva únicamente la cuota histórica', () => {
    const now = new Date('2026-09-03T17:00:00.000Z');
    assert.equal(pickForAudience(activePick, { canViewActiveDetails: true, now }).bet.selection, 'Sí');
    const historical = pickForAudience(activePick, { now: new Date('2026-09-03T19:00:00.000Z') });
    assert.equal(historical.isLocked, false);
    assert.equal(historical.isPublicSummary, true);
    assert.equal(historical.bet.market, null);
    assert.equal(historical.bet.selection, null);
    assert.equal(historical.bet.oddsAtPublication, 1.7);
    assert.equal(historical.system.id, null);
});
