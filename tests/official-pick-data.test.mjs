import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOfficialPickInput, publicPickIdFor } from '../api/lib/official-pick-data.js';
import { isPublicOfficialPickData } from '../api/lib/official-picks.js';

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
    assert.equal(first.publicationPolicy, 't_minus_5');
});

test('un sistema inmediato queda listo en el momento observado, no en T-5', () => {
    const immediate = normalizeOfficialPickInput({ ...validPick, publicationPolicy: 'immediate' });

    assert.equal(immediate.publicationPolicy, 'immediate');
    assert.equal(immediate.scheduledAt.toISOString(), '2026-08-30T17:45:00.000Z');
});

test('un pick oficial rechaza una política de publicación desconocida', () => {
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, publicationPolicy: 'later' }), /política/i);
});

test('un pick oficial rechaza una cuota o fecha inválida', () => {
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, bet: { ...validPick.bet, oddsAtPublication: 1 } }), /cuota/i);
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, event: { ...validPick.event, kickoffAt: 'no-date' } }), /fecha/i);
});

test('los registros técnicos no aparecen en el feed público de picks', () => {
    assert.equal(isPublicOfficialPickData({ status: 'published', source: { provider: 'money-tips-owned' } }), true);
    assert.equal(isPublicOfficialPickData({ status: 'published', source: { provider: 'test-authorized' } }), false);
    assert.equal(isPublicOfficialPickData({ status: 'queued', source: { provider: 'money-tips-owned' } }), false);
});
