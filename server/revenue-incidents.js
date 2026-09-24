import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';
import { updateAgentState, HQ_UNIT_STATUSES, HQ_UNIT_TYPES } from '../api/_lib/agent-state.js';
import { notifyOperations } from './operations-alerts.js';

export const REVENUE_INCIDENT_TYPES = {
    PAYMENT_GATEWAY_ERROR: 'payment_gateway_error',
    VALIDATION_MISMATCH: 'validation_mismatch',
    ORPHAN_PAYMENT: 'orphan_payment',
    SUBSCRIPTION_DISCREPANCY: 'subscription_discrepancy'
};

export const ESCALATION_TARGETS = {
    KAREN: 'karen',
    SENOR_CORTES: 'senor_cortes'
};

/**
 * Registra una incidencia de pago o suscripción con persistencia transaccional,
 * log centralizado en systemEvents, actualización en agentStates y alerta inmediata a Ops.
 */
export const registerRevenueIncident = async ({
    incidentType,
    orderId = null,
    uid = null,
    email = null,
    amount = null,
    currency = 'EUR',
    reason,
    providerResponse = null,
    escalateTo = ESCALATION_TARGETS.KAREN
}) => {
    const db = getAdminDb();
    const incidentId = `inc_rev_${randomUUID()}`;
    const now = new Date();

    const incidentRecord = {
        incidentId,
        schemaVersion: 1,
        incidentType,
        orderId: orderId || null,
        uid: uid || null,
        email: email || null,
        amount: amount !== null ? Number(amount) : null,
        currency,
        reason: String(reason || '').slice(0, 500),
        status: 'open',
        escalateTo,
        providerResponse: providerResponse || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    };

    // 1. Persistir incidencia en colección dedicada
    const incidentRef = db.collection('revenueIncidents').doc(incidentId);
    await incidentRef.set(incidentRecord);

    // 2. Emitir log en systemEvents
    await logSystemEvent({
        department: DEPARTMENTS.CUSTOMERS_REVENUE,
        workerId: 'revenue-incident-manager',
        eventType: 'revenue.incident_logged',
        status: EVENT_STATUSES.ERROR,
        payload: {
            incidentId,
            incidentType,
            orderId,
            uid,
            email,
            amount
        },
        rulesApplied: ['rule_incident_escalation'],
        error: {
            code: incidentType,
            message: reason,
            escalatedTo: escalateTo
        }
    }).catch((err) => console.error('Error logging system event for revenue incident:', err));

    // 3. Actualizar estado de unidad HQ
    await updateAgentState({
        id: 'customers-revenue-worker',
        name: 'Customers & Revenue Engine',
        department: DEPARTMENTS.CUSTOMERS_REVENUE,
        type: HQ_UNIT_TYPES.WORKER,
        status: HQ_UNIT_STATUSES.ERROR,
        currentTask: `Incidencia en pago: ${reason}`,
        error: {
            code: incidentType,
            message: reason,
            escalatedTo: escalateTo
        },
        actionsAvailable: ['retry_payment_sync', 'manual_resolve', 'escalate']
    }).catch((err) => console.error('Error updating HQ state for revenue incident:', err));

    // 4. Alertar al canal de operaciones (Telegram)
    const alertKey = `revenue-incident-${orderId || incidentId}`;
    const alertText = [
        '🚨 <b>INCIDENCIA EN CUSTOMERS & REVENUE</b>',
        '',
        `<b>Tipo:</b> ${incidentType}`,
        `<b>Motivo:</b> ${reason}`,
        orderId ? `<b>Pedido:</b> <code>${orderId}</code>` : '',
        email ? `<b>Cliente:</b> ${email}` : '',
        amount ? `<b>Importe:</b> ${amount} ${currency}` : '',
        `<b>Escalado a:</b> ${escalateTo === ESCALATION_TARGETS.SENOR_CORTES ? 'Señor Cortés (CEO)' : 'Karen (COO)'}`,
        `<b>ID Incidencia:</b> <code>${incidentId}</code>`
    ].filter(Boolean).join('\n');

    await notifyOperations({ key: alertKey, text: alertText }).catch((err) => {
        console.error('Error al enviar alerta a canal de operaciones:', err);
    });

    return { incidentId, ...incidentRecord };
};

/**
 * Resuelve una incidencia de pago abierta (auditoría y estado completado).
 */
export const resolveRevenueIncident = async ({
    incidentId,
    resolvedBy = 'karen',
    resolutionNotes
}) => {
    const db = getAdminDb();
    const incidentRef = db.collection('revenueIncidents').doc(incidentId);
    const snapshot = await incidentRef.get();
    if (!snapshot.exists) throw new Error('Incidencia no encontrada.');

    await incidentRef.update({
        status: 'resolved',
        resolvedBy,
        resolutionNotes: String(resolutionNotes || '').slice(0, 500),
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });

    await logSystemEvent({
        department: DEPARTMENTS.CUSTOMERS_REVENUE,
        workerId: 'revenue-incident-manager',
        eventType: 'revenue.incident_resolved',
        status: EVENT_STATUSES.SUCCESS,
        payload: { incidentId, resolvedBy, resolutionNotes },
        rulesApplied: ['rule_incident_resolution']
    }).catch(() => {});

    await updateAgentState({
        id: 'customers-revenue-worker',
        name: 'Customers & Revenue Engine',
        department: DEPARTMENTS.CUSTOMERS_REVENUE,
        type: HQ_UNIT_TYPES.WORKER,
        status: HQ_UNIT_STATUSES.IDLE,
        currentTask: null,
        error: null
    }).catch(() => {});

    return { ok: true, incidentId, status: 'resolved' };
};
