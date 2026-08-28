import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOfficialPickInput, publicPickIdFor } from '../api/lib/official-pick-data.js';

const validPick = {
    event: {
        sourceEventId: 'test-event-001',
        competition: 'Liga de prueba',
        homeTeam: 'Equipo Local',
        awayTeam: 'Equipo Visitante',
        kickoffAt: '2026-08-30T18:00:00.000Z'
    },
    bet: { market: 'Más de 2.5 goles', selection: 'Over 2.5', oddsAtPublication: 1.85 },
    system: { id: 'MT-TEST', version: 'v1' },
    source: { provider: 'money-tips-owned', observedAt: '2026-08-30T17:45:00.000Z' }
};

test('un pick oficial normalizado tiene una identidad y evidencia deterministas', () => {
    const first = normalizeOfficialPickInput(validPick);
    const second = normalizeOfficialPickInput({ ...validPick, event: { ...validPick.event } });

    assert.equal(first.status, 'published');
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.equal(first.source.evidenceHash, second.source.evidenceHash);
    assert.match(publicPickIdFor(first), /^op_[a-f0-9]{40}$/);
    assert.equal(first.scheduledAt.toISOString(), '2026-08-30T17:55:00.000Z');
});

test('un pick oficial rechaza una cuota o fecha inválida', () => {
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, bet: { ...validPick.bet, oddsAtPublication: 1 } }), /cuota/i);
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, event: { ...validPick.event, kickoffAt: 'no-date' } }), /fecha/i);
});
