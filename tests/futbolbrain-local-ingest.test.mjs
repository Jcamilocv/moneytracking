import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FUTBOLBRAIN_OWNER_BROWSER_PROVIDER,
    normalizeFutbolBrainOwnerCandidate
} from '../server/futbolbrain-local-ingest.js';

const NOW = new Date('2026-09-06T10:00:00.000Z');

const visibleCandidate = (overrides = {}) => ({
    event: {
        sourceEventId: 'fb-own-abc123',
        competition: 'ENG-Premier League',
        homeTeam: 'Everton',
        awayTeam: 'Manchester United',
        kickoffAt: '2026-09-06T16:00:00.000Z'
    },
    system: { id: 'MT - Premier League 02.5' },
    visiblePick: { selection: 'Under 3.5', odds: '1.50' },
    source: { provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER, observedAt: NOW.toISOString() },
    ...overrides
});

test('normalizes an approved visible pick with its server-owned policy', () => {
    const pick = normalizeFutbolBrainOwnerCandidate(visibleCandidate(), { now: NOW });
    assert.equal(pick.publicationPolicy, 'immediate');
    assert.equal(pick.bet.market, 'Total de goles');
    assert.equal(pick.bet.selection, 'Menos de 3,5 goles');
    assert.equal(pick.bet.oddsAtPublication, 1.5);
    assert.equal(pick.system.version, 'visible-table-v1');
});

test('uses T-minus-five only for the approved systems', () => {
    const pick = normalizeFutbolBrainOwnerCandidate(visibleCandidate({
        system: { id: 'MT - FRA1 FRA2 - V1.0' },
        visiblePick: { selection: 'Over 2.5', odds: 1.7 }
    }), { now: NOW });
    assert.equal(pick.publicationPolicy, 't_minus_5');
    assert.equal(pick.bet.selection, 'Más de 2,5 goles');
});

test('rejects unapproved systems, mismatched markets, and incomplete timing', () => {
    assert.throws(() => normalizeFutbolBrainOwnerCandidate(visibleCandidate({ system: { id: 'MT - GER1 - v1.1' } }), { now: NOW }), /no está aprobado/i);
    assert.throws(() => normalizeFutbolBrainOwnerCandidate(visibleCandidate({ visiblePick: { selection: 'Over 2.5', odds: 1.5 } }), { now: NOW }), /no coincide/i);
    assert.throws(() => normalizeFutbolBrainOwnerCandidate(visibleCandidate({ event: { ...visibleCandidate().event, kickoffAt: '2026-09-06T10:00:30.000Z' } }), { now: NOW }), /al menos un minuto/i);
});

test('rejects future-day picks even if a browser exposes a time', () => {
    assert.throws(
        () => normalizeFutbolBrainOwnerCandidate(visibleCandidate({
            event: { ...visibleCandidate().event, kickoffAt: '2026-09-12T14:00:00.000Z' }
        }), { now: NOW }),
        /día actual/i
    );
});
