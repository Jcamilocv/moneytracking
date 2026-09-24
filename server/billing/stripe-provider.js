import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePlanId } from './plans.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

const toForm = (values) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
    }
    return body;
};

const stripeError = async (response) => {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body?.error?.message || `Stripe rechazó la solicitud (${response.status}).`);
    error.status = response.status;
    error.code = body?.error?.code || 'stripe_request_failed';
    return error;
};

export const verifyStripeWebhookSignature = ({ rawBody, signature, secret, now = Date.now() }) => {
    if (!rawBody || !signature || !secret) return false;
    const components = Object.fromEntries(String(signature).split(',').map((item) => item.split('=')));
    const timestamp = Number(components.t);
    const received = components.v1;
    if (!Number.isFinite(timestamp) || !received || Math.abs(Math.floor(now / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const receivedBytes = Buffer.from(received, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
};

export const priceIdForPlan = (priceIds, planId) => {
    const normalizedPlan = normalizePlanId(planId);
    const priceId = String(priceIds?.[normalizedPlan] || '').trim();
    if (!/^price_[A-Za-z0-9_]+$/.test(priceId)) throw new Error(`Falta el Price ID sandbox de Stripe para el plan ${normalizedPlan}.`);
    return priceId;
};

export const planIdFromStripeSubscription = (stripeSubscription, priceIds) => {
    const priceId = stripeSubscription?.items?.data?.[0]?.price?.id;
    const match = Object.entries(priceIds || {}).find(([, configuredPriceId]) => configuredPriceId === priceId);
    if (!match) throw new Error('La suscripción de Stripe no corresponde a un plan Money Tips configurado.');
    return normalizePlanId(match[0]);
};

export const createStripeBillingProvider = ({ secretKey, priceIds, fetchImpl = fetch }) => {
    if (!String(secretKey || '').startsWith('sk_test_')) throw new Error('Stripe Billing solo admite una clave sandbox sk_test_ en esta fase.');
    const request = async (path, values = {}, method = 'POST') => {
        const response = await fetchImpl(`${STRIPE_API_BASE}${path}`, {
            method,
            headers: { Authorization: `Bearer ${secretKey}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
            ...(method === 'POST' ? { body: toForm(values) } : {})
        });
        if (!response.ok) throw await stripeError(response);
        return response.json();
    };
    return {
        provider: 'stripe',
        async createCheckout({ userId, email, planId, customerId, successUrl, cancelUrl }) {
            const priceId = priceIdForPlan(priceIds, planId);
            return request('/checkout/sessions', {
                mode: 'subscription', 'payment_method_types[0]': 'card',
                'line_items[0][price]': priceId, 'line_items[0][quantity]': 1,
                success_url: successUrl, cancel_url: cancelUrl, client_reference_id: userId,
                'metadata[money_tips_user_id]': userId, 'metadata[money_tips_plan_id]': normalizePlanId(planId),
                'subscription_data[metadata][money_tips_user_id]': userId,
                'subscription_data[metadata][money_tips_plan_id]': normalizePlanId(planId),
                ...(customerId ? { customer: customerId } : { customer_email: email })
            });
        },
        async createSubscription({ customerId, userId, planId }) {
            return request('/subscriptions', {
                customer: customerId, 'items[0][price]': priceIdForPlan(priceIds, planId),
                'payment_settings[payment_method_types][0]': 'card',
                'metadata[money_tips_user_id]': userId, 'metadata[money_tips_plan_id]': normalizePlanId(planId)
            });
        },
        async cancelAtPeriodEnd({ providerSubscriptionId }) { return request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { cancel_at_period_end: true }); },
        async resumeSubscription({ providerSubscriptionId }) { return request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { cancel_at_period_end: false }); },
        async updatePaymentMethod({ providerCustomerId, returnUrl }) { return request('/billing_portal/sessions', { customer: providerCustomerId, return_url: returnUrl }); },
        async refund({ paymentIntentId, amountCents }) { return request('/refunds', { payment_intent: paymentIntentId, ...(amountCents ? { amount: amountCents } : {}) }); },
        async getSubscription({ providerSubscriptionId }) { return request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {}, 'GET'); },
        async getPaymentIntent({ paymentIntentId }) { return request(`/payment_intents/${encodeURIComponent(paymentIntentId)}`, {}, 'GET'); },
        async getInvoice({ invoiceId }) { return request(`/invoices/${encodeURIComponent(invoiceId)}`, {}, 'GET'); },
        parseWebhook({ rawBody, signature, webhookSecret }) {
            if (!verifyStripeWebhookSignature({ rawBody, signature, secret: webhookSecret })) throw new Error('Firma de webhook Stripe no válida.');
            const event = JSON.parse(rawBody);
            if (!event?.id || !event?.type || !event?.data?.object) throw new Error('Evento Stripe incompleto.');
            return event;
        }
    };
};
