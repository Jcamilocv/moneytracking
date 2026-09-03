import { getAdminDb } from '../api/lib/firebase-admin.js';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const toDate = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// El documento de suscripción se escribe exclusivamente desde un backend de pago.
// Un acceso activo siempre necesita estado válido y fecha de vencimiento futura.
export const hasActivePremiumSubscription = (subscription, now = new Date()) => {
    if (!subscription || !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return false;
    const accessUntil = toDate(subscription.accessUntil);
    return Boolean(accessUntil && accessUntil.getTime() > now.getTime());
};

export const getPremiumSubscription = async (uid) => {
    if (!uid) return { active: false, subscription: null };
    const snapshot = await getAdminDb().collection('users').doc(uid).collection('entitlements').doc('subscription').get();
    const subscription = snapshot.exists ? snapshot.data() : null;
    return { active: hasActivePremiumSubscription(subscription), subscription };
};
