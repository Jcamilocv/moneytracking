import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from './official-pick-data.js';
import { PUBLICATION_POLICIES } from './official-pick-scheduling.js';
import { publishOfficialPick, toPublicOfficialPick } from './official-picks.js';

const MAX_DISPATCH_BATCH = 20;
const LEASE_MS = 2 * 60 * 1000;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

const asDate = (value) => value?.toDate && typeof value.toDate === 'function' ? value.toDate() : new Date(value);
const asTimestamp = (value) => Timestamp.fromDate(value instanceof Date ? value : new Date(value));
const safeLimit = (value) => Math.min(Math.max(Number(value) || MAX_DISPATCH_BATCH, 1), MAX_DISPATCH_BATCH);

const retryAtFor = ({ attempts, now }) => {
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];
    return new Date(now.getTime() + delay);
};

const payloadFromCandidate = (candidate) => ({
    event: { ...candidate.event, kickoffAt: asDate(candidate.event.kickoffAt) },
    bet: candidate.bet,
    system: candidate.system,
    source: { ...candidate.source, observedAt: asDate(candidate.source.observedAt) },
    publicationPolicy: candidate.publicationPolicy,
    scheduledAt: asDate(candidate.scheduledAt)
});

const queueDocumentFor = (normalized) => ({
    schemaVersion: 1,
    status: 'queued',
    idempotencyKey: normalized.idempotencyKey,
    event: { ...normalized.event, kickoffAt: asTimestamp(normalized.event.kickoffAt) },
    bet: normalized.bet,
    system: normalized.system,
    source: { ...normalized.source, observedAt: asTimestamp(normalized.source.observedAt) },
    publicationPolicy: normalized.publicationPolicy,
    scheduledAt: asTimestamp(normalized.scheduledAt),
    nextAttemptAt: asTimestamp(normalized.scheduledAt),
    dispatchAttempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
});

export const queueOfficialPick = async (input) => {
    const normalized = normalizeOfficialPickInput(input);
    const db = getAdminDb();
    const pickId = publicPickIdFor(normalized);
    const pickRef = db.collection('officialPicks').doc(pickId);
    const queueRef = db.collection('officialPickQueue').doc(pickId);
    let state = 'queued';
    let created = false;

    await db.runTransaction(async (transaction) => {
        const [officialSnapshot, queueSnapshot] = await Promise.all([transaction.get(pickRef), transaction.get(queueRef)]);
        if (officialSnapshot.exists) {
            state = 'already_published';
            return;
        }
        if (queueSnapshot.exists) {
            state = queueSnapshot.data().status || 'queued';
            return;
        }

        created = true;
        transaction.create(queueRef, queueDocumentFor(normalized));
    });

    if (state === 'already_published') return { created: false, state, queueId: pickId, pick: toPublicOfficialPick(await pickRef.get()) };
    if (!created) return { created: false, state, queueId: pickId };

    if (normalized.publicationPolicy === PUBLICATION_POLICIES.IMMEDIATE) {
        const dispatch = await dispatchQueuedOfficialPick({ pickId });
        return { created: true, state: dispatch.state, queueId: pickId, pick: dispatch.pick || null };
    }

    return { created: true, state: 'queued', queueId: pickId };
};

export const dispatchQueuedOfficialPick = async ({ pickId, now = new Date() }) => {
    const db = getAdminDb();
    const queueRef = db.collection('officialPickQueue').doc(pickId);
    let candidate = null;
    let state = 'not_found';

    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(queueRef);
        if (!snapshot.exists) return;
        const value = snapshot.data();
        const nextAttemptAt = asDate(value.nextAttemptAt);
        const leaseUntil = value.leaseUntil ? asDate(value.leaseUntil) : null;
        const kickoffAt = asDate(value.event.kickoffAt);

        if (value.status === 'published') {
            state = 'published';
            return;
        }
        if (value.status === 'skipped') {
            state = 'skipped';
            return;
        }
        if (value.status === 'dispatching' && leaseUntil && leaseUntil > now) {
            state = 'dispatching';
            return;
        }
        if (nextAttemptAt > now) {
            state = 'not_due';
            return;
        }
        if (kickoffAt <= now) {
            state = 'skipped';
            transaction.update(queueRef, {
                status: 'skipped',
                skipReason: 'kickoff_reached_before_publication',
                skippedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            return;
        }

        candidate = payloadFromCandidate(value);
        state = 'dispatching';
        transaction.update(queueRef, {
            status: 'dispatching',
            leaseUntil: asTimestamp(new Date(now.getTime() + LEASE_MS)),
            updatedAt: FieldValue.serverTimestamp()
        });
    });

    if (!candidate) return { state };

    try {
        const result = await publishOfficialPick(candidate);
        await queueRef.update({
            status: 'published',
            officialPickId: result.pick.id,
            publishedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            leaseUntil: FieldValue.delete()
        });
        return { state: 'published', pick: result.pick, created: result.created };
    } catch (error) {
        const latest = await queueRef.get();
        const attempts = Number(latest.data()?.dispatchAttempts || 0) + 1;
        const kickoffAt = asDate(latest.data().event.kickoffAt);
        const canRetry = retryAtFor({ attempts, now }) < kickoffAt;
        await queueRef.update({
            status: canRetry ? 'queued' : 'skipped',
            dispatchAttempts: attempts,
            nextAttemptAt: asTimestamp(retryAtFor({ attempts, now })),
            lastDispatchError: String(error.message || 'No se pudo publicar el pick').slice(0, 240),
            skipReason: canRetry ? FieldValue.delete() : 'publication_failed_before_kickoff',
            updatedAt: FieldValue.serverTimestamp(),
            leaseUntil: FieldValue.delete()
        });
        return { state: canRetry ? 'retry_scheduled' : 'skipped', error: error.message || 'No se pudo publicar el pick' };
    }
};

export const dispatchDueOfficialPicks = async ({ now = new Date(), limit } = {}) => {
    const db = getAdminDb();
    const due = await db.collection('officialPickQueue')
        .where('status', '==', 'queued')
        .where('nextAttemptAt', '<=', asTimestamp(now))
        .orderBy('nextAttemptAt', 'asc')
        .limit(safeLimit(limit))
        .get();

    const results = [];
    for (const snapshot of due.docs) results.push(await dispatchQueuedOfficialPick({ pickId: snapshot.id, now }));
    return { checkedAt: now.toISOString(), results };
};
