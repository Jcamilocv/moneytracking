import { randomUUID } from 'node:crypto';
import { blockOutsideOpsInReadOnlyMode } from '../../../server/ops/read-only-mode.js';
import { getAdminAuth, getAdminDb } from '../../_lib/firebase-admin.js';
import { buildBillingEvent, recordBillingEvent } from '../../../server/billing/event-ledger.js';
import { normalizePlanId } from '../../../server/billing/plans.js';
import { createStripeBillingProvider } from '../../../server/billing/stripe-provider.js';

const assertSandbox = () => {
    if (process.env.STRIPE_BILLING_MODE !== 'test' || process.env.STRIPE_BILLING_ENABLED !== 'true') {
        const error = new Error('Stripe Billing sandbox no está habilitado.');
        error.status = 503;
        throw error;
    }
};

const stripeProvider = () => createStripeBillingProvider({
    secretKey: process.env.STRIPE_SECRET_KEY,
    priceIds: { monthly: process.env.STRIPE_PRICE_MONTHLY, annual: process.env.STRIPE_PRICE_ANNUAL }
});

const tokenUser = async (req) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    try { return await getAdminAuth().verifyIdToken(token); } catch { return null; }
};

export default async function handler(req, res) {
    if (blockOutsideOpsInReadOnlyMode(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    try {
        assertSandbox();
        const user = await tokenUser(req);
        if (!user?.uid || !user.email) return res.status(401).json({ error: 'Inicia sesión con una cuenta que tenga correo.' });
        const planId = normalizePlanId(req.body?.planId || req.body?.plan);
        const db = getAdminDb();
        const entitlementRef = db.collection('users').doc(user.uid).collection('entitlements').doc('subscription');
        const existing = await entitlementRef.get();
        const customerId = existing.exists && existing.data()?.provider === 'stripe' ? existing.data()?.providerCustomerId : null;
        const origin = process.env.MONEYTRACKING_APP_ORIGIN;
        const checkout = await stripeProvider().createCheckout({
            userId: user.uid, email: user.email, planId, customerId,
            successUrl: `${origin}/?payment=stripe-success`, cancelUrl: `${origin}/?payment=stripe-cancelled`
        });
        const event = buildBillingEvent({
            provider: 'stripe', providerEventId: checkout.id, userId: user.uid,
            subscriptionId: checkout.subscription || `checkout:${checkout.id}`,
            type: 'checkout_created', payload: { planId, checkoutId: checkout.id, mode: checkout.mode }
        });
        await recordBillingEvent(db, event);
        await db.collection('stripeCheckoutOrders').doc(`stripe-${randomUUID()}`).set({
            schemaVersion: 1, checkoutSessionId: checkout.id, userId: user.uid, planId,
            status: 'checkout_created', createdAt: new Date()
        });
        return res.status(201).json({ ok: true, checkoutUrl: checkout.url, environment: 'test' });
    } catch (error) {
        return res.status(error.status || 400).json({ error: error.message || 'No se pudo crear el checkout sandbox.' });
    }
}
