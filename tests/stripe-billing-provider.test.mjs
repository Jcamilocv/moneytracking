import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createStripeBillingProvider, planIdFromStripeSubscription, verifyStripeWebhookSignature } from '../server/billing/stripe-provider.js';
import { applyStripeWebhookToEntitlement, entitlementFromStripeSubscription, stripeWebhookType } from '../server/billing/stripe-subscription-sync.js';

const now = new Date('2026-09-23T10:00:00.000Z');
const priceIds = { monthly: 'price_monthly_test', annual: 'price_annual_test' };
const stripeSubscription = (overrides = {}) => ({
    id: 'sub_test_1', customer: 'cus_test_1', status: 'active', cancel_at_period_end: false,
    current_period_start: 1790157600, current_period_end: 1792836000,
    metadata: { money_tips_user_id: 'user-1' },
    items: { data: [{ price: { id: 'price_monthly_test' } }] }, ...overrides
});

test('Stripe sandbox checkout maps plan, Price, Customer and subscription metadata', async () => {
    let call;
    const provider = createStripeBillingProvider({
        secretKey: 'sk_test_local_only', priceIds,
        fetchImpl: async (url, options) => {
            call = { url, options };
            return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/session', mode: 'subscription' }) };
        }
    });
    const checkout = await provider.createCheckout({ userId: 'user-1', email: 'cliente@example.test', planId: 'monthly', successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel' });
    assert.equal(checkout.id, 'cs_test_1');
    assert.match(call.url, /\/checkout\/sessions$/);
    assert.equal(call.options.body.get('mode'), 'subscription');
    assert.equal(call.options.body.get('payment_method_types[0]'), 'card');
    assert.equal(call.options.body.get('line_items[0][price]'), 'price_monthly_test');
    assert.equal(call.options.body.get('subscription_data[metadata][money_tips_user_id]'), 'user-1');
});

test('Stripe webhook signature rejects altered, expired and unsigned payloads', () => {
    const rawBody = JSON.stringify({ id: 'evt_test_1' });
    const secret = 'whsec_test_local_only';
    const timestamp = 1790157600;
    const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    assert.equal(verifyStripeWebhookSignature({ rawBody, signature: `t=${timestamp},v1=${signature}`, secret, now: timestamp * 1000 }), true);
    assert.equal(verifyStripeWebhookSignature({ rawBody: `${rawBody}x`, signature: `t=${timestamp},v1=${signature}`, secret, now: timestamp * 1000 }), false);
    assert.equal(verifyStripeWebhookSignature({ rawBody, signature: `t=${timestamp},v1=${signature}`, secret, now: (timestamp + 301) * 1000 }), false);
});

test('subscription and webhook events synchronize only the central entitlement', () => {
    const entitlement = entitlementFromStripeSubscription({ userId: 'user-1', stripeSubscription: stripeSubscription(), priceIds, now });
    assert.equal(entitlement.provider, 'stripe');
    assert.equal(entitlement.providerCustomerId, 'cus_test_1');
    assert.equal(entitlement.providerSubscriptionId, 'sub_test_1');
    assert.equal(entitlement.planId, 'monthly');
    assert.equal(entitlement.renewalMode, 'automatic');
    assert.equal(planIdFromStripeSubscription(stripeSubscription(), priceIds), 'monthly');
    assert.equal(stripeWebhookType({ type: 'invoice.payment_failed', data: { object: {} } }), 'payment_failed');
});

test('Stripe failed payment enters the approved three-day grace flow', () => {
    const event = { type: 'invoice.payment_failed', data: { object: { subscription: 'sub_test_1' } } };
    const updated = applyStripeWebhookToEntitlement({
        existing: entitlementFromStripeSubscription({ userId: 'user-1', stripeSubscription: stripeSubscription(), priceIds, now }),
        event, stripeSubscription: stripeSubscription({ status: 'past_due' }), priceIds, userId: 'user-1', now
    });
    assert.equal(updated.status, 'past_due');
    assert.equal(updated.graceUntil.getTime() - updated.currentPeriodEnd.getTime(), 3 * 24 * 60 * 60 * 1000);
});

test('Stripe cancellation and refund synchronize access states without a provider decision in core', () => {
    const active = entitlementFromStripeSubscription({ userId: 'user-1', stripeSubscription: stripeSubscription(), priceIds, now });
    const cancelled = applyStripeWebhookToEntitlement({ existing: active, event: { type: 'customer.subscription.deleted', data: { object: stripeSubscription({ status: 'canceled' }) } }, stripeSubscription: stripeSubscription({ status: 'canceled' }), priceIds, userId: 'user-1', now });
    assert.equal(cancelled.status, 'expired');
    const refunded = applyStripeWebhookToEntitlement({ existing: active, event: { type: 'charge.refunded', data: { object: {} } }, stripeSubscription: null, priceIds, userId: 'user-1', now });
    assert.equal(refunded.status, 'refunded');
});

test('Stripe reactivation and provider past_due updates keep the intended state', () => {
    const active = entitlementFromStripeSubscription({ userId: 'user-1', stripeSubscription: stripeSubscription(), priceIds, now });
    const reactivatedEvent = { type: 'customer.subscription.updated', data: { object: stripeSubscription({ cancel_at_period_end: false }) } };
    assert.equal(stripeWebhookType(reactivatedEvent), 'subscription_renewed');
    const reactivated = applyStripeWebhookToEntitlement({ existing: active, event: reactivatedEvent, stripeSubscription: stripeSubscription({ cancel_at_period_end: false }), priceIds, userId: 'user-1', now });
    assert.equal(reactivated.status, 'active');
    const pastDue = applyStripeWebhookToEntitlement({ existing: active, event: reactivatedEvent, stripeSubscription: stripeSubscription({ status: 'past_due' }), priceIds, userId: 'user-1', now });
    assert.equal(pastDue.status, 'past_due');
    assert.ok(pastDue.graceUntil);
});
