import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import { semanticOfficialPickKey, publicPickIdFor } from '../api/_lib/official-pick-data.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';

export const PAPER_PICKS_COLLECTION = 'paperPicks';

/**
 * Registra un pick de sistema PAPER (observación / stake 0%).
 * 
 * REGLAS INVIOLABLES DE PAPER:
 * 1. Stake estrictamente 0 (cero exposición de capital).
 * 2. CERO publicación en Telegram público.
 * 3. CERO copia a la banca oficial de temporada.
 * 4. CERO afectación al Balance de Money Tips.
 * 5. Registro auditable para seguimiento forward en Money Tips HQ.
 */
export const recordPaperPick = async ({
    candidate,
    db = null,
    now = new Date()
} = {}) => {
    if (!candidate?.system?.id) throw new Error('Faltan datos del pick paper');

    const database = db || getAdminDb();
    const semanticKey = semanticOfficialPickKey(candidate);
    const paperPickId = `paper_${semanticKey.slice(0, 36)}`;
    const paperRef = database.collection(PAPER_PICKS_COLLECTION).doc(paperPickId);

    const existingSnap = await paperRef.get();
    if (existingSnap.exists) {
        return { created: false, duplicate: true, paperPickId, pick: existingSnap.data() };
    }

    const kickoffDate = candidate.event.kickoffAt instanceof Date
        ? candidate.event.kickoffAt
        : new Date(candidate.event.kickoffAt);

    const paperDocument = {
        schemaVersion: 1,
        paperPickId,
        semanticDuplicateKey: semanticKey,
        system: {
            id: String(candidate.system.id).trim(),
            tier: 'OBSERVACION_PAPER',
            version: String(candidate.system.version || 'v1')
        },
        event: {
            sourceEventId: candidate.event.sourceEventId || null,
            competition: String(candidate.event.competition || '').trim(),
            homeTeam: String(candidate.event.homeTeam || '').trim(),
            awayTeam: String(candidate.event.awayTeam || '').trim(),
            kickoffAt: (typeof Timestamp !== 'undefined' && Timestamp.fromDate) ? Timestamp.fromDate(kickoffDate) : kickoffDate
        },
        bet: {
            market: String(candidate.bet.market || '').trim(),
            selection: String(candidate.bet.selection || '').trim(),
            oddsAtPublication: Number(candidate.bet.oddsAtPublication) || null,
            stake: 0,
            recommendedStakePct: 0
        },
        source: {
            provider: candidate.source?.provider || 'futbolbrain-owner-browser',
            observedAt: candidate.source?.observedAt
                ? ((typeof Timestamp !== 'undefined' && Timestamp.fromDate) ? Timestamp.fromDate(new Date(candidate.source.observedAt)) : new Date(candidate.source.observedAt))
                : ((typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date())
        },
        status: 'recorded_paper',
        isPaper: true,
        stake: 0,
        recordedAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date(),
        createdAt: (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date()
    };

    await paperRef.set(paperDocument);

    await logSystemEvent({
        department: DEPARTMENTS.PICKS_RISK || 'picks_risk',
        workerId: 'paper-picks-manager',
        eventType: 'picks_risk.paper_pick_recorded',
        status: EVENT_STATUSES.SUCCESS,
        payload: {
            paperPickId,
            systemId: paperDocument.system.id,
            homeTeam: paperDocument.event.homeTeam,
            awayTeam: paperDocument.event.awayTeam,
            odds: paperDocument.bet.oddsAtPublication
        },
        rulesApplied: ['rule_paper_zero_capital_exposure']
    }).catch(() => {});

    return { created: true, duplicate: false, paperPickId, pick: paperDocument };
};
