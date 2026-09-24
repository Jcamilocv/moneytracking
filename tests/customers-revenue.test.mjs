import assert from 'node:assert/strict';
import test from 'node:test';
import {
    accessUntilForPlan,
    entitlementForManualGrant,
    entitlementForRevocation,
    normalizePremiumAccessRequest
} from '../server/premium-access.js';
import {
    hasActivePremiumSubscription,
    isExpiringSoon,
    evaluateCustomerRevenueStatus
} from '../server/subscription.js';
import {
    normalizePremiumPayPlan,
    premiumPayPlan,
    hasValidPremiumPayAuthorization,
    statusIsPaid,
    normalizeAmount
} from '../server/premiumpay.js';
import {
    REVENUE_INCIDENT_TYPES,
    ESCALATION_TARGETS
} from '../server/revenue-incidents.js';
import {
    RECONCILIATION_CONSTANTS,
    ORDER_MONITOR_CONSTANTS,
    UNRESOLVED_ORDER_STATUSES
} from '../server/revenue-reconciliation.js';
import {
    DEPARTMENTS,
    EVENT_STATUSES
} from '../api/_lib/system-events.js';
import {
    HQ_UNIT_STATUSES,
    HQ_UNIT_TYPES
} from '../api/_lib/agent-state.js';

const now = new Date('2026-09-17T10:00:00.000Z');

test('Customers & Revenue: Validación y planes de suscripción', () => {
    assert.equal(normalizePremiumPayPlan('monthly'), 'monthly');
    assert.equal(normalizePremiumPayPlan('annual'), 'annual');
    assert.throws(() => normalizePremiumPayPlan('invalido'));
    assert.equal(premiumPayPlan('monthly').amount, 29.9);
    assert.equal(premiumPayPlan('annual').amount, 289);
});

test('Customers & Revenue: Verificación criptográfica timingSafeEqual en webhook', () => {
    const secret = 'mi_secreto_super_seguro_123';
    assert.equal(hasValidPremiumPayAuthorization(`Bearer ${secret}`, secret), true);
    assert.equal(hasValidPremiumPayAuthorization('Bearer incorrecto', secret), false);
    assert.equal(hasValidPremiumPayAuthorization('', secret), false);
});

test('Customers & Revenue: Idempotencia y cálculo determinista de vencimientos', () => {
    // 31 días exactos para mensual
    const monthlyDate = accessUntilForPlan('monthly', now);
    assert.equal(monthlyDate.toISOString(), '2026-10-18T10:00:00.000Z');

    // 366 días exactos para anual
    const annualDate = accessUntilForPlan('annual', now);
    assert.equal(annualDate.toISOString(), '2027-09-18T10:00:00.000Z');

    // Renovación no destructiva: empieza cuando expira el vigente
    const activeUntil = new Date('2026-10-18T10:00:00.000Z');
    const renewalEntitlement = entitlementForManualGrant({
        plan: 'monthly',
        now,
        startsAt: activeUntil
    });
    assert.equal(renewalEntitlement.status, 'active');
    assert.equal(renewalEntitlement.renewalMode, 'manual');
    assert.equal(renewalEntitlement.accessUntil.toISOString(), '2026-11-18T10:00:00.000Z');
});

test('Customers & Revenue: Detección proactiva de vencimiento a T-3 días sin cobros automáticos', () => {
    // A 2 días de expirar: expiringSoon = true
    const expiringSub = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    };
    const statusExpiring = evaluateCustomerRevenueStatus(expiringSub, now);
    assert.equal(statusExpiring.active, true);
    assert.equal(statusExpiring.tier, 'premium');
    assert.equal(statusExpiring.renewalMode, 'manual');
    assert.equal(statusExpiring.expiringSoon, true);
    assert.equal(statusExpiring.daysRemaining, 2);

    // A 10 días de expirar: expiringSoon = false
    const farSub = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)
    };
    const statusFar = evaluateCustomerRevenueStatus(farSub, now);
    assert.equal(statusFar.expiringSoon, false);
    assert.equal(statusFar.daysRemaining, 10);
});

test('Customers & Revenue: Tipos de Incidencia, Contrato HQ y Auditoría', () => {
    assert.equal(REVENUE_INCIDENT_TYPES.VALIDATION_MISMATCH, 'validation_mismatch');
    assert.equal(REVENUE_INCIDENT_TYPES.PAYMENT_GATEWAY_ERROR, 'payment_gateway_error');
    assert.equal(ESCALATION_TARGETS.KAREN, 'karen');
    assert.equal(ESCALATION_TARGETS.SENOR_CORTES, 'senor_cortes');

    assert.equal(DEPARTMENTS.CUSTOMERS_REVENUE, 'customers_revenue');
    assert.equal(EVENT_STATUSES.SUCCESS, 'success');
    assert.equal(EVENT_STATUSES.ERROR, 'error');

    assert.equal(HQ_UNIT_STATUSES.IDLE, 'idle');
    assert.equal(HQ_UNIT_STATUSES.ERROR, 'error');
    assert.equal(HQ_UNIT_TYPES.WORKER, 'worker');
});

test('Customers & Revenue: Corte inmediato y determinista de acceso al expirar (now >= accessUntil)', () => {
    // Exactamente en el instante de expiración: corte inmediato
    const expiredExact = {
        status: 'active',
        plan: 'monthly',
        accessUntil: now
    };
    assert.equal(hasActivePremiumSubscription(expiredExact, now), false);
    assert.equal(evaluateCustomerRevenueStatus(expiredExact, now).active, false);
    assert.equal(evaluateCustomerRevenueStatus(expiredExact, now).tier, 'free');

    // 1 milisegundo en el pasado: corte inmediato
    const expiredPast = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(now.getTime() - 1)
    };
    assert.equal(hasActivePremiumSubscription(expiredPast, now), false);
    assert.equal(evaluateCustomerRevenueStatus(expiredPast, now).active, false);

    // 1 milisegundo en el futuro: sigue activo
    const stillActive = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(now.getTime() + 1)
    };
    assert.equal(hasActivePremiumSubscription(stillActive, now), true);
    assert.equal(evaluateCustomerRevenueStatus(stillActive, now).active, true);
    assert.equal(evaluateCustomerRevenueStatus(stillActive, now).tier, 'premium');
});

test('Customers & Revenue: Comparación criptográfica timingSafeEqual estricta frente a ataques de temporización', () => {
    const validSecret = 'test_secret_key_prod_abc123';
    // Mismo largo pero diferente contenido
    assert.equal(hasValidPremiumPayAuthorization('Bearer test_secret_key_prod_abc124', validSecret), false);
    // Largo diferente
    assert.equal(hasValidPremiumPayAuthorization('Bearer test', validSecret), false);
    // Vacío o malformado
    assert.equal(hasValidPremiumPayAuthorization('Basic test_secret_key_prod_abc123', validSecret), false);
    assert.equal(hasValidPremiumPayAuthorization(null, validSecret), false);
    assert.equal(hasValidPremiumPayAuthorization(undefined, validSecret), false);
    assert.equal(hasValidPremiumPayAuthorization('', validSecret), false);
    // Exacto con y sin prefijo Bearer
    assert.equal(hasValidPremiumPayAuthorization(`Bearer ${validSecret}`, validSecret), true);
    assert.equal(hasValidPremiumPayAuthorization(validSecret, validSecret), true);
});

test('Customers & Revenue: Normalización y tolerancia cero en discrepancia de importes', () => {
    assert.equal(normalizeAmount('29.90'), 29.9);
    assert.equal(normalizeAmount('289.00'), 289);
    assert.equal(normalizeAmount(29.900000000000002), 29.9);

    // Discrepancias de un céntimo deben rechazarse estrictamente
    assert.notEqual(normalizeAmount('29.91'), 29.9);
    assert.notEqual(normalizeAmount('29.89'), 29.9);
    assert.notEqual(normalizeAmount('0'), 29.9);
});

test('Customers & Revenue: Constantes y reglas del motor de reconciliación autónomo', () => {
    assert.equal(RECONCILIATION_CONSTANTS.GRACE_PERIOD_MINUTES, 15);
    assert.equal(RECONCILIATION_CONSTANTS.ABANDONED_EXPIRY_MINUTES, 120);
    assert.equal(RECONCILIATION_CONSTANTS.MAX_LOOKBACK_HOURS, 48);
    assert.equal(REVENUE_INCIDENT_TYPES.ORPHAN_PAYMENT, 'orphan_payment');
});

test('Auditoría C1: El monitor de pedidos escanea tanto pending como checkout_created', () => {
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('pending'), true);
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('checkout_created'), true);
    assert.equal(UNRESOLVED_ORDER_STATUSES.size, 2);
    // Estados terminales NO deben escanearse
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('paid'), false);
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('abandoned'), false);
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('validation_failed'), false);
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('provider_error'), false);
});

test('Auditoría H3: El modo de reconciliación es manual_review_required (PremiumPay no tiene API de consulta)', () => {
    assert.equal(ORDER_MONITOR_CONSTANTS.RECONCILIATION_MODE, 'manual_review_required');
    // Backward compat: RECONCILIATION_CONSTANTS es alias de ORDER_MONITOR_CONSTANTS
    assert.equal(RECONCILIATION_CONSTANTS.RECONCILIATION_MODE, 'manual_review_required');
    assert.deepEqual(RECONCILIATION_CONSTANTS, ORDER_MONITOR_CONSTANTS);
});

test('Auditoría C2: statusIsPaid acepta solo estados de pago completado de PremiumPay', () => {
    // Documentación oficial PremiumPay: "ok", "completed", "paid", "approved"
    assert.equal(statusIsPaid('ok'), true);
    assert.equal(statusIsPaid('completed'), true);
    assert.equal(statusIsPaid('paid'), true);
    assert.equal(statusIsPaid('approved'), true);
    // Rechazar estados no completados
    assert.equal(statusIsPaid('pending'), false);
    assert.equal(statusIsPaid('failed'), false);
    assert.equal(statusIsPaid('cancelled'), false);
    assert.equal(statusIsPaid('error'), false);
    assert.equal(statusIsPaid(''), false);
    assert.equal(statusIsPaid(null), false);
    assert.equal(statusIsPaid(undefined), false);
});



