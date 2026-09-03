import assert from 'node:assert/strict';
import test from 'node:test';
import { hasActivePremiumSubscription } from '../server/subscription.js';

const now = new Date('2026-09-03T10:00:00.000Z');

test('una suscripción activa y no vencida concede acceso Premium', () => {
    assert.equal(hasActivePremiumSubscription({ status: 'active', accessUntil: '2026-09-04T10:00:00.000Z' }, now), true);
});

test('un acceso vencido, cancelado o sin fecha no concede Premium', () => {
    assert.equal(hasActivePremiumSubscription({ status: 'active', accessUntil: '2026-09-03T09:59:59.000Z' }, now), false);
    assert.equal(hasActivePremiumSubscription({ status: 'canceled', accessUntil: '2026-10-03T10:00:00.000Z' }, now), false);
    assert.equal(hasActivePremiumSubscription({ status: 'active' }, now), false);
});
