import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMorningSourceClient } from '../server/morning/source-client.js';
import { adaptMorningCandidate, parseFutbolBrainKickoff } from '../server/morning/candidate.js';
import { prepareMorningBatch, createMorningSubmissionHandler } from '../server/morning/ingestion.js';
import { morningSlotKey, claimMorningSlot } from '../server/morning/one-shot.js';
import { morningSubmissionBody, readMorningPublishSecret, submitMorningBatch } from '../server/morning/publish-client.js';
import { runMorningPublisher } from '../server/morning/run-publisher.mjs';
import { NOW, item, sourceResponse, sourceClientOptions, responseCapture } from './fixtures/morning.js';
const batch = items => ({ slot: morningSlotKey(NOW), observedAt: NOW.toISOString(), items });
const secret = 'SYNTHETIC_MORNING_TEST_ONLY_0000000000';
const noIO = () => { throw new Error('UNEXPECTED_IO'); };
process.env.MORNING_PUBLISH_DAY = NOW.toISOString().slice(0, 10);

for (const n of [0, 15, 108, 200]) test(`source reads ${n} complete entries in exactly one GET`, async () => {
    let calls = 0;
    const client = createMorningSourceClient({ ...sourceClientOptions, transport: async (url, options) => {
        calls++; assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
        assert.equal(url.href, 'https://application.futbolbrain.com/api/alarms/active-alarms');
        return sourceResponse(Array.from({ length: n }, (_, i) => item(i + 1)));
    } });
    assert.equal((await client.readActiveAlarms()).items.length, n);
    await assert.rejects(client.readActiveAlarms(), /RATE_LIMITED/); assert.equal(calls, 1);
});
for (const [label, items, extra] of [
    ['201', Array.from({ length: 201 }, (_, i) => item(i)), {}],
    ['malformed last entry', [item(), item(2, { TargetMarket: null })], {}],
    ['has more', [item()], { HasMore: true }], ['truncated', [item()], { IsTruncated: true }],
    ['pagination', [item()], { NextPage: 2 }]
]) test(`source fails closed: ${label}`, async () => {
    const client = createMorningSourceClient({ ...sourceClientOptions, transport: async () => sourceResponse(items, extra) });
    await assert.rejects(client.readActiveAlarms(), /PARTIAL_RESPONSE/);
});
test('source bounds streaming body and applies timeout while reading body', async () => {
    const oversized = createMorningSourceClient({ ...sourceClientOptions, transport: async () => new Response(' '.repeat(1_000_001),
        { headers: { 'Content-Type': 'application/json' } }) });
    await assert.rejects(oversized.readActiveAlarms(), /RESPONSE_TOO_LARGE/);
    const delayed = createMorningSourceClient({ ...sourceClientOptions, timeoutMs: 20,
        transport: async () => ({ status: 200, headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) }) });
    await assert.rejects(delayed.readActiveAlarms(), /SOURCE_TIMEOUT/);
});
for (const status of [302, 401, 403]) test(`source does not follow authorization failure ${status}`, async () => {
    const client = createMorningSourceClient({ ...sourceClientOptions, transport: async () => new Response(null, { status }) });
    await assert.rejects(client.readActiveAlarms(), /AUTH_EXPIRED/);
});
test('source pins origin and returns sanitized errors', async () => {
    assert.throws(() => createMorningSourceClient({ ...sourceClientOptions, baseUrl: 'https://other.example/' }), /INVALID_SOURCE_ORIGIN/);
    const client = createMorningSourceClient({ ...sourceClientOptions, transport: async () => { throw new Error('SENSITIVE_PROVIDER_BODY'); } });
    await assert.rejects(client.readActiveAlarms(), e => e.message === 'SOURCE_UNAVAILABLE');
});
test('naive source time is UTC, explicit offsets agree, malformed dates reject', () => {
    assert.equal(parseFutbolBrainKickoff('2026-10-11T13:00:00').toISOString(), '2026-10-11T13:00:00.000Z');
    assert.equal(parseFutbolBrainKickoff('2026-10-11T15:00:00+02:00').toISOString(), '2026-10-11T13:00:00.000Z');
    for (const s of ['2026-02-30T13:00:00', '2026-10-11T25:00:00', 'bogus']) assert.equal(parseFutbolBrainKickoff(s), null);
});
test('10:00 Madrid window handles summer, winter and DST; no catchup at 13/16', () => {
    for (const iso of ['2026-10-11T08:00:00Z', '2026-10-25T09:00:00Z', '2027-03-28T08:00:00Z']) assert.ok(morningSlotKey(new Date(iso)));
    for (const iso of ['2026-10-11T07:59:59Z', '2026-10-11T08:03:00Z', '2026-10-11T11:00:00Z', '2026-10-11T14:00:00Z']) assert.equal(morningSlotKey(new Date(iso)), null);
});
test('batch rejects started, next-day, wrong leagues, markets, odds and unconfirmed entry', () => {
    const cases = [
        item(1, { DateOfMatch: '2026-10-11T08:00:00' }), item(2, { DateOfMatch: '2026-10-12T13:00:00' }),
        item(3, { League: { ShortName: 'ENG-PRE' } }), item(4, { SystemName: 'unknown' }),
        item(5, { TargetMarket: { ...item().TargetMarket, Odds: 1 } }),
        item(6, { TargetMarket: { ...item().TargetMarket, InOddsRanges: false } }),
        item(7, { TargetMarket: { ...item().TargetMarket, MarketCategory: 'Match Odds' } }),
        item(8, { TargetMarket: { ...item().TargetMarket, MarketName: 'Yes' } }),
        item(9, { SystemName: 'MT-LAB-BTTS-ESP-v0.1', League: { ShortName: 'ESP-PRE' },
            TargetMarket: { ...item().TargetMarket, MarketName: 'Yes' } }),
        item(10, { SystemName: 'MT - GER1 - v1.1', League: { ShortName: 'GER-BUN' } }),
        item(11, { SystemName: 'MT - CHA EUR - V1.0', League: { ShortName: 'EUR-CHL' } })
    ];
    const result = prepareMorningBatch(batch(cases), { now: NOW });
    assert.equal(result.candidates.length, 0); assert.equal(Object.values(result.rejected).reduce((a, b) => a + b, 0), cases.length);
    assert.equal(result.rejected.NOT_MORNING_SYSTEM, 1);
});
test('all three observed EARLY market tuples preserve quotes and server-owned stake', () => {
    const items = [item(), item(2, { SystemName: 'MT - ENG2 - v1.0', League: { ShortName: 'ENG-CHA' },
        TargetMarket: { MarketCategory: 'Match Odds', MarketName: 'Team 2 (FT)', Odds: 3.2, InOddsRanges: true } }),
        item(3, { SystemName: 'MT - Premier League 02.5', League: { ShortName: 'ENG-PRE' },
            TargetMarket: { MarketCategory: 'Over/Under 3.5', MarketName: 'U 3.5 FT', Odds: 1.5, InOddsRanges: true } })];
    const prepared = prepareMorningBatch(batch(items), { now: NOW }); assert.equal(prepared.candidates.length, 3);
    assert.deepEqual(prepared.candidates.map(x => x.input.bet.oddsAtPublication), [2.2, 3.2, 1.5]);
    assert.deepEqual(prepared.candidates.map(x => x.input.bet.selection), ['No', 'Visitante', 'Menos de 3,5 goles']);
});
test('validation of duplicate or oversized batch occurs before any writes', () => {
    assert.throws(() => prepareMorningBatch(batch([item(), item()]), { now: NOW }), /DUPLICATE_SOURCE_ID/);
    assert.throws(() => prepareMorningBatch(batch(Array.from({ length: 51 }, (_, i) => item(i))), { now: NOW }), /MORNING_PUBLICATION_LIMIT/);
    assert.throws(() => prepareMorningBatch({ ...batch([]), observedAt: '2026-10-11T07:59:59Z' }, { now: NOW }), /OBSERVATION_EXPIRED/);
    assert.throws(() => prepareMorningBatch(batch([]), { now: new Date('2026-10-11T08:03:00Z') }), /OUTSIDE_WINDOW/);
});
test('semantic duplicates differing in source IDs collapse within batch', () => {
    const prepared = prepareMorningBatch(batch([item(), item(2, { HomeTeam: item().HomeTeam })]), { now: NOW });
    assert.equal(prepared.candidates.length, 1); assert.equal(prepared.rejected.SEMANTIC_DUPLICATE, 1);
});
test('bounded handler handles zero and several; fail-closed auth, method, disabled and invalid', async () => {
    process.env.MORNING_PUBLISH_SECRET = secret; process.env.MORNING_PUBLISH_ENABLED = 'true';
    let writes = 0; let dispatches = 0;
    const handler = createMorningSubmissionHandler({ clock: () => NOW, loadLegacyLookup: async () => ({}),
        queue: async (_, options) => { assert.equal(options.deferDispatch, true); return { created: true, queueId: String(++writes), state: 'queued' }; },
        dispatch: async () => { dispatches++; return { state: 'published', telegramStatus: 'anchored' }; } });
    const req = items => ({ method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: batch(items) });
    const zero = responseCapture(); await handler(req([]), zero); assert.equal(zero.body.accepted, 0); assert.equal(writes, 0);
    const many = responseCapture(); await handler(req([item(), item(2)]), many); assert.equal(many.body.telegramConfirmed, 2); assert.equal(dispatches, 2);
    for (const [request, code] of [[{ ...req([]), method: 'GET' }, 405], [{ ...req([]), headers: {} }, 401], [req([item(), item()]), 422]]) {
        const res = responseCapture(); await handler(request, res); assert.equal(res.statusCode, code);
    }
    process.env.MORNING_PUBLISH_ENABLED = 'false'; const disabled = responseCapture(); await handler(req([]), disabled); assert.equal(disabled.statusCode, 503);
    assert.equal(writes, 2); delete process.env.MORNING_PUBLISH_ENABLED; delete process.env.MORNING_PUBLISH_SECRET;
});
test('handler queues all first and leaves undispatched entries to existing durable dispatcher', async () => {
    process.env.MORNING_PUBLISH_SECRET = secret; process.env.MORNING_PUBLISH_ENABLED = 'true';
    let elapsed = 0; const order = [];
    const handler = createMorningSubmissionHandler({ clock: () => NOW, monotonic: () => elapsed,
        loadLegacyLookup: async () => ({}), queue: async () => { order.push('queue'); return { created: true, queueId: String(order.length), state: 'queued' }; },
        dispatch: async () => { order.push('send'); elapsed = 33_000; return { state: 'retry_scheduled' }; } });
    const res = responseCapture(); await handler({ method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: batch([item(), item(2)]) }, res);
    assert.deepEqual(order, ['queue', 'queue', 'send']); assert.equal(res.body.pendingDispatch, 1); assert.equal(res.body.retryScheduled, 1);
    delete process.env.MORNING_PUBLISH_ENABLED; delete process.env.MORNING_PUBLISH_SECRET;
});
test('submission drops unknown source data; response logs only sanitized aggregates', async () => {
    const body = morningSubmissionBody({ items: [item(1, { Cookie: 'PRIVATE_SENTINEL', unknown: 'PRIVATE_SENTINEL' })], observedAt: NOW.toISOString() }, morningSlotKey(NOW));
    assert.ok(!JSON.stringify(body).includes('PRIVATE_SENTINEL'));
    const result = await submitMorningBatch({ body, secret, transport: async () => ({ status: 200,
        json: async () => ({ ok: true, accepted: 1, dispatched: 1, rejected: {}, secret: 'PRIVATE_SENTINEL', results: [{ id: 'PRIVATE_SENTINEL' }] }) }) });
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
    await assert.rejects(submitMorningBatch({ body, secret, transport: async () => { throw new Error('PRIVATE_SENTINEL'); } }), e => e.message === 'MORNING_SUBMISSION_UNCONFIRMED');
});
test('publisher claims before I/O and never retries an ambiguous submission or runs outside window', async () => {
    const claims = new Set(); let calls = 0; const logs = [];
    const config = { mode: 'PUBLISH', enabled: true, stateDirectory: '/synthetic', sessionPath: '/synthetic/session', secretPath: '/synthetic/key',
        clock: () => NOW, claim: async (_, slot) => { if (claims.has(slot)) return false; claims.add(slot); return true; },
        readSecret: async () => secret, sessionProvider: () => sourceClientOptions.sessionProvider,
        log: async (_, record) => logs.push({ ...record }), sourceTransport: async () => sourceResponse([item()]),
        publishTransport: async () => { calls++; throw new Error('PRIVATE_SENTINEL'); } };
    assert.equal((await runMorningPublisher(config)).errorCode, 'MORNING_SUBMISSION_UNCONFIRMED');
    assert.equal((await runMorningPublisher(config)).result, 'SKIPPED_OUTSIDE_OR_CLAIMED_WINDOW'); assert.equal(calls, 1);
    const disabled = await runMorningPublisher({ ...config, mode: 'SHADOW', readSecret: noIO, claim: noIO }); assert.equal(disabled.errorCode, 'MORNING_PUBLISH_DISABLED');
    const late = await runMorningPublisher({ ...config, clock: () => new Date('2026-10-11T11:00:00Z'), readSecret: noIO, claim: noIO });
    assert.equal(late.result, 'SKIPPED_OUTSIDE_OR_CLAIMED_WINDOW'); assert.ok(!JSON.stringify(logs).includes('PRIVATE_SENTINEL'));
});
test('protected key reader rejects permission widening and symlinks; durable slot refuses replay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'morning-synthetic-test-')); await chmod(dir, 0o700);
    try {
        const key = join(dir, 'key'); await writeFile(key, secret, { mode: 0o600 }); assert.equal(await readMorningPublishSecret(key), secret);
        await chmod(key, 0o644); await assert.rejects(readMorningPublishSecret(key), /MORNING_SECRET_UNSAFE/);
        await chmod(key, 0o600); const link = join(dir, 'link'); await symlink(key, link); await assert.rejects(readMorningPublishSecret(link));
        assert.equal(await claimMorningSlot(join(dir, 'slots'), 'synthetic-slot'), true);
        assert.equal(await claimMorningSlot(join(dir, 'slots'), 'synthetic-slot'), false);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test('submission response is bounded and timed out even after headers arrive', async () => {
    const config = { body: batch([]), secret };
    await assert.rejects(submitMorningBatch({ ...config, transport: async () => new Response(' '.repeat(65_537),
        { headers: { 'Content-Type': 'application/json' } }) }), /MORNING_SUBMISSION_UNCONFIRMED/);
    await assert.rejects(submitMorningBatch({ ...config, timeoutMs: 20,
        transport: async () => ({ status: 200, json: () => new Promise(() => {}) }) }), /MORNING_SUBMISSION_UNCONFIRMED/);
});
