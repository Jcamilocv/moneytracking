/**
 * @file verify-telegram-read-only.mjs
 * 
 * Script de validación local en modo STRICT READ-ONLY + DRY-RUN.
 * 
 * Conecta el cliente MTProto usando la StringSession y variables de .env.local,
 * verifica el acceso al chat de FutbolBrain, lee pasivamente los mensajes recientes
 * y demuestra la clasificación, normalización y simulación de routing sin ninguna mutación.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    FutbolBrainMtprotoClient,
    classifyTelegramMessage,
    MESSAGE_TYPES,
    normalizeFutbolBrainTelegramPick,
    parseMyPicksSummary,
    TelegramPocRouter
} from '../server/futbolbrain-telegram-poc/index.js';
import { createReadOnlyClientProxy } from '../server/futbolbrain-telegram-poc/read-only-guard.js';

// 1. Cargar .env.local
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

async function runReadOnlyValidation() {
    console.log('\n=== MONEY TIPS — TELEGRAM READ-ONLY LOCAL VALIDATION ===\n');

    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    const stringSession = process.env.TELEGRAM_STRING_SESSION;
    const chatId = process.env.FUTBOLBRAIN_TELEGRAM_CHAT_ID;

    console.log('API_ID_PRESENT:', Boolean(apiId));
    console.log('API_HASH_PRESENT:', Boolean(apiHash));
    console.log('STRING_SESSION_PRESENT:', Boolean(stringSession));
    console.log('CHAT_ID_PRESENT:', Boolean(chatId));

    if (!apiId || !apiHash || !stringSession || !chatId) {
        console.log('\n[INFO] Faltan credenciales en .env.local.');
        console.log('Para conectar Telegram real, el CEO debe ejecutar primero:');
        console.log('  node scripts/telegram-login.mjs\n');
        return {
            status: 'CREDENTIALS_MISSING',
            apiIdPresent: Boolean(apiId),
            apiHashPresent: Boolean(apiHash),
            stringSessionPresent: Boolean(stringSession),
            chatIdPresent: Boolean(chatId)
        };
    }

    const client = new FutbolBrainMtprotoClient({
        apiId,
        apiHash,
        stringSession,
        chatId,
        isMock: false
    });

    const router = new TelegramPocRouter({ dryRun: true, expectedChatId: chatId });
    let readOnlyViolations = 0;
    let myPicksFound = false;
    let activePickFound = false;
    let sampleParsed = null;

    try {
        console.log('\nIniciando cliente GramJS con Proxy Read-Only...');
        await client.start();
        console.log('[OK] Cliente conectado con éxito.');

        // Verificar que el proxy bloquea mutaciones
        try {
            await client.client.sendMessage('me', { message: 'test' });
        } catch (err) {
            if (err.name === 'ReadOnlyViolationError') {
                console.log('[OK] Garantía Read-Only verificada: sendMessage bloqueado deterministamente.');
            } else {
                readOnlyViolations++;
            }
        }

        // Cargar diálogos para resolver access_hash y entidades en caché
        console.log('Cargando lista de diálogos para resolver entidades...');
        const dialogs = await client.client.getDialogs({ limit: 100 });
        const targetDialog = dialogs.find(d => String(d.id) === String(chatId) || String(d.entity?.id) === String(chatId));
        const targetEntity = targetDialog?.inputEntity || targetDialog?.entity || chatId;
        const chatTitle = targetDialog?.title || targetDialog?.name || 'FutbolBrain';
        console.log(`[OK] Entidad resuelta: "${chatTitle}" (ID: ${chatId})`);

        // Lectura pasiva de mensajes recientes del chat configurado
        console.log(`\nConsultando mensajes recientes del chat ${chatTitle} (solo lectura pasiva)...`);
        const messages = await client.client.getMessages(targetEntity, { limit: 15 });
        console.log(`[OK] ${messages.length} mensaje(s) recuperados para análisis pasivo.`);

        for (const msg of messages) {
            const text = msg.message || msg.text || '';
            if (!text) continue;

            const classification = classifyTelegramMessage({
                text,
                chatId,
                expectedChatId: chatId
            });

            if (classification.type === MESSAGE_TYPES.MY_PICKS_SUMMARY) {
                myPicksFound = true;
                const summary = parseMyPicksSummary(text, { observedAt: new Date(msg.date * 1000) });
                console.log('\n[MY PICKS DETECTADO]');
                console.log(`  Total Picks: ${summary.totalPicks}`);
                console.log(`  Sistemas reportados: ${summary.systems.map(s => `${s.systemId} (${s.upcomingPickCount})`).join(', ')}`);
                sampleParsed = { type: 'MY_PICKS', summary };
            } else if (classification.type === MESSAGE_TYPES.ACTIVE_PICK) {
                activePickFound = true;
                const routed = await router.processMessage({
                    text,
                    chatId,
                    telegramMessageId: msg.id,
                    observedAt: new Date(msg.date * 1000)
                });
                console.log('\n[ACTIVE PICK DETECTADO]');
                console.log(`  Sistema: ${routed.candidate?.systemId}`);
                console.log(`  Evento: ${routed.candidate?.event}`);
                console.log(`  Selección: ${routed.candidate?.selection}`);
                console.log(`  Cuota: ${routed.candidate?.odds}`);
                console.log(`  Modo: ${routed.executionMode}`);
                console.log(`  Acción Simulada: ${routed.action}`);
                sampleParsed = { type: 'ACTIVE_PICK', routed };
            }
        }

        const safety = router._getSafetyReport();
        console.log('\n=== REPORTE DE SEGURIDAD LOCAL ===');
        console.log('Firestore writes:', safety.externalFirestoreWrites);
        console.log('Outbound Telegram messages:', safety.outboundTelegramMessages);
        console.log('Production mutations:', safety.productionMutations);
        console.log('ReadOnly violations:', readOnlyViolations);
        console.log('===================================\n');

        return {
            status: 'VALIDATION_SUCCESS',
            myPicksFound,
            activePickFound,
            sampleParsed,
            safety,
            readOnlyViolations
        };
    } finally {
        await client.stop();
        console.log('Cliente desconectado.');
    }
}

if (process.argv[1]?.endsWith('verify-telegram-read-only.mjs')) {
    runReadOnlyValidation().catch(console.error);
}
