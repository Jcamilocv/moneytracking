import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_RECOVERY_ATTEMPTS,
    PAYMENT_GRACE_PERIOD_DAYS,
    SUBSCRIPTION_STATUSES,
    accessPolicyForSubscription,
    entitlementForSubscription,
    expireSubscription,
    hasPremiumAccess,
    markPaymentFailed,
    refundSubscription,
    registerRecoveryFailure,
    requestCancelAtPeriodEnd,
    renewSubscription,
    resumeSubscription,
    revokeSubscription,
    startSubscription,
    supportsRecurringPaymentMethod
} from '../server/billing/subscription-core.js';
import { BILLING_EVENT_TYPES, buildBillingEvent, hashBillingPayload, recordBillingEvent } from '../server/billing/event-ledger.js';
import { assertBillingProvider, createUnconfiguredBillingProvider, BillingProviderNotConfiguredError } from '../server/billing/provider.js';
import { applySubscriptionManagementAction, subscriptionPortalView } from '../server/billing/subscription-management.js';
import { SUBSCRIPTION_PLANS, planPeriodEnd, planSupportsAutoRenew } from '../server/billing/plans.js';

const now = new Date('2026-09-23T10:00:00.000Z');
const end = new Date('2026-10-23T10:00:00.000Z');
const base = () => ({
    userId: 'user-1', planId: 'monthly', provider: 'provider-test', providerCustomerId: 'cus_1',
    providerSubscriptionId: 'sub_1', status: 'active', currentPeriodStart: now,
    currentPeriodEnd: end, accessUntil: end, paymentMethodType: 'card', createdAt: now, updatedAt: now
});

test('new subscription creates canonical entitlement and grants Premium access', () => {
    const subscription = startSubscription(base(), now);
    assert.equal(subscription.schemaVersion, 2);
    assert.equal(subscription.status, SUBSCRIPTION_STATUSES.ACTIVE);
    assert.equal(subscription.plan, 'monthly');
    assert.equal(subscription.renewalMode, 'automatic');
    assert.equal(hasPremiumAccess(subscription, now), true);
});

test('the approved commercial catalogue is provider-agnostic and exact', () => {
    assert.deepEqual(SUBSCRIPTION_PLANS.monthly, {
        id: 'monthly', code: 'PLAN_MONTHLY', priceCents: 2990, currency: 'EUR', durationDays: 31,
        autoRenewPaymentMethods: ['card'], productName: 'Money Tips Premium Mensual', productDescription: 'Acceso Premium a Money Tips durante 31 días.'
    });
    assert.equal(SUBSCRIPTION_PLANS.annual.priceCents, 28900);
    assert.equal(SUBSCRIPTION_PLANS.annual.durationDays, 366);
    assert.equal(planSupportsAutoRenew('annual', 'card'), true);
    assert.equal(planSupportsAutoRenew('monthly', 'bizum'), false);
    assert.equal(planPeriodEnd('monthly', now).toISOString(), '2026-10-24T10:00:00.000Z');
});

test('renewal-ready state uses recurring card and Bizum stays one-time only', () => {
    assert.equal(supportsRecurringPaymentMethod('card'), true);
    assert.equal(supportsRecurringPaymentMethod('bizum'), false);
});

test('renewal starts a new paid period and resets recovery state', () => {
    const pastDue = { ...markPaymentFailed(base(), now), recoveryAttempts: 2 };
    const renewed = renewSubscription(pastDue, {
        currentPeriodStart: end,
        currentPeriodEnd: new Date('2026-11-23T10:00:00.000Z')
    }, now);
    assert.equal(renewed.status, SUBSCRIPTION_STATUSES.ACTIVE);
    assert.equal(renewed.recoveryAttempts, 0);
    assert.equal(renewed.graceUntil, null);
    assert.equal(renewed.accessUntil.toISOString(), '2026-11-23T10:00:00.000Z');
});

test('ledger event has deterministic idempotency key and never persists sensitive payload fields', () => {
    const first = buildBillingEvent({ provider: 'stripe', providerEventId: 'evt_1', userId: 'user-1', subscriptionId: 'sub_1', type: 'payment_succeeded', payload: { amount: 29.9, token: 'never-store-this' } });
    const duplicate = buildBillingEvent({ provider: 'stripe', providerEventId: 'evt_1', userId: 'user-1', subscriptionId: 'sub_1', type: 'payment_succeeded', payload: { amount: 29.9, token: 'different' } });
    assert.equal(first.eventId, duplicate.eventId);
    // Tokens are stripped before hashing too: they cannot affect ledger data.
    assert.equal(first.payloadHash, duplicate.payloadHash);
    assert.equal('payload' in first, false);
    assert.equal(BILLING_EVENT_TYPES.includes(first.type), true);
});

test('payload hashing is stable independently of key order', () => {
    assert.equal(hashBillingPayload({ b: 2, a: 1 }), hashBillingPayload({ a: 1, b: 2 }));
});

test('duplicate webhook is persisted once by the immutable event ledger', async () => {
    const records = new Map();
    const db = {
        collection: () => ({ doc: (id) => ({ id }) }),
        runTransaction: async (work) => work({
            get: async (ref) => ({ exists: records.has(ref.id), data: () => records.get(ref.id) }),
            create: (ref, value) => records.set(ref.id, value)
        })
    };
    const event = buildBillingEvent({ provider: 'provider-test', providerEventId: 'webhook-1', userId: 'user-1', subscriptionId: 'sub_1', type: 'payment_succeeded' });
    assert.equal((await recordBillingEvent(db, event)).duplicate, false);
    assert.equal((await recordBillingEvent(db, event)).duplicate, true);
    assert.equal(records.size, 1);
});

test('failed payment grants exactly a three-day recovery window', () => {
    const failed = markPaymentFailed(base(), now);
    assert.equal(failed.status, SUBSCRIPTION_STATUSES.PAST_DUE);
    assert.equal(failed.graceUntil.toISOString(), '2026-10-26T10:00:00.000Z');
    assert.equal(PAYMENT_GRACE_PERIOD_DAYS, 3);
    assert.equal(hasPremiumAccess(failed, new Date('2026-10-25T10:00:00.000Z')), true);
});

test('recovery failure expires after the configured third attempt', () => {
    let subscription = markPaymentFailed(base(), now);
    subscription = registerRecoveryFailure(subscription, now);
    subscription = registerRecoveryFailure(subscription, now);
    subscription = registerRecoveryFailure(subscription, now);
    assert.equal(MAX_RECOVERY_ATTEMPTS, 3);
    assert.equal(subscription.status, SUBSCRIPTION_STATUSES.EXPIRED);
    assert.equal(hasPremiumAccess(subscription, now), false);
});

test('cancel at period end preserves access and can be reactivated before expiry', () => {
    const canceled = requestCancelAtPeriodEnd(base(), now);
    assert.equal(canceled.status, SUBSCRIPTION_STATUSES.CANCEL_AT_PERIOD_END);
    assert.equal(canceled.cancelAtPeriodEnd, true);
    assert.equal(hasPremiumAccess(canceled, now), true);
    const resumed = resumeSubscription(canceled, now);
    assert.equal(resumed.status, SUBSCRIPTION_STATUSES.ACTIVE);
    assert.equal(resumed.cancelAtPeriodEnd, false);
});

test('expiration preserves a read-only historical MoneyTracKING policy', () => {
    const expired = expireSubscription(base(), new Date('2026-10-23T10:00:00.000Z'));
    const policy = accessPolicyForSubscription(expired, new Date('2026-10-24T10:00:00.000Z'));
    assert.equal(policy.premium, false);
    assert.equal(policy.historicalWorkspace, 'read_only');
    assert.equal(policy.canReceiveNewPremiumPicks, false);
    assert.equal(policy.canUsePremiumTools, false);
});

test('refund and administrative revoke remove Premium access immediately', () => {
    assert.equal(refundSubscription(base(), now).status, SUBSCRIPTION_STATUSES.REFUNDED);
    assert.equal(hasPremiumAccess(refundSubscription(base(), now), now), false);
    assert.equal(revokeSubscription(base(), now).status, SUBSCRIPTION_STATUSES.REVOKED);
    assert.equal(hasPremiumAccess(revokeSubscription(base(), now), now), false);
});

test('portal explains status and performs only local subscription state actions', () => {
    const portal = subscriptionPortalView(base(), now);
    assert.equal(portal.canCancelRenewal, true);
    assert.equal(portal.canManagePaymentMethod, false);
    const updated = applySubscriptionManagementAction(base(), 'cancel_at_period_end', now);
    assert.equal(updated.cancelAtPeriodEnd, true);
    assert.throws(() => applySubscriptionManagementAction(base(), 'update_payment_method', now), { code: 'provider_action_required' });
});

test('provider contract is complete but intentionally unconfigured', async () => {
    const provider = assertBillingProvider(createUnconfiguredBillingProvider('future-provider'));
    await assert.rejects(provider.createSubscription(), BillingProviderNotConfiguredError);
});

test('subscription normalization rejects secret-bearing data', () => {
    assert.throws(() => entitlementForSubscription({ ...base(), cardToken: 'forbidden' }, now), /sensible/);
});
