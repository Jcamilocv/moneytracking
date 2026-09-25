import { randomUUID } from 'node:crypto';
import { blockOutsideOpsInReadOnlyMode } from '../server/ops/read-only-mode.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getOfficialPick, listOfficialPicks } from './_lib/official-picks.js';
import { getAdminAuth, getAdminDb } from './_lib/firebase-admin.js';
import { getPremiumSubscription, evaluateCustomerRevenueStatus } from '../server/subscription.js';
import { accessUntilForPlan } from '../server/premium-access.js';
import { hasValidPremiumPayAuthorization, normalizeAmount, normalizePremiumPayPlan, premiumPayPlan, statusIsPaid } from '../server/premiumpay.js';
import { listOfficialPickReportsForAdmin, resolveOfficialPickReports, submitOfficialPickReport } from './_lib/official-pick-reports.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from './_lib/system-events.js';
import { registerRevenueIncident, REVENUE_INCIDENT_TYPES } from '../server/revenue-incidents.js';
import { buildBillingEvent } from '../server/billing/event-ledger.js';
import { applySubscriptionManagementAction, subscriptionPortalView } from '../server/billing/subscription-management.js';
import { normalizeSubscription } from '../server/billing/subscription-core.js';

const isValidPickId = (value) => typeof value === 'string' && /^op_[a-f0-9]{40}$/.test(value);

// C3 Auditoría: Sanitizar el body del callback de PremiumPay antes de persistir.
// Elimina el campo `token` (credencial de tokenización de tarjeta) y cualquier
// campo inesperado que PremiumPay pueda añadir en el futuro.
const SAFE_CALLBACK_FIELDS = new Set([
    'clientOrderId', 'paymentId', 'amount', 'currency',
    'status', 'message', 'paymentMethod'
]);
const sanitizeCallbackPayload = (body) => {
    if (!body || typeof body !== 'object') return null;
    const sanitized = {};
    for (const key of Object.keys(body)) {
        if (SAFE_CALLBACK_FIELDS.has(key)) sanitized[key] = body[key];
    }
    return sanitized;
};

const publicOrigin = (req) => process.env.MONEYTRACKING_APP_ORIGIN
    || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

const premiumPayEnvironment = () => process.env.PREMIUMPAY_ENVIRONMENT === 'production'
    ? 'production'
    : 'test';

const premiumPayCheckoutEnabled = () => premiumPayEnvironment() === 'test'
    || process.env.PREMIUMPAY_CHECKOUT_ENABLED === 'true';

const premiumPayCallbackUrl = (origin) => {
    const callbackUrl = new URL('/api/payments/premiumpay/callback', origin);
    // Preview deployments are protected by Vercel. The system-provided bypass is
    // permitted only for sandbox callbacks, never for live payment traffic.
    if (premiumPayEnvironment() === 'test') {
        const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        if (bypassSecret) callbackUrl.searchParams.set('x-vercel-protection-bypass', bypassSecret);
    }
    return callbackUrl.toString();
};

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()
    .slice(0, 64);

const asDate = (value) => value?.toDate?.() || (value ? new Date(value) : null);

const handlePremiumPayCheckout = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const apiKey = process.env.PREMIUMPAY_API_KEY;
    if (!premiumPayCheckoutEnabled() || !apiKey) {
        return res.status(503).json({ error: 'La suscripción Premium todavía no está disponible.' });
    }

    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar con el pago.' });

    try {
        const user = await getAdminAuth().verifyIdToken(token);
        // The verified Firebase ID token already contains the email needed by
        // PremiumPay. Avoid an additional Admin Auth lookup here: it is not
        // required to create an order and can demand a broader IAM permission
        // than the checkout service needs.
        const customerEmail = String(user.email || '').trim().toLowerCase();
        if (!customerEmail) return res.status(400).json({ error: 'Tu cuenta necesita un correo para continuar.' });

        const planName = normalizePremiumPayPlan(req.body?.plan);
        const plan = premiumPayPlan(planName);
        const orderId = `mt-${planName}-${randomUUID()}`;
        const origin = publicOrigin(req);
        const orderRef = getAdminDb().collection('premiumPaymentOrders').doc(orderId);
        const environment = premiumPayEnvironment();
        const configuredApiBase = process.env.PREMIUMPAY_API_BASE_URL;

        if (environment === 'production' && !configuredApiBase) {
            throw new Error('La pasarela Premium todavía no está configurada.');
        }

        await orderRef.set({
            schemaVersion: 1,
            status: 'pending',
            provider: 'premiumpay',
            environment,
            uid: user.uid,
            email: customerEmail,
            plan: planName,
            expectedAmount: plan.amount,
            currency: plan.currency,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        const apiBase = (configuredApiBase || 'https://dev.premiumpay.pro/api/v1').replace(/\/$/, '');
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
                clientEmail: customerEmail,
                okurl: `${origin}/?payment=success`,
                kourl: `${origin}/?payment=failed`,
                cancelurl: `${origin}/?payment=cancelled`,
                callbackurl: premiumPayCallbackUrl(origin),
                // POLÍTICA INVIOLABLE: Money Tips NO realiza cobros recurrentes.
                // No solicitamos tokenización de tarjeta a PremiumPay.
                tokenizer: false
            })
        });
        const result = await response.json().catch(() => ({}));
        // PremiumPay documents the hosted checkout link as `redirect`.
        // Keep `url` as a compatibility fallback for earlier sandbox variants.
        const checkoutUrl = result?.redirect || result?.url;
        if (!response.ok || !checkoutUrl) {
            await orderRef.update({
                status: 'provider_error',
                providerResponse: result,
                updatedAt: FieldValue.serverTimestamp()
            });
            const providerRejectedAuthorization = response.status === 401 || response.status === 403;
            return res.status(502).json({
                error: providerRejectedAuthorization
                    ? 'La pasarela Premium está terminando su autorización. Vuelve a intentarlo en unos minutos.'
                    : (result?.message || 'PremiumPay no pudo preparar el pago.')
            });
        }

        await orderRef.update({
            status: 'checkout_created',
            providerPaymentId: result.paymentId || null,
            updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(201).json({ ok: true, orderId, checkoutUrl, environment });
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

            // Idempotencia: callback duplicado para orden ya completada
            if (order.status === 'paid') return { activated: true, duplicate: true };

            // C2 Auditoría: Aceptar explícitamente órdenes en estados elegibles.
            // 'abandoned' se acepta porque el monitor de órdenes puede haberla
            // marcado antes de que llegue un callback retrasado de PremiumPay.
            // Rechazar estados terminales de error para evitar reactivación
            // desde callbacks fabricados contra órdenes fallidas.
            const CALLBACK_ELIGIBLE_STATUSES = new Set(['pending', 'checkout_created', 'abandoned']);
            if (!CALLBACK_ELIGIBLE_STATUSES.has(order.status)) {
                return {
                    activated: false,
                    failReason: `Orden en estado terminal '${order.status}' — no se puede reactivar.`,
                    order,
                    paymentId: String(req.body?.paymentId || '').slice(0, 160) || null
                };
            }

            const paid = statusIsPaid(req.body?.status);
            const correctAmount = normalizeAmount(req.body?.amount) === normalizeAmount(order.expectedAmount);
            const correctCurrency = String(req.body?.currency || '').toUpperCase() === order.currency;
            const paymentId = String(req.body?.paymentId || '').slice(0, 160) || null;

            if (!paid || !correctAmount || !correctCurrency) {
                const failReason = !paid
                    ? `Estado de pago no completado (${req.body?.status})`
                    : `Discrepancia en cobro (Esperado: ${order.expectedAmount} ${order.currency}, Recibido: ${req.body?.amount} ${req.body?.currency})`;

                transaction.set(orderRef, {
                    status: paid ? 'validation_failed' : 'payment_not_completed',
                    providerPaymentId: paymentId,
                    providerStatus: String(req.body?.status || ''),
                    failReason,
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                return { activated: false, failReason, order, paymentId };
            }

            const entitlementRef = db.collection('users').doc(order.uid).collection('entitlements').doc('subscription');
            const entitlementSnapshot = await transaction.get(entitlementRef);
            const previous = entitlementSnapshot.exists ? entitlementSnapshot.data() : {};
            const previousUntil = asDate(previous.accessUntil);
            const startsAt = previous.status === 'active' && previousUntil && previousUntil > now ? previousUntil : now;

            // POLÍTICA INVIOLABLE MONEY TIPS: Renovaciones estrictamente manuales.
            // Aunque PremiumPay envíe tokenizador, Money Tips no realiza cobros automáticos.
            transaction.set(entitlementRef, {
                schemaVersion: 1,
                status: 'active',
                plan: order.plan,
                accessUntil: accessUntilForPlan(order.plan, startsAt),
                source: 'premiumpay-api',
                renewalMode: 'manual',
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
            return { activated: true, duplicate: false, plan: order.plan, uid: order.uid };
        });

        if (outcome.activated && !outcome.duplicate) {
            await logSystemEvent({
                department: DEPARTMENTS.CUSTOMERS_REVENUE,
                workerId: 'premiumpay-callback-handler',
                eventType: 'subscription.activated',
                status: EVENT_STATUSES.SUCCESS,
                payload: {
                    orderId,
                    uid: outcome.uid,
                    plan: outcome.plan,
                    provider: 'premiumpay'
                },
                rulesApplied: ['rule_payment_paid', 'rule_amount_exact', 'rule_currency_exact', 'rule_manual_renewal_only'],
                output: { activated: true, renewalMode: 'manual' }
            }).catch((err) => console.error('Error logging system event for subscription activation:', err));
        } else if (!outcome.activated) {
            // Pago no válido o discrepancia: registrar incidencia y alertar de inmediato a Karen
            await registerRevenueIncident({
                incidentType: REVENUE_INCIDENT_TYPES.VALIDATION_MISMATCH,
                orderId,
                uid: outcome.order?.uid || null,
                email: outcome.order?.email || null,
                amount: req.body?.amount,
                currency: req.body?.currency || 'EUR',
                reason: outcome.failReason || 'Fallo de validación en webhook de pago',
                providerResponse: sanitizeCallbackPayload(req.body)
            }).catch((err) => console.error('Error al registrar incidencia de ingresos:', err));
        }

        return res.status(200).json({ ok: true, ...outcome });
    } catch (error) {
        console.error('No se pudo procesar el callback de PremiumPay:', error);
        await registerRevenueIncident({
            incidentType: REVENUE_INCIDENT_TYPES.PAYMENT_GATEWAY_ERROR,
            orderId: req.body?.clientOrderId || null,
            reason: error.message || 'Excepción no controlada en webhook de PremiumPay',
            providerResponse: sanitizeCallbackPayload(req.body)
        }).catch(() => {});
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

const subscriptionFromEntitlement = (uid, entitlement, now = new Date()) => {
    const legacyStatus = entitlement?.status === 'canceled' ? 'expired' : entitlement?.status;
    return normalizeSubscription({
        ...entitlement,
        userId: uid,
        planId: entitlement?.planId || entitlement?.plan,
        provider: entitlement?.provider || 'legacy',
        status: legacyStatus || 'expired',
        currentPeriodStart: entitlement?.currentPeriodStart || entitlement?.grantedAt || now,
        currentPeriodEnd: entitlement?.currentPeriodEnd || entitlement?.accessUntil,
        accessUntil: entitlement?.accessUntil,
        paymentMethodType: entitlement?.paymentMethodType || null
    }, now);
};

const handleSubscriptionManagement = async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    const uid = await getTokenUid(req);
    if (!uid) return res.status(401).json({ error: 'Inicia sesión para gestionar tu suscripción.' });

    const db = getAdminDb();
    const subscriptionRef = db.collection('users').doc(uid).collection('entitlements').doc('subscription');
    if (req.method === 'GET') {
        const snapshot = await subscriptionRef.get();
        if (!snapshot.exists) return res.status(404).json({ error: 'No existe una suscripción para esta cuenta.' });
        const existing = subscriptionFromEntitlement(uid, snapshot.data(), new Date());
        return res.status(200).json({ ok: true, subscription: subscriptionPortalView(existing) });
    }

    try {
        const action = String(req.body?.action || '');
        const outcome = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(subscriptionRef);
            if (!snapshot.exists) throw new Error('No existe una suscripción para esta cuenta.');
            const now = new Date();
            const existing = subscriptionFromEntitlement(uid, snapshot.data(), now);
            const updated = applySubscriptionManagementAction(existing, action, now);
            const providerEventId = `self-service:${uid}:${action}:${asDate(updated.currentPeriodEnd).getTime()}`;
            const event = buildBillingEvent({
                provider: updated.provider,
                providerEventId,
                userId: uid,
                subscriptionId: updated.providerSubscriptionId || 'subscription',
                type: action === 'cancel_at_period_end' ? 'subscription_cancel_requested' : 'subscription_started',
                timestamp: now,
                payload: { action, cancelAtPeriodEnd: updated.cancelAtPeriodEnd, currentPeriodEnd: updated.currentPeriodEnd.toISOString() }
            });
            const eventRef = db.collection('billingEvents').doc(event.eventId);
            const previousEvent = await transaction.get(eventRef);
            if (previousEvent.exists) return { updated: existing, duplicate: true };
            // No se invoca ningún proveedor aquí. El futuro adaptador realizará
            // la sincronización externa antes de activar este endpoint en producción.
            transaction.set(subscriptionRef, updated, { merge: true });
            transaction.create(eventRef, event);
            return { updated, duplicate: false };
        });
        return res.status(200).json({ ok: true, duplicate: outcome.duplicate, subscription: subscriptionPortalView(outcome.updated) });
    } catch (error) {
        const status = error.code === 'provider_action_required' ? 409 : 400;
        return res.status(status).json({ error: error.message || 'No se pudo actualizar la suscripción.', code: error.code || null });
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
    if (blockOutsideOpsInReadOnlyMode(res)) return;
    try {
        if (req.query.mode === 'subscription-status') {
            const uid = await getTokenUid(req);
            if (!uid) return res.status(401).json({ error: 'Inicia sesión para consultar tu suscripción.' });
            const sub = await getPremiumSubscription(uid);
            const status = evaluateCustomerRevenueStatus(sub.subscription);
            return res.status(200).json({ ok: true, subscription: status });
        }
        if (req.query.mode === 'subscription-management') return await handleSubscriptionManagement(req, res);
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
            res.setHeader('Vary', 'Authorization');
            res.setHeader('Cache-Control', audience.canViewActiveDetails ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=300');
            return res.status(200).json({ schemaVersion: 1, ...result });
        }

        res.setHeader('Vary', 'Authorization');
        res.setHeader('Cache-Control', audience.canViewActiveDetails ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=120');
        return res.status(200).json({ schemaVersion: 1, picks: await listOfficialPicks(req.query.limit, audience) });
    } catch (error) {
        if (req.query.mode === 'premiumpay-create') return res.status(400).json({ error: error.message || 'No se pudo preparar el pago.' });
        if (req.query.mode === 'premiumpay-callback') return res.status(400).json({ error: error.message || 'No se pudo procesar el pago.' });
        if (req.query.mode === 'report') return res.status(400).json({ error: error.message || 'No se pudo registrar la incidencia.' });
        if (req.query.mode === 'subscription-management') return res.status(400).json({ error: error.message || 'No se pudo actualizar la suscripción.' });
        if (req.query.mode === 'admin-reports') return res.status(400).json({ error: error.message || 'No se pudo resolver la incidencia.' });
        console.error('No se pudieron leer los picks oficiales:', error);
        return res.status(500).json({ error: 'No se pudieron cargar los picks oficiales' });
    }
}
