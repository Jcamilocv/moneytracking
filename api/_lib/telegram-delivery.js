// Telegram sendMessage has no idempotency key. Once an attempt is durably
// claimed, a crash or network error is ambiguous: automatic retries must stop
// until an operator reconciles the channel message and its anchor.
export const deliverTelegramAtMostOnce = async ({ claim, send, anchor, markUncertain, markNotConfigured }) => {
    const claimed = await claim();
    if (claimed !== true) return { status: claimed?.status === 'anchored' ? 'anchored' : 'review_required' };
    let result;
    try { result = await send(); }
    catch {
        await markUncertain('send_result_unknown');
        return { status: 'review_required' };
    }
    if (!result?.configured) {
        await markNotConfigured();
        return { status: 'not_configured' };
    }
    try {
        await anchor(result);
        return { status: 'anchored', messageId: result.messageId };
    } catch {
        await markUncertain('send_succeeded_anchor_unknown');
        return { status: 'review_required' };
    }
};

export const deliverOfficialPickTelegramOnce = ({ db, pickRef, pick, send, allowFreshClaim = false }) => {
    const telegramAnchorRef = pickRef.collection('events').doc('telegram_anchor');
    const deliveryRef = pickRef.collection('events').doc('telegram_delivery');
    return deliverTelegramAtMostOnce({
        claim: () => db.runTransaction(async (transaction) => {
            const [anchor, delivery] = await Promise.all([
                transaction.get(telegramAnchorRef), transaction.get(deliveryRef)
            ]);
            if (anchor.exists) return { status: 'anchored' };
            if (delivery.exists && delivery.data().status !== 'not_configured') return { status: delivery.data().status };
            // A legacy pick with no anchor and no delivery record may already
            // have been sent before this outbox existed. Never guess.
            if (!delivery.exists && !allowFreshClaim) return { status: 'legacy_unknown' };
            transaction.set(deliveryRef, {
                type: 'telegram_delivery', status: 'claimed',
                attemptId: `${pick.id}:1`, updatedAt: FieldValue.serverTimestamp()
            });
            return true;
        }),
        send: () => send(pick),
        anchor: (telegram) => db.runTransaction(async (transaction) => {
            const existing = await transaction.get(telegramAnchorRef);
            if (existing.exists) return;
            transaction.set(telegramAnchorRef, {
                type: 'telegram_anchor', chatId: telegram.chatId,
                messageId: telegram.messageId, permalink: telegram.permalink,
                createdAt: FieldValue.serverTimestamp()
            });
            transaction.update(deliveryRef, {
                status: 'anchored', updatedAt: FieldValue.serverTimestamp()
            });
        }),
        markUncertain: (reason) => deliveryRef.update({
            status: 'uncertain', reason, updatedAt: FieldValue.serverTimestamp()
        }),
        markNotConfigured: () => deliveryRef.update({
            status: 'not_configured', updatedAt: FieldValue.serverTimestamp()
        })
    });
};
import { FieldValue } from 'firebase-admin/firestore';
