import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';

export const DEPARTMENTS = {
    OPERATIONS: 'operations',
    CUSTOMERS_REVENUE: 'customers_revenue',
    PICKS_RISK: 'picks_risk',
    DATA_PERFORMANCE: 'data_performance',
    GROWTH_MARKETING: 'growth_marketing',
    PRODUCT_TECH: 'product_technology'
};

export const EVENT_STATUSES = {
    SUCCESS: 'success',
    ERROR: 'error',
    RETRY: 'retry',
    BLOCKED: 'blocked',
    PENDING_HUMAN_REVIEW: 'pending_human_review'
};

/**
 * Normaliza y persiste un evento en la colección central `systemEvents`.
 * Contrato inmutable: ningún evento previo se reescribe; todos tienen timestamp de servidor.
 */
export const logSystemEvent = async ({
    eventId = null,
    correlationId = null,
    department,
    workerId,
    eventType,
    status = EVENT_STATUSES.SUCCESS,
    payload = {},
    rulesApplied = [],
    output = {},
    attempt = 1,
    error = null,
    reversionRef = null
}) => {
    if (!department) throw new Error('Se requiere departamento para el evento de sistema.');
    if (!workerId) throw new Error('Se requiere workerId / unidad responsable.');
    if (!eventType) throw new Error('Se requiere eventType.');

    const finalEventId = eventId || `evt_${randomUUID()}`;
    const finalCorrelationId = correlationId || `corr_${randomUUID()}`;
    const db = getAdminDb();

    const eventRecord = {
        schemaVersion: 1,
        eventId: finalEventId,
        correlationId: finalCorrelationId,
        department,
        workerId,
        eventType,
        status,
        payload: payload || {},
        rulesApplied: Array.isArray(rulesApplied) ? rulesApplied : [],
        output: output || {},
        attempt: Number(attempt) || 1,
        error: error ? {
            message: String(error.message || error).slice(0, 500),
            code: error.code || null,
            stack: error.stack ? String(error.stack).slice(0, 1000) : null
        } : null,
        reversionRef: reversionRef || null,
        createdAt: FieldValue.serverTimestamp()
    };

    const eventRef = db.collection('systemEvents').doc(finalEventId);
    await eventRef.set(eventRecord);

    return {
        eventId: finalEventId,
        correlationId: finalCorrelationId,
        eventRecord
    };
};
