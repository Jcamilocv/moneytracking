import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getOfficialPick, listOfficialPicks } from './lib/official-picks.js';
import { getAdminAuth, getAdminDb } from './lib/firebase-admin.js';
import { getPremiumSubscription } from '../server/subscription.js';
import { accessUntilForPlan } from '../server/premium-access.js';
import { hasValidPremiumPayAuthorization, normalizeAmount, normalizePremiumPayPlan, premiumPayPlan, statusIsPaid } from '../server/premiumpay.js';
import { listOfficialPickReportsForAdmin, resolveOfficialPickReports, submitOfficialPickReport } from './lib/official-pick-reports.js';

const isValidPickId = (value) => typeof value === 'string' && /^op_[a-f0-9]{40}$/.test(value);

const publicOrigin = (req) => process.env.MONEYTRACKING_APP_ORIGIN
    || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()
    .slice(0, 64);

const asDate = (value) => value?.toDate?.() || (value ? new Date(value) : null);

const handlePremiumPayCheckout = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const apiKey = process.env.PREMIUMPAY_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'La pasarela de pruebas todavía no está configurada.' });

    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar con el pago.' });

    try {
        const user = await getAdminAuth().verifyIdToken(token);
        const account = await getAdminAuth().getUser(user.uid);
        if (!account.email) return res.status(400).json({ error: 'Tu cuenta necesita un correo verificado para continuar.' });

        const planName = normalizePremiumPayPlan(req.body?.plan);
        const plan = premiumPayPlan(planName);
        const orderId = `mt-${planName}-${randomUUID()}`;
        const origin = publicOrigin(req);
        const orderRef = getAdminDb().collection('premiumPaymentOrders').doc(orderId);

        await orderRef.set({
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

        const apiBase = (process.env.PREMIUMPAY_API_BASE_URL || 'https://dev.premiumpay.pro/api/v1').replace(/\/$/, '');
        const response = await fetch(`${apiBase}/makepayment`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
                callbackurl: `${origin}/api/payments/premiumpay/callback`,
                tokenizer: true
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.url) {
            await orderRef.update({
                status: 'provider_error',
                providerResponse: result,
                updatedAt: FieldValue.serverTimestamp()
            });
            return res.status(502).json({ error: result?.message || 'PremiumPay no pudo preparar el pago de prueba.' });
        }

        await orderRef.update({
            status: 'checkout_created',
            providerPaymentId: result.paymentId || null,
            updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(201).json({ ok: true, orderId, checkoutUrl: result.url, environment: 'test' });
    } catch (error) {
        console.error('No se pudo crear el checkout de PremiumPay:', error);
        return res.status(400).json({ error: error.message || 'No se pudo preparar el pago.' });
    }
};

const handlePremiumPayCallback = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (!hasValidPremiumPayAuthorization(req.headers.authorization, process.env.PREMIUMPAY_API_KEY)) {
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

            transaction.set(entitlementRef, {
                schemaVersion: 1,
                status: 'active',
                plan: order.plan,
                accessUntil: accessUntilForPlan(order.plan, startsAt),
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
};

const getTokenUid = async (req) => {
    const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    try {
        return (await getAdminAuth().verifyIdToken(match[1])).uid;
    } catch {
        return null;
    }
};

const isOwner = async (req) => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    return Boolean(ownerUid) && await getTokenUid(req) === ownerUid;
};

const getAudience = async (req) => {
    const uid = await getTokenUid(req);
    if (!uid) return { canViewActiveDetails: false };
    if (uid === process.env.OFFICIAL_SNAPSHOT_OWNER_UID) return { canViewActiveDetails: true };
    const subscription = await getPremiumSubscription(uid);
    return { canViewActiveDetails: subscription.active };
};

const handleReport = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const reporterUid = await getTokenUid(req);
    if (!reporterUid) return res.status(401).json({ error: 'Inicia sesión para reportar una incidencia.' });
    const result = await submitOfficialPickReport({
        pickId: req.body?.pickId,
        reporterUid,
        category: req.body?.category
    });
    return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
};

const handleAdminReports = async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    if (!await isOwner(req)) return res.status(401).json({ error: 'No autorizado' });
    if (req.method === 'GET') return res.status(200).json({ reports: await listOfficialPickReportsForAdmin(req.query.pick) });
    const result = await resolveOfficialPickReports({
        pickId: req.body?.pickId,
        decision: req.body?.decision,
        message: req.body?.message
    });
    return res.status(200).json({ ok: true, ...result });
};

export default async function handler(req, res) {
    try {
        if (req.query.mode === 'premiumpay-create') return await handlePremiumPayCheckout(req, res);
        if (req.query.mode === 'premiumpay-callback') return await handlePremiumPayCallback(req, res);
        if (req.query.mode === 'report') return await handleReport(req, res);
        if (req.query.mode === 'admin-reports') return await handleAdminReports(req, res);
        if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
        const audience = await getAudience(req);
        const pickId = req.query.pick;
        if (pickId) {
            if (!isValidPickId(pickId)) return res.status(400).json({ error: 'Identificador de pick no válido' });
            const result = await getOfficialPick(pickId, audience);
            if (!result) return res.status(404).json({ error: 'El comprobante no existe o no es público' });
            res.setHeader('Cache-Control', audience.canViewActiveDetails ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=300');
            return res.status(200).json({ schemaVersion: 1, ...result });
        }

        res.setHeader('Cache-Control', audience.canViewActiveDetails ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=120');
        return res.status(200).json({ schemaVersion: 1, picks: await listOfficialPicks(req.query.limit, audience) });
    } catch (error) {
        if (req.query.mode === 'premiumpay-create') return res.status(400).json({ error: error.message || 'No se pudo preparar el pago.' });
        if (req.query.mode === 'premiumpay-callback') return res.status(400).json({ error: error.message || 'No se pudo procesar el pago.' });
        if (req.query.mode === 'report') return res.status(400).json({ error: error.message || 'No se pudo registrar la incidencia.' });
        if (req.query.mode === 'admin-reports') return res.status(400).json({ error: error.message || 'No se pudo resolver la incidencia.' });
        console.error('No se pudieron leer los picks oficiales:', error);
        return res.status(500).json({ error: 'No se pudieron cargar los picks oficiales' });
    }
}
