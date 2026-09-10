import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '../../lib/firebase-admin.js';
import { premiumPayPlan, normalizePremiumPayPlan } from '../../../server/premiumpay.js';

const publicOrigin = (req) => process.env.MONEYTRACKING_APP_ORIGIN
    || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()
    .slice(0, 64);

const authenticatedUser = async (req) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Inicia sesión para continuar con el pago.');
    return getAdminAuth().verifyIdToken(token);
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const apiKey = process.env.PREMIUMPAY_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'La pasarela de pruebas todavía no está configurada.' });

    try {
        const user = await authenticatedUser(req);
        const account = await getAdminAuth().getUser(user.uid);
        if (!account.email) return res.status(400).json({ error: 'Tu cuenta necesita un correo verificado para continuar.' });

        const planName = normalizePremiumPayPlan(req.body?.plan);
        const plan = premiumPayPlan(planName);
        const orderId = `mt-${planName}-${randomUUID()}`;
        const origin = publicOrigin(req);
        const callbackUrl = `${origin}/api/payments/premiumpay/callback`;

        await getAdminDb().collection('premiumPaymentOrders').doc(orderId).set({
            schemaVersion: 1,
            status: 'pending',
            provider: 'premiumpay',
            environment: 'test',
            uid: user.uid,
            email: account.email.toLowerCase(),
            plan: planName,
            expectedAmount: plan.amount,
            currency: plan.currency,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        const payload = {
            amount: plan.amount,
            currency: plan.currency,
            productName: plan.productName,
            productDescription: plan.productDescription,
            clientOrderId: orderId,
            clientIP: clientIp(req),
            clientEmail: account.email,
            okurl: `${origin}/?payment=success`,
            kourl: `${origin}/?payment=failed`,
            cancelurl: `${origin}/?payment=cancelled`,
            callbackurl: callbackUrl,
            tokenizer: true
        };
        // The developer environment is explicit. Production receives its base URL
        // only when its own credential is intentionally configured later.
        const apiBase = (process.env.PREMIUMPAY_API_BASE_URL || 'https://dev.premiumpay.pro/api/v1').replace(/\/$/, '');
        const response = await fetch(`${apiBase}/makepayment`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.url) {
            await getAdminDb().collection('premiumPaymentOrders').doc(orderId).update({
                status: 'provider_error', providerResponse: result, updatedAt: FieldValue.serverTimestamp()
            });
            throw new Error(result?.message || 'PremiumPay no pudo preparar el pago de prueba.');
        }

        await getAdminDb().collection('premiumPaymentOrders').doc(orderId).update({
            status: 'checkout_created', providerPaymentId: result.paymentId || null,
            updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(201).json({ ok: true, orderId, checkoutUrl: result.url, environment: 'test' });
    } catch (error) {
        console.error('No se pudo crear el checkout de PremiumPay:', error);
        return res.status(400).json({ error: error.message || 'No se pudo preparar el pago.' });
    }
}
