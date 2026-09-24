import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

async function main() {
    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const session = new StringSession(process.env.TELEGRAM_STRING_SESSION);

    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });
    await client.connect();

    const dialogs = await client.getDialogs({ limit: 50 });

    for (const d of dialogs) {
        const title = d.title || d.name || '';
        const idStr = String(d.id || '');

        if (idStr.includes('6168168880') || title.includes('Money Tips Oficial') || title.includes('Picks & Risks')) {
            console.log(`\n======================================================`);
            console.log(`DIALOG: "${title}" (ID: ${idStr})`);
            console.log(`======================================================`);

            const messages = await client.getMessages(d.inputEntity, { limit: 15 });
            for (const m of messages) {
                const text = m.message || '';
                const date = m.date ? new Date(m.date * 1000).toISOString() : '';
                console.log(`[${date}] (Msg ${m.id}): ${text.replace(/\n+/g, ' | ').slice(0, 120)}`);
            }
        }
    }

    await client.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
