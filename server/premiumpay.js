import { timingSafeEqual } from 'node:crypto';
import { SUBSCRIPTION_PLANS, normalizePlanId } from './billing/plans.js';

export const PREMIUM_PAY_PLANS = Object.freeze(Object.fromEntries(
    Object.entries(SUBSCRIPTION_PLANS).map(([id, plan]) => [id, {
        amount: plan.priceCents / 100,
        currency: plan.currency,
        productName: plan.productName,
        productDescription: plan.productDescription
    }])
));

export const normalizePremiumPayPlan = (value) => {
    return normalizePlanId(value);
};

export const premiumPayPlan = (value) => PREMIUM_PAY_PLANS[normalizePremiumPayPlan(value)];

export const statusIsPaid = (status) => ['ok', 'paid', 'approved', 'completed'].includes(
    String(status || '').trim().toLowerCase()
);

// PremiumPay uses the product API key as the Bearer credential on callbacks.
// Keeping this comparison timing-safe prevents revealing partial key matches.
export const hasValidPremiumPayAuthorization = (authorization, secret) => {
    const received = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!secret || !received) return false;
    const expectedBytes = Buffer.from(secret);
    const receivedBytes = Buffer.from(received);
    return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
};

export const normalizeAmount = (value) => Math.round(Number(value) * 100) / 100;
