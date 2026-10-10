import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAdminAuth } from '../api/lib/firebase-admin.js';
import { queueOfficialPick, dispatchQueuedOfficialPick, loadOfficialDayLegacyLookup, inspectDueOfficialPicks } from '../server/official-pick-queue.js';
import { publishOfficialPick, pickForAudience } from '../api/lib/official-picks.js';
import { normalizeOfficialPickInput, publicPickIdFor } from '../api/lib/official-pick-data.js';
import { deliverOfficialPickTelegramOnce } from '../api/lib/telegram-delivery.js';
import { TelegramRequestError, publishOfficialPickToTelegram, formatOfficialTelegramMessage } from '../api/lib/telegram.js';
import officialApi from '../api/official-picks.js';
import adminApi from '../api/admin/official-picks.js';
import { NOW, item, responseCapture } from './fixtures/morning.js';
import { createMorningSubmissionHandler } from '../server/morning/ingestion.js';
import { morningSlotKey } from '../server/morning/one-shot.js';
const project = 'demo-morning-20261011';
const endpoint = `http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`;
let app; let db;
const originalFetch = globalThis.fetch;
const input = (n = 1, changes = {}) => ({
    event: { sourceEventId: String(n), homeTeam: `Team ${n}`, awayTeam: 'Visitor', competition: 'ITA-SRA', kickoffAt: '2026-10-11T13:00:00Z' },
    bet: { market: 'Ambos equipos marcan', selection: 'No', oddsAtPublication: 2.2 },
    system: { id: 'MT - ITA1 - V1.0', version: 'active-alarms-v1' },
    source: { provider: 'futbolbrain-active-alarms', observedAt: NOW }, publicationPolicy: 'immediate', ...changes
});
const confirmation = n => ({ configured: true, messageId: n, chatId: '-100111', permalink: `https://example.test/${n}` });
const publisherWith = send => (data, options) => publishOfficialPick(data, { ...options, send, clock: () => options.now });
const queued = async (n = 1, changes = {}) => queueOfficialPick(input(n, changes), { db, now: NOW, deferDispatch: true });
const request = async (handler, query, headers = {}, method = 'GET') => {
    const res = responseCapture(); await handler({ method, headers, query }, res); return res;
};
before(async () => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'Local emulator required; production is forbidden');
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    app = initializeApp({ projectId: project }); db = getFirestore(app);
    // Authentication is a synthetic stub; subscription checks and API/DB logic are real.
    getAdminAuth().verifyIdToken = async token => {
        if (!['qa-owner', 'qa-premium', 'qa-expired', 'qa-free', 'qa-revoked'].includes(token)) throw new Error('INVALID_SYNTHETIC_TOKEN');
        return { uid: token };
    };
    process.env.OFFICIAL_SNAPSHOT_OWNER_UID = 'qa-owner';
    globalThis.fetch = async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN_IN_TEST'); };
});
beforeEach(async () => {
    globalThis.fetch = async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN_IN_TEST'); };
    const response = await originalFetch(endpoint, { method: 'DELETE' }); assert.equal(response.status, 200);
});
after(async () => { globalThis.fetch = originalFetch; delete process.env.OFFICIAL_SNAPSHOT_OWNER_UID; await db?.terminate(); if (app) await deleteApp(app); });

test('concurrent Morning/UI/T5-equivalent inputs share one immutable record and one send', async () => {
    const variants = [input(), input(1, { source: { provider: 'futbolbrain-owner-browser', observedAt: NOW }, system: { id: input().system.id, version: 'visible-table-v1' } }),
        input(1, { source: { provider: 'telegram-t5', observedAt: NOW }, system: { id: input().system.id, version: 't5-v1' } })];
    assert.equal(new Set(variants.map(x => publicPickIdFor(normalizeOfficialPickInput(x)))).size, 1);
    const results = await Promise.all(variants.map(x => queueOfficialPick(x, { now: NOW, deferDispatch: true, db })));
    assert.equal(results.filter(x => x.created).length, 1);
    let sends = 0; const publisher = publisherWith(async () => confirmation(++sends));
    await Promise.all(results.map(x => dispatchQueuedOfficialPick({ pickId: x.queueId, now: NOW, db, publisher })));
    assert.equal(sends, 1); assert.equal((await db.collection('officialPicks').get()).size, 1);
    assert.equal((await db.collection('officialPickQueue').doc(results[0].queueId).get()).data().status, 'published');
    const before = (await db.collection('officialPicks').doc(results[0].queueId).get()).data();
    await queueOfficialPick(input(1, { bet: { ...input().bet, oddsAtPublication: 3.5 } }), { db, now: NOW, deferDispatch: true });
    assert.deepEqual((await db.collection('officialPicks').doc(results[0].queueId).get()).data(), before);
    assert.equal(before.bet.oddsAtPublication, 2.2); assert.equal(before.bet.recommendedStakePct, 0.75);
});
test('full Morning batch publishes fifteen via durable queue and repeating request sends nothing', async () => {
    const secret = 'SYNTHETIC_MORNING_TEST_ONLY_0000000000';
    process.env.MORNING_PUBLISH_SECRET = secret; process.env.MORNING_PUBLISH_ENABLED = 'true'; let sends = 0;
    try {
        const handler = createMorningSubmissionHandler({ clock: () => NOW,
            queue: (input, options) => queueOfficialPick(input, { ...options, db }),
            loadLegacyLookup: now => loadOfficialDayLegacyLookup(now, { db }),
            dispatch: options => dispatchQueuedOfficialPick({ ...options, db, publisher: publisherWith(async () => confirmation(++sends)) }) });
        const req = { method: 'POST', headers: { authorization: `Bearer ${secret}` },
            body: { slot: morningSlotKey(NOW), observedAt: NOW.toISOString(), items: Array.from({ length: 15 }, (_, i) => item(i + 1)) } };
        const first = responseCapture(); await handler(req, first); assert.equal(first.statusCode, 200);
        assert.equal(first.body.accepted, 15); assert.equal(first.body.telegramConfirmed, 15);
        const repeat = responseCapture(); await handler(req, repeat); assert.equal(repeat.statusCode, 200);
        assert.equal(repeat.body.created, 0); assert.equal(repeat.body.dispatched, 0); assert.equal(sends, 15);
        assert.equal((await db.collection('officialPicks').get()).size, 15);
        assert.ok((await db.collection('officialPickQueue').get()).docs.every(x => x.data().status === 'published'));
    } finally { delete process.env.MORNING_PUBLISH_ENABLED; delete process.env.MORNING_PUBLISH_SECRET; }
});
test('legacy identity and corrected hour do not rewrite old publication or duplicate it', async () => {
    const oldId = `op_${'a'.repeat(40)}`;
    const legacy = normalizeOfficialPickInput(input(1, { event: { ...input().event, kickoffAt: '2026-10-11T11:00:00Z' } }));
    const document = { ...legacy, semanticDuplicateKey: 'legacy-source-specific-key',
        event: { ...legacy.event, kickoffAt: Timestamp.fromDate(legacy.event.kickoffAt) } };
    await db.collection('officialPicks').doc(oldId).set(document);
    const before = (await db.collection('officialPicks').doc(oldId).get()).data();
    const result = await queued(); assert.equal(result.state, 'already_published'); assert.equal(result.queueId, oldId);
    assert.deepEqual((await db.collection('officialPicks').doc(oldId).get()).data(), before);
    assert.equal((await db.collection('officialPickQueue').get()).size, 0);
});
test('legacy pending queue is reused rather than generating another identity', async () => {
    const first = await queued(); const original = (await db.collection('officialPickQueue').doc(first.queueId).get()).data();
    const oldId = `op_${'b'.repeat(40)}`; await db.collection('officialPickQueue').doc(oldId).set(original); await db.collection('officialPickQueue').doc(first.queueId).delete();
    assert.equal((await queued()).queueId, oldId); assert.equal((await db.collection('officialPickQueue').get()).size, 1);
});
test('bounded legacy scan refuses ambiguous duplicates without changes', async () => {
    const first = await queued(); const original = (await db.collection('officialPickQueue').doc(first.queueId).get()).data();
    await db.collection('officialPickQueue').doc(`op_${'c'.repeat(40)}`).set(original);
    await assert.rejects(queued(), /LEGACY_DUPLICATE_REQUIRES_REVIEW/); assert.equal((await db.collection('officialPickQueue').get()).size, 2);
});
test('definitive Telegram rejection schedules one-minute retry and later anchors once', async () => {
    const q = await queued(); let sends = 0;
    const publisher = publisherWith(async () => { if (++sends === 1) throw new TelegramRequestError(true); return confirmation(9001); });
    const one = await dispatchQueuedOfficialPick({ pickId: q.queueId, now: NOW, db, publisher }); assert.equal(one.state, 'retry_scheduled');
    const notDue = await dispatchQueuedOfficialPick({ pickId: q.queueId, now: new Date(NOW.getTime() + 30_000), db, publisher }); assert.equal(notDue.state, 'not_due');
    const two = await dispatchQueuedOfficialPick({ pickId: q.queueId, now: new Date(NOW.getTime() + 60_001), db, publisher });
    assert.equal(two.telegramStatus, 'anchored'); assert.equal(sends, 2);
    assert.equal((await db.collection('officialPicks').doc(q.queueId).collection('events').doc('telegram_delivery').get()).data().attempts, 2);
});
test('ambiguous timeout stops automatic resend even when manually dispatched again', async () => {
    const q = await queued(); let sends = 0;
    const publisher = publisherWith(async () => { sends++; throw new Error('RAW_URL_OR_CREDENTIAL_SENTINEL'); });
    const result = await dispatchQueuedOfficialPick({ pickId: q.queueId, now: NOW, db, publisher }); assert.equal(result.state, 'review_required');
    await dispatchQueuedOfficialPick({ pickId: q.queueId, now: new Date(NOW.getTime() + 180_000), db, publisher }); assert.equal(sends, 1);
    assert.ok(!JSON.stringify((await db.collection('officialPickQueue').doc(q.queueId).get()).data()).includes('RAW_URL'));
    assert.equal((await inspectDueOfficialPicks({ now: new Date(NOW.getTime() + 180_000) })).dueCount, 0);
});
test('existing T5 outbox claimed/uncertain prevents a new send; anchor prevents all replays', async () => {
    const pickRef = db.collection('officialPicks').doc(`op_${'e'.repeat(40)}`); let sends = 0;
    const delivery = () => deliverOfficialPickTelegramOnce({ db, pickRef, pick: { id: pickRef.id }, allowFreshClaim: true, send: async () => confirmation(++sends) });
    await pickRef.collection('events').doc('telegram_delivery').set({ status: 'claimed', attempts: 1 });
    assert.equal((await delivery()).status, 'review_required');
    await pickRef.collection('events').doc('telegram_delivery').set({ status: 'uncertain', attempts: 1 });
    assert.equal((await delivery()).status, 'review_required');
    await pickRef.collection('events').doc('telegram_anchor').set({ messageId: 9000 });
    assert.equal((await delivery()).status, 'anchored'); assert.equal(sends, 0);
});
test('legacy record without delivery/anchor requires review rather than a blind send', async () => {
    const pickRef = db.collection('officialPicks').doc(`op_${'f'.repeat(40)}`);
    const result = await deliverOfficialPickTelegramOnce({ db, pickRef, pick: { id: pickRef.id }, send: async () => { throw new Error('MUST_NOT_SEND'); } });
    assert.equal(result.status, 'review_required');
});
test('crash after send and before anchor remains uncertain and cannot resend', async () => {
    const pickRef = db.collection('officialPicks').doc(`op_${'d'.repeat(40)}`); let sends = 0;
    const brokenDb = { runTransaction: fn => db.runTransaction(tx => fn(new Proxy(tx, { get(target, prop) {
        if (prop === 'set') return (ref, ...args) => { if (ref.id === 'telegram_anchor') throw new Error('ANCHOR_STORAGE_FAILURE'); return target.set(ref, ...args); };
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
    } }))) };
    const config = { db: brokenDb, pickRef, pick: { id: pickRef.id }, allowFreshClaim: true, send: async () => confirmation(++sends) };
    assert.equal((await deliverOfficialPickTelegramOnce(config)).status, 'review_required');
    assert.equal((await deliverOfficialPickTelegramOnce({ ...config, db })).status, 'review_required'); assert.equal(sends, 1);
});
test('crashed dispatcher lease is recovered into review without repeating uncertain send', async () => {
    const q = await queued(); const pickRef = db.collection('officialPicks').doc(q.queueId);
    await publishOfficialPick(input(), { db, now: NOW, send: async () => confirmation(9002) });
    await pickRef.collection('events').doc('telegram_anchor').delete();
    await pickRef.collection('events').doc('telegram_delivery').update({ status: 'claimed' });
    await db.collection('officialPickQueue').doc(q.queueId).update({ status: 'dispatching', leaseUntil: Timestamp.fromDate(new Date(NOW.getTime() - 1)) });
    const due = await inspectDueOfficialPicks({ now: NOW }); assert.deepEqual(due.queueIds, [q.queueId]);
    const result = await dispatchQueuedOfficialPick({ pickId: q.queueId, now: NOW, db,
        publisher: publisherWith(async () => { throw new Error('MUST_NOT_SEND'); }) }); assert.equal(result.state, 'review_required');
});
test('expired queue and retries cannot publish; future timestamps retain due guard', async () => {
    const q = await queued(); let sends = 0;
    const result = await dispatchQueuedOfficialPick({ pickId: q.queueId, now: new Date('2026-10-11T12:59:01Z'), db,
        publisher: publisherWith(async () => confirmation(++sends)) }); assert.equal(result.state, 'skipped'); assert.equal(sends, 0);
    await assert.rejects(queueOfficialPick(input(), { db, now: new Date('2026-10-11T13:00:00Z') }), /PICK_KICKOFF_EXPIRED/);
    const t5 = await queued(2, { publicationPolicy: 't_minus_5' });
    assert.equal((await dispatchQueuedOfficialPick({ pickId: t5.queueId, now: NOW, db })).state, 'not_due');
});
test('public endpoint hides future known ID exactly like missing ID; owner and active Premium keep full data', async () => {
    const future = input(1, { event: { ...input().event, kickoffAt: '2099-10-11T13:00:00Z' } });
    const result = await publishOfficialPick(future, { db, now: NOW, send: async () => confirmation(9003) });
    for (const [uid, status, offset] of [['qa-premium', 'active', 86_400_000], ['qa-expired', 'active', -86_400_000], ['qa-revoked', 'revoked', 86_400_000]]) {
        await db.collection('users').doc(uid).collection('entitlements').doc('subscription').set({ status, accessUntil: Timestamp.fromMillis(Date.now() + offset) });
    }
    const missing = await request(officialApi, { pick: `op_${'9'.repeat(40)}` });
    for (const token of [null, 'invalid', 'qa-free', 'qa-expired', 'qa-revoked']) {
        const headers = token ? { authorization: `Bearer ${token}` } : {};
        const publicResult = await request(officialApi, { pick: result.pick.id }, headers);
        assert.equal(publicResult.statusCode, 404); assert.deepEqual(publicResult.body, missing.body);
        const list = await request(officialApi, {}, headers); assert.deepEqual(list.body.picks, []);
        assert.equal(publicResult.headers['Cache-Control'], 'private, no-store'); assert.equal(publicResult.headers.Vary, 'Authorization');
    }
    for (const token of ['qa-owner', 'qa-premium']) {
        const privateResult = await request(officialApi, { pick: result.pick.id }, { authorization: `Bearer ${token}` });
        assert.equal(privateResult.statusCode, 200); assert.equal(privateResult.body.pick.bet.oddsAtPublication, 2.2);
        assert.equal(privateResult.body.pick.bet.recommendedStakePct, 0.75); assert.equal(privateResult.body.pick.isLocked, false);
    }
});
test('public historical response whitelist excludes source, odds, stakes, private metadata and event IDs', async () => {
    const historical = input(1, { event: { ...input().event, kickoffAt: '2026-10-09T13:00:00Z' } });
    const result = await publishOfficialPick(historical, { db, now: new Date('2026-10-09T08:00:00Z'), clock: () => new Date('2026-10-09T08:00:00Z'), send: async () => confirmation(9004) });
    const ref = db.collection('officialPicks').doc(result.pick.id);
    await ref.update({ privateSentinel: 'PRIVATE_METADATA_SENTINEL', withdrawal: { reason: 'PRIVATE_REASON_SENTINEL' } });
    await ref.collection('events').doc('operator').set({ type: 'operator', secret: 'PRIVATE_EVENT_SENTINEL', createdAt: Timestamp.now() });
    const response = await request(officialApi, { pick: result.pick.id }); assert.equal(response.statusCode, 200);
    assert.equal(response.body.pick.bet.oddsAtPublication, null); assert.equal(response.body.pick.system.id, null);
    const raw = JSON.stringify(response.body); assert.ok(!raw.includes('PRIVATE_')); assert.ok(!raw.includes('evidenceHash')); assert.ok(!raw.includes('permalink'));
    assert.ok(response.body.events.every(x => Object.keys(x).sort().join(',') === 'createdAt,type'));
    const pick = { ...result.pick, event: { ...result.pick.event, kickoffAt: 'invalid' } }; assert.equal(pickForAudience(pick), null);
});
test('free reporting cannot reveal future existence or create a report', async () => {
    const future = input(1, { event: { ...input().event, kickoffAt: '2099-10-11T13:00:00Z' } });
    const result = await publishOfficialPick(future, { db, now: NOW, send: async () => confirmation(9005) });
    const report = async pickId => {
        const res = responseCapture();
        await officialApi({ method: 'POST', headers: { authorization: 'Bearer qa-free' }, query: { mode: 'report' },
            body: { pickId, category: 'odds_mismatch' } }, res); return res;
    };
    const known = await report(result.pick.id); const missing = await report(`op_${'9'.repeat(40)}`);
    assert.equal(known.statusCode, 404); assert.deepEqual(known.body, missing.body);
    assert.equal((await db.collection('officialPickReports').get()).size, 0);
});
test('day lookup is bounded and excludes adjacent Madrid days across winter DST boundary', async () => {
    const raw = normalizeOfficialPickInput(input());
    const batch = db.batch();
    for (let n = 0; n < 201; n++) batch.set(db.collection('officialPicks').doc(`legacy-${n}`), { ...raw,
        event: { ...raw.event, homeTeam: `Home ${n}`, kickoffAt: Timestamp.fromDate(new Date('2026-10-11T13:00:00Z')) } });
    await batch.commit(); await assert.rejects(loadOfficialDayLegacyLookup(NOW, { db }), /LEGACY_DAY_READ_LIMIT/);
    await db.recursiveDelete(db.collection('officialPicks'));
    await db.collection('officialPicks').doc('day-edge').set({ ...raw,
        event: { ...raw.event, kickoffAt: Timestamp.fromDate(new Date('2026-10-25T23:30:00Z')) } });
    const currentDay = await loadOfficialDayLegacyLookup(new Date('2026-10-25T12:00:00Z'), { db });
    const nextDay = await loadOfficialDayLegacyLookup(new Date('2026-10-26T12:00:00Z'), { db });
    const key = normalizeOfficialPickInput(input(1, { event: { ...input().event, kickoffAt: '2026-10-25T23:30:00Z' } })).semanticDuplicateKey;
    assert.equal(currentDay.find(key), null); assert.equal(nextDay.find(key).id, 'day-edge');
});
test('Morning secret cannot access owner/admin actions', async () => {
    process.env.MORNING_PUBLISH_SECRET = 'SYNTHETIC_MORNING_TEST_ONLY_0000000000'; process.env.MORNING_PUBLISH_ENABLED = 'true';
    for (const mode of ['list', 'publish', 'dispatch', 'withdraw']) {
        const res = await request(adminApi, { mode }, { authorization: `Bearer ${process.env.MORNING_PUBLISH_SECRET}` }, 'POST'); assert.equal(res.statusCode, 401, mode);
    }
    delete process.env.MORNING_PUBLISH_SECRET; delete process.env.MORNING_PUBLISH_ENABLED;
});
test('Telegram transport classifies definitive rejection vs uncertain failure without raw URL leakage', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'SYNTHETIC_TELEGRAM_NOT_A_REAL_TOKEN'; process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '-100111';
    try {
        for (const status of [400, 401, 403, 429]) {
            globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ ok: false, description: 'RAW_ERROR_SENTINEL' }) });
            await assert.rejects(publishOfficialPickToTelegram(input()), e => e instanceof TelegramRequestError && e.definitelyNotSent && e.message === 'TELEGRAM_REJECTED');
        }
        for (const transport of [async () => { throw new Error('RAW_URL_SENTINEL'); },
            async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }),
            async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: 'WRONG' } } }) })]) {
            globalThis.fetch = transport; await assert.rejects(publishOfficialPickToTelegram(input()), e => !e.definitelyNotSent && e.message === 'TELEGRAM_RESULT_UNKNOWN');
        }
        globalThis.fetch = async (_, options) => {
            assert.equal(options.redirect, 'error');
            const body = JSON.parse(options.body); assert.equal(body.text, formatOfficialTelegramMessage({})); assert.ok(!body.text.includes('?pick='));
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: '-100111' } } }) };
        };
        assert.equal((await publishOfficialPickToTelegram(input())).messageId, 1);
    } finally { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_PUBLIC_CHANNEL_ID; }
});
test('disabling Morning pauses only its unstarted queue entries; UI/T5-equivalent queue still works', async () => {
    const q = await queueOfficialPick(input(), { db, now: NOW, deferDispatch: true, morningSlot: morningSlotKey(NOW) });
    delete process.env.MORNING_PUBLISH_ENABLED; let sends = 0;
    const publisher = publisherWith(async () => confirmation(++sends));
    assert.equal((await dispatchQueuedOfficialPick({ pickId: q.queueId, now: NOW, db, publisher })).state, 'paused');
    assert.equal(sends, 0); assert.equal((await db.collection('officialPicks').get()).size, 0);
    const ui = await queued(2);
    assert.equal((await dispatchQueuedOfficialPick({ pickId: ui.queueId, now: NOW, db, publisher })).state, 'published'); assert.equal(sends, 1);
    process.env.MORNING_PUBLISH_ENABLED = 'true';
    assert.equal((await dispatchQueuedOfficialPick({ pickId: q.queueId, now: NOW, db, publisher })).state, 'paused'); assert.equal(sends, 1);
    delete process.env.MORNING_PUBLISH_ENABLED;
});

test('kickoff crossing between ledger commit and Telegram claim prevents a late send', async () => {
    let ticks = 0; let sends = 0;
    const result = await publishOfficialPick(input(), { db, now: NOW,
        clock: () => ++ticks === 1 ? NOW : new Date('2026-10-11T13:00:01Z'),
        send: async () => confirmation(++sends) });
    assert.equal(result.telegramDelivery.status, 'retryable'); assert.equal(sends, 0);
});
test('public historical feed remains visible even with more than fifty active Premium records', async () => {
    const batch = db.batch();
    for (let n = 0; n < 51; n++) {
        const value = normalizeOfficialPickInput(input(n + 1, { event: { ...input(n + 1).event, kickoffAt: '2099-10-11T13:00:00Z' } }));
        batch.set(db.collection('officialPicks').doc(publicPickIdFor(value)), { ...value,
            event: { ...value.event, kickoffAt: Timestamp.fromDate(value.event.kickoffAt) }, publishedAt: Timestamp.now() });
    }
    const historical = normalizeOfficialPickInput(input(100, { event: { ...input(100).event, kickoffAt: '2026-10-09T13:00:00Z' } }));
    const historicalId = publicPickIdFor(historical);
    batch.set(db.collection('officialPicks').doc(historicalId), { ...historical,
        event: { ...historical.event, kickoffAt: Timestamp.fromDate(historical.event.kickoffAt) }, publishedAt: Timestamp.fromDate(new Date('2026-10-09T08:00:00Z')) });
    await batch.commit();
    const publicResult = await request(officialApi, {}); assert.equal(publicResult.statusCode, 200);
    assert.deepEqual(publicResult.body.picks.map(x => x.id), [historicalId]);
    assert.equal(publicResult.body.picks[0].bet.oddsAtPublication, null);
});
