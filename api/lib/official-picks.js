import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from './official-pick-data.js';
import { attachOfficialPickReviewSummaries } from './official-pick-reports.js';
import { publishOfficialPickToTelegram } from './telegram.js';
import { stakeRecommendationForOfficialPick } from '../../server/money-tips-stake-policy.js';

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

// El público puede auditar la existencia, el evento, la hora y, tras el inicio,
// la cuota registrada. Mercado, selección y sistema permanecen reservados para
// Premium para que el histórico no revele mecánicamente picks futuros.
export const pickForAudience = (pick, { canViewActiveDetails = false, now = new Date() } = {}) => {
    if (pick.status === 'withdrawn') {
        return {
            ...pick,
            isLocked: true,
            isPublicSummary: true,
            isWithdrawn: true,
            bet: { market: null, selection: null, oddsAtPublication: null },
            system: { id: null, version: null }
        };
    }
    if (canViewActiveDetails) return { ...pick, isLocked: false, isPublicSummary: false };

    const isActive = isPickStillActive(pick, now);

    return {
        ...pick,
        isLocked: isActive,
        isPublicSummary: true,
        bet: {
            market: null,
            selection: null,
            oddsAtPublication: isActive ? null : pick.bet?.oddsAtPublication ?? null
        },
        system: { id: null, version: null }
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
        events: eventsSnapshot.docs.map(toPublicOfficialPick)
    };
};
