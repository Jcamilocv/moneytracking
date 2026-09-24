import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';

export const HQ_UNIT_STATUSES = {
    IDLE: 'idle',
    WORKING: 'working',
    WAITING: 'waiting',
    BLOCKED: 'blocked',
    ERROR: 'error',
    COMPLETED: 'completed'
};

export const HQ_UNIT_TYPES = {
    AGENT: 'agent',
    WORKFLOW: 'workflow',
    BOT: 'bot',
    WORKER: 'worker',
    API: 'api'
};

/**
 * Actualiza el estado de una unidad operativa en `agentStates/{id}`.
 * Sigue el contrato oficial consumible por la futura oficina visual Money Tips HQ.
 */
export const updateAgentState = async ({
    id,
    name,
    department,
    type = HQ_UNIT_TYPES.WORKER,
    status = HQ_UNIT_STATUSES.IDLE,
    currentTask = null,
    startedAt = null,
    completedAt = null,
    result = null,
    error = null,
    retryCount = 0,
    cost = { tokens: 0, estimatedEur: 0 },
    model = null,
    actionsAvailable = ['retry', 'pause', 'resume', 'escalate']
}) => {
    if (!id) throw new Error('Se requiere id para agentState.');
    if (!name) throw new Error('Se requiere name para agentState.');
    if (!department) throw new Error('Se requiere department para agentState.');

    const db = getAdminDb();
    const unitRef = db.collection('agentStates').doc(id);

    const updatePayload = {
        id,
        name,
        department,
        type,
        status,
        currentTask: currentTask || null,
        lastActivity: FieldValue.serverTimestamp(),
        retryCount: Number(retryCount) || 0,
        cost: cost || { tokens: 0, estimatedEur: 0 },
        model: model || null,
        actionsAvailable: Array.isArray(actionsAvailable) ? actionsAvailable : []
    };

    if (startedAt !== undefined) updatePayload.startedAt = startedAt;
    if (completedAt !== undefined) updatePayload.completedAt = completedAt;
    if (result !== undefined) updatePayload.result = result;
    if (error !== undefined) {
        updatePayload.error = error ? {
            code: error.code || 'ERR_GENERIC',
            message: String(error.message || error).slice(0, 500),
            escalatedTo: error.escalatedTo || null
        } : null;
    }

    await unitRef.set(updatePayload, { merge: true });
    return updatePayload;
};
