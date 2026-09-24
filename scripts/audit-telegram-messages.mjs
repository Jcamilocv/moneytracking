import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FutbolBrainMtprotoClient } from '../server/futbolbrain-telegram-poc/index.js';

// Cargar .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2]?.trim() || '';
        }
    }
}

async function auditMessagesToFile() {
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    const stringSession = process.env.TELEGRAM_STRING_SESSION;
    const chatId = process.env.FUTBOLBRAIN_TELEGRAM_CHAT_ID;

    const client = new FutbolBrainMtprotoClient({
        apiId,
        apiHash,
        stringSession,
        chatId,
        isMock: false
    });

    await client.start();
    try {
        const dialogs = await client.client.getDialogs({ limit: 100 });
        const targetDialog = dialogs.find(d => String(d.id) === String(chatId) || String(d.entity?.id) === String(chatId));
        const targetEntity = targetDialog?.inputEntity || targetDialog?.entity || chatId;

        console.log(`[AUDIT] Consultando últimos 100 mensajes de FutbolBrain (ID: ${chatId})...`);
        const messages = await client.client.getMessages(targetEntity, { limit: 100 });
        console.log(`[AUDIT] ${messages.length} mensajes recuperados.`);

        const results = [];
        for (const msg of messages) {
            const text = msg.message || msg.text || '';
            const dateUTC = msg.date ? new Date(msg.date * 1000).toISOString() : null;
            const dateMadrid = msg.date ? new Date(msg.date * 1000).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : null;
            results.push({
                id: msg.id,
                dateUTC,
                dateMadrid,
                text
            });
        }

        const outPath = resolve(process.cwd(), '.telegram-audit-messages.json');
        writeFileSync(outPath, JSON.stringify(results, null, 2));
        console.log(`[AUDIT] Escritos ${results.length} mensajes en ${outPath}`);
    } finally {
        await client.stop();
    }
}

auditMessagesToFile().catch(console.error);
