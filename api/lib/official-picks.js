import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from './official-pick-data.js';
import { attachOfficialPickReviewSummaries } from './official-pick-reports.js';
import { publishOfficialPickToTelegram } from './telegram.js';

const toPlainValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(toPlainValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    return value;
};

export const toPublicOfficialPick = (snapshot) => ({ id: snapshot.id, ...toPlainValue(snapshot.data()) });

const isPickStillActive = (pick, now = new Date()) => {
    const kickoffAt = new Date(pick?.event?.kickoffAt);
    return !Number.isNaN(kickoffAt.getTime()) && kickoffAt.getTime() > now.getTime();
};

// La prueba de existencia (evento, hora, hash) permanece pública. Los detalles
// accionables se reservan para Premium hasta que comienza el partido.
export const pickForAudience = (pick, { canViewActiveDetails = false, now = new Date() } = {}) => {
    if (!isPickStillActive(pick, now) || canViewActiveDetails) {
        return { ...pick, isLocked: false };
    }

    return {
        ...pick,
        isLocked: true,
        bet: { market: null, selection: null, oddsAtPublication: null },
        system: { id: null, version: null }
    };
};

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
    const pick = toPublicOfficialPick(snapshot);

    if (created) {
        try {
            const telegram = await publishOfficialPickToTelegram(pick);
            if (telegram.configured) {
                await pickRef.collection('events').doc('telegram_anchor').set({
                    type: 'telegram_anchor',
                    chatId: telegram.chatId,
                    messageId: telegram.messageId,
                    permalink: telegram.permalink,
                    createdAt: FieldValue.serverTimestamp()
                });
            }
        } catch (error) {
            console.error('No se pudo anclar el pick oficial en Telegram:', error.message);
        }
    }

    return { created, pick };
};

export const listOfficialPicks = async (limit = 20, audience = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const snapshot = await getAdminDb().collection('officialPicks').orderBy('publishedAt', 'desc').limit(safeLimit).get();
    const picks = snapshot.docs
        .filter((document) => document.data().status === 'published')
        .map(toPublicOfficialPick);
    const reviewed = await attachOfficialPickReviewSummaries(picks);
    return reviewed.map((pick) => pickForAudience(pick, audience));
};

export const getOfficialPick = async (pickId, audience = {}) => {
    const db = getAdminDb();
    const pickSnapshot = await db.collection('officialPicks').doc(pickId).get();
    if (!pickSnapshot.exists || pickSnapshot.data().status !== 'published') return null;
    const eventsSnapshot = await pickSnapshot.ref.collection('events').orderBy('createdAt', 'asc').get();
    const [pick] = await attachOfficialPickReviewSummaries([toPublicOfficialPick(pickSnapshot)]);
    return {
        pick: pickForAudience(pick, audience),
        events: eventsSnapshot.docs.map(toPublicOfficialPick)
    };
};
