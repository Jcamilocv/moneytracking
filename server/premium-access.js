const PLAN_DURATIONS = {
    monthly: 31,
    annual: 366
};

const cleanText = (value, maxLength = 120) => String(value || '').trim().slice(0, maxLength);

export const normalizePremiumAccessRequest = (input = {}) => {
    const action = cleanText(input.action, 20);
    if (!['grant', 'revoke'].includes(action)) throw new Error('Acción de acceso Premium no válida.');

    const email = cleanText(input.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Introduce el correo con el que el cliente creó su cuenta.');
    }

    const plan = cleanText(input.plan, 20) || 'monthly';
    if (!(plan in PLAN_DURATIONS)) throw new Error('Plan Premium no válido.');

    const paymentReference = cleanText(input.paymentReference, 120);
    return { action, email, plan, paymentReference };
};

export const accessUntilForPlan = (plan, now = new Date()) => {
    const days = PLAN_DURATIONS[plan];
    if (!days) throw new Error('Plan Premium no válido.');
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

export const entitlementForManualGrant = ({ plan, paymentReference, now = new Date(), startsAt = now }) => ({
    schemaVersion: 1,
    status: 'active',
    plan,
    accessUntil: accessUntilForPlan(plan, startsAt),
    source: 'manual-payment-confirmed',
    renewalMode: 'manual',
    paymentReference: paymentReference || null,
    grantedAt: now,
    updatedAt: now
});

export const entitlementForRevocation = ({ previous = {}, now = new Date() }) => ({
    ...previous,
    schemaVersion: 1,
    status: 'canceled',
    canceledAt: now,
    updatedAt: now
});
