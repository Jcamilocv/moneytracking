import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../../lib/firebase-admin.js';
import { accessUntilForPlan } from '../../../server/premium-access.js';
import { hasValidPremiumPayAuthorization, normalizeAmount, statusIsPaid } from '../../../server/premiumpay.js';

const asDate = (value) => value?.toDate?.() || (value ? new Date(value) : null);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const apiKey = process.env.PREMIUMPAY_API_KEY;
    if (!hasValidPremiumPayAuthorization(req.headers.authorization, apiKey)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const orderId = String(req.body?.clientOrderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Falta clientOrderId.' });

    try {
        const db = getAdminDb();
        const orderRef = db.collection('premiumPaymentOrders').doc(orderId);
        const now = new Date();
        const outcome = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(orderRef);
            if (!snapshot.exists) throw new Error('Pedido no reconocido.');
            const order = snapshot.data();
            const paid = statusIsPaid(req.body?.status);
            const correctAmount = normalizeAmount(req.body?.amount) === normalizeAmount(order.expectedAmount);
            const correctCurrency = String(req.body?.currency || '').toUpperCase() === order.currency;
            const paymentId = String(req.body?.paymentId || '').slice(0, 160) || null;

            if (!paid || !correctAmount || !correctCurrency) {
                transaction.set(orderRef, {
                    status: paid ? 'validation_failed' : 'payment_not_completed',
                    providerPaymentId: paymentId,
                    providerStatus: String(req.body?.status || ''),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                return { activated: false };
            }
            if (order.status === 'paid') return { activated: true, duplicate: true };

            const entitlementRef = db.collection('users').doc(order.uid).collection('entitlements').doc('subscription');
            const entitlementSnapshot = await transaction.get(entitlementRef);
            const previous = entitlementSnapshot.exists ? entitlementSnapshot.data() : {};
            const previousUntil = asDate(previous.accessUntil);
            const startsAt = previous.status === 'active' && previousUntil && previousUntil > now ? previousUntil : now;
            const accessUntil = accessUntilForPlan(order.plan, startsAt);

            transaction.set(entitlementRef, {
                schemaVersion: 1,
                status: 'active',
                plan: order.plan,
                accessUntil,
                source: 'premiumpay-api',
                renewalMode: 'provider-tokenized',
                paymentReference: paymentId || orderId,
                grantedAt: now,
                updatedAt: now
            });
            transaction.set(orderRef, {
                status: 'paid',
                providerPaymentId: paymentId,
                providerStatus: String(req.body?.status || ''),
                paidAt: now,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return { activated: true, duplicate: false };
        });
        return res.status(200).json({ ok: true, ...outcome });
    } catch (error) {
        console.error('No se pudo procesar el callback de PremiumPay:', error);
        return res.status(400).json({ error: error.message || 'No se pudo procesar el pago.' });
    }
}
