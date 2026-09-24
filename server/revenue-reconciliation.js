import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';
import { updateAgentState, HQ_UNIT_STATUSES, HQ_UNIT_TYPES } from '../api/_lib/agent-state.js';
import { registerRevenueIncident, REVENUE_INCIDENT_TYPES, ESCALATION_TARGETS } from './revenue-incidents.js';
import { toDate } from './subscription.js';

// Órdenes en estos estados aún no han recibido un callback de pago confirmado.
// El monitor las escanea para detectar abandonos o webhooks perdidos.
export const UNRESOLVED_ORDER_STATUSES = new Set(['pending', 'checkout_created']);

export const ORDER_MONITOR_CONSTANTS = {
    GRACE_PERIOD_MINUTES: 15,
    ABANDONED_EXPIRY_MINUTES: 120, // 2 horas sin callback ni pago -> abandonado
    MAX_LOOKBACK_HOURS: 48,
    // PremiumPay NO ofrece un endpoint GET para consultar el estado de un pago
    // individual. La verificación de pagos sin callback requiere comprobación
    // manual en el backoffice de Betandeal.
    RECONCILIATION_MODE: 'manual_review_required'
};

/**
 * @deprecated Use ORDER_MONITOR_CONSTANTS instead.
 * Alias retained for backward compatibility with existing tests.
 */
export const RECONCILIATION_CONSTANTS = ORDER_MONITOR_CONSTANTS;

/**
 * Escanea pedidos no resueltos (pending / checkout_created) y gestiona su ciclo de vida:
 *
 * 1. < 15 min: dentro de la ventana de cortesía del checkout — no se toca.
 * 2. 15 min – 2 h: posible webhook perdido → registra incidencia para revisión
 *    manual en el backoffice de Betandeal (reconciliationMode: manual_review_required).
 * 3. > 2 h: marca la orden como `abandoned`. Si un callback retrasado llega
 *    después, el handler de callback sigue aceptándola y activa Premium
 *    normalmente (ver C2 en la auditoría de seguridad).
 *
 * IMPORTANTE: Este módulo NO es un motor de reconciliación automática.
 * PremiumPay no expone un endpoint de consulta de pago individual.
 * La verificación real cuando falta un webhook requiere que Ops compruebe
 * el extracto en el backoffice de Betandeal.
 */
export const scanUnresolvedOrders = async ({
    db = getAdminDb(),
    now = new Date()
} = {}) => {
    const startedAt = now;
    const workerId = 'revenue-order-monitor';

    await updateAgentState({
        id: workerId,
        name: 'Revenue Order Monitor',
        department: DEPARTMENTS.CUSTOMERS_REVENUE,
        type: HQ_UNIT_TYPES.WORKER,
        status: HQ_UNIT_STATUSES.WORKING,
        currentTask: 'Escaneando pedidos no resueltos',
        startedAt,
        actionsAvailable: ['scan_unresolved_orders', 'expire_abandoned_orders', 'escalate_orphan_orders']
    }).catch(() => {});

    // Firestore `in` query soporta hasta 30 valores — aquí son 2.
    const snapshot = await db.collection('premiumPaymentOrders')
        .where('status', 'in', [...UNRESOLVED_ORDER_STATUSES])
        .get();

    const results = {
        totalScanned: snapshot.size,
        stillWithinGrace: 0,
        expiredAbandoned: 0,
        incidentsRegistered: 0,
        reconciliationMode: ORDER_MONITOR_CONSTANTS.RECONCILIATION_MODE,
        errors: 0
    };

    const currentTimeMs = now.getTime();
    const gracePeriodMs = ORDER_MONITOR_CONSTANTS.GRACE_PERIOD_MINUTES * 60 * 1000;
    const abandonExpiryMs = ORDER_MONITOR_CONSTANTS.ABANDONED_EXPIRY_MINUTES * 60 * 1000;

    for (const doc of snapshot.docs) {
        const orderId = doc.id;
        const order = doc.data();
        const createdAt = toDate(order.createdAt);
        if (!createdAt) continue;

        const ageMs = currentTimeMs - createdAt.getTime();

        // 1. Aún dentro de la ventana de cortesía de checkout (< 15 min)
        if (ageMs < gracePeriodMs) {
            results.stillWithinGrace += 1;
            continue;
        }

        // 2. Supera la ventana de abandono (>= 2 horas sin callback)
        if (ageMs >= abandonExpiryMs) {
            try {
                await db.runTransaction(async (transaction) => {
                    const freshDoc = await transaction.get(doc.ref);
                    if (!freshDoc.exists) return;
                    const freshStatus = freshDoc.data().status;
                    // Solo transicionar si la orden sigue sin resolver
                    if (!UNRESOLVED_ORDER_STATUSES.has(freshStatus)) return;

                    transaction.update(doc.ref, {
                        status: 'abandoned',
                        previousStatus: freshStatus,
                        abandonedAt: now,
                        updatedAt: FieldValue.serverTimestamp(),
                        reconciliationNote: `Expirado tras ${Math.round(ageMs / 60000)} minutos sin confirmación de pago. Si el cliente pagó realmente, un callback retrasado seguirá activando Premium.`
                    });
                });
                results.expiredAbandoned += 1;

                await logSystemEvent({
                    department: DEPARTMENTS.CUSTOMERS_REVENUE,
                    workerId,
                    eventType: 'order.abandoned',
                    status: EVENT_STATUSES.SUCCESS,
                    payload: { orderId, uid: order.uid, previousStatus: order.status, ageMinutes: Math.round(ageMs / 60000) },
                    rulesApplied: ['rule_abandoned_order_timeout', 'rule_late_callback_still_accepted'],
                    output: { markedStatus: 'abandoned', reconciliationMode: ORDER_MONITOR_CONSTANTS.RECONCILIATION_MODE }
                }).catch(() => {});
            } catch (err) {
                results.errors += 1;
                console.error(`Error al marcar orden abandonada ${orderId}:`, err);
            }
            continue;
        }

        // 3. Entre 15 min y 2 horas: Ventana crítica de posible webhook perdido
        if (order.reconciliationAlerted) {
            continue;
        }

        // Registrar incidencia preventiva y alertar a Ops para revisión manual en Betandeal
        try {
            await registerRevenueIncident({
                incidentType: REVENUE_INCIDENT_TYPES.ORPHAN_PAYMENT,
                orderId,
                uid: order.uid,
                email: order.email,
                amount: order.expectedAmount,
                currency: order.currency,
                reason: `Pedido en estado '${order.status}' durante ${Math.round(ageMs / 60000)} minutos sin callback de PremiumPay. Verificar pago en backoffice de Betandeal.`,
                escalateTo: ESCALATION_TARGETS.KAREN
            });

            await doc.ref.update({
                reconciliationAlerted: true,
                reconciliationAlertedAt: now,
                updatedAt: FieldValue.serverTimestamp()
            });

            results.incidentsRegistered += 1;
        } catch (err) {
            results.errors += 1;
            console.error(`Error al registrar alerta preventiva para orden ${orderId}:`, err);
        }
    }

    const completedAt = new Date();
    await updateAgentState({
        id: workerId,
        name: 'Revenue Order Monitor',
        department: DEPARTMENTS.CUSTOMERS_REVENUE,
        type: HQ_UNIT_TYPES.WORKER,
        status: results.errors > 0 ? HQ_UNIT_STATUSES.ERROR : HQ_UNIT_STATUSES.IDLE,
        currentTask: 'Monitorización de pedidos completada',
        startedAt,
        completedAt,
        lastActivity: completedAt,
        result: results,
        error: results.errors > 0 ? { message: `Hubo ${results.errors} errores durante la monitorización.` } : null,
        actionsAvailable: ['scan_unresolved_orders', 'expire_abandoned_orders', 'escalate_orphan_orders']
    }).catch(() => {});

    return results;
};

// Backward-compatible alias
export const reconcilePendingOrders = scanUnresolvedOrders;
