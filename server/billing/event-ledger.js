import { createHash } from 'node:crypto';

export const BILLING_EVENT_TYPES = Object.freeze([
    'checkout_created',
    'payment_succeeded',
    'payment_failed',
    'subscription_started',
    'subscription_renewed',
    'subscription_cancel_requested',
    'subscription_cancelled',
    'subscription_expired',
    'refund_created',
    'refund_completed',
    'subscription_revoked'
]);

const SENSITIVE_FIELD = /(secret|token|password|authorization|cardnumber|cvc|cvv)/i;
const stableValue = (value) => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
        if (!SENSITIVE_FIELD.test(key)) result[key] = stableValue(value[key]);
        return result;
    }, {});
    return value;
};

export const hashBillingPayload = (payload = {}) => createHash('sha256')
    .update(JSON.stringify(stableValue(payload)))
    .digest('hex');

export const buildBillingEvent = ({
    provider,
    providerEventId,
    userId,
    subscriptionId,
    type,
    timestamp = new Date(),
    payload = {}
}) => {
    if (!BILLING_EVENT_TYPES.includes(type)) throw new Error('Tipo de evento de facturación no válido.');
    if (!provider || !providerEventId || !userId || !subscriptionId) throw new Error('Faltan identificadores requeridos en el evento de facturación.');
    const eventId = createHash('sha256').update(`${provider}:${providerEventId}`).digest('hex');
    return {
        eventId,
        provider: String(provider),
        providerEventId: String(providerEventId),
        userId: String(userId),
        subscriptionId: String(subscriptionId),
        type,
        timestamp: new Date(timestamp),
        payloadHash: hashBillingPayload(payload),
        processedAt: null,
        processingResult: 'pending'
    };
};

/**
 * Persisted only by Admin SDK. provider+providerEventId is the idempotency key;
 * duplicate webhooks return the existing immutable record without reprocessing.
 */
export const recordBillingEvent = async (db, event) => {
    const ref = db.collection('billingEvents').doc(event.eventId);
    return db.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists) return { duplicate: true, event: existing.data() };
        transaction.create(ref, event);
        return { duplicate: false, event };
    });
};

export const markBillingEventProcessed = async (db, eventId, processingResult, now = new Date()) => {
    const ref = db.collection('billingEvents').doc(eventId);
    await ref.update({ processedAt: now, processingResult: String(processingResult || 'processed') });
};
