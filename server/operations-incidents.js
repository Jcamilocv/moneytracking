import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';
import { updateAgentState, HQ_UNIT_STATUSES, HQ_UNIT_TYPES } from '../api/_lib/agent-state.js';
import { notifyOperations } from './operations-alerts.js';

export const OPERATIONS_INCIDENT_TYPES = {
    AUTO_COPY_FAILED: 'auto_copy_failed',
    SETTLEMENT_AMBIGUOUS: 'settlement_ambiguous',
    T5_TELEGRAM_MISSED: 't5_telegram_missed',
    SYSTEM_REGISTRY_UNMATCHED: 'system_registry_unmatched',
    TELEGRAM_INGEST_ERROR: 'telegram_ingest_error',
    PROVIDER_ERROR: 'provider_error',
    DATA_SYNC_ERROR: 'data_sync_error',
    SYSTEM_ERROR: 'system_error'
};

export const OPERATIONS_SEVERITIES = {
    CRITICAL: 'critical',
    ACTION_REQUIRED: 'action_required',
    WARNING: 'warning',
    INFO: 'info'
};

export const OPERATIONS_ESCALATION_TARGETS = {
    KAREN: 'karen',
    SENOR_CORTES: 'senor_cortes'
};

/**
 * Registra una incidencia operativa para un departamento técnico (ej: data_performance, growth, platform).
 * 
 * REGLA ARQUITECTÓNICA:
 * revenueIncidents queda estrictamente reservado para Customers & Revenue.
 * Cualquier incidencia técnica u operativa se registra en operationsIncidents con su departamento explícito.
 */
export const registerOperationsIncident = async ({
    department = DEPARTMENTS.DATA_PERFORMANCE,
    incidentType,
    severity = OPERATIONS_SEVERITIES.ACTION_REQUIRED,
    targetId = null,
    reason,
    status = 'open',
    escalateTo = OPERATIONS_ESCALATION_TARGETS.KAREN,
    details = null,
    db = null,
    notify = null
}) => {
    let database = db;
    if (!database) {
        try {
            database = getAdminDb();
        } catch {
            // Graceful when running unit tests without Firebase admin credentials
        }
    }
    const incidentId = `inc_ops_${randomUUID()}`;

    const incidentRecord = {
        incidentId,
        schemaVersion: 1,
        department,
        incidentType,
        severity,
        targetId: targetId ? String(targetId) : null,
        reason: String(reason || '').slice(0, 500),
        status,
        escalateTo,
        details: details || null,
        createdAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date(),
        updatedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date()
    };

    // 1. Persistir incidencia en colección operationsIncidents
    if (database) {
        const incidentRef = database.collection('operationsIncidents').doc(incidentId);
        await incidentRef.set(incidentRecord);
    }

    // 2. Emitir log en systemEvents con el departamento correspondiente
    await logSystemEvent({
        department,
        workerId: 'operations-incident-manager',
        eventType: `${department}.incident_logged`,
        status: EVENT_STATUSES.ERROR,
        payload: {
            incidentId,
            incidentType,
            targetId,
            department
        },
        rulesApplied: ['rule_operations_incident_escalation'],
        error: {
            code: incidentType,
            message: reason,
            escalatedTo: escalateTo
        }
    }).catch((err) => console.error(`Error logging system event for operations incident (${department}):`, err));

    // 3. Actualizar estado de unidad HQ
    const workerId = department === DEPARTMENTS.DATA_PERFORMANCE
        ? 'data-performance-incident-worker'
        : 'operations-incident-worker';

    await updateAgentState({
        id: workerId,
        name: `Operations Manager (${department.toUpperCase()})`,
        department,
        type: HQ_UNIT_TYPES.WORKER,
        status: HQ_UNIT_STATUSES.ERROR,
        currentTask: `Incidencia en ${department}: ${reason}`,
        error: {
            code: incidentType,
            message: reason,
            escalatedTo: escalateTo
        },
        actionsAvailable: ['retry_task', 'manual_resolve', 'escalate']
    }).catch((err) => console.error(`Error updating HQ state for operations incident (${department}):`, err));

    // 4. Alertar al canal de operaciones (Telegram) - Money Tips Ops
    // REGLA INVIOLABLE (Punto 2): Money Tips Ops NO debe recibir actividad rutinaria.
    // Solo recibe eventos que requieran atención humana (action_required, critical, warning relevante).
    const requiresOpsAlert = [OPERATIONS_SEVERITIES.CRITICAL, OPERATIONS_SEVERITIES.ACTION_REQUIRED, OPERATIONS_SEVERITIES.WARNING].includes(severity);

    if (requiresOpsAlert) {
        const deptTitle = department.replace('_', ' & ').toUpperCase();
        const alertKey = `ops-incident-${targetId || incidentId}`;
        const alertText = [
            `🚨 <b>INCIDENCIA OPERATIVA [${deptTitle}]</b>`,
            `<b>Severidad:</b> ${severity.toUpperCase()}`,
            '',
            `<b>Tipo:</b> ${incidentType}`,
            `<b>Motivo:</b> ${reason}`,
            targetId ? `<b>ID Ref:</b> <code>${targetId}</code>` : '',
            `<b>Escalado a:</b> ${escalateTo === OPERATIONS_ESCALATION_TARGETS.SENOR_CORTES ? 'Señor Cortés (CEO)' : 'Karen (COO)'}`,
            `<b>ID Incidencia:</b> <code>${incidentId}</code>`
        ].filter(Boolean).join('\n');

        if (typeof notify === 'function') {
            await notify({ key: alertKey, text: alertText });
        } else {
            await notifyOperations({ key: alertKey, text: alertText }).catch((err) => {
                console.error('Error al enviar alerta operativa a canal de operaciones:', err);
            });
        }
    }

    return { incidentId, ...incidentRecord };
};

/**
 * Reconoce (acknowledge) una incidencia operativa.
 */
export const acknowledgeOperationsIncident = async ({
    incidentId,
    acknowledgedBy = 'karen',
    db = null
}) => {
    let database = db;
    if (!database) {
        try {
            database = getAdminDb();
        } catch {
            // Graceful when running unit tests without Firebase admin credentials
        }
    }
    if (database) {
        const incidentRef = database.collection('operationsIncidents').doc(incidentId);
        await incidentRef.update({
            status: 'acknowledged',
            acknowledgedBy,
            acknowledgedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date(),
            updatedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date()
        });
    }
    return { incidentId, status: 'acknowledged', acknowledgedBy };
};

/**
 * Resuelve una incidencia operativa abierta.
 */
export const resolveOperationsIncident = async ({
    incidentId,
    resolvedBy = 'karen',
    resolutionNotes = '',
    resolutionNote = '',
    db = null
}) => {
    let database = db;
    if (!database) {
        try {
            database = getAdminDb();
        } catch {
            // Graceful when running unit tests without Firebase admin credentials
        }
    }
    const note = resolutionNotes || resolutionNote || '';
    if (database) {
        const incidentRef = database.collection('operationsIncidents').doc(incidentId);
        const snapshot = await incidentRef.get();
        if (snapshot.exists) {
            const data = snapshot.data();
            await incidentRef.update({
                status: 'resolved',
                resolvedBy,
                resolutionNotes: String(note).slice(0, 500),
                resolvedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date(),
                updatedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date()
            });

            await logSystemEvent({
                department: data.department || DEPARTMENTS.DATA_PERFORMANCE,
                workerId: 'operations-incident-manager',
                eventType: `${data.department || DEPARTMENTS.DATA_PERFORMANCE}.incident_resolved`,
                status: EVENT_STATUSES.SUCCESS,
                payload: { incidentId, resolvedBy, resolutionNotes: note },
                rulesApplied: ['rule_operations_incident_resolution']
            }).catch(() => {});
        }
    }

    return { incidentId, status: 'resolved', resolvedBy };
};
