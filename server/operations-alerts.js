import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/lib/firebase-admin.js';
import { getTelegramUpdates, sendTelegramOperationsMessage } from '../api/lib/telegram.js';

const CONFIG_COLLECTION = 'systemConfiguration';
const CONFIG_DOCUMENT = 'telegramOperations';
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

const operationsChannelTitle = () => (process.env.TELEGRAM_OPERATIONS_CHANNEL_TITLE || 'Money Tips Ops').trim();
const asDate = (value) => value?.toDate && typeof value.toDate === 'function' ? value.toDate() : value ? new Date(value) : null;

export const matchingOperationsChannel = (updates, title = operationsChannelTitle()) => {
    const expected = title.trim().toLocaleLowerCase('es-ES');
    const candidates = updates
        .map((update) => update?.channel_post?.chat || update?.edited_channel_post?.chat)
        .filter((chat) => chat?.type === 'channel' && typeof chat.title === 'string')
        .filter((chat) => chat.title.trim().toLocaleLowerCase('es-ES') === expected);
    return candidates.at(-1) || null;
};

// This only examines Telegram's channel metadata. Message contents are neither
// stored nor logged, and the resulting chat id remains server-side in Firestore.
export const discoverOperationsTelegramChannel = async () => {
    const telegram = await getTelegramUpdates();
    if (!telegram.configured) return { configured: false, linked: false };

    const channel = matchingOperationsChannel(telegram.updates);
    if (!channel) return { configured: true, linked: false };

    const db = getAdminDb();
    const configRef = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT);
    await configRef.set({
        provider: 'telegram',
        chatId: String(channel.id),
        title: channel.title,
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { configured: true, linked: true, title: channel.title };
};

const operationsChatId = async () => {
    const config = await getAdminDb().collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT).get();
    const chatId = config.data()?.chatId;
    return typeof chatId === 'string' && chatId.trim() ? chatId : null;
};

export const notifyOperations = async ({ key, text }) => {
    const chatId = await operationsChatId();
    if (!chatId) return { configured: false, sent: false };

    const db = getAdminDb();
    const alertRef = db.collection('operationsAlerts').doc(key);
    const now = new Date();
    let claimed = false;

    await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(alertRef);
        const lastAttemptAt = asDate(existing.data()?.lastAttemptAt);
        if (lastAttemptAt && now.getTime() - lastAttemptAt.getTime() < ALERT_COOLDOWN_MS) return;

        claimed = true;
        transaction.set(alertRef, {
            key,
            lastAttemptAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (!claimed) return { configured: true, sent: false, throttled: true };

    try {
        const telegram = await sendTelegramOperationsMessage({ chatId, text });
        if (!telegram.configured) return { configured: false, sent: false };
        await alertRef.set({
            lastSentAt: FieldValue.serverTimestamp(),
            lastError: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { configured: true, sent: true };
    } catch (error) {
        await alertRef.set({
            lastError: String(error?.message || 'No se pudo enviar el aviso').slice(0, 200),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        throw error;
    }
};
