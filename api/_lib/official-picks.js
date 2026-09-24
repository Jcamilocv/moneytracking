import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from './official-pick-data.js';
import { attachOfficialPickReviewSummaries } from './official-pick-reports.js';
import { publishOfficialPickToTelegram } from './telegram.js';
import { stakeRecommendationForOfficialPick } from '../../server/money-tips-stake-policy.js';
import { dispatchOfficialPickAutoCopy } from '../../server/official-pick-auto-copy.js';

const toPlainValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(toPlainValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    return value;
};

export const toPublicOfficialPick = (snapshot) => ({ id: snapshot.id, ...toPlainValue(snapshot.data()) });

// Picks published before the stake-policy launch have no recommendation stored
// in Firestore. Derive it only in the response, so their original ledger and
// evidence remain untouched while the owner can safely synchronise their bank.
const withStakeRecommendation = (pick) => {
    if (!pick?.bet || Number.isFinite(Number(pick.bet.recommendedStakePct))) return pick;
    try {
        return {
            ...pick,
            bet: {
                ...pick.bet,
                ...stakeRecommendationForOfficialPick({
                    systemId: pick.system?.id,
                    oddsAtPublication: pick.bet.oddsAtPublication
                })
            }
        };
    } catch {
        return pick;
    }
};

const isPickStillActive = (pick, now = new Date()) => {
    const kickoffAt = new Date(pick?.event?.kickoffAt);
    return !Number.isNaN(kickoffAt.getTime()) && kickoffAt.getTime() > now.getTime();
};

export const sanitizeOfficialPickSettlement = (settlement) => {
    if (!settlement || typeof settlement !== 'object') return null;
    return {
        status: settlement.status || 'pending',
        regularTimeScore: settlement.regularTimeScore || null,
        settledAt: settlement.settledAt || null
    };
};

export const sanitizeOfficialPickEventForAudience = (event, { canViewActiveDetails = false } = {}) => {
    if (canViewActiveDetails) return event;
    const { id, type, createdAt } = event;
    if (type === 'published') {
        return { id, type, evidenceHash: event.evidenceHash, createdAt };
    }
    if (type === 'telegram_anchor') {
        return { id, type, permalink: event.permalink, createdAt };
    }
    if (type === 'settled') {
        return {
            id,
            type,
            status: event.status,
            regularTimeScore: event.regularTimeScore || null,
            createdAt
        };
    }
    if (type === 'withdrawn_duplicate') {
        return { id, type, createdAt };
    }
    return { id, type, status: event.status || null, createdAt };
};

// POLÍTICA DE PRIVACIDAD PERMANENTE DE MONEY TIPS:
// Un usuario NO Premium o no autenticado NUNCA debe recibir market, selection,
// oddsAtPublication, system, reglas internas ni parámetros de estrategia.
// Esto aplica antes, durante y después del partido, en histórico, tras settlement
// y en cualquier snapshot o API pública.
export const pickForAudience = (pick, { canViewActiveDetails = false } = {}) => {
    if (pick.status === 'withdrawn') {
        return {
            ...pick,
            isLocked: true,
            isPublicSummary: true,
            isWithdrawn: true,
            publicationPolicy: null,
            bet: { market: null, selection: null, oddsAtPublication: null, recommendedStakePct: null, baseStakePct: null, confidenceFactor: null },
            system: { id: null, version: null },
            settlement: sanitizeOfficialPickSettlement(pick.settlement)
        };
    }
    if (canViewActiveDetails) return { ...pick, isLocked: false, isPublicSummary: false };

    return {
        ...pick,
        isLocked: true,
        isPublicSummary: true,
        publicationPolicy: null,
        bet: {
            market: null,
            selection: null,
            oddsAtPublication: null,
            recommendedStakePct: null,
            baseStakePct: null,
            confidenceFactor: null
        },
        system: { id: null, version: null },
        settlement: sanitizeOfficialPickSettlement(pick.settlement)
    };
};

// Technical checks remain immutable in the ledger, but must never be promoted
// alongside real Money Tips recommendations in the public feed.
export const isPublicOfficialPickData = (data = {}) => (
    data.status === 'published' && !String(data.source?.provider || '').startsWith('test-')
);

// Los picks sintéticos sirven para probar el ledger y la cola, pero nunca deben
// dejar el entorno de pruebas ni aparecer como una recomendación real.
export const shouldNotifyTelegramForOfficialPick = (pick) => isPublicOfficialPickData(pick);

export const publishOfficialPick = async (input) => {
    const normalized = normalizeOfficialPickInput(input);
    const db = getAdminDb();
    const pickId = publicPickIdFor(normalized);
    const pickRef = db.collection('officialPicks').doc(pickId);
    const eventRef = pickRef.collection('events').doc('published');
    let created = false;

    await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(pickRef);
        if (existing.exists) return;
        created = true;
        transaction.set(pickRef, {
            ...normalized,
            event: { ...normalized.event, kickoffAt: Timestamp.fromDate(normalized.event.kickoffAt) },
            source: { ...normalized.source, observedAt: Timestamp.fromDate(normalized.source.observedAt) },
            scheduledAt: Timestamp.fromDate(normalized.scheduledAt),
            createdAt: FieldValue.serverTimestamp(),
            publishedAt: FieldValue.serverTimestamp()
        });
        transaction.set(eventRef, {
            type: 'published',
            evidenceHash: normalized.source.evidenceHash,
            createdAt: FieldValue.serverTimestamp()
        });
    });

    const snapshot = await pickRef.get();
    const pick = withStakeRecommendation(toPublicOfficialPick(snapshot));

    const telegramAnchorRef = pickRef.collection('events').doc('telegram_anchor');
    const telegramAnchor = await telegramAnchorRef.get();
    if (shouldNotifyTelegramForOfficialPick(pick) && !telegramAnchor.exists) {
        const telegram = await publishOfficialPickToTelegram(pick);
        if (telegram.configured) {
            await telegramAnchorRef.set({
                type: 'telegram_anchor',
                chatId: telegram.chatId,
                messageId: telegram.messageId,
                permalink: telegram.permalink,
                createdAt: FieldValue.serverTimestamp()
            });
        }
    }

    // Auto-copia desacoplada y durable a la banca de temporada (Data & Performance).
    // REGLA ARQUITECTÓNICA INVIOLABLE:
    // La publicación oficial NUNCA se revierte ni falla si la auto-copia falla.
    // La tarea queda persistida de forma durable en officialPickAutoCopyQueue antes de finalizar.
    if (created && isPublicOfficialPickData(pick)) {
        try {
            await dispatchOfficialPickAutoCopy(pick, { db });
        } catch (err) {
            console.error('Error desacoplado en auto-copia durable de pick oficial:', err);
        }
    }

    return { created, pick };
};

export const listOfficialPicks = async (limit = 20, audience = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const scanLimit = Math.min(safeLimit + 10, 50);
    const snapshot = await getAdminDb().collection('officialPicks').orderBy('publishedAt', 'desc').limit(scanLimit).get();
    const picks = snapshot.docs
        .filter((document) => isPublicOfficialPickData(document.data()))
        .slice(0, safeLimit)
        .map((document) => withStakeRecommendation(toPublicOfficialPick(document)));
    const reviewed = await attachOfficialPickReviewSummaries(picks);
    return reviewed.map((pick) => pickForAudience(pick, audience));
};

export const getOfficialPick = async (pickId, audience = {}) => {
    const db = getAdminDb();
    const pickSnapshot = await db.collection('officialPicks').doc(pickId).get();
    if (!pickSnapshot.exists || !['published', 'withdrawn'].includes(pickSnapshot.data().status)) return null;
    const eventsSnapshot = await pickSnapshot.ref.collection('events').orderBy('createdAt', 'asc').get();
    const [pick] = await attachOfficialPickReviewSummaries([withStakeRecommendation(toPublicOfficialPick(pickSnapshot))]);
    return {
        pick: pickForAudience(pick, audience),
        events: eventsSnapshot.docs.map((doc) => sanitizeOfficialPickEventForAudience(toPublicOfficialPick(doc), audience))
    };
};
