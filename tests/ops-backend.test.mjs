import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    logOpsAudit,
    listOpsAuditLogs,
    sanitizeForAudit,
    inMemoryAuditLogs
} from '../server/ops/audit-log.js';

import {
    HEALTH_STATES,
    evaluateUnifiedHealth
} from '../server/ops/health-model.js';

import {
    getOpsKpisSummary,
    getOpsSystemsSummary,
    getOpsPicksSummary,
    getOpsIncidentsSummary,
    getOpsPaperSummary,
    getOpsAutomationSummary,
    opsReadCache
} from '../server/ops/read-models.js';

import {
    executeOpsAction,
    OPS_ACTION_TYPES,
    systemRuntimeOverrides
} from '../server/ops/action-service.js';

import {
    isOpsAuthorized,
    handleOpsRequest
} from '../server/ops/ops-router.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUDIT LOG & SECRET REDACTION
// ─────────────────────────────────────────────────────────────────────────────

test('Audit Log: Sanitize for audit strips all sensitive fields and tokens', () => {
    const raw = {
        username: 'ceo@moneytips.com',
        api_token: 'secret_12345',
        telegram_string_session: 'session_abcdef',
        private_key: '-----BEGIN PRIVATE KEY-----',
        password: 'SuperSecretPassword',
        nested: {
            auth_credential: 'xyz',
            safeField: 'visible_data'
        }
    };

    const sanitized = sanitizeForAudit(raw);

    assert.equal(sanitized.api_token, '[REDACTED_SECRET]');
    assert.equal(sanitized.telegram_string_session, '[REDACTED_SECRET]');
    assert.equal(sanitized.private_key, '[REDACTED_SECRET]');
    assert.equal(sanitized.password, '[REDACTED_SECRET]');
    assert.equal(sanitized.nested.auth_credential, '[REDACTED_SECRET]');
    assert.equal(sanitized.nested.safeField, 'visible_data');
    assert.equal(sanitized.username, 'ceo@moneytips.com');
});

test('Audit Log: logOpsAudit enforces mandatory action, entityType, entityId and reason', async () => {
    await assert.rejects(
        () => logOpsAudit({ entityType: 'officialPick', entityId: 'op_1', reason: 'valid' }),
        /action is required/
    );

    await assert.rejects(
        () => logOpsAudit({ action: 'test', entityId: 'op_1', reason: 'valid' }),
        /entityType is required/
    );

    await assert.rejects(
        () => logOpsAudit({ action: 'test', entityType: 'officialPick', reason: 'valid' }),
        /entityId is required/
    );

    await assert.rejects(
        () => logOpsAudit({ action: 'test', entityType: 'officialPick', entityId: 'op_1' }),
        /reason is required/
    );
});

test('Audit Log: Creates audit entry with correlationId and stores in memory ledger', async () => {
    const entry = await logOpsAudit({
        actor: { id: 'ceo_1', role: 'admin' },
        action: 'settlement.manual_retry',
        entityType: 'officialPick',
        entityId: 'op_test_123',
        before: { status: 'pending', secret_token: 'abc' },
        after: { status: 'won', secret_token: 'abc' },
        reason: 'Resultado verificado en acta oficial de competición',
        source: 'astra_ui'
    });

    assert.ok(entry.id.startsWith('audit_'));
    assert.ok(entry.correlationId.startsWith('corr_'));
    assert.equal(entry.entityId, 'op_test_123');
    assert.equal(entry.before.secret_token, '[REDACTED_SECRET]');
    assert.equal(entry.after.secret_token, '[REDACTED_SECRET]');
    assert.equal(entry.before.status, 'pending');
    assert.equal(entry.after.status, 'won');
    assert.ok(entry.timestamp);
    assert.ok(entry.timestampMadrid);

    const logs = await listOpsAuditLogs({ entityId: 'op_test_123' });
    assert.ok(logs.length >= 1);
    assert.equal(logs[0].entityId, 'op_test_123');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. UNIFIED HEALTH MODEL
// ─────────────────────────────────────────────────────────────────────────────

test('Health Model: Evaluates overall health and aggregates all core components', async () => {
    process.env.T5_TRANSPORT_STATUS = 'TELEGRAM_MTPROTO_ACTIVE';
    process.env.FUTBOLBRAIN_WORKER_MODE = 'PRODUCTION';
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token';
    process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '-100123456789';

    const health = await evaluateUnifiedHealth();

    assert.ok([HEALTH_STATES.HEALTHY, HEALTH_STATES.DEGRADED, HEALTH_STATES.UNKNOWN].includes(health.overall));
    assert.ok(health.components.vps_t5_worker);
    assert.equal(health.components.vps_t5_worker.status, HEALTH_STATES.HEALTHY);
    assert.equal(health.components.telegram_outbound.status, HEALTH_STATES.HEALTHY);
    assert.equal(health.components.thesportsdb.status, HEALTH_STATES.HEALTHY);
    assert.ok(health.checkedAt);
    assert.ok(health.checkedAtMadrid);
    assert.ok(health.summary.healthyCount >= 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. READ MODELS FOR ASTRA HQ
// ─────────────────────────────────────────────────────────────────────────────

test('Read Models: getOpsSystemsSummary returns all 9 portfolio systems with execution modes', async () => {
    const systemsSummary = await getOpsSystemsSummary();

    assert.ok(systemsSummary.systems.length >= 9, 'Debe incluir al menos los 9 sistemas del portfolio');
    assert.ok(systemsSummary.breakdown.production >= 4);
    assert.ok(systemsSummary.breakdown.paper >= 3);

    // Verificar sistemas T-5 y Morning
    const bttsEsp = systemsSummary.systems.find(s => s.id === 'MT-LAB-BTTS-ESP-v0.1');
    assert.ok(bttsEsp);
    assert.equal(bttsEsp.timing, 'T_MINUS_5');

    const ita1 = systemsSummary.systems.find(s => s.id === 'MT - ITA1 - V1.0');
    assert.ok(ita1);
    assert.equal(ita1.timing, 'MORNING_10_00');
});

test('Read Models: getOpsKpisSummary caches results and responds within TTL', async () => {
    opsReadCache.invalidate();

    const query = (name, filters = [], max = null) => ({
        where: (field, operator, value) => {
            assert.notEqual(name === 'premiumPaymentOrders' && field === 'status', true, 'revenue must not require a compound index');
            assert.notEqual(name === 'entitlements' && field === 'status', true, 'entitlements must not require a collection-group status index');
            return query(name, [...filters, [field, operator, value]], max);
        },
        limit: (size) => query(name, filters, size),
        count: () => ({ get: async () => ({ data: () => ({ count:
            name === 'officialPicks' ? (filters.some(([field]) => field === 'settlement.status') ? 5 : 81)
                : name === 'operationsIncidents' ? 1 : 0
        }) }) }),
        get: async () => {
            assert.ok(max, 'No Ops query may call get() without a limit');
            if (name === 'premiumPaymentOrders') return { docs: [
                { data: () => ({ status: 'paid', expectedAmount: 29.9 }) },
                { data: () => ({ status: 'pending', expectedAmount: 999 }) }
            ] };
            if (name === 'entitlements') return { docs: [{
                data: () => ({ status: 'active', accessUntil: new Date(Date.now() + 86400000) }),
                ref: { parent: { parent: { id: 'user_1' } } }
            }, {
                data: () => ({ status: 'expired', accessUntil: new Date(Date.now() - 86400000) }),
                ref: { parent: { parent: { id: 'user_2' } } }
            }] };
            return { size: 0, docs: [] };
        },
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ lastSettledAt: new Date().toISOString() }) }) })
    });
    const mockDb = {
        collection: (name) => query(name),
        collectionGroup: (name) => query(name)
    };

    const kpis1 = await getOpsKpisSummary({ db: mockDb });
    assert.ok(kpis1.companyHealth);
    assert.equal(kpis1.status, 'connected');
    assert.equal(kpis1.isStale, false);
    assert.equal(kpis1.picksMetrics.totalValidOfficialPicks, 81);
    assert.equal(kpis1.activeSubscribers, 1);
    assert.equal(kpis1.monthlyGrossRevenueEUR, 29.9);

    // Segunda lectura debe venir de cache
    const kpis2 = await getOpsKpisSummary();
    assert.deepEqual(kpis1, kpis2);
});

test('Read Models: picks use a bounded single-field kickoff index and filter before pagination', async () => {
    const docs = [
        { id: 'latest', data: () => ({ status: 'published', system: { id: 'sys-a' }, event: { kickoffAt: new Date('2026-09-25T21:00:00Z') }, settlement: { status: 'won' } }) },
        { id: 'draft', data: () => ({ status: 'draft', system: { id: 'sys-b' }, event: { kickoffAt: new Date('2026-09-25T20:00:00Z') }, settlement: { status: 'pending' } }) },
        { id: 'older', data: () => ({ status: 'published', system: { id: 'sys-b' }, event: { kickoffAt: new Date('2026-09-25T19:00:00Z') }, settlement: { status: 'pending' } }) }
    ];
    const db = { collection(name) {
        assert.equal(name, 'officialPicks');
        return { orderBy(field, direction) {
            assert.equal(field, 'event.kickoffAt');
            assert.equal(direction, 'desc');
            return { limit(max) {
                assert.equal(max, 200);
                return { get: async () => ({ docs }) };
            } };
        } };
    } };

    const page = await getOpsPicksSummary({ db, limit: 1, offset: 1 });
    assert.equal(page.status, 'connected');
    assert.deepEqual(page.picks.map(pick => pick.id), ['older']);
    const filtered = await getOpsPicksSummary({ db, systemId: 'sys-a', status: 'won' });
    assert.deepEqual(filtered.picks.map(pick => pick.id), ['latest']);
});

test('Read Models: getOpsPaperSummary returns paper systems breakdown', async () => {
    const paper = await getOpsPaperSummary();

    assert.ok(Array.isArray(paper.systemsTracked));
    assert.ok(paper.systemsTracked.includes('MT - GER1 - v1.1'));
    assert.ok(paper.systemsTracked.includes('MT - TUR1 - V1.0'));
    assert.ok(paper.systemsTracked.includes('MT - POR1 - v1.0'));
});

test('Read Models: getOpsAutomationSummary returns VPS and cron status', async () => {
    const auto = await getOpsAutomationSummary();

    assert.ok(auto.vpsWorker);
    assert.equal(auto.vpsWorker.service, 'moneytips-t5.service');
    assert.ok(auto.crons.dailySettlement);
    assert.equal(auto.crons.dailySettlement.schedule, '01:00 Europe/Madrid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ACTION MODEL & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

test('Action Model: Rejects execution if reason is missing or too short', async () => {
    await assert.rejects(
        () => executeOpsAction({
            action: OPS_ACTION_TYPES.RETRY_SETTLEMENT,
            params: { pickId: 'op_123' },
            reason: ''
        }),
        (err) => err.code === 'REASON_REQUIRED'
    );

    await assert.rejects(
        () => executeOpsAction({
            action: OPS_ACTION_TYPES.RETRY_SETTLEMENT,
            params: { pickId: 'op_123' },
            reason: 'abc' // menos de 5 caracteres
        }),
        (err) => err.code === 'REASON_REQUIRED'
    );
});

test('Action Model: Executes disable_system and enable_system with runtime override and audit', async () => {
    const systemId = 'MT - Premier League 02.5';

    // Desactivar
    const disableResult = await executeOpsAction({
        action: OPS_ACTION_TYPES.DISABLE_SYSTEM,
        params: { systemId },
        actor: { id: 'ceo', role: 'admin' },
        reason: 'Pausa operativa temporal por mantenimiento de datos de liga'
    });

    assert.equal(disableResult.ok, true);
    assert.equal(disableResult.result.active, false);
    assert.equal(systemRuntimeOverrides.get(systemId), false);
    assert.ok(disableResult.auditId);

    // Reactivar
    const enableResult = await executeOpsAction({
        action: OPS_ACTION_TYPES.ENABLE_SYSTEM,
        params: { systemId },
        actor: { id: 'ceo', role: 'admin' },
        reason: 'Mantenimiento finalizado con éxito'
    });

    assert.equal(enableResult.ok, true);
    assert.equal(enableResult.result.active, true);
    assert.equal(systemRuntimeOverrides.get(systemId), true);
});

test('Action Model: Executes activate_entitlement and revoke_entitlement with audit', async () => {
    const grant = await executeOpsAction({
        action: OPS_ACTION_TYPES.ACTIVATE_ENTITLEMENT,
        params: { email: 'test_client@moneytips.com', plan: 'monthly' },
        actor: { id: 'astra_agent', role: 'operator' },
        reason: 'Activación manual tras confirmación de ingreso bancario'
    });

    assert.equal(grant.ok, true);
    assert.equal(grant.result.granted, true);
    assert.ok(grant.result.accessUntil);
    assert.ok(grant.auditId);

    const revoke = await executeOpsAction({
        action: OPS_ACTION_TYPES.REVOKE_ENTITLEMENT,
        params: { email: 'test_client@moneytips.com' },
        actor: { id: 'astra_agent', role: 'operator' },
        reason: 'Revocación por solicitud expresa del cliente'
    });

    assert.equal(revoke.ok, true);
    assert.equal(revoke.result.revoked, true);
    assert.ok(revoke.auditId);
});

test('Action Model: Executes acknowledge_incident and resolve_incident', async () => {
    const ack = await executeOpsAction({
        action: OPS_ACTION_TYPES.ACKNOWLEDGE_INCIDENT,
        params: { incidentId: 'inc_test_999', domain: 'operations' },
        actor: { id: 'karen', role: 'director' },
        reason: 'Incidencia técnica asignada para investigación'
    });

    assert.equal(ack.ok, true);
    assert.equal(ack.result.acknowledged, true);

    const resolve = await executeOpsAction({
        action: OPS_ACTION_TYPES.RESOLVE_INCIDENT,
        params: { incidentId: 'inc_test_999', domain: 'operations', resolutionNote: 'Corregido' },
        actor: { id: 'karen', role: 'director' },
        reason: 'Solución aplicada y verificada en logs'
    });

    assert.equal(resolve.ok, true);
    assert.equal(resolve.result.resolved, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. OPERATIONAL HTTP ROUTER & AUTH GATE
// ─────────────────────────────────────────────────────────────────────────────

function createMockReqRes({ method = 'GET', url = '/api/ops/kpis', headers = {}, body = null } = {}) {
    const req = {
        method,
        url,
        headers: {
            'content-type': 'application/json',
            ...headers
        },
        body
    };

    let statusCode = 200;
    let headersSent = {};
    let responseBody = '';

    const res = {
        setHeader(name, value) { headersSent[name.toLowerCase()] = value; },
        writeHead(code, headers = {}) {
            statusCode = code;
            Object.assign(headersSent, headers);
        },
        end(chunk) {
            if (chunk) responseBody = chunk;
        }
    };

    return {
        req,
        res,
        getStatus: () => statusCode,
        getJson: () => JSON.parse(responseBody)
    };
}

test('HTTP Router: Rejects unauthenticated requests with 401 and error envelope', async () => {
    process.env.OPS_ADMIN_SECRET = 'super_secret_ops_token';

    const { req, res, getStatus, getJson } = createMockReqRes({
        method: 'GET',
        url: '/api/ops/kpis',
        headers: {} // sin token
    });

    await handleOpsRequest(req, res);

    assert.equal(getStatus(), 401);
    const body = getJson();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.ok(body.error.correlationId);
});

test('HTTP Router: Accepts authorized Bearer token and returns 200 with meta', async () => {
    process.env.OPS_ADMIN_SECRET = 'super_secret_ops_token';

    const { req, res, getStatus, getJson } = createMockReqRes({
        method: 'GET',
        url: '/api/ops/systems',
        headers: {
            'authorization': 'Bearer super_secret_ops_token'
        }
    });

    await handleOpsRequest(req, res);

    assert.equal(getStatus(), 200);
    const body = getJson();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data.systems));
    assert.ok(body.meta.correlationId);
    assert.ok(body.meta.timestamp);
});

test('HTTP Router: Accepts x-ops-admin-token header', async () => {
    process.env.OPS_ADMIN_SECRET = 'super_secret_ops_token';

    const { req, res, getStatus, getJson } = createMockReqRes({
        method: 'GET',
        url: '/api/ops/health',
        headers: {
            'x-ops-admin-token': 'super_secret_ops_token'
        }
    });

    await handleOpsRequest(req, res);

    assert.equal(getStatus(), 200);
    const body = getJson();
    assert.equal(body.ok, true);
    assert.ok(body.data.overall);
});

test('HTTP Router: Dispatches POST /api/ops/actions with audit logging', async () => {
    process.env.OPS_ADMIN_SECRET = 'super_secret_ops_token';

    const { req, res, getStatus, getJson } = createMockReqRes({
        method: 'POST',
        url: '/api/ops/actions',
        headers: {
            'authorization': 'Bearer super_secret_ops_token'
        },
        body: {
            action: 'acknowledge_incident',
            reason: 'Reconocida incidencia desde Astra UI',
            params: {
                incidentId: 'inc_http_test',
                domain: 'operations'
            }
        }
    });

    await handleOpsRequest(req, res);

    assert.equal(getStatus(), 200);
    const body = getJson();
    assert.equal(body.ok, true);
    assert.equal(body.data.action, 'acknowledge_incident');
    assert.ok(body.data.auditId);
});

test('HTTP Router: Returns 404 for non-existent operational subpaths', async () => {
    process.env.OPS_ADMIN_SECRET = 'super_secret_ops_token';

    const { req, res, getStatus, getJson } = createMockReqRes({
        method: 'GET',
        url: '/api/ops/unknown-route',
        headers: {
            'authorization': 'Bearer super_secret_ops_token'
        }
    });

    await handleOpsRequest(req, res);

    assert.equal(getStatus(), 404);
    const body = getJson();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. OPENAPI 3.1 SPECIFICATION INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

test('OpenAPI: Specification file exists and conforms to OpenAPI 3.1.0 standard', () => {
    const specPath = resolve(process.cwd(), 'docs/openapi-ops.json');
    const content = readFileSync(specPath, 'utf8');
    const spec = JSON.parse(content);

    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.info.title.includes('Money Tips'));
    assert.ok(spec.paths['/api/ops/kpis']);
    assert.ok(spec.paths['/api/ops/health']);
    assert.ok(spec.paths['/api/ops/systems']);
    assert.ok(spec.paths['/api/ops/picks']);
    assert.ok(spec.paths['/api/ops/incidents']);
    assert.ok(spec.paths['/api/ops/paper']);
    assert.ok(spec.paths['/api/ops/automation']);
    assert.ok(spec.paths['/api/ops/audit-logs']);
    assert.ok(spec.paths['/api/ops/actions']);
    assert.ok(spec.components.securitySchemes.BearerAuth);
    assert.ok(spec.components.securitySchemes.OpsAdminToken);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. P3.1 READ SAFETY & REAL VALIDATION REGRESSIONS
// ─────────────────────────────────────────────────────────────────────────────

test('Regression: health GET causes zero writes', async () => {
    let writeCalls = 0;
    const writePreventingDb = {
        collection: (name) => ({
            limit: (n) => ({
                get: async () => ({ size: 1, docs: [] })
            }),
            doc: (id) => ({
                get: async () => ({ exists: true, data: () => ({ lastSettledAt: new Date().toISOString() }) }),
                set: async () => { writeCalls++; throw new Error('WRITE_NOT_ALLOWED'); },
                update: async () => { writeCalls++; throw new Error('WRITE_NOT_ALLOWED'); },
                delete: async () => { writeCalls++; throw new Error('WRITE_NOT_ALLOWED'); }
            }),
            where: () => ({
                where: () => ({
                    get: async () => ({ size: 0, docs: [] })
                }),
                get: async () => ({ size: 0, docs: [] })
            }),
            add: async () => { writeCalls++; throw new Error('WRITE_NOT_ALLOWED'); }
        })
    };

    const health = await evaluateUnifiedHealth({ db: writePreventingDb });

    assert.equal(writeCalls, 0, 'evaluateUnifiedHealth must NEVER perform any writes to Firestore');
    assert.equal(health.components.firestore.status, HEALTH_STATES.HEALTHY);
    assert.ok(health.components.firestore.message.includes('Firestore operativo'));
});

test('Regression: KPI source failure produces null/unavailable, never synthetic values', async () => {
    opsReadCache.invalidate();

    // Sin base de datos ni fuentes conectadas
    const kpis = await getOpsKpisSummary({ db: null, bypassCache: true });

    assert.equal(kpis.status, 'unavailable');
    assert.equal(kpis.isStale, false);
    assert.equal(kpis.activeSubscribers, null, 'UNKNOWN subscribers must be null, never 0 or fake count');
    assert.equal(kpis.monthlyGrossRevenueEUR, null, 'UNKNOWN revenue must be null, never 0.00');
    assert.equal(kpis.openIncidents, null, 'UNKNOWN incidents must be null, never 0');
    assert.equal(kpis.picksMetrics.totalValidOfficialPicks, null, 'Must never return hardcoded 81 when source fails');
    assert.equal(kpis.picksMetrics.pendingSettlements, null, 'Must never return hardcoded 0');
    assert.equal(kpis.sourceStatus.subscribers, 'unavailable');
    assert.equal(kpis.sourceStatus.revenue, 'unavailable');
    assert.equal(kpis.sourceStatus.incidents, 'unavailable');
    assert.equal(kpis.sourceStatus.picks, 'unavailable');
});

test('Regression: stale cache is explicitly labelled stale', async () => {
    opsReadCache.invalidate();

    const originalTimestamp = '2026-09-24T01:00:00.000Z';
    // Sembrar la cache con un snapshot válido previo
    opsReadCache.set('kpis_summary', {
        companyHealth: 'HEALTHY',
        status: 'connected',
        isStale: false,
        activeSubscribers: 42,
        monthlyGrossRevenueEUR: 1250.00,
        openIncidents: 1,
        picksMetrics: { totalValidOfficialPicks: 90, pendingSettlements: 2 },
        generatedAt: originalTimestamp
    }, -1000); // Expirada para lectura normal

    // Simular que ahora la base de datos está caída
    const failingDb = {
        collection: () => { throw new Error('CONNECTION_LOST'); },
        collectionGroup: () => { throw new Error('CONNECTION_LOST'); }
    };

    const staleKpis = await getOpsKpisSummary({ db: failingDb, bypassCache: false });

    assert.equal(staleKpis.isStale, true, 'Debe marcarse explícitamente como stale');
    assert.equal(staleKpis.status, 'stale', 'Status debe ser stale');
    assert.equal(staleKpis.activeSubscribers, 42);
    assert.equal(staleKpis.generatedAt, originalTimestamp, 'Debe conservar el timestamp original de la medición');
});

test('Regression: Ops authentication failure does not leak secret', async () => {
    process.env.OPS_ADMIN_SECRET = 'ultra_confidential_admin_token_xyz987';

    const { req, res, getStatus, getJson } = createMockReqRes({
        method: 'GET',
        url: '/api/ops/kpis',
        headers: {
            'authorization': 'Bearer wrong_token_attempt'
        }
    });

    await handleOpsRequest(req, res);

    assert.equal(getStatus(), 401);
    const body = getJson();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');

    const serializedResponse = JSON.stringify(body);
    assert.ok(!serializedResponse.includes('ultra_confidential_admin_token_xyz987'), 'La respuesta de error NUNCA debe contener el secreto');
    assert.ok(!serializedResponse.includes('wrong_token_attempt'));
});

test('Regression: HQ real-mode integration remains read-only', async () => {
    process.env.OPS_ADMIN_SECRET = 'valid_test_secret';

    const readEndpoints = [
        '/api/ops/kpis',
        '/api/ops/health',
        '/api/ops/incidents',
        '/api/ops/systems',
        '/api/ops/paper',
        '/api/ops/automation',
        '/api/ops/audit-logs'
    ];

    for (const endpoint of readEndpoints) {
        const { req, res, getStatus } = createMockReqRes({
            method: 'POST', // Los endpoints de lectura deben rechazar POST
            url: endpoint,
            headers: {
                'authorization': 'Bearer valid_test_secret'
            }
        });

        await handleOpsRequest(req, res);
        assert.ok([404, 405].includes(getStatus()), `Endpoint ${endpoint} no debe aceptar escrituras POST`);
    }
});
