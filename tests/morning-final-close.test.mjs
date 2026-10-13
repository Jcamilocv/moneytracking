import assert from 'node:assert/strict';
import test from 'node:test';
import { morningActivationOpen, morningDeliveryOpen } from '../server/morning/activation.js';
import { dispatchQueuedOfficialPick } from '../server/official-pick-queue.js';
import { createMorningSubmissionHandler } from '../server/morning/ingestion.js';
import { deliverTelegramAtMostOnce } from '../api/lib/_telegram-delivery.js';

process.env.MORNING_PUBLISH_ENABLED = 'true';
process.env.MORNING_PUBLISH_DAY = '2026-10-13';
const slot = '2026-10-13T10:00 Europe/Madrid';
const instant = time => new Date('2026-10-13T' + time + 'Z');

test('one Madrid day and window, missing date fails closed', () => {
    assert.equal(morningActivationOpen(instant('08:00:00')), true);
    assert.equal(morningActivationOpen(instant('08:02:59')), true);
    assert.equal(morningActivationOpen(instant('07:59:59')), false);
    assert.equal(morningActivationOpen(instant('08:03:00')), false);
    assert.equal(morningActivationOpen(new Date('2026-10-14T08:00:00Z')), false);
    assert.equal(morningActivationOpen(instant('08:00:00'), { day: '' }), false);
    assert.equal(morningActivationOpen(instant('08:00:00'), { slot: '2026-10-12T10:00 Europe/Madrid' }), false);
    assert.equal(morningDeliveryOpen(instant('08:02:52'), slot), false);
});

const dispatchScenario = async ({ origin = { kind: 'morning', slot }, times, delivery = 'anchored', senderDelay = false }) => {
    const value = { status: 'queued', origin, event: { kickoffAt: instant('18:00:00') },
        source: { observedAt: instant('08:00:05') }, bet: {}, system: {},
        scheduledAt: instant('08:00:00'), nextAttemptAt: instant('08:00:00') };
    let calls = 0, updates = 0, tick = 0;
    const snapshot = { exists: true, data: () => value };
    const update = changes => { updates++; Object.assign(value, changes); };
    const ref = { update: async changes => update(changes), get: async () => snapshot };
    const db = { collection: () => ({ doc: () => ref }), runTransaction: async fn => fn({ get: async () => snapshot, update: (_, changes) => update(changes) }) };
    let rejected = 0;
    const publisher = async (_, options) => {
        calls++;
        if (!senderDelay) {
            if (origin.kind !== 'morning') assert.equal(options.send, undefined);
            return { pick: { id: 'memory-only' }, telegramDelivery: { status: delivery } };
        }
        const telegramDelivery = await deliverTelegramAtMostOnce({ claim: async () => true,
            send: () => options.send({ event: { kickoffAt: instant('18:00:00') } }),
            markRejected: async () => { rejected++; },
            markUncertain: async () => { throw Error('A blocked send is definitely unsent'); },
            markNotConfigured: async () => { throw Error('Unexpected Telegram call'); },
            anchor: async () => { throw Error('No message should exist'); } });
        return { pick: { id: 'memory-only' }, telegramDelivery };
    };
    const result = await dispatchQueuedOfficialPick({ pickId: 'memory-only', now: times[0], db, publisher,
        clock: () => times[Math.min(tick++, times.length - 1)] });
    return { result, calls, value, updates, rejected };
};

test('pending Morning cannot publish after expiry; valid window can publish', async () => {
    const expired = await dispatchScenario({ times: [instant('08:05:00')] });
    assert.equal(expired.calls, 0);
    assert.equal(expired.result.state, 'paused');
    const valid = await dispatchScenario({ times: [instant('08:00:10')] });
    assert.equal(valid.calls, 1);
    assert.equal(valid.result.state, 'published');
});

test('transaction delay crossing deadline blocks publisher', async () => {
    const result = await dispatchScenario({ times: [instant('08:02:40'), instant('08:03:01')] });
    assert.equal(result.calls, 0);
    assert.equal(result.result.state, 'paused');
});

test('ledger or outbox delay crossing deadline blocks the actual sender', async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = () => { requests++; throw Error('Network forbidden in this test'); };
    try {
        const result = await dispatchScenario({ senderDelay: true,
            times: [instant('08:02:40'), instant('08:02:41'), instant('08:03:01')] });
        assert.equal(requests, 0);
        assert.equal(result.rejected, 1);
        assert.equal(result.result.state, 'retry_scheduled');
        assert.notEqual(result.value.status, 'published');
    } finally { globalThis.fetch = originalFetch; }
});

test('other origins retain existing publication behavior outside Morning', async () => {
    const result = await dispatchScenario({ origin: { kind: 't5' }, times: [instant('09:00:00')] });
    assert.equal(result.calls, 1);
    assert.equal(result.result.state, 'published');
});

test('uncertain delivery is retained for review without resend', async () => {
    const result = await dispatchScenario({ times: [instant('08:00:10')], delivery: 'review_required' });
    assert.equal(result.calls, 1);
    assert.equal(result.result.state, 'review_required');
});

test('ingestion expired before auth/schema cannot enqueue', async () => {
    let mutations = 0;
    const handler = createMorningSubmissionHandler({ clock: () => instant('08:05:00'),
        queue: () => { mutations++; }, dispatch: () => { mutations++; }, loadLegacyLookup: () => { mutations++; } });
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.error, 'MORNING_DISABLED');
    assert.equal(mutations, 0);
});
