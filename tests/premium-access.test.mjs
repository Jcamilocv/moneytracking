import assert from 'node:assert/strict';
import test from 'node:test';
import {
    accessUntilForPlan,
    entitlementForManualGrant,
    entitlementForRevocation,
    normalizePremiumAccessRequest
} from '../server/premium-access.js';

const now = new Date('2026-09-06T10:00:00.000Z');

test('normaliza una alta manual de Premium sin aceptar campos inesperados', () => {
    assert.deepEqual(normalizePremiumAccessRequest({
        action: 'grant', email: ' CLIENTE@EXAMPLE.COM ', plan: 'annual', paymentReference: 'PP-1001'
    }), { action: 'grant', email: 'cliente@example.com', plan: 'annual', paymentReference: 'PP-1001' });
});

test('rechaza un correo, acción o plan que no sean válidos', () => {
    assert.throws(() => normalizePremiumAccessRequest({ action: 'grant', email: 'sin-correo' }));
    assert.throws(() => normalizePremiumAccessRequest({ action: 'delete', email: 'cliente@example.com' }));
    assert.throws(() => normalizePremiumAccessRequest({ action: 'grant', email: 'cliente@example.com', plan: 'lifetime' }));
});

test('una alta manual crea acceso mensual activo durante 31 días', () => {
    const entitlement = entitlementForManualGrant({ plan: 'monthly', paymentReference: 'PP-1001', now });
    assert.equal(entitlement.status, 'active');
    assert.equal(entitlement.accessUntil.toISOString(), '2026-10-07T10:00:00.000Z');
    assert.equal(entitlement.source, 'manual-payment-confirmed');
});

test('una renovación puede empezar cuando acaba el acceso ya vigente', () => {
    const startsAt = new Date('2026-10-07T10:00:00.000Z');
    const entitlement = entitlementForManualGrant({ plan: 'monthly', now, startsAt });
    assert.equal(entitlement.accessUntil.toISOString(), '2026-11-07T10:00:00.000Z');
});

test('la revocación corta el acceso sin borrar el historial de la suscripción', () => {
    const canceled = entitlementForRevocation({ previous: { plan: 'annual', accessUntil: '2027-09-06T10:00:00.000Z' }, now });
    assert.equal(canceled.status, 'canceled');
    assert.equal(canceled.plan, 'annual');
    assert.equal(canceled.accessUntil, '2027-09-06T10:00:00.000Z');
});

test('la duración anual contempla un año completo', () => {
    assert.equal(accessUntilForPlan('annual', now).toISOString(), '2027-09-07T10:00:00.000Z');
});
