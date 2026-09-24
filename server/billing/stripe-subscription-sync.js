import { SUBSCRIPTION_STATUSES, entitlementForSubscription, expireSubscription, markPaymentFailed, refundSubscription } from './subscription-core.js';
import { planIdFromStripeSubscription } from './stripe-provider.js';

const dateFromUnix = (value) => Number.isFinite(Number(value)) ? new Date(Number(value) * 1000) : null;

export const stripeWebhookType = (event) => {
    const object = event?.data?.object || {};
    if (event.type === 'checkout.session.completed') return 'checkout_created';
    if (event.type === 'invoice.payment_failed') return 'payment_failed';
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') return 'payment_succeeded';
    if (event.type === 'customer.subscription.deleted') return 'subscription_cancelled';
    if (event.type === 'customer.subscription.updated' && object.cancel_at_period_end) return 'subscription_cancel_requested';
    if (event.type === 'customer.subscription.updated') return 'subscription_renewed';
    if (event.type === 'customer.subscription.created') return 'subscription_started';
    if (event.type === 'charge.refunded') return 'refund_completed';
    if (event.type === 'refund.created') return 'refund_created';
    return null;
};

export const stripeUserId = (event, stripeSubscription = null) => {
    const object = event?.data?.object || {};
    return object.metadata?.money_tips_user_id || object.subscription_details?.metadata?.money_tips_user_id || stripeSubscription?.metadata?.money_tips_user_id || object.client_reference_id || null;
};

export const stripeSubscriptionId = (event, stripeSubscription = null) => {
    const object = event?.data?.object || {};
    return stripeSubscription?.id || (object.object === 'subscription' ? object.id : object.subscription) || null;
};

export const entitlementFromStripeSubscription = ({ userId, stripeSubscription, priceIds, existing = {}, now = new Date() }) => {
    const previous = existing || {};
    const currentPeriodStart = dateFromUnix(stripeSubscription.current_period_start) || previous.currentPeriodStart || now;
    const currentPeriodEnd = dateFromUnix(stripeSubscription.current_period_end) || previous.currentPeriodEnd;
    if (!currentPeriodEnd) throw new Error('Stripe no entregó current_period_end para la suscripción.');
    const status = stripeSubscription.status === 'trialing' ? SUBSCRIPTION_STATUSES.TRIALING
        : stripeSubscription.status === 'past_due' ? SUBSCRIPTION_STATUSES.PAST_DUE
            : stripeSubscription.cancel_at_period_end ? SUBSCRIPTION_STATUSES.CANCEL_AT_PERIOD_END
                : stripeSubscription.status === 'active' ? SUBSCRIPTION_STATUSES.ACTIVE : SUBSCRIPTION_STATUSES.EXPIRED;
    return entitlementForSubscription({
        ...previous, userId, planId: planIdFromStripeSubscription(stripeSubscription, priceIds), provider: 'stripe',
        providerCustomerId: stripeSubscription.customer, providerSubscriptionId: stripeSubscription.id, status,
        currentPeriodStart, currentPeriodEnd, accessUntil: currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end), paymentMethodType: 'card',
        createdAt: previous.createdAt || now, updatedAt: now
    }, now);
};

export const applyStripeWebhookToEntitlement = ({ existing, event, stripeSubscription, priceIds, userId, now = new Date() }) => {
    const type = stripeWebhookType(event);
    if (!type) return existing || null;
    if (type === 'payment_failed' || stripeSubscription?.status === 'past_due') {
        if (!existing && !stripeSubscription) throw new Error('No se puede aplicar un impago sin suscripción Stripe.');
        const baseline = existing || entitlementFromStripeSubscription({ userId, stripeSubscription, priceIds, existing, now });
        return markPaymentFailed(baseline, now);
    }
    if (type === 'subscription_cancelled') return expireSubscription(existing, now);
    if (type === 'refund_created' || type === 'refund_completed') return refundSubscription(existing, now);
    if (!stripeSubscription) return existing || null;
    return entitlementFromStripeSubscription({ userId, stripeSubscription, priceIds, existing, now });
};
