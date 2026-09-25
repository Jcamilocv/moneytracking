// Every limit is a maximum per HTTP request, including requests that bypass a cache.
// Firestore count() scans index entries, not documents; the query limit bounds those too.
export const OPS_READ_LIMITS = Object.freeze({
    healthDocuments: 8, // cronLocks: 1 query + 1 document; revenueIncidents: 6
    healthIncidentDocuments: 6,
    kpiDetailDocuments: 21, // 20 complete records plus one overflow sentinel
    kpiCountIndexEntries: 1000,
    kpiDocuments: 50, // health (8) + payments (21) + entitlements (21)
    incidentDocuments: 200,
    pickDocuments: 200,
    paperDocuments: 100,
    auditDocuments: 200,
    pickOffset: 100
});

export function boundedPageSize(value, defaultSize = 50) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
        ? Math.min(Math.floor(number), 100)
        : defaultSize;
}

export function boundedPickOffset(value) {
    const number = Number(value || 0);
    if (!Number.isSafeInteger(number) || number < 0 || number > OPS_READ_LIMITS.pickOffset) {
        const error = new Error(`El offset de picks debe estar entre 0 y ${OPS_READ_LIMITS.pickOffset}.`);
        error.code = 'OPS_READ_BUDGET_EXCEEDED';
        throw error;
    }
    return number;
}

export function boundedAuditOffset(value) {
    const number = Number(value || 0);
    if (!Number.isSafeInteger(number) || number < 0 || number > 100) {
        const error = new Error('El offset de auditoría debe estar entre 0 y 100.');
        error.code = 'OPS_READ_BUDGET_EXCEEDED';
        throw error;
    }
    return number;
}

export async function boundedCount(query) {
    // Fail closed if the SDK/mock cannot provide a native count aggregation.
    // A document get() fallback would reintroduce collection scans.
    const snapshot = await query.limit(OPS_READ_LIMITS.kpiCountIndexEntries).count().get();
    const count = snapshot.data()?.count;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_COUNT_AGGREGATION');
    return count < OPS_READ_LIMITS.kpiCountIndexEntries ? count : null;
}

export function boundedCompleteDocs(snapshot) {
    if (!Array.isArray(snapshot.docs)) throw new Error('INVALID_QUERY_SNAPSHOT');
    return snapshot.docs.length < OPS_READ_LIMITS.kpiDetailDocuments ? snapshot.docs : null;
}
