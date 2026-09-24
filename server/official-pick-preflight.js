import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { preflightKeyForEvent } from '../api/_lib/official-pick-data.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';

export const PREFLIGHT_STATUSES = Object.freeze({
    AWAITING_TELEGRAM_T5: 'awaiting_telegram_t5',
    CONFIRMED_PUBLISHED: 'confirmed_published',
    MISSED_EXPIRED: 'missed_expired'
});

export const PREFLIGHT_COLLECTION = 'officialPickPreflight';

/**
 * Registra una expectativa de pick para un sistema T5.
 * 
 * REGLA INVIOLABLE:
 * El preflight representa exclusivamente una expectativa monitorizada ("esperamos un pick para este partido").
 * UN PREFLIGHT NUNCA PUEDE PUBLICAR UN PICK T5 NI REEMPLAZAR LA CONFIRMACIÓN DE TELEGRAM.
 */
export const registerOfficialPickPreflight = async ({
    event,
    system,
    source = {},
    db = null,
    now = new Date()
} = {}) => {
    if (!event || !system?.id) throw new Error('Faltan datos de evento o sistema para registrar preflight');

    const database = db || getAdminDb();
    const preflightId = preflightKeyForEvent({ event, system });
    const preflightRef = database.collection(PREFLIGHT_COLLECTION).doc(preflightId);

    const kickoffAt = event.kickoffAt instanceof Date ? event.kickoffAt : new Date(event.kickoffAt);
    const expectedT5WindowStart = new Date(kickoffAt.getTime() - 7 * 60 * 1000); // T-7m
    const expectedT5WindowEnd = new Date(kickoffAt.getTime() - 2 * 60 * 1000);   // T-2m

    const existingSnap = await preflightRef.get();
    if (existingSnap.exists) {
        const data = existingSnap.data();
        if (data.status === PREFLIGHT_STATUSES.CONFIRMED_PUBLISHED) {
            return { registered: false, preflightId, status: data.status, confirmedPickId: data.confirmedPickId };
        }
    }

    const payload = {
        schemaVersion: 1,
        preflightId,
        systemId: String(system.id).trim(),
        system: {
            id: String(system.id).trim()
        },
        event: {
            sourceEventId: event.sourceEventId ? String(event.sourceEventId) : null,
            competition: String(event.competition || '').trim(),
            homeTeam: String(event.homeTeam || '').trim(),
            awayTeam: String(event.awayTeam || '').trim(),
            kickoffAt: (typeof Timestamp !== 'undefined' && Timestamp.fromDate) ? Timestamp.fromDate(kickoffAt) : kickoffAt
        },
        expectedT5Window: {
            start: (typeof Timestamp !== 'undefined' && Timestamp.fromDate) ? Timestamp.fromDate(expectedT5WindowStart) : expectedT5WindowStart,
            end: (typeof Timestamp !== 'undefined' && Timestamp.fromDate) ? Timestamp.fromDate(expectedT5WindowEnd) : expectedT5WindowEnd
        },
        status: PREFLIGHT_STATUSES.AWAITING_TELEGRAM_T5,
        source: {
            provider: source.provider || 'futbolbrain-owner-browser',
            observedAt: source.observedAt
                ? ((typeof Timestamp !== 'undefined' && Timestamp.fromDate) ? Timestamp.fromDate(new Date(source.observedAt)) : new Date(source.observedAt))
                : ((typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date())
        },
        createdAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date(),
        updatedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date()
    };

    await preflightRef.set(payload, { merge: true });

    await logSystemEvent({
        department: DEPARTMENTS.PICKS_RISK || 'picks_risk',
        workerId: 'preflight-monitor',
        eventType: 'picks_risk.preflight_registered',
        status: EVENT_STATUSES.SUCCESS,
        payload: {
            preflightId,
            systemId: payload.systemId,
            homeTeam: payload.event.homeTeam,
            awayTeam: payload.event.awayTeam,
            kickoffAt: kickoffAt.toISOString()
        },
        rulesApplied: ['rule_t5_preflight_registration']
    }).catch(() => {});

    return { registered: true, preflightId, status: PREFLIGHT_STATUSES.AWAITING_TELEGRAM_T5 };
};

/**
 * Marca un preflight como confirmado cuando llega el mensaje T-5 válido de Telegram.
 */
export const markPreflightConfirmed = async ({
    preflightId,
    officialPickId,
    db = null
} = {}) => {
    if (!preflightId || !officialPickId) return;
    const database = db || getAdminDb();
    const preflightRef = database.collection(PREFLIGHT_COLLECTION).doc(preflightId);

    await preflightRef.update({
        status: PREFLIGHT_STATUSES.CONFIRMED_PUBLISHED,
        confirmedPickId: String(officialPickId),
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    }).catch(() => {});
};
