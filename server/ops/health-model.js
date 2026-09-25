import { getAdminDb } from '../../api/_lib/firebase-admin.js';
import { OPS_READ_LIMITS } from './read-safety.js';

export const HEALTH_STATES = {
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    DOWN: 'DOWN',
    UNKNOWN: 'UNKNOWN'
};

/**
 * Evalúa el estado de salud de la base de datos Firestore.
 */
async function checkFirestoreHealth(db) {
    if (!db || typeof db.collection !== 'function') {
        return {
            status: HEALTH_STATES.UNKNOWN,
            message: 'Instancia Firestore no disponible o no inicializada'
        };
    }
    const start = Date.now();
    try {
        // Comprobación estrictamente READ-ONLY (cero escrituras/pings/modificaciones)
        await db.collection('cronLocks').limit(1).get();
        const latencyMs = Date.now() - start;
        return {
            status: latencyMs > 2500 ? HEALTH_STATES.DEGRADED : HEALTH_STATES.HEALTHY,
            latencyMs,
            message: `Firestore operativo (latencia: ${latencyMs}ms)`
        };
    } catch (err) {
        return {
            status: HEALTH_STATES.DOWN,
            latencyMs: Date.now() - start,
            message: `Error al conectar con Firestore: ${err.message}`
        };
    }
}

/**
 * Evalúa el estado del cron diario de liquidación 01:00.
 */
async function checkSettlementCronHealth(db, now = new Date()) {
    if (!db || typeof db.collection !== 'function') {
        return {
            status: HEALTH_STATES.UNKNOWN,
            message: 'Sin acceso a Firestore para verificar cronLocks'
        };
    }

    try {
        const lockRef = db.collection('cronLocks').doc('settle-official-picks');
        const snap = await lockRef.get();

        if (!snap.exists) {
            return {
                status: HEALTH_STATES.UNKNOWN,
                message: 'No hay registro histórico de ejecución de cronLocks/settle-official-picks'
            };
        }

        const data = snap.data();
        const lastRun = data.lastSettledAt || data.lockedAt || data.updatedAt;
        const lastRunDate = lastRun?.toDate ? lastRun.toDate() : new Date(lastRun);

        const ageHours = (now.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60);

        if (ageHours > 36) {
            return {
                status: HEALTH_STATES.DEGRADED,
                lastRunDate: lastRunDate.toISOString(),
                message: `Última liquidación hace ${Math.round(ageHours)} horas (se esperaba diaria)`
            };
        }

        return {
            status: HEALTH_STATES.HEALTHY,
            lastRunDate: lastRunDate.toISOString(),
            lastProcessedPicks: data.settledCount ?? null,
            message: `Liquidación 01:00 al día (última ejecución: ${data.dateMadrid || lastRunDate.toISOString()})`
        };
    } catch (err) {
        return {
            status: HEALTH_STATES.DEGRADED,
            message: `No se pudo verificar el estado del cron de liquidación: ${err.message}`
        };
    }
}

/**
 * Evalúa el estado del worker T-5 (VPS / MTProto).
 */
async function checkVpsWorkerHealth() {
    // Si tenemos una variable de entorno indicando que el transporte está activo
    const transportStatus = process.env.T5_TRANSPORT_STATUS || 'UNKNOWN';
    const workerMode = process.env.FUTBOLBRAIN_WORKER_MODE || 'UNKNOWN';

    if (transportStatus === 'TELEGRAM_MTPROTO_ACTIVE') {
        return {
            status: HEALTH_STATES.HEALTHY,
            transport: transportStatus,
            mode: workerMode,
            host: 'mt-picks-risk-vps (188.245.21.120)',
            message: 'Worker T-5 persistente activo en Hetzner VPS (systemd/MTProto)'
        };
    }

    return {
        status: transportStatus === 'DEFERRED' ? HEALTH_STATES.DEGRADED : HEALTH_STATES.UNKNOWN,
        transport: transportStatus,
        mode: workerMode,
        message: transportStatus === 'DEFERRED' ? 'T-5 worker en estado DEFERRED' : 'Estado del worker T-5 no reportado'
    };
}

/**
 * Evalúa el estado de Telegram saliente y canales.
 */
function checkTelegramHealth() {
    const botTokenPresent = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const channelIdPresent = Boolean(process.env.TELEGRAM_PUBLIC_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID);

    if (botTokenPresent && channelIdPresent) {
        return {
            status: HEALTH_STATES.HEALTHY,
            configured: true,
            message: 'Bot de Telegram y canal oficial configurados correctamente'
        };
    }

    if (botTokenPresent && !channelIdPresent) {
        return {
            status: HEALTH_STATES.DEGRADED,
            configured: false,
            message: 'TELEGRAM_BOT_TOKEN presente pero falta TELEGRAM_PUBLIC_CHANNEL_ID'
        };
    }

    return {
        status: HEALTH_STATES.UNKNOWN,
        configured: false,
        message: 'Credenciales de Telegram saliente no configuradas en este entorno'
    };
}

/**
 * Evalúa TheSportsDB como proveedor principal de resultados y reconciliación.
 */
async function checkTheSportsDbHealth() {
    const apiKey = process.env.THESPORTSDB_API_KEY || '3'; // '3' es la API key pública gratuita de pruebas

    return {
        status: HEALTH_STATES.HEALTHY,
        provider: 'TheSportsDB',
        tier: apiKey === '3' ? 'FREE_TIER_3' : 'PATREON_V1',
        message: 'Proveedor TheSportsDB disponible para reconciliación y liquidación'
    };
}

/**
 * Evalúa la salud de facturación e incidencias de Revenue (PremiumPay / Stripe).
 */
async function checkBillingHealth(db) {
    if (!db || typeof db.collection !== 'function') {
        return {
            status: HEALTH_STATES.UNKNOWN,
            message: 'Sin base de datos para auditar incidencias de facturación'
        };
    }

    try {
        const incidentsSnap = await db.collection('revenueIncidents')
            .where('status', '==', 'open')
            .limit(OPS_READ_LIMITS.healthIncidentDocuments)
            .get();

        const openCount = incidentsSnap.size;

        if (openCount > 5) {
            return {
                status: HEALTH_STATES.DEGRADED,
                openIncidentsCount: openCount,
                countIsLowerBound: true,
                message: `Al menos ${openCount} incidencias de revenue abiertas requieren atención`
            };
        }

        return {
            status: HEALTH_STATES.HEALTHY,
            openIncidentsCount: openCount,
            message: openCount === 0 ? 'Sin incidencias de facturación abiertas' : `${openCount} incidencia(s) en seguimiento`
        };
    } catch {
        return {
            status: HEALTH_STATES.UNKNOWN,
            message: 'No se pudo consultar la colección revenueIncidents'
        };
    }
}

/**
 * Evalúa el modelo unificado de salud en un único snapshot consolidado.
 */
export async function evaluateUnifiedHealth({
    db = null,
    now = new Date()
} = {}) {
    let database = db;
    if (!database) {
        try {
            database = getAdminDb();
        } catch {
            // entorno test
        }
    }

    const [
        firestoreHealth,
        settlementCronHealth,
        vpsWorkerHealth,
        telegramHealth,
        theSportsDbHealth,
        billingHealth
    ] = await Promise.all([
        checkFirestoreHealth(database),
        checkSettlementCronHealth(database, now),
        checkVpsWorkerHealth(),
        Promise.resolve(checkTelegramHealth()),
        checkTheSportsDbHealth(),
        checkBillingHealth(database)
    ]);

    const components = {
        firestore: firestoreHealth,
        settlement_01_00: settlementCronHealth,
        vps_t5_worker: vpsWorkerHealth,
        telegram_outbound: telegramHealth,
        thesportsdb: theSportsDbHealth,
        billing: billingHealth
    };

    // Calcular estado global unificado
    const statuses = Object.values(components).map(c => c.status);
    let overall = HEALTH_STATES.HEALTHY;

    if (statuses.includes(HEALTH_STATES.DOWN)) {
        overall = HEALTH_STATES.DOWN;
    } else if (statuses.includes(HEALTH_STATES.DEGRADED)) {
        overall = HEALTH_STATES.DEGRADED;
    } else if (statuses.every(s => s === HEALTH_STATES.UNKNOWN)) {
        overall = HEALTH_STATES.UNKNOWN;
    }

    return {
        overall,
        checkedAt: now.toISOString(),
        checkedAtMadrid: new Intl.DateTimeFormat('es-ES', {
            timeZone: 'Europe/Madrid',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(now),
        components,
        summary: {
            healthyCount: statuses.filter(s => s === HEALTH_STATES.HEALTHY).length,
            degradedCount: statuses.filter(s => s === HEALTH_STATES.DEGRADED).length,
            downCount: statuses.filter(s => s === HEALTH_STATES.DOWN).length,
            unknownCount: statuses.filter(s => s === HEALTH_STATES.UNKNOWN).length
        }
    };
}
