import assert from 'node:assert/strict';
import test from 'node:test';
import {
    hasActivePremiumSubscription,
    isExpiringSoon,
    evaluateCustomerRevenueStatus
} from '../server/subscription.js';

const now = new Date('2026-09-03T10:00:00.000Z');

test('una suscripción activa y no vencida concede acceso Premium', () => {
    assert.equal(hasActivePremiumSubscription({ status: 'active', accessUntil: '2026-09-04T10:00:00.000Z' }, now), true);
});

test('un acceso vencido, cancelado o sin fecha no concede Premium', () => {
    assert.equal(hasActivePremiumSubscription({ status: 'active', accessUntil: '2026-09-03T09:59:59.000Z' }, now), false);
    assert.equal(hasActivePremiumSubscription({ status: 'canceled', accessUntil: '2026-10-03T10:00:00.000Z' }, now), false);
    assert.equal(hasActivePremiumSubscription({ status: 'active' }, now), false);
});

test('detecta si la suscripción está próxima a vencer (T-3 días) para aviso de renovación manual', () => {
    // Vence en 2 días (dentro de la ventana de 3 días)
    assert.equal(isExpiringSoon({ status: 'active', accessUntil: '2026-09-05T10:00:00.000Z' }, now, 3), true);
    // Vence en 10 días (fuera de la ventana)
    assert.equal(isExpiringSoon({ status: 'active', accessUntil: '2026-09-13T10:00:00.000Z' }, now, 3), false);
    // Ya vencida
    assert.equal(isExpiringSoon({ status: 'active', accessUntil: '2026-09-02T10:00:00.000Z' }, now, 3), false);
});

test('evaluateCustomerRevenueStatus garantiza renewalMode estrictamente manual', () => {
    const status = evaluateCustomerRevenueStatus({
        status: 'active',
        plan: 'monthly',
        accessUntil: '2026-09-05T10:00:00.000Z'
    }, now);

    assert.equal(status.active, true);
    assert.equal(status.tier, 'premium');
    assert.equal(status.renewalMode, 'manual');
    assert.equal(status.expiringSoon, true);
    assert.equal(status.daysRemaining, 2);
});
