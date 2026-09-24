import { getAdminAuth, getAdminDb } from '../../_lib/firebase-admin.js';
import { createStripeBillingProvider } from '../../../server/billing/stripe-provider.js';

const tokenUser = async (req) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    try { return await getAdminAuth().verifyIdToken(token); } catch { return null; }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (process.env.STRIPE_BILLING_MODE !== 'test' || process.env.STRIPE_BILLING_ENABLED !== 'true') {
        return res.status(503).json({ error: 'El portal Stripe sandbox no está habilitado.' });
    }
    try {
        const user = await tokenUser(req);
        if (!user?.uid) return res.status(401).json({ error: 'Inicia sesión para gestionar tu suscripción.' });
        const entitlement = await getAdminDb().collection('users').doc(user.uid).collection('entitlements').doc('subscription').get();
        const customerId = entitlement.exists && entitlement.data()?.provider === 'stripe' ? entitlement.data()?.providerCustomerId : null;
        if (!customerId) return res.status(404).json({ error: 'No hay un cliente Stripe asociado a esta cuenta.' });
        const provider = createStripeBillingProvider({
            secretKey: process.env.STRIPE_SECRET_KEY,
            priceIds: { monthly: process.env.STRIPE_PRICE_MONTHLY, annual: process.env.STRIPE_PRICE_ANNUAL }
        });
        const portal = await provider.updatePaymentMethod({ providerCustomerId: customerId, returnUrl: `${process.env.MONEYTRACKING_APP_ORIGIN}/?subscription=manage` });
        return res.status(200).json({ ok: true, portalUrl: portal.url, environment: 'test' });
    } catch (error) {
        return res.status(error.status || 400).json({ error: error.message || 'No se pudo abrir el portal Stripe.' });
    }
}
