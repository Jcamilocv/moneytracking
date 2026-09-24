import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { asDate, hasPremiumAccess } from './billing/subscription-core.js';

export const toDate = (value) => {
    return asDate(value);
};

// El documento de suscripción se escribe exclusivamente desde un backend de pago.
// Un acceso activo siempre necesita estado válido y fecha de vencimiento futura.
export const hasActivePremiumSubscription = (subscription, now = new Date()) => {
    return hasPremiumAccess(subscription, now);
};

export const getPremiumSubscription = async (uid) => {
    if (!uid) return { active: false, subscription: null };
    const snapshot = await getAdminDb().collection('users').doc(uid).collection('entitlements').doc('subscription').get();
    const subscription = snapshot.exists ? snapshot.data() : null;
    return { active: hasActivePremiumSubscription(subscription), subscription };
};

/**
 * Evalúa la ventana informativa T-3 sin provocar ningún cobro.
 */
export const isExpiringSoon = (subscription, now = new Date(), windowDays = 3) => {
    if (!subscription || !hasActivePremiumSubscription(subscription, now)) return false;
    const accessUntil = toDate(subscription.accessUntil);
    if (!accessUntil) return false;
    const diffMs = accessUntil.getTime() - now.getTime();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    return diffMs > 0 && diffMs <= windowMs;
};

/**
 * Retorna el estado consolidado de suscripción para Customers & Revenue.
 */
export const evaluateCustomerRevenueStatus = (subscription, now = new Date()) => {
    if (!subscription) {
        return { tier: 'free', active: false, expiringSoon: false, daysRemaining: 0 };
    }
    const active = hasActivePremiumSubscription(subscription, now);
    const accessUntil = toDate(subscription.accessUntil);
    const expiringSoon = isExpiringSoon(subscription, now);
    const daysRemaining = accessUntil && active
        ? Math.max(0, Math.ceil((accessUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

    return {
        tier: active ? 'premium' : 'free',
        active,
        plan: subscription.plan || null,
        status: subscription.status || 'inactive',
        // Los documentos legacy conservan `manual`; el núcleo nuevo podrá
        // expresar `automatic` cuando exista un adaptador de proveedor real.
        renewalMode: subscription.renewalMode || 'manual',
        accessUntil: accessUntil ? accessUntil.toISOString() : null,
        expiringSoon,
        daysRemaining
    };
};
