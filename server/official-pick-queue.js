import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/lib/firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor, semanticOfficialPickKey } from '../api/lib/official-pick-data.js';
import { PUBLICATION_POLICIES } from './official-pick-scheduling.js';
import { publishOfficialPick, toPublicOfficialPick } from '../api/lib/official-picks.js';
import { parseMadridDateTimeToUTC } from '../api/lib/_timezone.js';

const MAX_DISPATCH_BATCH = 20;
const LEASE_MS = 2 * 60 * 1000;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

const asDate = (value) => value?.toDate && typeof value.toDate === 'function' ? value.toDate() : new Date(value);
const asTimestamp = (value) => Timestamp.fromDate(value instanceof Date ? value : new Date(value));
const safeLimit = (value) => Math.min(Math.max(Number(value) || MAX_DISPATCH_BATCH, 1), MAX_DISPATCH_BATCH);
const isSyntheticTestPick = (candidate = {}) => String(candidate.source?.provider || '').startsWith('test-');

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
    semanticDuplicateKey: normalized.semanticDuplicateKey,
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

// Older records predate semanticDuplicateKey. Scan the small, real-pick
// ledger before queuing so a later change to a source kickoff hour cannot
// reproduce one of those historical records either. New records are protected
// atomically by their semantic public id below.
export const loadOfficialDayLegacyLookup = async (now, { db = getAdminDb() } = {}) => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const tomorrow = new Date(`${day}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const start = new Date(parseMadridDateTimeToUTC(`${day} 00:00:00`));
    const end = new Date(parseMadridDateTimeToUTC(`${tomorrow.toISOString().slice(0, 10)} 00:00:00`));
    const readDay = (collection) => db.collection(collection)
        .where('event.kickoffAt', '>=', asTimestamp(start))
        .where('event.kickoffAt', '<', asTimestamp(end)).limit(201).get();
    const [snapshot, queued] = await Promise.all([readDay('officialPicks'), readDay('officialPickQueue')]);
    if (snapshot.size > 200 || queued.size > 200) throw new Error('LEGACY_DAY_READ_LIMIT');
    const byKey = new Map();
    for (const document of snapshot.docs) {
        const data = document.data();
        if (!['published', 'withdrawn'].includes(data.status)) continue;
        const key = semanticOfficialPickKey({ ...data,
            event: { ...data.event, kickoffAt: asDate(data.event.kickoffAt) } });
        if (byKey.has(key)) throw new Error('LEGACY_DUPLICATE_REQUIRES_REVIEW');
        byKey.set(key, document);
    }
    const byQueueKey = new Map();
    for (const document of queued.docs) {
        const data = document.data();
        const key = semanticOfficialPickKey({ ...data,
            event: { ...data.event, kickoffAt: asDate(data.event.kickoffAt) } });
        if (byQueueKey.has(key)) throw new Error('LEGACY_DUPLICATE_REQUIRES_REVIEW');
        byQueueKey.set(key, document);
    }
    return { day, find: key => byKey.get(key) || null, findQueue: key => byQueueKey.get(key) || null };
};

export const queueOfficialPick = async (input, { now = new Date(), deferDispatch = false,
    legacyLookup, morningSlot, db = getAdminDb(), publisher = publishOfficialPick } = {}) => {
    if (morningSlot !== undefined && !/^\d{4}-\d{2}-\d{2}T10:00 Europe\/Madrid$/.test(morningSlot)) {
        throw new Error('MORNING_SLOT_INVALID');
    }
    const normalized = normalizeOfficialPickInput(input);
    if (normalized.event.kickoffAt.getTime() <= now.getTime() + 60_000) throw new Error('PICK_KICKOFF_EXPIRED');
    const pickId = publicPickIdFor(normalized);
    const pickRef = db.collection('officialPicks').doc(pickId);
    const queueRef = db.collection('officialPickQueue').doc(pickId);
    const lookup = legacyLookup || await loadOfficialDayLegacyLookup(normalized.event.kickoffAt, { db });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(normalized.event.kickoffAt);
    if (lookup.day !== day) throw new Error('LEGACY_LOOKUP_DAY_MISMATCH');
    const legacyDuplicate = lookup.find(normalized.semanticDuplicateKey);
    if (legacyDuplicate) {
        return {
            created: false,
            state: 'already_published',
            queueId: legacyDuplicate.id,
            pick: toPublicOfficialPick(legacyDuplicate)
        };
    }
    const legacyQueued = lookup.findQueue?.(normalized.semanticDuplicateKey);
    if (legacyQueued) return { created: false, state: legacyQueued.data().status || 'queued', queueId: legacyQueued.id };
    let state = 'queued';
    let created = false;

    await db.runTransaction(async (transaction) => {
        state = 'queued';
        created = false;
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
        transaction.create(queueRef, { ...queueDocumentFor(normalized),
            ...(morningSlot ? { origin: { kind: 'morning', slot: morningSlot } } : {}) });
    });

    if (state === 'already_published') return { created: false, state, queueId: pickId, pick: toPublicOfficialPick(await pickRef.get()) };
    if (!created) return { created: false, state, queueId: pickId };

    if (!deferDispatch && normalized.publicationPolicy === PUBLICATION_POLICIES.IMMEDIATE) {
        const dispatch = await dispatchQueuedOfficialPick({ pickId, now, db, publisher });
        return { created: true, state: dispatch.state, queueId: pickId, pick: dispatch.pick || null };
    }

    return { created: true, state: 'queued', queueId: pickId };
};

export const dispatchQueuedOfficialPick = async ({ pickId, now = new Date(),
    db = getAdminDb(), publisher = publishOfficialPick }) => {
    const queueRef = db.collection('officialPickQueue').doc(pickId);
    let candidate = null;
    let state = 'not_found';

    await db.runTransaction(async (transaction) => {
        candidate = null;
        state = 'not_found';
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
        if (value.status === 'review_required') {
            state = 'review_required';
            return;
        }
        if (value.status === 'paused') { state = 'paused'; return; }
        if (value.status === 'dispatching' && leaseUntil && leaseUntil > now) {
            state = 'dispatching';
            return;
        }
        if (value.origin?.kind === 'morning' && process.env.MORNING_PUBLISH_ENABLED !== 'true') {
            state = 'paused';
            transaction.update(queueRef, { status: 'paused', pauseReason: 'morning_disabled',
                updatedAt: FieldValue.serverTimestamp(), leaseUntil: FieldValue.delete() });
            return;
        }
        if (nextAttemptAt > now) {
            state = 'not_due';
            return;
        }
        if (kickoffAt.getTime() <= now.getTime() + 60_000) {
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
        const result = await publisher(candidate, { now, db });
        const delivery = result.telegramDelivery?.status || 'not_applicable';
        if (['retryable', 'not_configured'].includes(delivery)) throw new Error('TELEGRAM_DELIVERY_NOT_CONFIRMED');
        if (delivery === 'review_required') {
            await queueRef.update({ status: 'review_required', officialPickId: result.pick.id,
                telegramDeliveryStatus: delivery, updatedAt: FieldValue.serverTimestamp(),
                leaseUntil: FieldValue.delete() });
            return { state: 'review_required', telegramStatus: delivery, pick: result.pick };
        }
        await queueRef.update({
            status: 'published',
            officialPickId: result.pick.id,
            telegramDeliveryStatus: delivery,
            publishedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            leaseUntil: FieldValue.delete()
        });
        return { state: 'published', telegramStatus: delivery, pick: result.pick, created: result.created };
    } catch (error) {
        const latest = await queueRef.get();
        const attempts = Number(latest.data()?.dispatchAttempts || 0) + 1;
        const kickoffAt = asDate(latest.data().event.kickoffAt);
        const canRetry = retryAtFor({ attempts, now }) < kickoffAt;
        await queueRef.update({
            status: canRetry ? 'queued' : 'skipped',
            dispatchAttempts: attempts,
            nextAttemptAt: asTimestamp(retryAtFor({ attempts, now })),
            lastDispatchError: 'OFFICIAL_DELIVERY_FAILED',
            skipReason: canRetry ? FieldValue.delete() : 'publication_failed_before_kickoff',
            updatedAt: FieldValue.serverTimestamp(),
            leaseUntil: FieldValue.delete()
        });
        return { state: canRetry ? 'retry_scheduled' : 'skipped', error: 'OFFICIAL_DELIVERY_FAILED' };
    }
};

const dueOfficialPickQueue = async ({ now, limit }) => {
    const db = getAdminDb();
    const count = safeLimit(limit);
    const [queued, expiredLeases] = await Promise.all([db.collection('officialPickQueue')
        .where('status', '==', 'queued')
        .where('nextAttemptAt', '<=', asTimestamp(now))
        .orderBy('nextAttemptAt', 'asc')
        .limit(count).get(), db.collection('officialPickQueue')
        .where('status', '==', 'dispatching')
        .where('leaseUntil', '<=', asTimestamp(now))
        .orderBy('leaseUntil', 'asc').limit(count).get()]);
    // Recover a crashed dispatcher, while the shared Telegram outbox prevents
    // an uncertain send from being repeated. Keep the total dispatch bounded.
    const docs = [...expiredLeases.docs, ...queued.docs].slice(0, count);
    return { docs, size: docs.length };
};

const dispatchQueueSnapshots = async ({ snapshots, now }) => {
    const results = [];
    const started = Date.now();
    for (const snapshot of snapshots) {
        if (Date.now() - started > 40_000) break;
        results.push(await dispatchQueuedOfficialPick({ pickId: snapshot.id, now: new Date() }));
    }
    return { checkedAt: now.toISOString(), results };
};

export const dispatchDueOfficialPicks = async ({ now = new Date(), limit } = {}) => {
    const due = await dueOfficialPickQueue({ now, limit });

    return dispatchQueueSnapshots({ snapshots: due.docs, now });
};

// This guard is deliberately separate from the normal dispatcher. It lets us
// validate the live scheduler path with synthetic picks while making it
// impossible for the same run to publish a real recommendation.
export const dispatchDueSyntheticTestPicks = async ({ now = new Date(), limit } = {}) => {
    const due = await dueOfficialPickQueue({ now, limit });

    return dispatchQueueSnapshots({
        snapshots: due.docs.filter((snapshot) => isSyntheticTestPick(snapshot.data())),
        now
    });
};

// Reads the same indexed queue slice as the dispatcher without leasing,
// publishing, or sending anything to Telegram.
export const inspectDueOfficialPicks = async ({ now = new Date(), limit } = {}) => {
    const due = await dueOfficialPickQueue({ now, limit });

    return {
        checkedAt: now.toISOString(),
        mode: 'dry_run',
        dueCount: due.size,
        queueIds: due.docs.map((snapshot) => snapshot.id)
    };
};
