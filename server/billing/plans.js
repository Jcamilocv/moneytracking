/**
 * Canonical commercial catalogue. Providers receive these values; they do not
 * define Money Tips plans, pricing or the duration of an entitlement.
 */
export const SUBSCRIPTION_PLANS = Object.freeze({
    monthly: Object.freeze({
        id: 'monthly',
        code: 'PLAN_MONTHLY',
        priceCents: 2990,
        currency: 'EUR',
        durationDays: 31,
        autoRenewPaymentMethods: ['card'],
        productName: 'Money Tips Premium Mensual',
        productDescription: 'Acceso Premium a Money Tips durante 31 días.'
    }),
    annual: Object.freeze({
        id: 'annual',
        code: 'PLAN_ANNUAL',
        priceCents: 28900,
        currency: 'EUR',
        durationDays: 366,
        autoRenewPaymentMethods: ['card'],
        productName: 'Money Tips Premium Anual',
        productDescription: 'Acceso Premium a Money Tips durante 366 días.'
    })
});

export const normalizePlanId = (value) => {
    const planId = String(value || '').trim().toLowerCase();
    if (!(planId in SUBSCRIPTION_PLANS)) throw new Error('Plan Premium no válido.');
    return planId;
};

export const subscriptionPlan = (value) => SUBSCRIPTION_PLANS[normalizePlanId(value)];

export const planPeriodEnd = (planId, start = new Date()) => {
    const plan = subscriptionPlan(planId);
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) throw new Error('La fecha de inicio del periodo no es válida.');
    return new Date(date.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
};

export const planSupportsAutoRenew = (planId, paymentMethodType) => subscriptionPlan(planId)
    .autoRenewPaymentMethods
    .includes(String(paymentMethodType || '').trim().toLowerCase());
