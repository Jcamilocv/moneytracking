import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';

import {
    FutbolBrainTelegramWorker,
    SingleInstanceLock,
    WorkerAlreadyRunningError,
    ReconnectManager,
    HealthMonitor,
    ParserQuarantine,
    WorkerLogger,
    LOG_TAGS,
    ReplayRecovery
} from '../server/futbolbrain-telegram-worker/index.js';

import { createReadOnlyClientProxy, ReadOnlyViolationError } from '../server/futbolbrain-telegram-poc/read-only-guard.js';
import { redactSecrets, redactSecretString } from '../server/futbolbrain-telegram-poc/secrets-redaction.js';
import { parseMadridDateTimeToUTC } from '../server/futbolbrain-telegram-poc/canonical-normalizer.js';
import { MESSAGE_TYPES } from '../server/futbolbrain-telegram-poc/message-classifier.js';

const TEST_LOCK_PATH = resolve(process.cwd(), '.test-worker.lock');

function cleanupTestLock() {
    if (existsSync(TEST_LOCK_PATH)) {
        try { unlinkSync(TEST_LOCK_PATH); } catch {}
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SINGLE-INSTANCE LOCK
// ─────────────────────────────────────────────────────────────────────────────

test('SingleInstanceLock: Successfully acquires lock and creates lockfile with PID', () => {
    cleanupTestLock();
    const lock = new SingleInstanceLock({ lockPath: TEST_LOCK_PATH });
    
    assert.equal(lock.acquire(), true);
    assert.equal(existsSync(TEST_LOCK_PATH), true);
    assert.equal(lock.isAcquired(), true);

    lock.release();
    assert.equal(existsSync(TEST_LOCK_PATH), false);
    assert.equal(lock.isAcquired(), false);
});

test('SingleInstanceLock: Throws WorkerAlreadyRunningError if lock is held by running PID', () => {
    cleanupTestLock();
    const lock1 = new SingleInstanceLock({ lockPath: TEST_LOCK_PATH });
    lock1.acquire();

    const lock2 = new SingleInstanceLock({ lockPath: TEST_LOCK_PATH });
    assert.throws(() => lock2.acquire(), (err) => {
        assert.equal(err.name, 'WorkerAlreadyRunningError');
        assert.equal(err.pid, process.pid);
        return true;
    });

    lock1.release();
    cleanupTestLock();
});

test('SingleInstanceLock: Cleans up and recovers from stale lock when PID is dead', () => {
    cleanupTestLock();
    // Escribir un PID ficticio que garantizadamente no existe (ej. 9999999)
    writeFileSync(TEST_LOCK_PATH, JSON.stringify({ pid: 9999999, acquiredAt: new Date().toISOString() }));

    const lock = new SingleInstanceLock({ lockPath: TEST_LOCK_PATH });
    // Debe detectar que 9999999 no existe, eliminar el lock stale y adquirir exitosamente
    assert.doesNotThrow(() => lock.acquire());
    assert.equal(lock.isAcquired(), true);

    lock.release();
    cleanupTestLock();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RECONNECT MANAGER & EXPONENTIAL BACKOFF
// ─────────────────────────────────────────────────────────────────────────────

test('ReconnectManager: Calculates exponential backoff with 30s cap and jitter', () => {
    const rm = new ReconnectManager({
        baseDelayMs: 1000,
        factor: 2,
        maxDelayMs: 30000,
        jitterMs: 100
    });

    // Intento 1: 1000ms + [0..100]
    const d1 = rm.getNextDelay();
    assert.ok(d1 >= 1000 && d1 <= 1100, `d1 ${d1} debe estar entre 1000 y 1100`);

    // Intento 2: 2000ms + [0..100]
    const d2 = rm.getNextDelay();
    assert.ok(d2 >= 2000 && d2 <= 2100, `d2 ${d2} debe estar entre 2000 y 2100`);

    // Intento 3: 4000ms + [0..100]
    const d3 = rm.getNextDelay();
    assert.ok(d3 >= 4000 && d3 <= 4100, `d3 ${d3} debe estar entre 4000 y 4100`);

    // Intento 4: 8000ms + [0..100]
    const d4 = rm.getNextDelay();
    assert.ok(d4 >= 8000 && d4 <= 8100, `d4 ${d4} debe estar entre 8000 y 8100`);

    // Intento 5: 16000ms + [0..100]
    const d5 = rm.getNextDelay();
    assert.ok(d5 >= 16000 && d5 <= 16100, `d5 ${d5} debe estar entre 16000 y 16100`);

    // Intento 6: 32000 -> capped a 30000ms + [0..100]
    const d6 = rm.getNextDelay();
    assert.ok(d6 >= 30000 && d6 <= 30100, `d6 ${d6} debe estar entre 30000 y 30100`);

    // Intento 7+: sigue en 30000ms cap
    const d7 = rm.getNextDelay();
    assert.ok(d7 >= 30000 && d7 <= 30100, `d7 ${d7} debe estar entre 30000 y 30100`);

    // Reset tras éxito
    rm.recordSuccess();
    assert.equal(rm.getAttempts(), 0);
    assert.equal(rm.getTotalReconnects(), 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HEALTH MONITOR & STATES
// ─────────────────────────────────────────────────────────────────────────────

test('HealthMonitor: Accurately reflects HEALTHY, DEGRADED, and UNHEALTHY states', () => {
    const hm = new HealthMonitor();

    // 1. Inicialmente no conectado -> DEGRADED/UNHEALTHY
    let health = hm.getHealth();
    assert.equal(health.status, 'UNHEALTHY');

    // 2. Conectado, autenticado, chat resuelto, listener activo -> HEALTHY
    hm.recordConnected({ authenticated: true, targetChatResolved: true, listenerActive: true });
    health = hm.getHealth();
    assert.equal(health.status, 'HEALTHY');
    assert.equal(health.metrics.connected, true);
    assert.equal(health.metrics.authenticated, true);
    assert.equal(health.metrics.targetChatResolved, true);
    assert.equal(health.metrics.listenerActive, true);

    // 3. Desconexión transitoria con reconexión activa -> DEGRADED
    hm.recordDisconnected({ reconnecting: true });
    health = hm.getHealth();
    assert.equal(health.status, 'DEGRADED');

    // 4. Reconexión exitosa -> HEALTHY
    hm.recordConnected();
    health = hm.getHealth();
    assert.equal(health.status, 'HEALTHY');

    // 5. Exceso de errores de parseo -> DEGRADED
    for (let i = 0; i < 6; i++) {
        hm.recordParseError();
    }
    health = hm.getHealth();
    assert.equal(health.status, 'DEGRADED');

    // 6. Error fatal -> UNHEALTHY
    hm.setFatalError(new Error('Auth failed'));
    health = hm.getHealth();
    assert.equal(health.status, 'UNHEALTHY');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PARSER ERROR QUARANTINE
// ─────────────────────────────────────────────────────────────────────────────

test('ParserQuarantine: Stores unparseable messages as PARSE_REVIEW_REQUIRED with secret redaction', () => {
    const quarantine = new ParserQuarantine();

    const sensitiveMessage = 'AI Model Error with session 1BQabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ and hash 0123456789abcdef0123456789abcdef';
    const entry = quarantine.quarantineMessage({
        messageId: '9901',
        text: sensitiveMessage,
        classification: 'UNKNOWN',
        reason: 'Malformed alert structure',
        timestamp: new Date()
    });

    assert.equal(entry.type, 'PARSE_REVIEW_REQUIRED');
    assert.equal(entry.messageId, '9901');
    assert.equal(entry.reason, 'Malformed alert structure');
    assert.ok(!entry.redactedText.includes('1BQabcdef'));
    assert.ok(!entry.redactedText.includes('0123456789abcdef0123456789abcdef'));
    assert.ok(entry.redactedText.includes('[REDACTED_TELEGRAM_STRING_SESSION]'));
    assert.ok(entry.redactedText.includes('[REDACTED_TELEGRAM_API_HASH]'));

    assert.equal(quarantine.count(), 1);
    assert.deepEqual(quarantine.getEntries()[0], entry);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REPLAY RECOVERY
// ─────────────────────────────────────────────────────────────────────────────

test('ReplayRecovery: Inspects recent messages, populates deduplication ledger and prevents double actions', async () => {
    const logger = new WorkerLogger({ silent: true });
    const hm = new HealthMonitor();
    const quarantine = new ParserQuarantine();

    const mockMessages = [
        {
            id: 101,
            text: `AI Model MT-LAB-BTTS-ESP-v0.1\nYield: 9.44% Hit Rate: 62.01%\n\nESP-PRE: Sevilla VS Barcelona\n    -Predicted Probability: 52% \n    -Kickoff: 21:00\n\nMarket BTTS Yes (Bet365): 1.61\n\nActive Pick`,
            date: Math.floor(Date.now() / 1000) - 300
        },
        {
            id: 102,
            text: `My Picks\nYou have a total of 12 picks in the next 24 hours.\n    MT-LAB-BTTS-ESP-v0.1: You have 3 picks in the next 24 hours.`,
            date: Math.floor(Date.now() / 1000) - 100
        }
    ];

    const mockClient = {
        client: {
            getMessages: async () => mockMessages
        }
    };

    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });

    const recovery = new ReplayRecovery({
        router: worker.router,
        logger,
        healthMonitor: hm,
        quarantine,
        limit: 10
    });

    // Primera pasada de recovery
    const stats1 = await recovery.recoverRecentMessages({
        client: mockClient,
        targetEntity: 'futbolbrain_chat',
        chatId: 'futbolbrain_chat'
    });

    assert.equal(stats1.inspected, 2);
    assert.equal(stats1.wouldPublish, 1);
    assert.equal(stats1.myPicksCount, 1);
    assert.equal(stats1.duplicates, 0);

    // Segunda pasada de recovery (simulando reconexión tras microcorte)
    const stats2 = await recovery.recoverRecentMessages({
        client: mockClient,
        targetEntity: 'futbolbrain_chat',
        chatId: 'futbolbrain_chat'
    });

    assert.equal(stats2.inspected, 2);
    assert.equal(stats2.wouldPublish, 0, 'No debe volver a emitir WOULD_PUBLISH para un pick ya recuperado');
    assert.equal(stats2.duplicates, 1, 'El Active Pick debe ser detectado como duplicado por ID/fingerprint');
    assert.equal(stats2.myPicksCount, 1, 'My Picks se procesa pasivamente para observabilidad');

    cleanupTestLock();
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. WORKER STARTUP & SHUTDOWN LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

test('Worker Lifecycle: Starts cleanly in DRY_RUN, acquires lock, and stops gracefully', async () => {
    cleanupTestLock();

    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_test_chat'
    });

    let startedEmitted = false;
    let stoppedEmitted = false;
    worker.on('started', () => { startedEmitted = true; });
    worker.on('stopped', () => { stoppedEmitted = true; });

    await worker.start();
    assert.equal(startedEmitted, true);
    assert.equal(existsSync(TEST_LOCK_PATH), true);

    const health = worker.getHealth();
    assert.equal(health.status, 'HEALTHY');
    assert.equal(health.metrics.connected, true);
    assert.equal(health.metrics.listenerActive, true);

    await worker.stop();
    assert.equal(stoppedEmitted, true);
    assert.equal(existsSync(TEST_LOCK_PATH), false);

    const healthAfter = worker.getHealth();
    assert.equal(healthAfter.metrics.connected, false);
    assert.equal(healthAfter.metrics.listenerActive, false);

    cleanupTestLock();
});

test('Worker Security Firewall: Refuses to start if FUTBOLBRAIN_WORKER_MODE != DRY_RUN', () => {
    cleanupTestLock();

    assert.throws(() => {
        new FutbolBrainTelegramWorker({
            mode: 'LIVE_PRODUCTION',
            isMock: true,
            lockPath: TEST_LOCK_PATH
        });
    }, /OPERATIONAL_FIREWALL/);

    cleanupTestLock();
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MESSAGE ROUTING: PRODUCTION T-5, PAPER T-5, EXCLUSIONS
// ─────────────────────────────────────────────────────────────────────────────

test('Worker Routing: Full pipeline verifies PRODUCTION T-5 -> WOULD_PUBLISH', async () => {
    cleanupTestLock();
    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });
    await worker.start();

    let publishedEvent = null;
    worker.on('active_pick', (data) => { publishedEvent = data; });

    // Mensaje real de Lyon vs Rennes (MT - FRA1 FRA2 - V1.0)
    worker.client.simulateIncomingMessage({
        id: 5001,
        chatId: 'futbolbrain_chat',
        text: `AI Model MT - FRA1 FRA2 - V1.0\nYield: 8.20% Hit Rate: 60.10%\n\nFRA-L1: Olympique Lyonnais VS Rennes\n    -Predicted Probability: 55% \n    -Kickoff: 20:45\n\nMarket Over 2.5 (Bet365): 1.85\n\nActive Pick`
    });

    // Esperar microtask
    await new Promise(r => setTimeout(r, 20));

    assert.ok(publishedEvent, 'Debe emitir evento active_pick');
    assert.equal(publishedEvent.action, 'WOULD_PUBLISH');
    assert.equal(publishedEvent.candidate.systemId, 'MT - FRA1 FRA2 - V1.0');
    assert.equal(publishedEvent.candidate.selection, 'Más de 2,5 goles');
    assert.equal(publishedEvent.candidate.odds, 1.85);
    assert.equal(publishedEvent.executionMode, 'PRODUCTION');

    const safety = worker.getRouterSafetyReport();
    assert.equal(safety.externalFirestoreWrites, 0);
    assert.equal(safety.outboundTelegramMessages, 0);
    assert.equal(safety.productionMutations, 0);

    await worker.stop();
    cleanupTestLock();
});

test('Worker Routing: Full pipeline verifies PAPER T-5 -> WOULD_RECORD_PAPER (stake 0%)', async () => {
    cleanupTestLock();
    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });
    await worker.start();

    let paperEvent = null;
    worker.on('active_pick', (data) => { paperEvent = data; });

    // Mensaje de GER1 (Paper T-5)
    worker.client.simulateIncomingMessage({
        id: 5002,
        chatId: 'futbolbrain_chat',
        text: `AI Model MT - GER1 - v1.1\nYield: 7.10% Hit Rate: 58.00%\n\nGER-BL: Bayern Munich VS Dortmund\n    -Predicted Probability: 54% \n    -Kickoff: 18:30\n\nMarket Over 3.5 (Bet365): 2.10\n\nActive Pick`
    });

    await new Promise(r => setTimeout(r, 20));

    assert.ok(paperEvent);
    assert.equal(paperEvent.action, 'WOULD_RECORD_PAPER');
    assert.equal(paperEvent.candidate.systemId, 'MT - GER1 - v1.1');
    assert.equal(paperEvent.candidate.selection, 'Más de 3,5 goles');
    assert.equal(paperEvent.candidate.odds, 2.10);
    assert.equal(paperEvent.executionMode, 'PAPER');
    assert.equal(paperEvent.stake, 0, 'Sistemas PAPER tienen stake real = 0%');

    await worker.stop();
    cleanupTestLock();
});

test('Worker Routing: Morning systems without T-5 are EXCLUDED from T-5 listener', async () => {
    cleanupTestLock();
    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });
    await worker.start();

    let activePickFired = false;
    worker.on('active_pick', () => { activePickFired = true; });

    // Mensaje de ITA1 (Morning Production)
    worker.client.simulateIncomingMessage({
        id: 5003,
        chatId: 'futbolbrain_chat',
        text: `AI Model MT - ITA1 - V1.0\nYield: 6.50% Hit Rate: 59.00%\n\nITA-SA: Venezia VS Lazio\n    -Predicted Probability: 51% \n    -Kickoff: 15:00\n\nMarket Away FT (Bet365): 1.70\n\nActive Pick`
    });

    await new Promise(r => setTimeout(r, 20));

    assert.equal(activePickFired, false, 'No debe emitir active_pick para sistemas Morning');

    await worker.stop();
    cleanupTestLock();
});

test('Worker Routing: Duplicate messages are recognized and not re-routed', async () => {
    cleanupTestLock();
    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });
    await worker.start();

    let duplicateFired = false;
    worker.on('duplicate', () => { duplicateFired = true; });

    const msg = {
        id: 5004,
        chatId: 'futbolbrain_chat',
        text: `AI Model MT-LAB-BTTS-ESP-v0.1\nYield: 9.44% Hit Rate: 62.01%\n\nESP-PRE: Sevilla VS Barcelona\n    -Predicted Probability: 52% \n    -Kickoff: 21:00\n\nMarket BTTS Yes (Bet365): 1.61\n\nActive Pick`
    };

    worker.client.simulateIncomingMessage(msg);
    await new Promise(r => setTimeout(r, 20));

    // Segunda recepción del mismo mensaje
    worker.client.simulateIncomingMessage(msg);
    await new Promise(r => setTimeout(r, 20));

    assert.equal(duplicateFired, true, 'Debe detectar y emitir evento duplicate');
    assert.equal(worker.healthMonitor.duplicates, 1);

    await worker.stop();
    cleanupTestLock();
});

test('Worker Routing E2E Acceptance: Real fixtures 28440, 28441, 28437 emit active_pick; Morning 28432 emits excluded_morning (NO active_pick)', async () => {
    cleanupTestLock();
    const worker = new FutbolBrainTelegramWorker({
        isMock: true,
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });
    await worker.start();

    const activePickEvents = [];
    const excludedMorningEvents = [];

    worker.on('active_pick', (data) => { activePickEvents.push(data); });
    worker.on('excluded_morning', (data) => { excludedMorningEvents.push(data); });

    // Fixture 28440: ESP-PRE: Atlético Madrid VS Real Madrid (MT-LAB-BTTS-ESP-v0.1 -> Production T-5)
    worker.client.simulateIncomingMessage({
        id: 28440,
        chatId: 'futbolbrain_chat',
        date: new Date('2026-09-20T14:11:45.000Z'),
        text: 'AI Model MT-LAB-BTTS-ESP-v0.1\nYield: 8.99% Hit Rate: 61.80%\n\nESP-PRE: Atlético Madrid VS Real Madrid\n    -Predicted Probability: 73% \n    -Kickoff: 16:15\n\nMarket BTTS Yes (Bet365): 1.5\n\nActive Pick'
    });

    // Fixture 28441: ESP-SEG: Ceuta VS Real Valladolid (MT-LAB-BTTS-ESP-v0.1 -> Production T-5)
    worker.client.simulateIncomingMessage({
        id: 28441,
        chatId: 'futbolbrain_chat',
        date: new Date('2026-09-20T14:11:45.000Z'),
        text: 'AI Model MT-LAB-BTTS-ESP-v0.1\nYield: 8.99% Hit Rate: 61.80%\n\nESP-SEG: Ceuta VS Real Valladolid\n    -Predicted Probability: 45% \n    -Kickoff: 16:15\n\nMarket BTTS Yes (Bet365): 1.83\n\nActive Pick'
    });

    // Fixture 28437: GER-BUN: Bayer Leverkusen VS RB Leipzig (MT - GER1 - v1.1 -> Paper T-5)
    worker.client.simulateIncomingMessage({
        id: 28437,
        chatId: 'futbolbrain_chat',
        date: new Date('2026-09-20T13:26:43.000Z'),
        text: 'AI Model MT - GER1 - v1.1\nYield: 8.51% Hit Rate: 48.08%\n\nGER-BUN: Bayer Leverkusen VS RB Leipzig\n    -Predicted Probability: 52% \n    -Kickoff: 15:30\n\nMarket O 3.5 FT (Bet365): 1.8\n\nActive Pick'
    });

    // Fixture 28432: ENG-PRE: AFC Bournemouth VS Liverpool (MT - Premier League 02.5 -> Morning Production)
    worker.client.simulateIncomingMessage({
        id: 28432,
        chatId: 'futbolbrain_chat',
        date: new Date('2026-09-20T12:56:42.000Z'),
        text: 'AI Model MT - Premier League 02.5\nYield: 5.11% Hit Rate: 71.07%\n\nENG-PRE: AFC Bournemouth VS Liverpool\n    -Predicted Probability: 77% \n    -Kickoff: 15:00\n\nMarket U 3.5 FT (Bet365): 1.66\n\nActive Pick'
    });

    await new Promise(r => setTimeout(r, 50));

    // Validar que 28440, 28441 y 28437 emitieron active_pick
    assert.equal(activePickEvents.length, 3, 'Deben haberse emitido exactamente 3 eventos active_pick');

    // 28440
    const ev28440 = activePickEvents.find(e => e.candidate?.telegramMessageId === 28440 || e.candidate?.telegramMessageId === '28440');
    assert.ok(ev28440, 'Fixture 28440 debe haber emitido active_pick');
    assert.equal(ev28440.action, 'WOULD_PUBLISH');
    assert.equal(ev28440.candidate.systemId, 'MT-LAB-BTTS-ESP-v0.1');
    assert.equal(ev28440.candidate.event, 'Atlético Madrid vs Real Madrid');
    assert.equal(ev28440.candidate.selection, 'Sí');
    assert.equal(ev28440.candidate.odds, 1.5);
    assert.equal(ev28440.candidate.kickoffAt, '2026-09-20T14:15:00.000Z'); // 16:15 Madrid CEST = 14:15 UTC!
    assert.equal(ev28440.executionMode, 'PRODUCTION');

    // 28441
    const ev28441 = activePickEvents.find(e => e.candidate?.telegramMessageId === 28441 || e.candidate?.telegramMessageId === '28441');
    assert.ok(ev28441, 'Fixture 28441 debe haber emitido active_pick');
    assert.equal(ev28441.action, 'WOULD_PUBLISH');
    assert.equal(ev28441.candidate.systemId, 'MT-LAB-BTTS-ESP-v0.1');
    assert.equal(ev28441.candidate.event, 'Ceuta vs Real Valladolid');
    assert.equal(ev28441.candidate.selection, 'Sí');
    assert.equal(ev28441.candidate.odds, 1.83);
    assert.equal(ev28441.candidate.kickoffAt, '2026-09-20T14:15:00.000Z'); // 16:15 Madrid CEST = 14:15 UTC!
    assert.equal(ev28441.executionMode, 'PRODUCTION');

    // 28437
    const ev28437 = activePickEvents.find(e => e.candidate?.telegramMessageId === 28437 || e.candidate?.telegramMessageId === '28437');
    assert.ok(ev28437, 'Fixture 28437 debe haber emitido active_pick');
    assert.equal(ev28437.action, 'WOULD_RECORD_PAPER');
    assert.equal(ev28437.candidate.systemId, 'MT - GER1 - v1.1');
    assert.equal(ev28437.candidate.event, 'Bayer Leverkusen vs RB Leipzig');
    assert.equal(ev28437.candidate.selection, 'Más de 3,5 goles');
    assert.equal(ev28437.candidate.odds, 1.8);
    assert.equal(ev28437.candidate.kickoffAt, '2026-09-20T13:30:00.000Z'); // 15:30 Madrid CEST = 13:30 UTC!
    assert.equal(ev28437.executionMode, 'PAPER');
    assert.equal(ev28437.stake, 0);

    // 28432 (Morning -> EXCLUDED_NON_T5_LISTENER, NO active_pick)
    assert.equal(excludedMorningEvents.length, 1, 'Debe haberse emitido 1 evento excluded_morning para 28432');
    assert.equal(excludedMorningEvents[0].action, 'EXCLUDED_NON_T5_LISTENER');
    assert.equal(excludedMorningEvents[0].systemId, 'MT - Premier League 02.5');

    // Safety report check
    const safety = worker.getRouterSafetyReport();
    assert.equal(safety.externalFirestoreWrites, 0);
    assert.equal(safety.outboundTelegramMessages, 0);
    assert.equal(safety.productionMutations, 0);

    await worker.stop();
    cleanupTestLock();
});

test('Worker Routing E2E Acceptance: Real message 28499 (Granada CF VS FC Andorra) with markdown bold **systemId** emits active_pick WOULD_PUBLISH and derives op_id', async () => {
    cleanupTestLock();
    const worker = new FutbolBrainTelegramWorker({
        mode: 'DRY_RUN',
        lockPath: TEST_LOCK_PATH,
        silent: true,
        chatId: 'futbolbrain_chat'
    });
    await worker.start();

    const activePickEvents = [];
    worker.on('active_pick', (data) => { activePickEvents.push(data); });

    // Fixture 28499: ESP-SEG: Granada CF VS FC Andorra (con markdown bold **MT-LAB-BTTS-ESP-v0.1**)
    worker.client.simulateIncomingMessage({
        id: 28499,
        chatId: 'futbolbrain_chat',
        date: new Date('2026-09-26T14:12:06.065Z'),
        text: 'AI Model **MT-LAB-BTTS-ESP-v0.1**\nYield: 8.99% Hit Rate: 61.80%\n\nESP-SEG: Granada CF VS FC Andorra\n    -Predicted Probability: 54% \n    -Kickoff: 16:15\n\nMarket BTTS Yes (Bet365): 1.95\n\nActive Pick'
    });

    await new Promise(r => setTimeout(r, 50));

    assert.equal(activePickEvents.length, 1, 'Debe haber emitido exactamente 1 evento active_pick');
    const ev28499 = activePickEvents[0];
    assert.equal(ev28499.action, 'WOULD_PUBLISH');
    assert.equal(ev28499.candidate.systemId, 'MT-LAB-BTTS-ESP-v0.1');
    assert.equal(ev28499.candidate.event, 'Granada CF vs FC Andorra');
    assert.equal(ev28499.candidate.selection, 'Sí');
    assert.equal(ev28499.candidate.odds, 1.95);
    assert.equal(ev28499.candidate.kickoffAt, '2026-09-26T14:15:00.000Z');
    assert.equal(ev28499.executionMode, 'PRODUCTION');

    // Comprobar derivación de op_id canónico
    const derivedOpId = `op_${ev28499.candidate.fingerprint.slice(0, 40)}`;
    assert.match(derivedOpId, /^op_[a-f0-9]{40}$/);

    const safety = worker.getRouterSafetyReport();
    assert.equal(safety.externalFirestoreWrites, 0);
    assert.equal(safety.outboundTelegramMessages, 0);
    assert.equal(safety.productionMutations, 0);

    await worker.stop();
    cleanupTestLock();
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. LOGGING & SECRET REDACTION
// ─────────────────────────────────────────────────────────────────────────────

test('WorkerLogger: Strips tokens, hashes, phone numbers and passwords from structured logs', () => {
    const logger = new WorkerLogger({ silent: true });

    const logEntry = logger.log(
        LOG_TAGS.STARTUP,
        'Connecting with session 1BQabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ and hash 0123456789abcdef0123456789abcdef',
        {
            apiHash: '0123456789abcdef0123456789abcdef',
            session: '1BQabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            phone: '+34611223344',
            otpCode: '12345'
        }
    );

    assert.ok(!logEntry.message.includes('1BQabcdef'));
    assert.ok(!logEntry.message.includes('0123456789abcdef0123456789abcdef'));
    assert.ok(logEntry.message.includes('[REDACTED_TELEGRAM_STRING_SESSION]'));
    assert.ok(logEntry.message.includes('[REDACTED_TELEGRAM_API_HASH]'));

    assert.equal(logEntry.apiHash, '[REDACTED_CREDENTIAL]');
    assert.equal(logEntry.session, '[REDACTED_CREDENTIAL]');
    assert.equal(logEntry.otpCode, '[REDACTED_CREDENTIAL]');
});
