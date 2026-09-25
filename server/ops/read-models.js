import { getAdminDb } from '../../api/_lib/firebase-admin.js';
import { SYSTEM_REGISTRY, SYSTEM_EXECUTION_MODES } from '../system-registry.js';
import { evaluateUnifiedHealth } from './health-model.js';
import { OPS_READ_LIMITS, boundedCompleteDocs, boundedCount, boundedPageSize, boundedPickOffset } from './read-safety.js';

/**
 * Cache en memoria con TTL para reducir lecturas acotadas sobre Firestore.
 */
class OpsReadCache {
    constructor(ttlMs = 300000) {
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            return null;
        }
        return entry.data;
    }

    getEntry(key) {
        return this.cache.get(key) || null;
    }

    set(key, data, customTtl = null) {
        this.cache.set(key, {
            data,
            expiresAt: Date.now() + (customTtl || this.ttlMs),
            cachedAt: Date.now()
        });
    }

    invalidate(key = null) {
        if (key) this.cache.delete(key);
        else this.cache.clear();
    }
}

export const opsReadCache = new OpsReadCache(300000); // 5 min; no background refresh

/**
 * KPI Summary consolidado para la vista ejecutiva de Astra HQ.
 * Regla canónica: UNKNOWN ≠ 0, FAILURE ≠ LAST KNOWN VALUE unless explicitly labelled stale, NO SOURCE ≠ synthetic value.
 */
export async function getOpsKpisSummary({ db = null, bypassCache = false, now = new Date() } = {}) {
    const cacheKey = 'kpis_summary';
    if (!bypassCache) {
        const cached = opsReadCache.get(cacheKey);
        if (cached) return cached;
    }

    let database = db;
    if (!database) {
        try { database = getAdminDb(); } catch { /* No Firebase credentials in isolated tests. */ }
    }

    const health = await evaluateUnifiedHealth({ db: database, now });

    // Si Firestore no está disponible en absoluto:
    if (!database || typeof database.collection !== 'function') {
        const lastEntry = opsReadCache.getEntry(cacheKey);
        if (lastEntry) {
            // Se sirve cache expirada explícitamente etiquetada como stale, conservando timestamp original
            return {
                ...lastEntry.data,
                companyHealth: health.overall,
                healthDetails: health,
                status: 'stale',
                isStale: true,
                staleReason: 'NO_DATABASE_CONNECTION',
                generatedAt: lastEntry.data.generatedAt,
                updatedAt: lastEntry.data.generatedAt
            };
        }

        // Si no hay cache previa: devolver nulls/unavailable (NUNCA ceros o números sintéticos)
        return {
            companyHealth: health.overall,
            healthDetails: health,
            status: 'unavailable',
            isStale: false,
            staleReason: null,
            sourceStatus: {
                firestore: health.components.firestore?.status || 'UNKNOWN',
                subscribers: 'unavailable',
                revenue: 'unavailable',
                incidents: 'unavailable',
                picks: 'unavailable'
            },
            activeSubscribers: null,
            monthlyGrossRevenueEUR: null,
            openIncidents: null,
            picksMetrics: {
                totalValidOfficialPicks: null,
                pendingSettlements: null,
                publishedSeasonPicks: null
            },
            automationStatus: {
                vpsWorker: health.components.vps_t5_worker?.status || 'UNKNOWN',
                settlementCron: health.components.settlement_01_00?.status || 'UNKNOWN'
            },
            generatedAt: now.toISOString(),
            updatedAt: now.toISOString()
        };
    }

    // Consulta aislada y robusta a cada fuente de datos (sin mezclar ni inventar números)
    let totalOfficialPicks = null;
    let pendingSettlementCount = null;
    let picksSourceStatus = 'unavailable';

    let openIncidentsCount = null;
    let incidentsSourceStatus = 'unavailable';

    let activeSubscribersCount = null;
    let subscribersSourceStatus = 'unavailable';

    let currentMonthGrossRevenueEUR = null;
    let revenueSourceStatus = 'unavailable';

    // 1. Picks oficiales
    try {
        pendingSettlementCount = await boundedCount(database.collection('officialPicks')
            .where('status', '==', 'published')
            .where('settlement.status', '==', 'pending'));

        totalOfficialPicks = await boundedCount(database.collection('officialPicks')
            .where('status', '==', 'published'));
        picksSourceStatus = pendingSettlementCount === null || totalOfficialPicks === null ? 'capped' : 'connected';
    } catch {
        picksSourceStatus = 'error';
    }

    // 2. Incidencias abiertas (Operations + Revenue)
    try {
        const opsCount = await boundedCount(database.collection('operationsIncidents')
            .where('status', '==', 'open'));
        const revCount = await boundedCount(database.collection('revenueIncidents')
            .where('status', '==', 'open'));
        openIncidentsCount = opsCount === null || revCount === null ? null : opsCount + revCount;
        incidentsSourceStatus = openIncidentsCount === null ? 'capped' : 'connected';
    } catch {
        incidentsSourceStatus = 'error';
    }

    // 3. Pedidos pagados en el mes actual
    try {
        const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const paymentsSnap = await database.collection('premiumPaymentOrders')
            .where('status', '==', 'paid')
            .where('paidAt', '>=', monthStart)
            .limit(OPS_READ_LIMITS.kpiDetailDocuments)
            .get();
        const payments = boundedCompleteDocs(paymentsSnap);
        if (payments === null) {
            revenueSourceStatus = 'capped';
        } else {
            let sum = 0;
            for (const doc of payments) {
                const amount = Number(doc.data().expectedAmount);
                if (!Number.isFinite(amount)) throw new Error('INVALID_PAYMENT_AMOUNT');
                sum += amount;
            }
            currentMonthGrossRevenueEUR = Number(sum.toFixed(2));
            revenueSourceStatus = 'connected';
        }
    } catch {
        revenueSourceStatus = 'error';
    }

    // 4. Suscriptores activos
    try {
        const entitlementsSnap = await database.collectionGroup('entitlements')
            .where('status', '==', 'active')
            .limit(OPS_READ_LIMITS.kpiDetailDocuments)
            .get();
        const entitlements = boundedCompleteDocs(entitlementsSnap);
        if (entitlements === null) {
            subscribersSourceStatus = 'capped';
        } else {
            const uniqueUsers = new Set();
            for (const doc of entitlements) {
                const data = doc.data();
                const accessUntil = data.accessUntil?.toDate ? data.accessUntil.toDate() : new Date(data.accessUntil);
                if (accessUntil > now) {
                    const userId = doc.ref.parent.parent?.id;
                    if (userId) uniqueUsers.add(userId);
                }
            }
            activeSubscribersCount = uniqueUsers.size;
            subscribersSourceStatus = 'connected';
        }
    } catch {
        subscribersSourceStatus = 'error';
    }

    const statuses = [picksSourceStatus, incidentsSourceStatus, revenueSourceStatus, subscribersSourceStatus];
    const allConnected = statuses.every(s => s === 'connected');
    const allFailed = statuses.every(s => s === 'error' || s === 'unavailable');

    // Si todas las fuentes fallaron y tenemos cache previa: fallback explícito a stale
    if (allFailed) {
        const lastEntry = opsReadCache.getEntry(cacheKey);
        if (lastEntry) {
            return {
                ...lastEntry.data,
                companyHealth: health.overall,
                healthDetails: health,
                status: 'stale',
                isStale: true,
                staleReason: 'ALL_SOURCES_FAILED',
                generatedAt: lastEntry.data.generatedAt,
                updatedAt: lastEntry.data.generatedAt
            };
        }
    }

    const overallKpiStatus = allFailed ? 'unavailable' : (allConnected ? 'connected' : 'degraded');

    const result = {
        companyHealth: health.overall,
        healthDetails: health,
        status: overallKpiStatus,
        isStale: false,
        staleReason: null,
        sourceStatus: {
            firestore: health.components.firestore?.status || 'UNKNOWN',
            subscribers: subscribersSourceStatus,
            revenue: revenueSourceStatus,
            incidents: incidentsSourceStatus,
            picks: picksSourceStatus
        },
        activeSubscribers: activeSubscribersCount,
        monthlyGrossRevenueEUR: currentMonthGrossRevenueEUR,
        openIncidents: openIncidentsCount,
        picksMetrics: {
            totalValidOfficialPicks: totalOfficialPicks,
            pendingSettlements: pendingSettlementCount,
            publishedSeasonPicks: totalOfficialPicks
        },
        automationStatus: {
            vpsWorker: health.components.vps_t5_worker?.status || 'UNKNOWN',
            settlementCron: health.components.settlement_01_00?.status || 'UNKNOWN'
        },
        generatedAt: now.toISOString(),
        updatedAt: now.toISOString()
    };

    // Solo guardar en cache si al menos una fuente tuvo éxito
    if (!allFailed) {
        opsReadCache.set(cacheKey, result);
    }

    return result;
}

/**
 * Lista y métricas de sistemas de apuestas registrados.
 */
export async function getOpsSystemsSummary() {
    const systems = Object.entries(SYSTEM_REGISTRY).map(([id, def]) => {
        return {
            id,
            name: def.name || id,
            executionMode: def.executionMode, // PRODUCTION, PAPER, T5
            timing: def.requiresT5 ? 'T_MINUS_5' : 'MORNING_10_00',
            tier: def.tier || 'OFFICIAL',
            market: def.market,
            defaultSelection: def.defaultSelection || null,
            baseStakePct: def.baseStakePct || 1.0,
            active: true
        };
    });

    const breakdown = {
        total: systems.length,
        production: systems.filter(s => s.executionMode !== SYSTEM_EXECUTION_MODES.PAPER).length,
        paper: systems.filter(s => s.executionMode === SYSTEM_EXECUTION_MODES.PAPER).length,
        t5Listening: systems.filter(s => s.timing === 'T_MINUS_5').length,
        morningReview: systems.filter(s => s.timing === 'MORNING_10_00').length
    };

    return {
        systems,
        breakdown
    };
}

/**
 * Lista de picks con paginación, filtros y estado de liquidación.
 */
export async function getOpsPicksSummary({
    db = null,
    limit = 50,
    offset = 0,
    status = null,
    systemId = null
} = {}) {
    let database = db;
    if (!database) {
        try { database = getAdminDb(); } catch { /* No Firebase credentials in isolated tests. */ }
    }

    const safeLimit = boundedPageSize(limit);
    const safeOffset = boundedPickOffset(offset);

    let picks = [];
    let sourceStatus = 'unavailable';

    if (database && typeof database.collection === 'function') {
        try {
            let query = database.collection('officialPicks')
                .where('status', '==', 'published')
                .orderBy('event.kickoffAt', 'desc');

            if (systemId) {
                query = query.where('system.id', '==', systemId);
            }

            if (status) {
                query = query.where('settlement.status', '==', status);
            }

            const snapshot = await query.limit(safeLimit + safeOffset).get();
            picks = snapshot.docs.map(doc => {
                const data = doc.data();
                const kickoff = data.event?.kickoffAt?.toDate ? data.event.kickoffAt.toDate().toISOString() : data.event?.kickoffAt;
                const settledAt = data.settlement?.settledAt?.toDate ? data.settlement.settledAt.toDate().toISOString() : data.settlement?.settledAt;

                return {
                    id: doc.id,
                    systemId: data.system?.id || null,
                    event: {
                        homeTeam: data.event?.homeTeam,
                        awayTeam: data.event?.awayTeam,
                        competition: data.event?.competition,
                        kickoffAt: kickoff
                    },
                    bet: {
                        market: data.bet?.market,
                        selection: data.bet?.selection,
                        odds: Number(data.bet?.oddsAtPublication) || null,
                        recommendedStakePct: data.bet?.recommendedStakePct ?? null
                    },
                    settlement: {
                        status: data.settlement?.status || 'pending',
                        score: data.settlement?.regularTimeScore || null,
                        reason: data.settlement?.reason || null,
                        settledAt
                    },
                    publishedAt: data.publishedAt?.toDate ? data.publishedAt.toDate().toISOString() : data.publishedAt
                };
            });

            picks = picks.slice(safeOffset, safeOffset + safeLimit);
            sourceStatus = 'connected';
        } catch (err) {
            console.error('[OPS_PICKS_READ_ERROR]', err.message);
            sourceStatus = 'error';
        }
    }

    return {
        count: picks.length,
        limit: safeLimit,
        offset: safeOffset,
        status: sourceStatus,
        picks
    };
}

/**
 * Incidencias técnicas y de facturación consolidadas.
 */
export async function getOpsIncidentsSummary({
    db = null,
    status = 'open',
    limit = 50
} = {}) {
    let database = db;
    if (!database) {
        try { database = getAdminDb(); } catch { /* No Firebase credentials in isolated tests. */ }
    }

    const safeLimit = boundedPageSize(limit);
    const incidents = [];
    let capped = false;
    let readError = false;

    if (database && typeof database.collection === 'function') {
        try {
            // 1. Incidencias técnicas (Operations / Data Performance)
            let opsQuery = database.collection('operationsIncidents');
            if (status) opsQuery = opsQuery.where('status', '==', status);
            const opsSnap = await opsQuery.limit(safeLimit).get();
            capped ||= opsSnap.docs.length === safeLimit;

            for (const doc of opsSnap.docs) {
                const data = doc.data();
                incidents.push({
                    id: doc.id,
                    domain: 'operations',
                    department: data.department || 'data_performance',
                    incidentType: data.incidentType,
                    severity: data.severity,
                    targetId: data.targetId,
                    status: data.status,
                    reason: data.reason,
                    escalateTo: data.escalateTo || 'karen',
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
                });
            }

            // 2. Incidencias de Revenue (Customers & Revenue)
            let revQuery = database.collection('revenueIncidents');
            if (status) revQuery = revQuery.where('status', '==', status);
            const revSnap = await revQuery.limit(safeLimit).get();
            capped ||= revSnap.docs.length === safeLimit;

            for (const doc of revSnap.docs) {
                const data = doc.data();
                incidents.push({
                    id: doc.id,
                    domain: 'revenue',
                    department: 'customers_revenue',
                    incidentType: data.incidentType,
                    severity: data.severity || 'action_required',
                    targetId: data.orderId || data.customerId,
                    status: data.status,
                    reason: data.reason,
                    escalateTo: data.escalateTo || 'karen',
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
                });
            }
        } catch (err) {
            console.error('[OPS_INCIDENTS_READ_ERROR]', err.message);
            readError = true;
        }
    }

    // Ordenar descendente por fecha
    incidents.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const isConnected = Boolean(database && typeof database.collection === 'function');

    return {
        total: isConnected && !readError && !capped ? incidents.length : null,
        sampleCount: incidents.length,
        status: !isConnected ? 'unavailable' : readError ? 'error' : capped ? 'capped' : 'connected',
        statusFilter: status,
        incidents: incidents.slice(0, safeLimit)
    };
}

/**
 * Resumen de rendimiento de sistemas Paper.
 */
export async function getOpsPaperSummary({ db = null, limit = 50 } = {}) {
    let database = db;
    if (!database) {
        try { database = getAdminDb(); } catch { /* No Firebase credentials in isolated tests. */ }
    }

    const safeLimit = boundedPageSize(limit);
    let paperPicks = [];
    let capped = false;
    let readError = false;

    if (database && typeof database.collection === 'function') {
        try {
            const snap = await database.collection('paperPicks')
                .orderBy('recordedAt', 'desc')
                .limit(safeLimit)
                .get();
            capped = snap.docs.length === safeLimit;

            paperPicks = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    systemId: d.system?.id,
                    event: `${d.event?.homeTeam} vs ${d.event?.awayTeam}`,
                    selection: d.bet?.selection,
                    odds: d.bet?.oddsAtPublication,
                    stake: 0,
                    status: d.settlement?.status || 'pending',
                    recordedAt: d.recordedAt?.toDate ? d.recordedAt.toDate().toISOString() : d.recordedAt
                };
            });
        } catch (err) {
            console.error('[OPS_PAPER_READ_ERROR]', err.message);
            readError = true;
        }
    }

    return {
        systemsTracked: ['MT - GER1 - v1.1', 'MT - TUR1 - V1.0', 'MT - POR1 - v1.0'],
        totalTrackedPicks: capped || readError || !database ? null : paperPicks.length,
        sampleCount: paperPicks.length,
        status: !database ? 'unavailable' : readError ? 'error' : capped ? 'capped' : 'connected',
        paperPicks
    };
}

/**
 * Resumen de automatizaciones (VPS, crons, workers).
 */
export async function getOpsAutomationSummary({ db = null, now = new Date() } = {}) {
    const health = await evaluateUnifiedHealth({ db, now });

    return {
        overallStatus: health.overall,
        vpsWorker: {
            service: 'moneytips-t5.service',
            host: 'mt-picks-risk-vps (188.245.21.120)',
            provider: 'Hetzner Cloud',
            status: health.components.vps_t5_worker.status,
            activeListening: health.components.vps_t5_worker.transport === 'TELEGRAM_MTPROTO_ACTIVE'
        },
        crons: {
            dailySettlement: {
                schedule: '01:00 Europe/Madrid',
                status: health.components.settlement_01_00.status,
                lastRunDate: health.components.settlement_01_00.lastRunDate || null
            },
            snapshotRefresh: {
                schedule: '04:17 UTC',
                status: 'UNKNOWN'
            }
        },
        checkedAt: health.checkedAt
    };
}
