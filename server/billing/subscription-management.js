import {
    SUBSCRIPTION_STATUSES,
    accessPolicyForSubscription,
    asDate,
    requestCancelAtPeriodEnd,
    resumeSubscription
} from './subscription-core.js';

export const subscriptionPortalView = (subscription, now = new Date()) => {
    const policy = accessPolicyForSubscription(subscription, now);
    const nextRenewal = asDate(subscription?.currentPeriodEnd);
    return {
        status: subscription?.status || 'expired',
        planId: subscription?.planId || subscription?.plan || null,
        nextRenewalAt: nextRenewal ? nextRenewal.toISOString() : null,
        paymentMethodType: subscription?.paymentMethodType || null,
        cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
        graceUntil: asDate(subscription?.graceUntil)?.toISOString() || null,
        accessUntil: asDate(subscription?.accessUntil)?.toISOString() || null,
        recoveryAttempts: Number(subscription?.recoveryAttempts) || 0,
        premiumAccess: policy.premium,
        historicalWorkspace: policy.historicalWorkspace,
        canManagePaymentMethod: false, // requires a concrete provider adapter
        canCancelRenewal: [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.TRIALING].includes(subscription?.status),
        canResumeRenewal: subscription?.status === SUBSCRIPTION_STATUSES.CANCEL_AT_PERIOD_END
    };
};

export const applySubscriptionManagementAction = (subscription, action, now = new Date()) => {
    if (action === 'cancel_at_period_end') return requestCancelAtPeriodEnd(subscription, now);
    if (action === 'resume_renewal') return resumeSubscription(subscription, now);
    if (action === 'update_payment_method') {
        const error = new Error('La gestión del método de pago requiere un proveedor de recurrencia configurado.');
        error.code = 'provider_action_required';
        throw error;
    }
    throw new Error('Acción de suscripción no válida.');
};
