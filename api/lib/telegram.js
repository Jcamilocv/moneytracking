const appUrl = () => 'https://app.pronosticosmoneytips.com';

export class TelegramRequestError extends Error {
    constructor(definitelyNotSent = false) {
        super(definitelyNotSent ? 'TELEGRAM_REJECTED' : 'TELEGRAM_RESULT_UNKNOWN');
        this.name = 'TelegramRequestError'; this.definitelyNotSent = definitelyNotSent;
    }
}

const telegramRequest = async ({ method, payload }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { configured: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: payload ? 'POST' : 'GET',
            redirect: 'error',
            headers: payload ? { 'Content-Type': 'application/json' } : undefined,
            body: payload ? JSON.stringify(payload) : undefined,
            signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok || data?.ok !== true) {
            throw new TelegramRequestError(response.status >= 400 && response.status < 500 && data?.ok === false);
        }
        return { configured: true, result: data.result };
    } catch (error) {
        if (error instanceof TelegramRequestError) throw error;
        throw new TelegramRequestError(false);
    } finally {
        clearTimeout(timeout);
    }
};

const channelLink = (messageId) => {
    const username = (process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME || '').replace(/^@/, '').trim();
    return username ? `https://t.me/${username}/${messageId}` : null;
};

const matchesConfiguredChat = (configured, chat) => {
    if (!Number.isSafeInteger(chat?.id) || chat.id === 0) return false;
    const target = String(configured).trim();
    if (/^-?\d+$/.test(target)) return String(chat.id) === target;
    if (!/^@[a-z0-9_]+$/i.test(target) || chat.type !== 'channel') return false;
    return typeof chat.username === 'string'
        && chat.username.toLowerCase() === target.slice(1).toLowerCase();
};

export const formatOfficialTelegramMessage = () => {
    // Identical generic notice regardless of event, system or publication
    // source. No per-pick URL/reference or data can identify a Premium fixture.
    return [
        '🔒 <b>ACTUALIZACIÓN PREMIUM · MONEY TIPS</b>',
        '',
        'Consulta las actualizaciones en tu cuenta autorizada de Money TracKING.',
        '',
        `<a href="${appUrl()}">Abrir Money TracKING</a>`
    ].join('\n');
};

export const publishOfficialPickToTelegram = async (pick) => {
    const chatId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!chatId) return { configured: false };

    const telegram = await telegramRequest({
        method: 'sendMessage',
        payload: {
            chat_id: chatId,
            text: formatOfficialTelegramMessage(pick),
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }
    });
    if (!telegram.configured) return telegram;

    if (!Number.isSafeInteger(telegram.result?.message_id) || telegram.result.message_id < 1
        || !matchesConfiguredChat(chatId, telegram.result?.chat)) throw new TelegramRequestError(false);
    return {
        configured: true,
        chatId: String(telegram.result.chat.id),
        messageId: telegram.result.message_id,
        permalink: channelLink(telegram.result.message_id)
    };
};

export const editOfficialPickTelegramMessage = async (pick, anchor = {}) => {
    const chatId = String(anchor.chatId || '');
    const messageId = Number(anchor.messageId);
    if (!chatId || !Number.isInteger(messageId) || messageId < 1) {
        throw new Error('El mensaje oficial no tiene un anclaje de Telegram válido.');
    }

    const telegram = await telegramRequest({
        method: 'editMessageText',
        payload: {
            chat_id: chatId,
            message_id: messageId,
            text: formatOfficialTelegramMessage(pick),
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }
    });
    return { configured: telegram.configured, chatId, messageId };
};

// The operations channel is private and its id is never returned by public APIs.
export const sendTelegramOperationsMessage = async ({ chatId, text }) => {
    const telegram = await telegramRequest({
        method: 'sendMessage',
        payload: { chat_id: chatId, text, disable_web_page_preview: true }
    });
    if (!telegram.configured) return telegram;

    return {
        configured: true,
        chatId: String(telegram.result.chat.id),
        messageId: telegram.result.message_id
    };
};

export const getTelegramUpdates = async () => {
    const telegram = await telegramRequest({ method: 'getUpdates' });
    if (!telegram.configured) return telegram;
    return { configured: true, updates: Array.isArray(telegram.result) ? telegram.result : [] };
};
