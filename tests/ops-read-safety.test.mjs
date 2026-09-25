import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleOpsRequest, isOpsAuthorized } from '../server/ops/ops-router.js';
import { executeOpsAction } from '../server/ops/action-service.js';
import { logOpsAudit } from '../server/ops/audit-log.js';
import { createLocalOpsReadOnlyServer } from '../server/ops/local-read-only-server.js';
import { OPS_READ_LIMITS } from '../server/ops/read-safety.js';
import { opsReadCache } from '../server/ops/read-models.js';

const SECRET = 'local_fixture_only';
const PATHS = [
    'health', 'kpis', 'incidents', 'systems', 'picks', 'paper', 'automation', 'audit-logs'
];

function mockFirestore(cardinality = 1_000_000) {
    const stats = { documents: 0, indexEntries: 0, unboundedGets: 0, writes: 0, listeners: 0 };
    const countFor = (name) => name === 'cronLocks' ? 1 : cardinality;
    const document = (name, index) => ({
        id: `${name}_${index}`,
        data: () => ({
            status: 'open', expectedAmount: 29.9,
            accessUntil: new Date(Date.now() + 86400000),
            lastSettledAt: new Date().toISOString(),
            event: { homeTeam: 'A', awayTeam: 'B', kickoffAt: new Date() },
            bet: { oddsAtPublication: 2 },
            settlement: { status: 'pending' }
        }),
        ref: { parent: { parent: { id: `user_${index}` } } }
    });
    const query = (name, max = null) => ({
        where: () => query(name, max),
        orderBy: () => query(name, max),
        limit: (n) => {
            assert.ok(Number.isSafeInteger(n) && n > 0 && n <= OPS_READ_LIMITS.kpiCountIndexEntries);
            return query(name, n);
        },
        count: () => {
            if (max === null) { stats.unboundedGets++; throw new Error('UNBOUNDED_COUNT'); }
            return { get: async () => {
                const count = Math.min(max, countFor(name));
                stats.indexEntries += count;
                return { data: () => ({ count }) };
            } };
        },
        get: async () => {
            if (max === null) { stats.unboundedGets++; throw new Error('UNBOUNDED_GET'); }
            const count = Math.min(max, countFor(name));
            stats.documents += count;
            const docs = Array.from({ length: count }, (_, index) => document(name, index));
            return { size: count, empty: count === 0, docs };
        },
        doc: () => ({
            get: async () => {
                stats.documents++;
                return { exists: true, data: () => ({ lastSettledAt: new Date().toISOString() }) };
            },
            set: () => { stats.writes++; throw new Error('WRITE_BLOCKED'); },
            update: () => { stats.writes++; throw new Error('WRITE_BLOCKED'); }
        }),
        onSnapshot: () => { stats.listeners++; throw new Error('LISTENER_BLOCKED'); },
        add: () => { stats.writes++; throw new Error('WRITE_BLOCKED'); }
    });
    return {
        stats,
        collection: (name) => query(name),
        collectionGroup: (name) => query(name)
    };
}

function mockRequest(path, method = 'GET') {
    let status = 200;
    let body = null;
    const req = {
        method, url: `/api/ops/${path}`,
        headers: { authorization: `Bearer ${SECRET}` }
    };
    const res = {
        setHeader() {},
        writeHead(code) { status = code; return this; },
        end(value) { body = value ? JSON.parse(value) : null; }
    };
    return { req, res, result: () => ({ status, body }) };
}

function withReadOnlyMode(fn) {
    const previousMode = process.env.OPS_READ_ONLY_MODE;
    const previousSecret = process.env.OPS_ADMIN_SECRET;
    process.env.OPS_READ_ONLY_MODE = '1';
    process.env.OPS_ADMIN_SECRET = SECRET;
    return Promise.resolve().then(fn).finally(() => {
        if (previousMode === undefined) delete process.env.OPS_READ_ONLY_MODE;
        else process.env.OPS_READ_ONLY_MODE = previousMode;
        if (previousSecret === undefined) delete process.env.OPS_ADMIN_SECRET;
        else process.env.OPS_ADMIN_SECRET = previousSecret;
    });
}

test('Every Ops GET stays within its document and index budget on a very large database', async () => withReadOnlyMode(async () => {
    const budgets = {
        health: OPS_READ_LIMITS.healthDocuments,
        kpis: OPS_READ_LIMITS.kpiDocuments,
        incidents: OPS_READ_LIMITS.incidentDocuments,
        systems: 0,
        picks: OPS_READ_LIMITS.pickDocuments,
        paper: OPS_READ_LIMITS.paperDocuments,
        automation: OPS_READ_LIMITS.healthDocuments,
        'audit-logs': OPS_READ_LIMITS.auditDocuments
    };
    for (const path of PATHS) {
        opsReadCache.invalidate();
        const db = mockFirestore();
        const response = mockRequest(path);
        await handleOpsRequest(response.req, response.res, { db });
        assert.equal(response.result().status, 200, path);
        assert.ok(db.stats.documents <= budgets[path], `${path}: ${db.stats.documents} > ${budgets[path]}`);
        assert.ok(db.stats.indexEntries <= 4 * OPS_READ_LIMITS.kpiCountIndexEntries, path);
        assert.equal(db.stats.unboundedGets, 0, `${path} attempted an unbounded query`);
        assert.equal(db.stats.writes, 0, path);
        assert.equal(db.stats.listeners, 0, path);
    }
}));

test('HQ historical full-scan incident cannot recur through KPI refresh or offset', async () => withReadOnlyMode(async () => {
    opsReadCache.invalidate();
    const db = mockFirestore(100_000);
    const first = mockRequest('kpis?refresh=true');
    await handleOpsRequest(first.req, first.res, { db });
    assert.equal(first.result().status, 200);
    assert.equal(first.result().body.data.picksMetrics.totalValidOfficialPicks, null);
    assert.equal(first.result().body.data.sourceStatus.picks, 'capped');
    const firstCost = { ...db.stats };
    const second = mockRequest('kpis?refresh=true');
    await handleOpsRequest(second.req, second.res, { db });
    assert.equal(second.result().status, 200);
    assert.deepEqual(db.stats, firstCost, 'a query parameter must not bypass the five-minute cache');

    const tooDeep = mockRequest('picks?offset=1000000');
    await handleOpsRequest(tooDeep.req, tooDeep.res, { db });
    assert.equal(tooDeep.result().status, 400);
    assert.equal(tooDeep.result().body.error.code, 'OPS_READ_BUDGET_EXCEEDED');
    assert.deepEqual(db.stats, firstCost, 'deep offsets must be rejected before Firestore');
    const auditTooDeep = mockRequest('audit-logs?offset=1000000');
    await handleOpsRequest(auditTooDeep.req, auditTooDeep.res, { db });
    assert.equal(auditTooDeep.result().status, 400);
    assert.deepEqual(db.stats, firstCost);
}));

test('Local mode blocks actions before side effects, including direct service calls', async () => withReadOnlyMode(async () => {
    const db = mockFirestore(1);
    for (const [path, method] of [['actions', 'POST'], ['health', 'POST'], ['actions/retry_settlement', 'POST'], ['not-a-tool', 'GET']]) {
        const response = mockRequest(path, method);
        await handleOpsRequest(response.req, response.res, { db });
        assert.equal(response.result().status, 403, path);
        assert.equal(response.result().body.error.code, 'OPS_READ_ONLY_MODE');
    }
    await assert.rejects(() => executeOpsAction({ action: 'disable_system', reason: 'local test', params: { systemId: 'test' }, db }), { code: 'OPS_READ_ONLY_MODE' });
    await assert.rejects(() => logOpsAudit({ action: 'test', entityType: 'test', entityId: '1', reason: 'local test', db }), { code: 'OPS_READ_ONLY_MODE' });
    assert.equal(db.stats.documents, 0);
    assert.equal(db.stats.writes, 0);
}));

test('Local mode never falls back to the production official-picks secret', async () => withReadOnlyMode(async () => {
    const previousFallback = process.env.OFFICIAL_PICKS_ADMIN_SECRET;
    delete process.env.OPS_ADMIN_SECRET;
    process.env.OFFICIAL_PICKS_ADMIN_SECRET = 'different_fixture_only';
    try {
        assert.equal(isOpsAuthorized({ headers: { authorization: 'Bearer different_fixture_only' } }), false);
        assert.throws(() => createLocalOpsReadOnlyServer(), /local OPS_ADMIN_SECRET is required/);
    } finally {
        if (previousFallback === undefined) delete process.env.OFFICIAL_PICKS_ADMIN_SECRET;
        else process.env.OFFICIAL_PICKS_ADMIN_SECRET = previousFallback;
    }
}));

test('All other HTTP entrypoints have an early read-only guard', async () => withReadOnlyMode(async () => {
    const paths = [
        'api/admin/official-picks.js',
        'api/cron/refresh-official-snapshots.js',
        'api/cron/settle-official-picks.js',
        'api/official-picks.js',
        'api/official-snapshots.js',
        'api/payments/stripe/create-checkout.js',
        'api/payments/stripe/customer-portal.js',
        'api/payments/stripe/webhook.js',
        'api/scan.js'
    ];
    for (const path of paths) {
        const source = readFileSync(resolve(process.cwd(), path), 'utf8');
        assert.match(source, /export default async function handler\(req, res\) \{\s*if \(blockOutsideOpsInReadOnlyMode\(res\)\) return;/, path);
        const { default: handler } = await import(new URL(`../${path}`, import.meta.url));
        let status = null;
        await handler({ method: 'POST', headers: {}, query: {} }, {
            status(code) { status = code; return this; },
            json(payload) { assert.equal(payload.error.code, 'OPS_READ_ONLY_MODE'); return this; }
        });
        assert.equal(status, 403, path);
    }
    for (const path of ['server/ops/read-models.js', 'server/ops/health-model.js', 'server/ops/audit-log.js']) {
        const source = readFileSync(resolve(process.cwd(), path), 'utf8');
        assert.doesNotMatch(source, /\bonSnapshot\s*\(|\bsetInterval\s*\(/, path);
    }
    assert.match(readFileSync(resolve(process.cwd(), 'server/futbolbrain-telegram-worker/worker.js'), 'utf8'), /async start\(\) \{\s*if \(process\.env\.OPS_READ_ONLY_MODE === '1'\)/);
    assert.match(readFileSync(resolve(process.cwd(), 'scripts/execute-p20-production.mjs'), 'utf8'), /async function main\(\) \{\s*if \(process\.env\.OPS_READ_ONLY_MODE === '1'\)/);
}));

test('Dedicated local server exposes only Ops GET and is configured for loopback', async () => withReadOnlyMode(async () => {
    const server = createLocalOpsReadOnlyServer();
    const source = readFileSync(resolve(process.cwd(), 'server/ops/local-read-only-server.js'), 'utf8');
    assert.match(source, /listen\(PORT, HOST/);
    assert.match(source, /const HOST = '127\.0\.0\.1'/);

    const dispatch = (url, method = 'GET') => new Promise((done) => {
        let status = 200;
        const req = { url, method, headers: { authorization: `Bearer ${SECRET}` } };
        const res = {
            setHeader() {},
            writeHead(value) { status = value; return this; },
            end(body) { done({ status, body: body ? JSON.parse(body) : null }); }
        };
        server.emit('request', req, res);
    });
    assert.equal((await dispatch('/api/ops/systems')).status, 200);
    assert.equal((await dispatch('/api/cron/settle-official-picks')).status, 403);
    assert.equal((await dispatch('/api/ops/actions', 'POST')).status, 403);
}));
