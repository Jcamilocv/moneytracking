/**
 * Money Tips subscription domain. This module intentionally has no SDK or
 * provider dependency: it is the single place where access is decided.
 */
import { normalizePlanId, planPeriodEnd, planSupportsAutoRenew } from './plans.js';

export const SUBSCRIPTION_STATUSES = Object.freeze({
    TRIALING: 'trialing',
    ACTIVE: 'active',
    PAST_DUE: 'past_due',
    CANCEL_AT_PERIOD_END: 'cancel_at_period_end',
    EXPIRED: 'expired',
    REFUNDED: 'refunded',
    REVOKED: 'revoked'
});

export const PAYMENT_GRACE_PERIOD_DAYS = 3;
export const MAX_RECOVERY_ATTEMPTS = 3;

const ACCESSIBLE_STATUSES = new Set([
    SUBSCRIPTION_STATUSES.TRIALING,
    SUBSCRIPTION_STATUSES.ACTIVE,
    SUBSCRIPTION_STATUSES.CANCEL_AT_PERIOD_END,
    SUBSCRIPTION_STATUSES.PAST_DUE
]);
const VALID_STATUSES = new Set(Object.values(SUBSCRIPTION_STATUSES));
const RECURRING_PAYMENT_METHODS = new Set(['card']);
const ONE_TIME_PAYMENT_METHODS = new Set(['bizum']);
const SENSITIVE_FIELD = /(secret|token|password|authorization|cardnumber|cvc|cvv)/i;

export const asDate = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
};

const assertDate = (value, name) => {
    const date = asDate(value);
    if (!date) throw new Error(`${name} debe ser una fecha válida.`);
    return date;
};

export const assertSubscriptionDoesNotContainSensitiveData = (value = {}) => {
    for (const key of Object.keys(value)) {
        if (SENSITIVE_FIELD.test(key)) throw new Error(`El campo sensible '${key}' no puede guardarse en una suscripción.`);
    }
};

export const normalizeSubscription = (input = {}, now = new Date()) => {
    assertSubscriptionDoesNotContainSensitiveData(input);
    const status = String(input.status || '').trim();
    if (!VALID_STATUSES.has(status)) throw new Error('Estado de suscripción no válido.');
    const userId = String(input.userId || '').trim();
    const planId = normalizePlanId(input.planId || input.plan);
    const provider = String(input.provider || '').trim();
    if (!userId || !planId || !provider) throw new Error('userId, planId y provider son obligatorios.');

    const currentPeriodStart = assertDate(input.currentPeriodStart || now, 'currentPeriodStart');
    const currentPeriodEnd = assertDate(input.currentPeriodEnd || input.accessUntil, 'currentPeriodEnd');
    const graceUntil = input.graceUntil ? assertDate(input.graceUntil, 'graceUntil') : null;
    const accessUntil = input.accessUntil ? assertDate(input.accessUntil, 'accessUntil') : (graceUntil || currentPeriodEnd);
    const paymentMethodType = input.paymentMethodType ? String(input.paymentMethodType).trim().toLowerCase() : null;
    if (paymentMethodType && !RECURRING_PAYMENT_METHODS.has(paymentMethodType) && !ONE_TIME_PAYMENT_METHODS.has(paymentMethodType)) {
        throw new Error('Método de pago no válido.');
    }

    return {
        schemaVersion: 2,
        userId,
        planId,
        provider,
        providerCustomerId: input.providerCustomerId ? String(input.providerCustomerId) : null,
        providerSubscriptionId: input.providerSubscriptionId ? String(input.providerSubscriptionId) : null,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(input.cancelAtPeriodEnd),
        graceUntil,
        accessUntil,
        paymentMethodType,
        recoveryAttempts: Number.isInteger(input.recoveryAttempts) ? input.recoveryAttempts : 0,
        createdAt: asDate(input.createdAt) || now,
        updatedAt: asDate(input.updatedAt) || now
    };
};

export const hasPremiumAccess = (subscription, now = new Date()) => {
    if (!subscription || !ACCESSIBLE_STATUSES.has(subscription.status)) return false;
    const accessUntil = asDate(subscription.accessUntil) || asDate(subscription.currentPeriodEnd);
    return Boolean(accessUntil && accessUntil.getTime() > now.getTime());
};

export const accessPolicyForSubscription = (subscription, now = new Date()) => ({
    premium: hasPremiumAccess(subscription, now),
    // Historical workspace is owned data. Firestore permits its owner to read it
    // even after expiry, but premium writes/features stay gated by `premium`.
    historicalWorkspace: 'read_only',
    canReceiveNewPremiumPicks: hasPremiumAccess(subscription, now),
    canUsePremiumTools: hasPremiumAccess(subscription, now)
});

export const entitlementForSubscription = (subscription, now = new Date()) => {
    const normalized = normalizeSubscription(subscription, now);
    const policy = accessPolicyForSubscription(normalized, now);
    return {
        ...normalized,
        plan: normalized.planId, // compatibility with the existing client
        renewalMode: planSupportsAutoRenew(normalized.planId, normalized.paymentMethodType) ? 'automatic' : 'manual',
        historicalWorkspaceAccess: policy.historicalWorkspace,
        canReceiveNewPremiumPicks: policy.canReceiveNewPremiumPicks,
        canUsePremiumTools: policy.canUsePremiumTools
    };
};

const withUpdate = (subscription, updates, now) => normalizeSubscription({
    ...subscription,
    ...updates,
    updatedAt: now
}, now);

export const startSubscription = (input, now = new Date()) => entitlementForSubscription({
    ...input,
    currentPeriodStart: input.currentPeriodStart || now,
    currentPeriodEnd: input.currentPeriodEnd || planPeriodEnd(input.planId || input.plan, input.currentPeriodStart || now),
    accessUntil: input.accessUntil || input.currentPeriodEnd || planPeriodEnd(input.planId || input.plan, input.currentPeriodStart || now),
    status: input.status || SUBSCRIPTION_STATUSES.ACTIVE,
    cancelAtPeriodEnd: false,
    recoveryAttempts: 0,
    createdAt: input.createdAt || now,
    updatedAt: now
}, now);

export const renewSubscription = (subscription, { currentPeriodStart, currentPeriodEnd } = {}, now = new Date()) => {
    const nextStart = currentPeriodStart || subscription.currentPeriodEnd || now;
    const nextEnd = currentPeriodEnd || planPeriodEnd(subscription.planId || subscription.plan, nextStart);
    return entitlementForSubscription(withUpdate(subscription, {
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    currentPeriodStart: nextStart,
    currentPeriodEnd: nextEnd,
    accessUntil: nextEnd,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    recoveryAttempts: 0
    }, now), now);
};

export const markPaymentFailed = (subscription, now = new Date()) => {
    const periodEnd = assertDate(subscription.currentPeriodEnd || subscription.accessUntil, 'currentPeriodEnd');
    const graceUntil = new Date(periodEnd.getTime() + PAYMENT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    return entitlementForSubscription(withUpdate(subscription, {
        status: SUBSCRIPTION_STATUSES.PAST_DUE,
        graceUntil,
        accessUntil: graceUntil,
        recoveryAttempts: 0
    }, now), now);
};

export const registerRecoveryFailure = (subscription, now = new Date()) => {
    const recoveryAttempts = (Number(subscription.recoveryAttempts) || 0) + 1;
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS || (asDate(subscription.graceUntil) || new Date(0)).getTime() <= now.getTime()) {
        return expireSubscription({ ...subscription, recoveryAttempts }, now);
    }
    return entitlementForSubscription(withUpdate(subscription, { recoveryAttempts }, now), now);
};

export const requestCancelAtPeriodEnd = (subscription, now = new Date()) => entitlementForSubscription(withUpdate(subscription, {
    status: SUBSCRIPTION_STATUSES.CANCEL_AT_PERIOD_END,
    cancelAtPeriodEnd: true,
    accessUntil: subscription.currentPeriodEnd || subscription.accessUntil
}, now), now);

export const resumeSubscription = (subscription, now = new Date()) => {
    const end = assertDate(subscription.currentPeriodEnd || subscription.accessUntil, 'currentPeriodEnd');
    if (end.getTime() <= now.getTime()) throw new Error('No se puede reactivar una suscripción ya vencida.');
    return entitlementForSubscription(withUpdate(subscription, {
        status: SUBSCRIPTION_STATUSES.ACTIVE,
        cancelAtPeriodEnd: false
    }, now), now);
};

export const expireSubscription = (subscription, now = new Date()) => entitlementForSubscription(withUpdate(subscription, {
    status: SUBSCRIPTION_STATUSES.EXPIRED,
    cancelAtPeriodEnd: false,
    graceUntil: null,
    accessUntil: subscription.currentPeriodEnd || subscription.accessUntil
}, now), now);

export const refundSubscription = (subscription, now = new Date()) => entitlementForSubscription(withUpdate(subscription, {
    status: SUBSCRIPTION_STATUSES.REFUNDED,
    cancelAtPeriodEnd: false,
    accessUntil: now
}, now), now);

export const revokeSubscription = (subscription, now = new Date()) => entitlementForSubscription(withUpdate(subscription, {
    status: SUBSCRIPTION_STATUSES.REVOKED,
    cancelAtPeriodEnd: false,
    accessUntil: now
}, now), now);

export const supportsRecurringPaymentMethod = (paymentMethodType) => RECURRING_PAYMENT_METHODS.has(String(paymentMethodType || '').toLowerCase());
