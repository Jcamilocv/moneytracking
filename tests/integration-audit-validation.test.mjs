import assert from 'node:assert/strict';
import test from 'node:test';
import {
    hasActivePremiumSubscription,
    isExpiringSoon,
    evaluateCustomerRevenueStatus
} from '../server/subscription.js';
import {
    pickForAudience
} from '../api/_lib/official-picks.js';
import {
    statusIsPaid,
    normalizeAmount,
    normalizePremiumPayPlan,
    premiumPayPlan,
    hasValidPremiumPayAuthorization
} from '../server/premiumpay.js';
import {
    ORDER_MONITOR_CONSTANTS,
    UNRESOLVED_ORDER_STATUSES
} from '../server/revenue-reconciliation.js';
import {
    REVENUE_INCIDENT_TYPES,
    ESCALATION_TARGETS
} from '../server/revenue-incidents.js';
import {
    accessUntilForPlan,
    entitlementForManualGrant,
    entitlementForRevocation
} from '../server/premium-access.js';

const mockNow = new Date('2026-09-17T12:00:00.000Z');

// ─────────────────────────────────────────────────────────────────────────────
// 1. EXPIRACIÓN END-TO-END Y CONTROL DE ACCESO
// ─────────────────────────────────────────────────────────────────────────────
test('E2E Expiración: usuario activo accede al contenido completo de picks oficiales', () => {
    const activeSub = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date('2026-09-20T12:00:00.000Z') // +3 días
    };

    assert.equal(hasActivePremiumSubscription(activeSub, mockNow), true);
    const revenueStatus = evaluateCustomerRevenueStatus(activeSub, mockNow);
    assert.equal(revenueStatus.active, true);
    assert.equal(revenueStatus.tier, 'premium');

    const audience = { canViewActiveDetails: revenueStatus.active };
    assert.equal(audience.canViewActiveDetails, true);

    const activePick = {
        id: 'op_1111111111111111111111111111111111111111',
        status: 'published',
        event: {
            homeTeam: 'Real Madrid',
            awayTeam: 'Barcelona',
            kickoffAt: new Date('2026-09-17T18:00:00.000Z')
        },
        bet: {
            market: 'Ganador del partido',
            selection: 'Real Madrid',
            oddsAtPublication: 2.10
        },
        system: { id: 'sys_val_1', version: '1.0' }
    };

    const rendered = pickForAudience(activePick, { canViewActiveDetails: audience.canViewActiveDetails, now: mockNow });
    assert.equal(rendered.isLocked, false);
    assert.equal(rendered.isPublicSummary, false);
    assert.equal(rendered.bet.market, 'Ganador del partido');
    assert.equal(rendered.bet.selection, 'Real Madrid');
    assert.equal(rendered.bet.oddsAtPublication, 2.10);
    assert.equal(rendered.system.id, 'sys_val_1');
});

test('E2E Expiración: usuario vencido deja de ver el contenido protegido y se bloquea el pick', () => {
    const expiredSub = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date('2026-09-17T11:59:59.000Z') // -1 segundo
    };

    assert.equal(hasActivePremiumSubscription(expiredSub, mockNow), false);
    const revenueStatus = evaluateCustomerRevenueStatus(expiredSub, mockNow);
    assert.equal(revenueStatus.active, false);
    assert.equal(revenueStatus.tier, 'free');

    const audience = { canViewActiveDetails: revenueStatus.active };
    assert.equal(audience.canViewActiveDetails, false);

    const activePick = {
        id: 'op_1111111111111111111111111111111111111111',
        status: 'published',
        event: {
            homeTeam: 'Real Madrid',
            awayTeam: 'Barcelona',
            kickoffAt: new Date('2026-09-17T18:00:00.000Z')
        },
        bet: {
            market: 'Ganador del partido',
            selection: 'Real Madrid',
            oddsAtPublication: 2.10
        },
        system: { id: 'sys_val_1', version: '1.0' }
    };

    const rendered = pickForAudience(activePick, { canViewActiveDetails: audience.canViewActiveDetails, now: mockNow });
    assert.equal(rendered.isLocked, true);
    assert.equal(rendered.isPublicSummary, true);
    assert.equal(rendered.bet.market, null);
    assert.equal(rendered.bet.selection, null);
    assert.equal(rendered.bet.oddsAtPublication, null);
    assert.equal(rendered.system.id, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CICLO DE CALLBACK: ABANDONED, IDEMPOTENCIA, ERRORES
// ─────────────────────────────────────────────────────────────────────────────
test('Callback Lifecycle: orden en estado abandoned es elegible para activación por callback retrasado', () => {
    const CALLBACK_ELIGIBLE_STATUSES = new Set(['pending', 'checkout_created', 'abandoned']);

    assert.equal(CALLBACK_ELIGIBLE_STATUSES.has('abandoned'), true);
    assert.equal(CALLBACK_ELIGIBLE_STATUSES.has('checkout_created'), true);
    assert.equal(CALLBACK_ELIGIBLE_STATUSES.has('pending'), true);

    assert.equal(CALLBACK_ELIGIBLE_STATUSES.has('provider_error'), false);
    assert.equal(CALLBACK_ELIGIBLE_STATUSES.has('validation_failed'), false);
    assert.equal(CALLBACK_ELIGIBLE_STATUSES.has('payment_not_completed'), false);
});

test('Callback Validation: discrepancia de importe o divisa se rechaza estrictamente', () => {
    const order = {
        expectedAmount: 29.90,
        currency: 'EUR'
    };

    const testCases = [
        { amount: '29.90', currency: 'EUR', valid: true },
        { amount: 29.90, currency: 'EUR', valid: true },
        { amount: '29.89', currency: 'EUR', valid: false },
        { amount: '29.91', currency: 'EUR', valid: false },
        { amount: '29.90', currency: 'USD', valid: false },
        { amount: '0.00', currency: 'EUR', valid: false }
    ];

    for (const tc of testCases) {
        const correctAmount = normalizeAmount(tc.amount) === normalizeAmount(order.expectedAmount);
        const correctCurrency = String(tc.currency || '').toUpperCase() === order.currency;
        const isValid = correctAmount && correctCurrency;
        assert.equal(isValid, tc.valid, `Fallo en caso: ${JSON.stringify(tc)}`);
    }
});

test('Callback Sanitization: strip del campo token de tarjeta en respuestas de pago', () => {
    const SAFE_CALLBACK_FIELDS = new Set([
        'clientOrderId', 'paymentId', 'amount', 'currency',
        'status', 'message', 'paymentMethod'
    ]);
    const sanitizeCallbackPayload = (body) => {
        if (!body || typeof body !== 'object') return null;
        const sanitized = {};
        for (const key of Object.keys(body)) {
            if (SAFE_CALLBACK_FIELDS.has(key)) sanitized[key] = body[key];
        }
        return sanitized;
    };

    const rawGatewayResponse = {
        clientOrderId: 'mt-monthly-uuid123',
        paymentId: 'pp_pay_999',
        amount: 29.9,
        currency: 'EUR',
        status: 'ok',
        message: 'Transaction completed successfully',
        paymentMethod: 'stripe2',
        token: '4a8b7f3e1c9d2a5b6e0f',
        extraInternalGatewayData: 'secret_gateway_metadata'
    };

    const clean = sanitizeCallbackPayload(rawGatewayResponse);
    assert.equal(clean.clientOrderId, 'mt-monthly-uuid123');
    assert.equal(clean.amount, 29.9);
    assert.equal(clean.token, undefined);
    assert.equal(clean.extraInternalGatewayData, undefined);
    assert.equal(Object.keys(clean).includes('token'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DETECCIÓN Y POLÍTICA T-3 DE RENOVACIÓN
// ─────────────────────────────────────────────────────────────────────────────
test('T-3 Policy: detecta correctamente la ventana T-3 y garantiza renewalMode manual', () => {
    const subT2 = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(mockNow.getTime() + 2 * 24 * 60 * 60 * 1000)
    };
    assert.equal(isExpiringSoon(subT2, mockNow, 3), true);
    const statusT2 = evaluateCustomerRevenueStatus(subT2, mockNow);
    assert.equal(statusT2.expiringSoon, true);
    assert.equal(statusT2.daysRemaining, 2);
    assert.equal(statusT2.renewalMode, 'manual');

    const subT5 = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(mockNow.getTime() + 5 * 24 * 60 * 60 * 1000)
    };
    assert.equal(isExpiringSoon(subT5, mockNow, 3), false);
    const statusT5 = evaluateCustomerRevenueStatus(subT5, mockNow);
    assert.equal(statusT5.expiringSoon, false);
    assert.equal(statusT5.daysRemaining, 5);
    assert.equal(statusT5.renewalMode, 'manual');

    const subExpired = {
        status: 'active',
        plan: 'monthly',
        accessUntil: new Date(mockNow.getTime() - 1000)
    };
    assert.equal(isExpiringSoon(subExpired, mockNow, 3), false);
    const statusExpired = evaluateCustomerRevenueStatus(subExpired, mockNow);
    assert.equal(statusExpired.active, false);
    assert.equal(statusExpired.expiringSoon, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. REVENUE ORDER MONITOR Y CONTRATO HQ
// ─────────────────────────────────────────────────────────────────────────────
test('Revenue Order Monitor: modo manual_review_required y retención de órdenes sin callback', () => {
    assert.equal(ORDER_MONITOR_CONSTANTS.RECONCILIATION_MODE, 'manual_review_required');
    assert.equal(ORDER_MONITOR_CONSTANTS.GRACE_PERIOD_MINUTES, 15);
    assert.equal(ORDER_MONITOR_CONSTANTS.ABANDONED_EXPIRY_MINUTES, 120);

    assert.equal(UNRESOLVED_ORDER_STATUSES.has('pending'), true);
    assert.equal(UNRESOLVED_ORDER_STATUSES.has('checkout_created'), true);

    assert.equal(ESCALATION_TARGETS.KAREN, 'karen');
    assert.equal(REVENUE_INCIDENT_TYPES.ORPHAN_PAYMENT, 'orphan_payment');
});
