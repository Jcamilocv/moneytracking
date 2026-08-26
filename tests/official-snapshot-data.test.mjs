import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublication } from '../api/lib/official-snapshot-data.js';

test('la publicación pública omite apuestas pendientes y produce una huella estable', () => {
    const bank = { id: 'bank-1', name: 'Oficial', initialCapital: 1000, currency: 'EUR' };
    const bets = [
        { id: 'b', bankId: 'bank-1', status: 'pending', odds: 2, amount: 10, stake: 1 },
        { id: 'a', bankId: 'bank-1', status: 'won', odds: 1.8, amount: 20, stake: 2, selections: [] }
    ];

    const first = buildPublication(bank, bets);
    const second = buildPublication(bank, [...bets].reverse());

    assert.equal(first.bets.length, 1);
    assert.equal(first.bets[0].id, 'a');
    assert.equal(first.bets[0].status, 'won');
    assert.equal(first.fingerprint, second.fingerprint);
});
