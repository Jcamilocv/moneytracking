const appUrl = () => (process.env.PUBLIC_APP_URL || 'https://app.pronosticosmoneytips.com').replace(/\/$/, '');

const telegramRequest = async ({ method, payload }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { configured: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: payload ? 'POST' : 'GET',
            headers: payload ? { 'Content-Type': 'application/json' } : undefined,
            body: payload ? JSON.stringify(payload) : undefined,
            signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(`Telegram no aceptó ${method}.`);
        return { configured: true, result: data.result };
    } finally {
        clearTimeout(timeout);
    }
};

const channelLink = (messageId) => {
    const username = (process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME || '').replace(/^@/, '').trim();
    return username ? `https://t.me/${username}/${messageId}` : null;
};

export const publishOfficialPickToTelegram = async (pick) => {
    const chatId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!chatId) return { configured: false };

    const kickoff = new Date(pick.event.kickoffAt).toLocaleString('es-ES', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid'
    });
    const proof = `${appUrl()}/?pick=${encodeURIComponent(pick.id)}`;
    const text = [
        '✅ REGISTRO OFICIAL MONEY TIPS',
        '',
        `${pick.event.homeTeam} vs ${pick.event.awayTeam}`,
        `${pick.event.competition}`,
        `Inicio: ${kickoff}`,
        'El detalle del pick está disponible para miembros Premium hasta el inicio.',
        '',
        `Comprobante: ${proof}`,
        `SHA-256: ${pick.source.evidenceHash}`
    ].join('\n');

    const telegram = await telegramRequest({
        method: 'sendMessage',
        payload: { chat_id: chatId, text, disable_web_page_preview: true }
    });
    if (!telegram.configured) return telegram;

    return {
        configured: true,
        chatId: String(telegram.result.chat.id),
        messageId: telegram.result.message_id,
        permalink: channelLink(telegram.result.message_id)
    };
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
