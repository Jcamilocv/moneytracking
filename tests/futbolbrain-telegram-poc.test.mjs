import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SYSTEM_REGISTRY,
    SYSTEM_EXECUTION_MODES,
    SYSTEM_TIERS,
    getSystemDefinition
} from '../server/system-registry.js';

import {
    FutbolBrainMtprotoClient,
    classifyTelegramMessage,
    MESSAGE_TYPES,
    normalizeFutbolBrainTelegramPick,
    normalizeSelection,
    normalizeMarket,
    extractKickoff,
    extractProbability,
    parseMadridDateTimeToUTC,
    parseMyPicksSummary,
    TelegramDeduplicationLedger,
    TelegramPocRouter
} from '../server/futbolbrain-telegram-poc/index.js';

import { createReadOnlyClientProxy, ReadOnlyViolationError } from '../server/futbolbrain-telegram-poc/read-only-guard.js';
import { redactSecrets, redactSecretString } from '../server/futbolbrain-telegram-poc/secrets-redaction.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. PORTFOLIO & SYSTEM REGISTRY RECOGNITION (9 SYSTEMS)
// ─────────────────────────────────────────────────────────────────────────────

test('Portfolio Recognition: Exactly 9 systems defined with strict execution modes and timing', () => {
    const allSystems = Object.keys(SYSTEM_REGISTRY);
    assert.equal(allSystems.length, 9, 'Debe haber exactamente 9 sistemas en el registro maestro');

    const productionSystems = allSystems.filter(s => SYSTEM_REGISTRY[s].tier === SYSTEM_TIERS.PUBLICAR_CONTROLADO);
    const paperSystems = allSystems.filter(s => SYSTEM_REGISTRY[s].tier === SYSTEM_TIERS.OBSERVACION_PAPER);

    assert.equal(productionSystems.length, 6, 'Debe haber exactamente 6 sistemas de PRODUCCIÓN');
    assert.equal(paperSystems.length, 3, 'Debe haber exactamente 3 sistemas PAPER');

    // T-5 Systems
    const prodT5 = productionSystems.filter(s => SYSTEM_REGISTRY[s].requiresT5);
    const paperT5 = paperSystems.filter(s => SYSTEM_REGISTRY[s].requiresT5);

    assert.equal(prodT5.length, 2, 'Debe haber exactamente 2 sistemas de PRODUCCIÓN T-5');
    assert.deepEqual(prodT5.sort(), ['MT - FRA1 FRA2 - V1.0', 'MT-LAB-BTTS-ESP-v0.1'].sort());

    assert.equal(paperT5.length, 2, 'Debe haber exactamente 2 sistemas PAPER T-5');
    assert.deepEqual(paperT5.sort(), ['MT - GER1 - v1.1', 'MT - TUR1 - V1.0'].sort());

    // Morning / Non-T5 Systems
    const prodMorning = productionSystems.filter(s => !SYSTEM_REGISTRY[s].requiresT5);
    const paperMorning = paperSystems.filter(s => !SYSTEM_REGISTRY[s].requiresT5);

    assert.equal(prodMorning.length, 4, 'Debe haber exactamente 4 sistemas de PRODUCCIÓN Morning (sin T-5)');
    assert.deepEqual(prodMorning.sort(), [
        'MT - CHA EUR - V1.0',
        'MT - ENG2 - v1.0',
        'MT - ITA1 - V1.0',
        'MT - Premier League 02.5'
    ].sort());

    assert.equal(paperMorning.length, 1, 'Debe haber exactamente 1 sistema PAPER Morning (sin T-5)');
    assert.deepEqual(paperMorning, ['MT - POR1 - v1.0']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. MESSAGE CLASSIFIER & ORIGIN FILTERING
// ─────────────────────────────────────────────────────────────────────────────

test('Message Classifier: Categorizes ACTIVE_PICK, MY_PICKS_SUMMARY, and IGNORED_EXTERNAL correctly', () => {
    const expectedChatId = '-100987654321';

    // Active Pick
    const activeMsg = `⚽ ACTIVE PICK ⚽\nSistema: MT - FRA1 FRA2 - V1.0\nPartido: Lyon vs Rennes\nCuota: 1.85`;
    const resActive = classifyTelegramMessage({ text: activeMsg, chatId: expectedChatId, expectedChatId });
    assert.equal(resActive.type, MESSAGE_TYPES.ACTIVE_PICK);

    // My Picks Summary
    const summaryMsg = `📊 My Picks (23)\nMT-LAB-BTTS-ESP-v0.1: 4\nMT - FRA1 FRA2 - V1.0: 2`;
    const resSummary = classifyTelegramMessage({ text: summaryMsg, chatId: expectedChatId, expectedChatId });
    assert.equal(resSummary.type, MESSAGE_TYPES.MY_PICKS_SUMMARY);

    // External chat message
    const resExternal = classifyTelegramMessage({ text: activeMsg, chatId: '-100111111111', expectedChatId });
    assert.equal(resExternal.type, MESSAGE_TYPES.IGNORED_EXTERNAL);
    assert.ok(resExternal.reason.includes('does not match'));

    // Unknown format
    const resUnknown = classifyTelegramMessage({ text: 'Hola a todos los miembros', chatId: expectedChatId, expectedChatId });
    assert.equal(resUnknown.type, MESSAGE_TYPES.UNKNOWN);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CANONICAL NORMALIZATION & EVENT SCHEMA (REQUIREMENT 5)
// ─────────────────────────────────────────────────────────────────────────────

test('Canonical Normalizer: Normalizes selection aliases (Yes / BTTS Yes / Sí / Si -> Sí)', () => {
    assert.equal(normalizeSelection('Yes'), 'Sí');
    assert.equal(normalizeSelection('BTTS Yes'), 'Sí');
    assert.equal(normalizeSelection('Sí'), 'Sí');
    assert.equal(normalizeSelection('Si'), 'Sí');
    assert.equal(normalizeSelection('No'), 'No');
    assert.equal(normalizeSelection('BTTS No'), 'No');
});

test('Canonical Normalizer: Normalizes Over/Under and 1X2 aliases', () => {
    // Over 2.5
    assert.equal(normalizeSelection('Over 2.5'), 'Más de 2,5 goles');
    assert.equal(normalizeSelection('O 2.5 FT'), 'Más de 2,5 goles');
    assert.equal(normalizeSelection('Más de 2.5'), 'Más de 2,5 goles');
    assert.equal(normalizeSelection('Over 2,5'), 'Más de 2,5 goles');

    // Over 3.5
    assert.equal(normalizeSelection('Over 3.5'), 'Más de 3,5 goles');
    assert.equal(normalizeSelection('O 3.5 FT'), 'Más de 3,5 goles');
    assert.equal(normalizeSelection('Más de 3.5'), 'Más de 3,5 goles');

    // Under 3.5
    assert.equal(normalizeSelection('Under 3.5'), 'Menos de 3,5 goles');
    assert.equal(normalizeSelection('U 3.5 FT'), 'Menos de 3,5 goles');

    // 1X2
    assert.equal(normalizeSelection('Team 2 (FT)'), 'Visitante');
    assert.equal(normalizeSelection('2'), 'Visitante');
    assert.equal(normalizeSelection('Away FT'), 'Visitante');
    assert.equal(normalizeSelection('Team 1 (FT)'), 'Local');
    assert.equal(normalizeSelection('1'), 'Local');
    assert.equal(normalizeSelection('Home FT'), 'Local');
});

test('Canonical Normalizer: Handles decimal commas (1,85 -> 1.85) and constructs canonical event', () => {
    const rawAlert = `⚽ ACTIVE PICK ⚽
Sistema: MT - FRA1 FRA2 - V1.0
Partido: Toulouse vs Le Havre
Liga: FRA-Ligue 1
Mercado: Total de goles
Selección: Over 2,5
Cuota: 1,92
Hora: 2026-09-20 20:45`;

    const normalized = normalizeFutbolBrainTelegramPick(rawAlert, {
        telegramMessageId: 1042,
        observedAt: '2026-09-20T18:40:00.000Z'
    });

    assert.equal(normalized.source, 'FUTBOLBRAIN_TELEGRAM');
    assert.equal(normalized.systemId, 'MT - FRA1 FRA2 - V1.0');
    assert.equal(normalized.executionMode, 'PRODUCTION');
    assert.equal(normalized.event, 'Toulouse vs Le Havre');
    assert.equal(normalized.competition, 'FRA-Ligue 1');
    assert.equal(normalized.homeTeam, 'Toulouse');
    assert.equal(normalized.awayTeam, 'Le Havre');
    assert.equal(normalized.market, 'Total de goles');
    assert.equal(normalized.selection, 'Más de 2,5 goles');
    assert.equal(normalized.odds, 1.92);
    // 20:45 Europe/Madrid en verano (CEST = UTC+2) corresponde exactamente a las 18:45:00 UTC
    assert.equal(normalized.kickoffAt, '2026-09-20T18:45:00.000Z');
    assert.equal(normalized.telegramMessageId, '1042');
    assert.equal(normalized.eligibility, 'ELIGIBLE');
    assert.ok(typeof normalized.fingerprint === 'string' && normalized.fingerprint.length === 64);
});

test('Canonical Normalizer: Sets null for missing fields without inventing data', () => {
    const rawAlertMinimal = `⚽ ACTIVE PICK ⚽
Sistema: MT-LAB-BTTS-ESP-v0.1
Partido: Sevilla vs Barcelona
Selección: Yes`;

    const normalized = normalizeFutbolBrainTelegramPick(rawAlertMinimal, {
        telegramMessageId: null,
        observedAt: '2026-09-20T18:55:00.000Z'
    });

    assert.equal(normalized.systemId, 'MT-LAB-BTTS-ESP-v0.1');
    assert.equal(normalized.selection, 'Sí');
    assert.equal(normalized.odds, null, 'Odds debe ser null si no está en el mensaje');
    assert.equal(normalized.probability, null, 'Probability debe ser null si no está en el mensaje');
    assert.equal(normalized.kickoffAt, null, 'KickoffAt debe ser null si no está en el mensaje');
    assert.equal(normalized.telegramMessageId, null);
    assert.equal(normalized.eligibility, 'ELIGIBLE');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IDEMPOTENCY & DEDUPLICATION (FINGERPRINT SOURCE-AGNOSTIC)
// ─────────────────────────────────────────────────────────────────────────────

test('Idempotency: Identical pick with cosmetic text variations produces IDENTICAL fingerprint', () => {
    const alert1 = `⚽ ACTIVE PICK ⚽
Sistema: MT-LAB-BTTS-ESP-v0.1
Partido: Sevilla vs Barcelona
Selección: Yes
Cuota: 1.80
Hora: 2026-09-20 21:00`;

    const alert2 = `⚽ ACTIVE PICK ⚽
Sistema: MT-LAB-BTTS-ESP-v0.1
Partido: Sevilla vs Barcelona
Selección: BTTS Yes
Cuota: 1.80
Hora: 2026-09-20 21:00`;

    const norm1 = normalizeFutbolBrainTelegramPick(alert1);
    const norm2 = normalizeFutbolBrainTelegramPick(alert2);

    assert.equal(norm1.selection, 'Sí');
    assert.equal(norm2.selection, 'Sí');
    assert.equal(norm1.fingerprint, norm2.fingerprint, 'Ambos deben generar exactamente el mismo fingerprint canónico');
});

test('Idempotency & Deduplication: Second reception returns DUPLICATE', async () => {
    const ledger = new TelegramDeduplicationLedger();
    const router = new TelegramPocRouter({ dedupLedger: ledger, dryRun: true });

    const alertText = `⚽ ACTIVE PICK ⚽
Sistema: MT - FRA1 FRA2 - V1.0
Partido: Lyon vs Rennes
Selección: Over 2.5
Cuota: 1.85
Hora: 2026-09-20 20:45`;

    // Primera recepción
    const res1 = await router.processMessage({
        text: alertText,
        telegramMessageId: 2001
    });
    assert.equal(res1.action, 'WOULD_PUBLISH');
    assert.equal(res1.eligibility, 'ELIGIBLE');

    // Segunda recepción (mismo mensaje)
    const res2 = await router.processMessage({
        text: alertText,
        telegramMessageId: 2001
    });
    assert.equal(res2.action, 'DUPLICATE');
    assert.equal(res2.reason, 'DUPLICATE_MESSAGE_ID');

    // Tercera recepción (distinto messageId pero mismo evento deportivo / replay)
    const res3 = await router.processMessage({
        text: alertText,
        telegramMessageId: 2002
    });
    assert.equal(res3.action, 'DUPLICATE');
    assert.equal(res3.reason, 'DUPLICATE_SPORTING_FINGERPRINT');
});

test('Idempotency: Multiple distinct picks in the same minute are both processed', async () => {
    const ledger = new TelegramDeduplicationLedger();
    const router = new TelegramPocRouter({ dedupLedger: ledger, dryRun: true });

    const pickLyon = `⚽ ACTIVE PICK ⚽
Sistema: MT - FRA1 FRA2 - V1.0
Partido: Lyon vs Rennes
Selección: Over 2.5
Hora: 2026-09-20 20:45`;

    const pickToulouse = `⚽ ACTIVE PICK ⚽
Sistema: MT - FRA1 FRA2 - V1.0
Partido: Toulouse vs Le Havre
Selección: Over 2.5
Hora: 2026-09-20 20:45`;

    const res1 = await router.processMessage({ text: pickLyon, telegramMessageId: 3001 });
    const res2 = await router.processMessage({ text: pickToulouse, telegramMessageId: 3002 });

    assert.equal(res1.action, 'WOULD_PUBLISH');
    assert.equal(res2.action, 'WOULD_PUBLISH');
    assert.notEqual(res1.candidate.fingerprint, res2.candidate.fingerprint);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ROUTING: PRODUCTION T-5, PAPER T-5, MORNING EXCLUSIONS
// ─────────────────────────────────────────────────────────────────────────────

test('Routing: FRA Production T-5 -> WOULD_PUBLISH (dry-run, 0 Firestore writes, 0 Telegram messages)', async () => {
    const router = new TelegramPocRouter({ dedupLedger: new TelegramDeduplicationLedger(), dryRun: true });
    const text = `⚽ ACTIVE PICK ⚽
Sistema: MT - FRA1 FRA2 - V1.0
Partido: Lyon vs Rennes
Selección: Over 2.5
Cuota: 1.85`;

    const res = await router.processMessage({ text, telegramMessageId: 4001 });
    assert.equal(res.action, 'WOULD_PUBLISH');
    assert.equal(res.candidate.systemId, 'MT - FRA1 FRA2 - V1.0');
    assert.equal(res.candidate.executionMode, 'PRODUCTION');
    assert.equal(res.candidate.eligibility, 'ELIGIBLE');
    assert.equal(res.safety.externalFirestoreWrites, 0);
    assert.equal(res.safety.outboundTelegramMessages, 0);
    assert.equal(res.safety.productionMutations, 0);
});

test('Routing: ESP Production T-5 -> WOULD_PUBLISH (dry-run, 0 Firestore writes, 0 Telegram messages)', async () => {
    const router = new TelegramPocRouter({ dedupLedger: new TelegramDeduplicationLedger(), dryRun: true });
    const text = `⚽ ACTIVE PICK ⚽
Sistema: MT-LAB-BTTS-ESP-v0.1
Partido: Sevilla vs Barcelona
Selección: Sí
Cuota: 1.75`;

    const res = await router.processMessage({ text, telegramMessageId: 4002 });
    assert.equal(res.action, 'WOULD_PUBLISH');
    assert.equal(res.candidate.systemId, 'MT-LAB-BTTS-ESP-v0.1');
    assert.equal(res.candidate.executionMode, 'PRODUCTION');
    assert.equal(res.candidate.eligibility, 'ELIGIBLE');
    assert.equal(res.safety.externalFirestoreWrites, 0);
    assert.equal(res.safety.outboundTelegramMessages, 0);
});

test('Routing: GER Paper T-5 -> WOULD_RECORD_PAPER (dry-run, stake 0%, 0 Firestore writes, 0 Telegram messages)', async () => {
    const router = new TelegramPocRouter({ dedupLedger: new TelegramDeduplicationLedger(), dryRun: true });
    const text = `⚽ ACTIVE PICK ⚽
Sistema: MT - GER1 - v1.1
Partido: Bayern Munich vs Dortmund
Selección: Over 3.5
Cuota: 2.10`;

    const res = await router.processMessage({ text, telegramMessageId: 5001 });
    assert.equal(res.action, 'WOULD_RECORD_PAPER');
    assert.equal(res.candidate.systemId, 'MT - GER1 - v1.1');
    assert.equal(res.candidate.executionMode, 'PAPER');
    assert.equal(res.candidate.eligibility, 'ELIGIBLE');
    assert.equal(res.stake, 0, 'Sistemas PAPER tienen stake 0%');
    assert.equal(res.safety.externalFirestoreWrites, 0);
    assert.equal(res.safety.outboundTelegramMessages, 0);
});

test('Routing: TUR Paper T-5 -> WOULD_RECORD_PAPER (dry-run, stake 0%, 0 Firestore writes, 0 Telegram messages)', async () => {
    const router = new TelegramPocRouter({ dedupLedger: new TelegramDeduplicationLedger(), dryRun: true });
    const text = `⚽ ACTIVE PICK ⚽
Sistema: MT - TUR1 - V1.0
Partido: Galatasaray vs Besiktas
Selección: Team 2 (FT)
Cuota: 2.40`;

    const res = await router.processMessage({ text, telegramMessageId: 5002 });
    assert.equal(res.action, 'WOULD_RECORD_PAPER');
    assert.equal(res.candidate.systemId, 'MT - TUR1 - V1.0');
    assert.equal(res.candidate.executionMode, 'PAPER');
    assert.equal(res.candidate.selection, 'Visitante');
    assert.equal(res.candidate.eligibility, 'ELIGIBLE');
    assert.equal(res.stake, 0);
    assert.equal(res.safety.externalFirestoreWrites, 0);
    assert.equal(res.safety.outboundTelegramMessages, 0);
});

test('Routing: POR Paper Morning (Non-T5) -> Recognized in Registry, EXCLUDED from T-5 MTProto listener', async () => {
    const router = new TelegramPocRouter({ dedupLedger: new TelegramDeduplicationLedger(), dryRun: true });
    const text = `⚽ ACTIVE PICK ⚽
Sistema: MT - POR1 - v1.0
Partido: Benfica vs Porto
Selección: Team 1 (FT)`;

    const res = await router.processMessage({ text, telegramMessageId: 6001 });
    assert.equal(res.action, 'EXCLUDED_NON_T5_LISTENER');
    assert.equal(res.systemId, 'MT - POR1 - v1.0');
    assert.equal(res.executionMode, 'PAPER');
    assert.equal(res.timing, 'MORNING');
    assert.equal(res.requiresT5, false);
});

test('Routing: Production Morning systems (ENG2, etc.) -> EXCLUDED from T-5 MTProto listener', async () => {
    const router = new TelegramPocRouter({ dedupLedger: new TelegramDeduplicationLedger(), dryRun: true });
    const text = `⚽ ACTIVE PICK ⚽
Sistema: MT - ENG2 - v1.0
Partido: Norwich vs Birmingham
Selección: 2`;

    const res = await router.processMessage({ text, telegramMessageId: 6002 });
    assert.equal(res.action, 'EXCLUDED_NON_T5_LISTENER');
    assert.equal(res.systemId, 'MT - ENG2 - v1.0');
    assert.equal(res.executionMode, 'PRODUCTION');
    assert.equal(res.timing, 'MORNING');
    assert.equal(res.requiresT5, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MY PICKS SUMMARY PARSER (OBSERVABILITY & RECONCILIATION)
// ─────────────────────────────────────────────────────────────────────────────

test('My Picks Parser: Extracts totalPicks, system breakdowns, and NEVER alters candidate eligibility', async () => {
    const rawMyPicks = `📊 My Picks (23)
MT-LAB-BTTS-ESP-v0.1: 4
MT - FRA1 FRA2 - V1.0: 2
MT - GER1 - v1.1: 1
MT - TUR1 - V1.0: 3`;

    const parsed = parseMyPicksSummary(rawMyPicks, { observedAt: '2026-09-20T12:00:00.000Z' });

    assert.equal(parsed.source, 'FUTBOLBRAIN_TELEGRAM');
    assert.equal(parsed.type, 'MY_PICKS_SUMMARY');
    assert.equal(parsed.totalPicks, 23);
    assert.equal(parsed.systems.length, 4);

    assert.deepEqual(parsed.systems[0], { systemId: 'MT-LAB-BTTS-ESP-v0.1', upcomingPickCount: 4 });
    assert.deepEqual(parsed.systems[1], { systemId: 'MT - FRA1 FRA2 - V1.0', upcomingPickCount: 2 });
    assert.deepEqual(parsed.systems[2], { systemId: 'MT - GER1 - v1.1', upcomingPickCount: 1 });
    assert.deepEqual(parsed.systems[3], { systemId: 'MT - TUR1 - V1.0', upcomingPickCount: 3 });

    // Verificar en el router
    const router = new TelegramPocRouter({ dryRun: true });
    const routerRes = await router.processMessage({ text: rawMyPicks });

    assert.equal(routerRes.action, 'MY_PICKS_PROCESSED');
    assert.equal(routerRes.eligibilityModified, false, 'My Picks NUNCA modifica la elegibilidad');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MTPROTO CLIENT ADAPTER, SENDER FILTERING & MESSAGE EDITS / DELETIONS
// ─────────────────────────────────────────────────────────────────────────────

test('MTProto Client: Filters messages from external chats and handles simulated events', async () => {
    const officialChatId = '-100999888777';
    const client = new FutbolBrainMtprotoClient({
        chatId: officialChatId,
        isMock: true
    });
    await client.start();

    const receivedMessages = [];
    const ignoredMessages = [];

    client.on('message', (msg) => receivedMessages.push(msg));
    client.on('external_message_ignored', (msg) => ignoredMessages.push(msg));

    // Mensaje desde chat oficial
    client.simulateIncomingMessage({
        id: 7001,
        text: '⚽ ACTIVE PICK ⚽\nSistema: MT - FRA1 FRA2 - V1.0\nPartido: Lyon vs Rennes',
        chatId: officialChatId
    });

    // Mensaje desde chat externo
    client.simulateIncomingMessage({
        id: 7002,
        text: 'Alerta desde grupo de amigos',
        chatId: '-100123456789'
    });

    assert.equal(receivedMessages.length, 1);
    assert.equal(receivedMessages[0].messageId, 7001);

    assert.equal(ignoredMessages.length, 1);
    assert.equal(ignoredMessages[0].messageId, 7002);
    assert.equal(ignoredMessages[0].reason, 'Chat no autorizado');

    await client.stop();
});

test('MTProto Client: MessageEdited and MessageDeleted are logged for audit with ZERO business mutations', async () => {
    const client = new FutbolBrainMtprotoClient({ isMock: true });
    await client.start();

    let editAuditFired = false;
    let deleteAuditFired = false;

    client.on('message_edited_audit', (audit) => {
        editAuditFired = true;
        assert.equal(audit.type, 'TELEGRAM_MESSAGE_EDITED_AUDIT');
        assert.equal(audit.policyApplied, 'NO_BUSINESS_MUTATION_ON_EDIT');
    });

    client.on('message_deleted_audit', (audit) => {
        deleteAuditFired = true;
        assert.equal(audit.type, 'TELEGRAM_MESSAGE_DELETED_AUDIT');
        assert.equal(audit.policyApplied, 'NO_BUSINESS_MUTATION_ON_DELETE');
    });

    client.simulateMessageEdited({ id: 8001, text: 'Texto editado' });
    client.simulateMessageDeleted({ ids: [8001] });

    assert.ok(editAuditFired, 'Debe emitir evento de auditoría en edición');
    assert.ok(deleteAuditFired, 'Debe emitir evento de auditoría en eliminación');
    assert.equal(client.auditLog.length, 2);

    await client.stop();
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. TOTAL ISOLATION & DRY-RUN SAFETY VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

test('Total Isolation & Dry-Run Safety: 0 Firestore writes, 0 outbound Telegram messages, 0 production mutations', async () => {
    const router = new TelegramPocRouter({ dryRun: true });

    // Procesar varios mensajes variados
    await router.processMessage({
        text: '⚽ ACTIVE PICK ⚽\nSistema: MT - FRA1 FRA2 - V1.0\nPartido: Lyon vs Rennes\nSelección: Over 2.5',
        telegramMessageId: 9001
    });

    await router.processMessage({
        text: '⚽ ACTIVE PICK ⚽\nSistema: MT - GER1 - v1.1\nPartido: Bayern vs Dortmund\nSelección: Over 3.5',
        telegramMessageId: 9002
    });

    await router.processMessage({
        text: '📊 My Picks (23)\nMT - FRA1 FRA2 - V1.0: 2',
        telegramMessageId: 9003
    });

    const report = router._getSafetyReport();
    assert.equal(report.externalFirestoreWrites, 0, 'Firestore writes DEBE ser 0');
    assert.equal(report.outboundTelegramMessages, 0, 'Outbound Telegram messages DEBE ser 0');
    assert.equal(report.productionMutations, 0, 'Production mutations DEBE ser 0');
    assert.equal(report.dryRunActive, true, 'dryRun DEBE estar activo');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. HARDENING & CRITICAL TIMEZONE AUDIT (P0.1)
// ─────────────────────────────────────────────────────────────────────────────

test('GRAMJS IMPORT TEST: GramJS imports and exports TelegramClient, StringSession, NewMessage without error', async () => {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions/index.js');
    const { NewMessage } = await import('telegram/events/index.js');

    assert.equal(typeof TelegramClient, 'function', 'TelegramClient debe ser una función/constructor');
    assert.equal(typeof StringSession, 'function', 'StringSession debe ser una función/constructor');
    assert.equal(typeof NewMessage, 'function', 'NewMessage debe ser una función/constructor');
});

test('TIMEZONE SUMMER TEST: 20:45 Europe/Madrid in CEST (UTC+2) converts to 18:45:00.000Z', () => {
    const summerDate = parseMadridDateTimeToUTC('2026-09-20 20:45');
    assert.equal(summerDate, '2026-09-20T18:45:00.000Z', 'En verano (CEST = UTC+2), 20:45 Madrid debe ser 18:45 UTC');
});

test('TIMEZONE WINTER TEST: 20:45 Europe/Madrid in CET (UTC+1) converts to 19:45:00.000Z', () => {
    const winterDate = parseMadridDateTimeToUTC('2026-01-15 20:45');
    assert.equal(winterDate, '2026-01-15T19:45:00.000Z', 'En invierno (CET = UTC+1), 20:45 Madrid debe ser 19:45 UTC');
});

test('DST TEST: Correct transition across autumn and spring clock shifts', () => {
    // Otoño: 24/10/2026 (CEST = UTC+2) vs 25/10/2026 (CET = UTC+1 tras cambio de hora)
    const beforeAutumn = parseMadridDateTimeToUTC('2026-10-24 20:00');
    const afterAutumn = parseMadridDateTimeToUTC('2026-10-25 20:00');
    assert.equal(beforeAutumn, '2026-10-24T18:00:00.000Z', 'Día previo a cambio de otoño: 20:00 CEST = 18:00 UTC');
    assert.equal(afterAutumn, '2026-10-25T19:00:00.000Z', 'Día de cambio de otoño: 20:00 CET = 19:00 UTC');

    // Primavera: 28/03/2026 (CET = UTC+1) vs 29/03/2026 (CEST = UTC+2 tras cambio de hora)
    const beforeSpring = parseMadridDateTimeToUTC('2026-03-28 20:00');
    const afterSpring = parseMadridDateTimeToUTC('2026-03-29 20:00');
    assert.equal(beforeSpring, '2026-03-28T19:00:00.000Z', 'Día previo a cambio de primavera: 20:00 CET = 19:00 UTC');
    assert.equal(afterSpring, '2026-03-29T18:00:00.000Z', 'Día de cambio de primavera: 20:00 CEST = 18:00 UTC');
});

test('EXPLICIT OFFSET TEST: Timestamps with explicit offsets are respected without double conversion', () => {
    const isoUtc = parseMadridDateTimeToUTC('2026-09-20T18:45:00.000Z');
    const isoOffsetPlus2 = parseMadridDateTimeToUTC('2026-09-20T20:45:00+02:00');
    const isoOffsetPlus0 = parseMadridDateTimeToUTC('2026-09-20T18:45:00+00:00');

    assert.equal(isoUtc, '2026-09-20T18:45:00.000Z');
    assert.equal(isoOffsetPlus2, '2026-09-20T18:45:00.000Z');
    assert.equal(isoOffsetPlus0, '2026-09-20T18:45:00.000Z');
});

test('SERVER-TIMEZONE-INDEPENDENCE TEST: Parsing is deterministic and does not rely on host local timezone', () => {
    const result1 = parseMadridDateTimeToUTC('2026-09-20 20:45');
    const result2 = parseMadridDateTimeToUTC('2026-01-15 20:45');

    assert.equal(result1, '2026-09-20T18:45:00.000Z');
    assert.equal(result2, '2026-01-15T19:45:00.000Z');
});

test('READ-ONLY GUARANTEE TEST: Client proxy blocks all mutating operations (sendMessage, edit, delete, join)', () => {
    const dummyClient = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        getDialogs: () => Promise.resolve([]),
        sendMessage: () => Promise.resolve('sent'),
        deleteMessages: () => Promise.resolve('deleted'),
        editMessage: () => Promise.resolve('edited'),
        joinChannel: () => Promise.resolve('joined')
    };

    const readOnlyClient = createReadOnlyClientProxy(dummyClient);

    // Métodos permitidos
    assert.doesNotThrow(() => readOnlyClient.connect());
    assert.doesNotThrow(() => readOnlyClient.getDialogs());

    // Métodos mutantes prohibidos DEBEN lanzar ReadOnlyViolationError
    assert.throws(() => readOnlyClient.sendMessage(), /READ_ONLY_VIOLATION.*sendMessage/);
    assert.throws(() => readOnlyClient.deleteMessages(), /READ_ONLY_VIOLATION.*deleteMessages/);
    assert.throws(() => readOnlyClient.editMessage(), /READ_ONLY_VIOLATION.*editMessage/);
    assert.throws(() => readOnlyClient.joinChannel(), /READ_ONLY_VIOLATION.*joinChannel/);
});

test('SECRET LEAK TEST: Redacts StringSession, API Hash, phone numbers, and OTPs in logs and audit', () => {
    const rawSensitiveData = {
        session: '1BQAAAAEAAAABAAAA...1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
        apiHash: '0123456789abcdef0123456789abcdef',
        phone: '+34600112233',
        otpCode: '12345',
        nested: {
            token: 'secret_token_value',
            normalField: 'Lyon vs Marseille'
        }
    };

    const redacted = redactSecrets(rawSensitiveData);

    assert.equal(redacted.session, '[REDACTED_CREDENTIAL]');
    assert.equal(redacted.apiHash, '[REDACTED_CREDENTIAL]');
    assert.equal(redacted.otpCode, '[REDACTED_CREDENTIAL]');
    assert.equal(redacted.nested.token, '[REDACTED_CREDENTIAL]');
    assert.equal(redacted.nested.normalField, 'Lyon vs Marseille');

    const logText = 'Error connecting with session 1BQabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ and hash 0123456789abcdef0123456789abcdef with code: 12345';
    const redactedText = redactSecretString(logText);

    assert.ok(!redactedText.includes('1BQabcdef'));
    assert.ok(!redactedText.includes('0123456789abcdef0123456789abcdef'));
    assert.ok(redactedText.includes('[REDACTED_TELEGRAM_STRING_SESSION]'));
    assert.ok(redactedText.includes('[REDACTED_TELEGRAM_API_HASH]'));
    assert.ok(redactedText.includes('[REDACTED_OTP]'));
});

test('Chat Discovery: Discovers FutbolBrain chats automatically without requiring manual ID entry', async () => {
    const client = new FutbolBrainMtprotoClient({ isMock: true });
    await client.start();

    const discovered = await client.discoverFutbolBrainChat({ query: 'futbolbrain' });
    assert.ok(Array.isArray(discovered));
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].id, '-1009876543210');
    assert.equal(discovered[0].title, 'FutbolBrain Official Alerts');
    assert.equal(discovered[0].isGroup, true);

    await client.stop();
});
