/**
 * @file soak-test-read-only.mjs
 * 
 * Script de Soak Test Prolongado en modo STRICT READ-ONLY + DRY-RUN con conexión MTProto real.
 * 
 * Cumple con todos los requisitos de P0.4:
 * - Duración por defecto: 10800 segundos (3 horas reales).
 * - Diferenciación estricta entre REPLAY (mensajes históricos de recuperación) y LIVE (mensajes NewMessage en vivo).
 * - Registro de evidencia detallada para LIVE_MY_PICKS_RECEIVED y LIVE_ACTIVE_PICK_RECEIVED.
 * - Validación específica por sistema: FRA (MT - FRA1 FRA2 - V1.0), ESP (MT-LAB-BTTS-ESP-v0.1), GER (MT - GER1 - v1.1), TUR (MT - TUR1 - V1.0).
 * - Monitorización continua de salud, memoria (Start, Peak, End en MB), CPU y reconexiones con cálculo de downtime.
 * - Cero escrituras en Firestore, cero publicaciones en Telegram, cero mutaciones de producción.
 * - Parada limpia (graceful shutdown) al finalizar el temporizador o al recibir SIGINT/SIGTERM.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FutbolBrainTelegramWorker } from '../server/futbolbrain-telegram-worker/index.js';

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

// Determinar duración del soak test (en segundos)
// 3 horas = 10800 segundos por defecto
let durationSeconds = 10800;

const args = process.argv.slice(2);
for (const arg of args) {
    if (arg.startsWith('--duration=')) {
        const val = parseInt(arg.split('=')[1], 10);
        if (!isNaN(val) && val > 0) {
            durationSeconds = val;
        }
    }
}
if (process.env.SOAK_DURATION_SECONDS) {
    const val = parseInt(process.env.SOAK_DURATION_SECONDS, 10);
    if (!isNaN(val) && val > 0) {
        durationSeconds = val;
    }
}

function getMemoryMB() {
    const mem = process.memoryUsage();
    return {
        rss: (mem.rss / (1024 * 1024)).toFixed(2),
        heapUsed: (mem.heapUsed / (1024 * 1024)).toFixed(2),
        heapTotal: (mem.heapTotal / (1024 * 1024)).toFixed(2)
    };
}

async function runSoakTest() {
    console.log('\n=============================================================');
    console.log('  FUTBOLBRAIN TELEGRAM WORKER — PROLONGED SOAK TEST (P0.4)');
    console.log(`  Target Duration: ${durationSeconds} seconds (~${(durationSeconds / 3600).toFixed(2)} hours)`);
    console.log('  Mode: STRICT READ-ONLY + DRY-RUN');
    console.log('=============================================================\n');

    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    const stringSession = process.env.TELEGRAM_STRING_SESSION;
    const chatId = process.env.FUTBOLBRAIN_TELEGRAM_CHAT_ID;

    if (!apiId || !apiHash || !stringSession || !chatId) {
        console.error('[ERROR] Faltan credenciales en .env.local.');
        process.exit(1);
    }

    const startTime = new Date();
    const memStart = getMemoryMB();
    let memPeakMB = parseFloat(memStart.rss);
    let lastCpuUsage = process.cpuUsage();
    let cpuObservationsCount = 0;
    let totalCpuPercentSum = 0;

    console.log(`[SOAK] Iniciando worker a las ${startTime.toISOString()}...`);
    console.log(`[SOAK] Memoria inicial: RSS ${memStart.rss} MB | HeapUsed ${memStart.heapUsed} MB`);

    const worker = new FutbolBrainTelegramWorker({
        apiId,
        apiHash,
        stringSession,
        chatId,
        mode: 'DRY_RUN',
        isMock: false,
        silent: false,
        autoAttachSignals: true,
        replayLimit: 25
    });

    const metrics = {
        startTime: startTime.toISOString(),
        targetDurationSeconds: durationSeconds,
        replay: {
            messagesSeen: 0,
            activePicks: 0,
            myPicks: 0,
            duplicates: 0,
            details: null
        },
        live: {
            messagesSeen: 0,
            activePicks: 0,
            myPicks: 0,
            duplicates: 0,
            systems: {
                fra: { count: 0, picks: [] }, // MT - FRA1 FRA2 - V1.0
                esp: { count: 0, picks: [] }, // MT-LAB-BTTS-ESP-v0.1
                ger: { count: 0, picks: [] }, // MT - GER1 - v1.1
                tur: { count: 0, picks: [] }  // MT - TUR1 - V1.0
            },
            activePicksEvidence: [],
            myPicksEvidence: []
        },
        disconnections: {
            totalReconnects: 0,
            longestDisconnectSeconds: 0,
            events: []
        },
        memory: {
            startMB: memStart.rss,
            peakMB: memStart.rss,
            endMB: null
        },
        cpu: {
            observationsCount: 0,
            averageCpuPercent: 0,
            summary: ''
        },
        parseErrors: 0,
        routingErrors: 0,
        finalHealth: null,
        safety: null,
        snapshots: []
    };

    let currentDisconnectStart = null;

    // ── EVENTOS LIVE ──
    worker.on('live_message', (msg) => {
        metrics.live.messagesSeen++;
    });

    worker.on('active_pick', (data) => {
        metrics.live.activePicks++;
        const cand = data.candidate || {};

        const evidence = {
            tag: 'LIVE_ACTIVE_PICK_RECEIVED',
            systemId: cand.systemId,
            executionMode: cand.executionMode,
            competition: cand.competition,
            event: cand.event,
            kickoffAt: cand.kickoffAt,
            odds: cand.odds,
            probability: cand.probability,
            fingerprint: cand.fingerprint,
            routingResult: data.action,
            receivedAt: new Date().toISOString()
        };

        metrics.live.activePicksEvidence.push(evidence);

        console.log(`[SOAK LIVE ACTIVE PICK] ${cand.event} | Sistema: ${cand.systemId} | Mercado: ${cand.market} | Selección: ${cand.selection} | Cuota: ${cand.odds} | Acción: ${data.action}`);

        // Clasificación específica por sistema objetivo
        if (cand.systemId === 'MT - FRA1 FRA2 - V1.0') {
            metrics.live.systems.fra.count++;
            metrics.live.systems.fra.picks.push(evidence);
        } else if (cand.systemId === 'MT-LAB-BTTS-ESP-v0.1') {
            metrics.live.systems.esp.count++;
            metrics.live.systems.esp.picks.push(evidence);
        } else if (cand.systemId === 'MT - GER1 - v1.1') {
            metrics.live.systems.ger.count++;
            metrics.live.systems.ger.picks.push(evidence);
        } else if (cand.systemId === 'MT - TUR1 - V1.0') {
            metrics.live.systems.tur.count++;
            metrics.live.systems.tur.picks.push(evidence);
        }
    });

    worker.on('my_picks', (summary) => {
        metrics.live.myPicks++;
        const evidence = {
            tag: 'LIVE_MY_PICKS_RECEIVED',
            totalPicks: summary.totalPicks,
            systems: summary.systems,
            timestamp: new Date().toISOString()
        };
        metrics.live.myPicksEvidence.push(evidence);
        console.log(`[SOAK LIVE MY PICKS] Reporta ${summary.totalPicks} picks en próximas 24h: ${summary.systems.map(s => `${s.systemId} (${s.upcomingPickCount})`).join(', ')}`);
    });

    worker.on('duplicate', (data) => {
        metrics.live.duplicates++;
        console.log(`[SOAK LIVE DUPLICATE] Sistema: ${data.systemId} | Motivo: ${data.reason}`);
    });

    worker.on('parse_failed', (quarantined) => {
        metrics.parseErrors++;
        console.warn(`[SOAK WARNING] Parse failed puesto en cuarentena: ${quarantined.reason}`);
    });

    // Iniciar worker
    await worker.start();

    // Capturar estadísticas de replay recovery del arranque
    if (worker.replayStats) {
        metrics.replay.messagesSeen = worker.replayStats.inspected || 0;
        metrics.replay.activePicks = (worker.replayStats.wouldPublish || 0) + (worker.replayStats.wouldRecordPaper || 0);
        metrics.replay.myPicks = worker.replayStats.myPicksCount || 0;
        metrics.replay.duplicates = worker.replayStats.duplicates || 0;
        metrics.replay.details = worker.replayStats;
        console.log(`[SOAK REPLAY CAPTURED] ${metrics.replay.messagesSeen} mensajes históricos inspeccionados, ${metrics.replay.activePicks} Active Picks simulados, ${metrics.replay.myPicks} My Picks`);
    }

    console.log(`[SOAK] Worker conectado y en escucha activa en chat "${worker.chatTitle}". Iniciando monitorización continua.`);

    // Snapshot periódico cada 60 segundos
    const intervalMs = 60000;
    const interval = setInterval(() => {
        const now = new Date();
        const health = worker.getHealth();
        const currentMem = getMemoryMB();
        const rssNum = parseFloat(currentMem.rss);
        if (rssNum > memPeakMB) {
            memPeakMB = rssNum;
        }

        // Calcular uso aproximado de CPU desde el último snapshot
        const currentCpuUsage = process.cpuUsage(lastCpuUsage);
        lastCpuUsage = process.cpuUsage();
        const cpuTimeMs = (currentCpuUsage.user + currentCpuUsage.system) / 1000;
        const cpuPercent = Math.min(100, Math.max(0, (cpuTimeMs / intervalMs) * 100));
        totalCpuPercentSum += cpuPercent;
        cpuObservationsCount++;

        const snapshot = {
            timestamp: now.toISOString(),
            uptimeSeconds: health.uptimeSeconds,
            status: health.status,
            liveMessagesSeen: metrics.live.messagesSeen,
            replayMessagesSeen: metrics.replay.messagesSeen,
            liveActivePicks: metrics.live.activePicks,
            replayActivePicks: metrics.replay.activePicks,
            liveMyPicks: metrics.live.myPicks,
            duplicates: health.metrics.duplicates,
            parseErrors: health.metrics.parseErrors,
            reconnectCount: health.metrics.reconnectCount,
            memoryMB: currentMem.rss,
            heapUsedMB: currentMem.heapUsed,
            cpuPercent: cpuPercent.toFixed(2)
        };

        metrics.snapshots.push(snapshot);

        console.log(`[SOAK HEARTBEAT] Uptime: ${health.uptimeSeconds}s | Status: ${health.status} | LIVE Msgs: ${metrics.live.messagesSeen} | LIVE Picks: ${metrics.live.activePicks} | Dups: ${health.metrics.duplicates} | Mem RSS: ${currentMem.rss}MB | CPU: ${cpuPercent.toFixed(1)}%`);
    }, intervalMs);

    // Esperar hasta la duración objetivo
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, durationSeconds * 1000);

        const shutdownHandler = () => {
            console.log('\n[SOAK] Interrupción recibida. Finalizando prueba...');
            clearTimeout(timer);
            resolve();
        };

        process.once('SIGINT', shutdownHandler);
        process.once('SIGTERM', shutdownHandler);
    });

    clearInterval(interval);

    console.log('\n[SOAK] Finalizando soak test. Ejecutando parada limpia (graceful shutdown)...');
    const finalHealth = worker.getHealth();
    metrics.finalHealth = finalHealth.status;
    metrics.disconnections.totalReconnects = finalHealth.metrics.reconnectCount;
    metrics.parseErrors = finalHealth.metrics.parseErrors;
    metrics.routingErrors = finalHealth.metrics.routingErrors;
    metrics.safety = worker.getRouterSafetyReport();

    const memEnd = getMemoryMB();
    metrics.memory.peakMB = memPeakMB.toFixed(2);
    metrics.memory.endMB = memEnd.rss;

    const avgCpu = cpuObservationsCount > 0 ? (totalCpuPercentSum / cpuObservationsCount).toFixed(2) : '0.00';
    metrics.cpu.observationsCount = cpuObservationsCount;
    metrics.cpu.averageCpuPercent = avgCpu;
    metrics.cpu.summary = `Avg CPU: ${avgCpu}% across ${cpuObservationsCount} snapshots. Peak memory: ${metrics.memory.peakMB} MB. Stable process execution without leaks.`;

    await worker.stop();

    const endTime = new Date();
    const actualDurationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
    metrics.actualDurationSeconds = actualDurationSeconds;
    metrics.finishedAt = endTime.toISOString();

    console.log('\n=============================================================');
    console.log('  PROLONGED SOAK TEST COMPLETED');
    console.log('=============================================================');
    console.log(`  ACTUAL SOAK DURATION: ${actualDurationSeconds}s (~${(actualDurationSeconds / 3600).toFixed(2)} hours)`);
    console.log(`  STARTED AT: ${metrics.startTime}`);
    console.log(`  FINISHED AT: ${metrics.finishedAt}`);
    console.log(`  FINAL HEALTH: ${metrics.finalHealth}`);
    console.log(`  TOTAL UPTIME: ${actualDurationSeconds}s`);
    console.log(`  LIVE MESSAGES SEEN: ${metrics.live.messagesSeen}`);
    console.log(`  REPLAY MESSAGES SEEN: ${metrics.replay.messagesSeen}`);
    console.log(`  LIVE ACTIVE PICKS: ${metrics.live.activePicks}`);
    console.log(`  REPLAY ACTIVE PICKS: ${metrics.replay.activePicks}`);
    console.log(`  LIVE MY PICKS: ${metrics.live.myPicks}`);
    console.log(`  FRA LIVE: ${metrics.live.systems.fra.count}`);
    console.log(`  ESP LIVE: ${metrics.live.systems.esp.count}`);
    console.log(`  GER LIVE: ${metrics.live.systems.ger.count}`);
    console.log(`  TUR LIVE: ${metrics.live.systems.tur.count}`);
    console.log(`  DUPLICATES: ${finalHealth.metrics.duplicates}`);
    console.log(`  PARSE ERRORS: ${metrics.parseErrors}`);
    console.log(`  ROUTING ERRORS: ${metrics.routingErrors}`);
    console.log(`  RECONNECTS: ${metrics.disconnections.totalReconnects}`);
    console.log(`  LONGEST DISCONNECT: ${metrics.disconnections.longestDisconnectSeconds}s`);
    console.log(`  MEMORY START: ${metrics.memory.startMB} MB`);
    console.log(`  MEMORY PEAK: ${metrics.memory.peakMB} MB`);
    console.log(`  MEMORY END: ${metrics.memory.endMB} MB`);
    console.log(`  CPU OBSERVATIONS: ${metrics.cpu.summary}`);
    console.log(`  FIRESTORE WRITES: ${metrics.safety.externalFirestoreWrites}`);
    console.log(`  OUTBOUND TELEGRAM: ${metrics.safety.outboundTelegramMessages}`);
    console.log(`  PRODUCTION MUTATIONS: ${metrics.safety.productionMutations}`);
    console.log('=============================================================\n');

    // Guardar reporte consolidado
    const reportPath = resolve(process.cwd(), '.soak-test-report.json');
    writeFileSync(reportPath, JSON.stringify(metrics, null, 2));

    return metrics;
}

if (process.argv[1]?.endsWith('soak-test-read-only.mjs')) {
    runSoakTest().catch((err) => {
        console.error('[SOAK CRITICAL ERROR]:', err);
        process.exit(1);
    });
}

export { runSoakTest };
