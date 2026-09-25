import { getAdminDb } from '../../_lib/firebase-admin.js';
import { blockOutsideOpsInReadOnlyMode } from '../../../server/ops/read-only-mode.js';
import { buildBillingEvent } from '../../../server/billing/event-ledger.js';
import { createStripeBillingProvider } from '../../../server/billing/stripe-provider.js';
import { applyStripeWebhookToEntitlement, stripeSubscriptionId, stripeUserId, stripeWebhookType } from '../../../server/billing/stripe-subscription-sync.js';

export const config = { api: { bodyParser: false } };

const readRawBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
};

const provider = () => createStripeBillingProvider({
    secretKey: process.env.STRIPE_SECRET_KEY,
    priceIds: { monthly: process.env.STRIPE_PRICE_MONTHLY, annual: process.env.STRIPE_PRICE_ANNUAL }
});

export default async function handler(req, res) {
    if (blockOutsideOpsInReadOnlyMode(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (process.env.STRIPE_BILLING_MODE !== 'test' || process.env.STRIPE_BILLING_ENABLED !== 'true') {
        return res.status(503).json({ error: 'El webhook Stripe sandbox no está habilitado.' });
    }
    try {
        const rawBody = await readRawBody(req);
        const event = provider().parseWebhook({ rawBody, signature: req.headers['stripe-signature'], webhookSecret: process.env.STRIPE_WEBHOOK_SECRET });
        const type = stripeWebhookType(event);
        if (!type) return res.status(200).json({ ok: true, ignored: true });

        let stripeSubscription = event.data.object?.object === 'subscription' ? event.data.object : null;
        let subscriptionId = stripeSubscriptionId(event, stripeSubscription);
        if (!subscriptionId && (type === 'refund_created' || type === 'refund_completed') && event.data.object?.payment_intent) {
            const paymentIntent = await provider().getPaymentIntent({ paymentIntentId: event.data.object.payment_intent });
            if (paymentIntent.invoice) {
                const invoice = await provider().getInvoice({ invoiceId: paymentIntent.invoice });
                subscriptionId = invoice.subscription || null;
            }
        }
        if (!stripeSubscription && subscriptionId && type !== 'subscription_cancelled') {
            stripeSubscription = await provider().getSubscription({ providerSubscriptionId: subscriptionId });
        }
        const userId = stripeUserId(event, stripeSubscription);
        if (!userId) return res.status(202).json({ ok: true, ignored: true, reason: 'missing_money_tips_user_id' });

        const db = getAdminDb();
        const entitlementRef = db.collection('users').doc(userId).collection('entitlements').doc('subscription');
        const eventRecord = buildBillingEvent({
            provider: 'stripe', providerEventId: event.id, userId,
            subscriptionId: subscriptionId || `checkout:${event.data.object.id}`,
            type, timestamp: new Date(event.created * 1000),
            payload: { stripeType: event.type, objectId: event.data.object.id, subscriptionId }
        });
        const outcome = await db.runTransaction(async (transaction) => {
            const ledgerRef = db.collection('billingEvents').doc(eventRecord.eventId);
            const previousEvent = await transaction.get(ledgerRef);
            if (previousEvent.exists) return { duplicate: true };
            const entitlementSnapshot = await transaction.get(entitlementRef);
            const existing = entitlementSnapshot.exists ? entitlementSnapshot.data() : null;
            const updated = applyStripeWebhookToEntitlement({
                existing, event, stripeSubscription,
                priceIds: { monthly: process.env.STRIPE_PRICE_MONTHLY, annual: process.env.STRIPE_PRICE_ANNUAL },
                userId, now: new Date()
            });
            if (updated) transaction.set(entitlementRef, updated, { merge: true });
            transaction.create(ledgerRef, { ...eventRecord, processedAt: new Date(), processingResult: 'applied' });
            return { duplicate: false };
        });
        return res.status(200).json({ ok: true, duplicate: outcome.duplicate });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Webhook Stripe no válido.' });
    }
}
