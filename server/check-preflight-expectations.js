import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { PREFLIGHT_COLLECTION, PREFLIGHT_STATUSES } from './official-pick-preflight.js';
import {
    registerOperationsIncident,
    OPERATIONS_INCIDENT_TYPES,
    OPERATIONS_SEVERITIES,
    OPERATIONS_ESCALATION_TARGETS
} from './operations-incidents.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';
import { updateAgentState, HQ_UNIT_STATUSES, HQ_UNIT_TYPES } from '../api/_lib/agent-state.js';

const isAuthorizedCron = (req) => {
    const authHeader = req.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET || process.env.OFFICIAL_PICKS_DISPATCHER_SECRET;
    return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
};

/**
 * Escáner supervisor de expectativas T-5.
 * 
 * REGLA INVIOLABLE (Punto 6):
 * Si un pick T-5 esperado no recibe confirmación válida de Telegram a T-2 minutos del kickoff:
 * NO SE PUBLICA NUNCA.
 * Se marca como missed_expired, se emite incidencia en picks_risk y se alerta a Money Tips Ops.
 */
export const checkDuePreflightExpectations = async ({ db = null, now = new Date(), notifyOps = null } = {}) => {
    const database = db || getAdminDb();

    // Buscar expectativas que superaron la ventana T-2m sin confirmación
    const nowThreshold = (typeof Timestamp !== 'undefined' && Timestamp.fromDate)
        ? Timestamp.fromDate(now)
        : now;

    const snapshot = await database.collection(PREFLIGHT_COLLECTION)
        .where('status', '==', PREFLIGHT_STATUSES.AWAITING_TELEGRAM_T5)
        .where('expectedT5Window.end', '<=', nowThreshold)
        .limit(20)
        .get();

    const summary = {
        scanned: snapshot.size || snapshot.docs?.length || 0,
        missed: 0,
        errors: 0,
        results: []
    };

    for (const docSnapshot of (snapshot.docs || [])) {
        const preflight = docSnapshot.data();
        const preflightId = docSnapshot.id;

        try {
            // 1. Marcar como missed_expired (NUNCA auto-publicar)
            await docSnapshot.ref.update({
                status: PREFLIGHT_STATUSES.MISSED_EXPIRED,
                missedAt: FieldValue?.serverTimestamp ? FieldValue.serverTimestamp() : new Date(),
                updatedAt: FieldValue?.serverTimestamp ? FieldValue.serverTimestamp() : new Date()
            });

            // 2. Registrar incidencia en operationsIncidents con department: picks_risk
            const home = preflight.event?.homeTeam || 'Local';
            const away = preflight.event?.awayTeam || 'Visitante';
            const system = preflight.system?.id || preflight.systemId || 'T5';

            await registerOperationsIncident({
                department: DEPARTMENTS.PICKS_RISK,
                incidentType: OPERATIONS_INCIDENT_TYPES.T5_TELEGRAM_MISSED,
                severity: OPERATIONS_SEVERITIES.ACTION_REQUIRED,
                targetId: preflightId,
                reason: `Pick T-5 esperado para ${system} (${home} vs ${away}) no recibido por Telegram a T-2 min. Pick NO publicado por seguridad de modelo.`,
                escalateTo: OPERATIONS_ESCALATION_TARGETS.KAREN,
                details: { preflightId, system, home, away, expectedEnd: preflight.expectedT5Window?.end },
                db: database,
                notify: notifyOps
            });

            // 3. Log en systemEvents para Money Tips HQ
            await logSystemEvent({
                department: DEPARTMENTS.PICKS_RISK,
                workerId: 'preflight-supervisor',
                eventType: 'picks_risk.t5_expectation_missed',
                status: EVENT_STATUSES.ERROR,
                payload: { preflightId, system, home, away },
                rulesApplied: ['rule_t5_strict_no_telegram_no_publish']
            }).catch(() => {});

            // 4. Actualizar estado de unidad HQ
            await updateAgentState({
                id: 'picks-risk-supervisor',
                name: 'Picks & Risk Supervisor',
                department: DEPARTMENTS.PICKS_RISK,
                type: HQ_UNIT_TYPES.MONITOR,
                status: HQ_UNIT_STATUSES.WARNING,
                currentTask: `Pick T-5 no recibido: ${system} (${home} vs ${away})`,
                lastActivity: new Date(),
                error: { message: 'T5 Telegram missed' }
            }).catch(() => {});

            summary.missed += 1;
            summary.results.push({
                preflightId,
                action: 'marked_missed_expired_and_reported',
                system,
                home,
                away
            });
        } catch (err) {
            summary.errors += 1;
            console.error(`Error procesando preflight vencido ${preflightId}:`, err);
        }
    }

    return summary;
};

export const checkPreflightExpectations = checkDuePreflightExpectations;

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const results = await checkDuePreflightExpectations();
        return res.status(200).json({ ok: true, timestamp: new Date().toISOString(), ...results });
    } catch (error) {
        console.error('Error en cron de supervisión preflight T-5:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
}
