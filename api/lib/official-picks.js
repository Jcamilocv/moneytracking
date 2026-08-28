import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from './official-pick-data.js';

const toPlainValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(toPlainValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    return value;
};

export const toPublicOfficialPick = (snapshot) => ({ id: snapshot.id, ...toPlainValue(snapshot.data()) });

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
    return { created, pick: toPublicOfficialPick(snapshot) };
};

export const listOfficialPicks = async (limit = 20) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const snapshot = await getAdminDb().collection('officialPicks').orderBy('publishedAt', 'desc').limit(safeLimit).get();
    return snapshot.docs
        .filter((document) => document.data().status === 'published')
        .map(toPublicOfficialPick);
};

export const getOfficialPick = async (pickId) => {
    const db = getAdminDb();
    const pickSnapshot = await db.collection('officialPicks').doc(pickId).get();
    if (!pickSnapshot.exists || pickSnapshot.data().status !== 'published') return null;
    const eventsSnapshot = await pickSnapshot.ref.collection('events').orderBy('createdAt', 'asc').get();
    return {
        pick: toPublicOfficialPick(pickSnapshot),
        events: eventsSnapshot.docs.map(toPublicOfficialPick)
    };
};

