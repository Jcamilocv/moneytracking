import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../../api/_lib/firebase-admin.js';
import { isOpsReadOnlyMode, readOnlyError } from './read-only-mode.js';
import { boundedAuditOffset, boundedPageSize } from './read-safety.js';

// Lista exhaustiva de claves sensibles que deben ser redactadas del audit log
const SENSITIVE_KEY_PATTERNS = [
    /token/i,
    /secret/i,
    /password/i,
    /credential/i,
    /private_?key/i,
    /service_?account/i,
    /hash/i,
    /string_?session/i,
    /authorization/i,
    /api_?key/i,
    /cookie/i,
    /bearer/i
];

/**
 * Redacta recursivamente secretos y datos sensibles de cualquier objeto para auditoría.
 */
export function sanitizeForAudit(data) {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object') return data;

    if (data instanceof Date) return data.toISOString();

    if (Array.isArray(data)) {
        return data.map(item => sanitizeForAudit(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
        if (isSensitive) {
            sanitized[key] = '[REDACTED_SECRET]';
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeForAudit(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

// In-memory ledger para testing y fallback local
export const inMemoryAuditLogs = [];

/**
 * Registra una acción administrativa u operativa en el log de auditoría central.
 */
export async function logOpsAudit({
    actor = 'system',
    action,
    entityType,
    entityId,
    before = null,
    after = null,
    reason,
    source = 'ops_api',
    correlationId = null,
    metadata = null,
    db = null,
    now = new Date()
} = {}) {
    if (isOpsReadOnlyMode()) throw readOnlyError();
    if (!action) throw new Error('AUDIT_LOG_ERROR: action is required');
    if (!entityType) throw new Error('AUDIT_LOG_ERROR: entityType is required');
    if (!entityId) throw new Error('AUDIT_LOG_ERROR: entityId is required');
    if (!reason) throw new Error('AUDIT_LOG_ERROR: reason is required for administrative actions');

    const auditId = `audit_${randomUUID()}`;
    const corrId = correlationId || `corr_${randomUUID()}`;

    const dateUTC = now.toISOString();
    const dateMadrid = new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(now);

    const auditRecord = {
        id: auditId,
        actor: typeof actor === 'string' ? { id: actor, type: 'user' } : actor,
        action,
        entityType,
        entityId: String(entityId),
        before: sanitizeForAudit(before),
        after: sanitizeForAudit(after),
        reason: String(reason).trim(),
        source,
        correlationId: corrId,
        metadata: sanitizeForAudit(metadata),
        timestamp: dateUTC,
        timestampMadrid: dateMadrid
    };

    // Almacenar en inMemoryAuditLogs
    inMemoryAuditLogs.push(auditRecord);
    if (inMemoryAuditLogs.length > 500) {
        inMemoryAuditLogs.shift();
    }

    // Persistir en Firestore si la base de datos está disponible
    let database = db;
    if (!database) {
        try {
            database = getAdminDb();
        } catch {
            // Entorno de test o sin credenciales Firestore
        }
    }

    if (database && typeof database.collection === 'function') {
        try {
            const serverTs = (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp)
                ? FieldValue.serverTimestamp()
                : now;
            await database.collection('opsAuditLogs').doc(auditId).set({
                ...auditRecord,
                createdAt: serverTs
            });
        } catch (err) {
            console.error('[OPS_AUDIT_WARNING] Failed to persist audit log to Firestore:', err.message);
        }
    }

    return auditRecord;
}

/**
 * Consulta registros de auditoría filtrados.
 */
export async function listOpsAuditLogs({
    entityType = null,
    entityId = null,
    actorId = null,
    action = null,
    limit = 50,
    offset = 0,
    strict = false,
    db = null
} = {}) {
    const safeLimit = boundedPageSize(limit);
    const safeOffset = boundedAuditOffset(offset);

    let database = db;
    if (!database) {
        try {
            database = getAdminDb();
        } catch {
            // fallback in-memory
        }
    }

    if (database && typeof database.collection === 'function') {
        try {
            let query = database.collection('opsAuditLogs').orderBy('timestamp', 'desc');
            if (entityType) query = query.where('entityType', '==', entityType);
            if (entityId) query = query.where('entityId', '==', String(entityId));
            if (action) query = query.where('action', '==', action);

            const snapshot = await query.limit(safeLimit + safeOffset).get();
            if (strict) return snapshot.docs.slice(safeOffset, safeOffset + safeLimit).map(doc => doc.data());
            if (!snapshot.empty) {
                return snapshot.docs.slice(safeOffset, safeOffset + safeLimit).map(doc => doc.data());
            }
        } catch (error) {
            if (strict) throw error;
            // fallback in-memory on error
        }
    }

    if (strict) throw new Error('FIRESTORE_UNAVAILABLE');

    // Filtrar in-memory
    let filtered = [...inMemoryAuditLogs].reverse();
    if (entityType) filtered = filtered.filter(l => l.entityType === entityType);
    if (entityId) filtered = filtered.filter(l => l.entityId === String(entityId));
    if (actorId) filtered = filtered.filter(l => l.actor?.id === actorId);
    if (action) filtered = filtered.filter(l => l.action === action);

    return filtered.slice(safeOffset, safeOffset + safeLimit);
}
