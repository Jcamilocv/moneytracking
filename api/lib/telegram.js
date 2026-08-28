const appUrl = () => (process.env.PUBLIC_APP_URL || 'https://app.pronosticosmoneytips.com').replace(/\/$/, '');

const channelLink = (messageId) => {
    const username = (process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME || '').replace(/^@/, '').trim();
    return username ? `https://t.me/${username}/${messageId}` : null;
};

export const publishOfficialPickToTelegram = async (pick) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!token || !chatId) return { configured: false };

    const kickoff = new Date(pick.event.kickoffAt).toLocaleString('es-ES', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid'
    });
    const proof = `${appUrl()}/?pick=${encodeURIComponent(pick.id)}`;
    const text = [
        '✅ PICK OFICIAL MONEY TIPS',
        '',
        `${pick.event.homeTeam} vs ${pick.event.awayTeam}`,
        `${pick.event.competition}`,
        `Mercado: ${pick.bet.market}`,
        `Selección: ${pick.bet.selection} @${Number(pick.bet.oddsAtPublication).toFixed(2)}`,
        `Inicio: ${kickoff}`,
        `Sistema: ${pick.system.id} · ${pick.system.version}`,
        '',
        `Comprobante: ${proof}`,
        `SHA-256: ${pick.source.evidenceHash}`
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
            signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error('Telegram no aceptó el mensaje.');
        return {
            configured: true,
            chatId: String(data.result.chat.id),
            messageId: data.result.message_id,
            permalink: channelLink(data.result.message_id)
        };
    } finally {
        clearTimeout(timeout);
    }
};
