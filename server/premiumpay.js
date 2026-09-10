import { timingSafeEqual } from 'node:crypto';

export const PREMIUM_PAY_PLANS = {
    monthly: {
        amount: 29.9,
        currency: 'EUR',
        productName: 'Money Tips Premium Mensual',
        productDescription: 'Acceso Premium a Money Tips durante 31 días.'
    },
    annual: {
        amount: 289,
        currency: 'EUR',
        productName: 'Money Tips Premium Anual',
        productDescription: 'Acceso Premium a Money Tips durante 366 días.'
    }
};

export const normalizePremiumPayPlan = (value) => {
    const plan = String(value || '').trim().toLowerCase();
    if (!(plan in PREMIUM_PAY_PLANS)) throw new Error('Plan Premium no válido.');
    return plan;
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
