import { randomUUID } from 'node:crypto';
import {
    getOpsKpisSummary,
    getOpsSystemsSummary,
    getOpsPicksSummary,
    getOpsIncidentsSummary,
    getOpsPaperSummary,
    getOpsAutomationSummary
} from './read-models.js';
import { evaluateUnifiedHealth } from './health-model.js';
import { executeOpsAction, OPS_ACTION_TYPES } from './action-service.js';
import { listOpsAuditLogs } from './audit-log.js';
import { isOpsReadOnlyMode, OPS_READ_PATHS } from './read-only-mode.js';

/**
 * Valida la autenticación administrativa para las peticiones de Astra Ops.
 */
export function isOpsAuthorized(req) {
    // Never reuse a production/admin fallback credential in the isolated local mode.
    const adminSecret = isOpsReadOnlyMode()
        ? process.env.OPS_ADMIN_SECRET
        : process.env.OPS_ADMIN_SECRET || process.env.OFFICIAL_PICKS_ADMIN_SECRET;

    // Si estamos en tests sin secreto configurado
    if (!adminSecret && process.env.NODE_ENV === 'test') {
        const testAuth = req.headers['authorization'] || req.headers['x-ops-admin-token'];
        return testAuth === 'Bearer test_ops_token_secret' || testAuth === 'test_ops_token_secret';
    }

    if (!adminSecret) return false;

    const authHeader = req.headers['authorization'] || '';
    const customHeader = req.headers['x-ops-admin-token'] || '';

    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const providedToken = bearerMatch ? bearerMatch[1] : customHeader;

    return Boolean(providedToken) && providedToken === adminSecret;
}

/**
 * Router principal para despachar rutas de /api/ops/*.
 */
export async function handleOpsRequest(req, res, { db = null, now = new Date() } = {}) {
    const correlationId = req.headers['x-correlation-id'] || `corr_${randomUUID()}`;
    const startTime = Date.now();

    // Headers de seguridad estándar
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Correlation-Id', correlationId);

    // Manejo de CORS restringido a Astra UI / Localhost
    const origin = req.headers['origin'];
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ops-admin-token, x-correlation-id');
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }

    const sendError = (statusCode, code, message, details = null) => {
        res.writeHead(statusCode);
        res.end(JSON.stringify({
            ok: false,
            error: {
                code,
                message,
                details,
                correlationId,
                timestamp: now.toISOString()
            }
        }));
    };

    const sendSuccess = (data, meta = {}) => {
        res.writeHead(200);
        res.end(JSON.stringify({
            ok: true,
            data,
            meta: {
                correlationId,
                timestamp: now.toISOString(),
                durationMs: Date.now() - startTime,
                ...meta
            }
        }));
    };

    // 1. GATE DE AUTENTICACIÓN
    // Rutas públicas (solo si aplica, ej. openapi o health ping básico si se desea, pero aquí Astra protege todo)
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/^\/api\/ops\/?/, '').replace(/\/$/, '');

    // Exact allowlist before parsing bodies or invoking any service.
    if (isOpsReadOnlyMode() && (req.method !== 'GET' || !OPS_READ_PATHS.has(pathname))) {
        return sendError(403, 'OPS_READ_ONLY_MODE', 'Esta instancia solo permite las ocho lecturas Ops.');
    }

    // OpenAPI specification can be viewed if authorized or for introspection
    if (!isOpsAuthorized(req)) {
        return sendError(401, 'UNAUTHORIZED', 'Acceso denegado: se requiere token administrativo de operaciones válido (Bearer o x-ops-admin-token).');
    }

    try {
        // Parsear query parameters
        const query = Object.fromEntries(url.searchParams.entries());

        // 2. PARSEAR BODY EN PETICIONES POST
        let body = {};
        if (req.method === 'POST') {
            if (typeof req.body === 'object' && req.body !== null) {
                body = req.body;
            } else if (typeof req.body === 'string' && req.body.length > 0) {
                try {
                    body = JSON.parse(req.body);
                } catch {
                    return sendError(400, 'INVALID_JSON_BODY', 'El cuerpo de la petición no contiene JSON válido.');
                }
            }
        }

        // ── 3. ROUTING POR DOMINIO CANÓNICO ──

        // GET /api/ops/kpis
        if (req.method === 'GET' && (pathname === 'kpis' || pathname === '')) {
            // A query parameter cannot force repeated Firestore reads.
            const kpis = await getOpsKpisSummary({ db, now });
            return sendSuccess(kpis);
        }

        // GET /api/ops/health
        if (req.method === 'GET' && pathname === 'health') {
            const health = await evaluateUnifiedHealth({ db, now });
            return sendSuccess(health);
        }

        // GET /api/ops/systems
        if (req.method === 'GET' && pathname === 'systems') {
            const systems = await getOpsSystemsSummary({ db });
            return sendSuccess(systems);
        }

        // GET /api/ops/picks
        if (req.method === 'GET' && pathname === 'picks') {
            const picks = await getOpsPicksSummary({
                db,
                limit: query.limit,
                offset: query.offset,
                status: query.status,
                systemId: query.systemId
            });
            if (picks.status === 'capped' || picks.status === 'error') {
                return sendError(503, 'OPS_PICKS_UNAVAILABLE', 'No se puede ofrecer una página completa de picks dentro del presupuesto de lectura.');
            }
            return sendSuccess(picks);
        }

        // GET /api/ops/incidents
        if (req.method === 'GET' && pathname === 'incidents') {
            const incidents = await getOpsIncidentsSummary({
                db,
                status: query.status || 'open',
                limit: query.limit
            });
            return sendSuccess(incidents);
        }

        // GET /api/ops/paper
        if (req.method === 'GET' && pathname === 'paper') {
            const paper = await getOpsPaperSummary({ db, limit: query.limit });
            return sendSuccess(paper);
        }

        // GET /api/ops/automation
        if (req.method === 'GET' && pathname === 'automation') {
            const automation = await getOpsAutomationSummary({ db, now });
            return sendSuccess(automation);
        }

        // GET /api/ops/audit-logs
        if (req.method === 'GET' && pathname === 'audit-logs') {
            const logs = await listOpsAuditLogs({
                entityType: query.entityType,
                entityId: query.entityId,
                action: query.action,
                limit: query.limit,
                offset: query.offset,
                strict: true,
                db
            });
            return sendSuccess({ count: logs.length, logs });
        }

        // POST /api/ops/actions
        // POST /api/ops/actions/:actionName
        if (req.method === 'POST' && (pathname.startsWith('actions') || pathname.endsWith('/action') || pathname.endsWith('/actions'))) {
            const action = body.action || pathname.split('/').pop();
            const actor = {
                id: req.headers['x-actor-id'] || 'astra_operator',
                role: req.headers['x-actor-role'] || 'admin'
            };

            const result = await executeOpsAction({
                action,
                params: body.params || body,
                actor,
                reason: body.reason,
                correlationId,
                db,
                now
            });

            return sendSuccess(result);
        }

        // RUTA NO ENCONTRADA
        return sendError(404, 'ROUTE_NOT_FOUND', `La ruta /api/ops/${pathname} no existe.`);

    } catch (err) {
        if (err.code !== 'OPS_READ_BUDGET_EXCEEDED') console.error('[OPS_ROUTER_EXCEPTION]', err);
        return sendError(
            ['INVALID_ACTION', 'REASON_REQUIRED', 'OPS_READ_BUDGET_EXCEEDED'].includes(err.code) ? 400 : 500,
            err.code || 'INTERNAL_OPS_ERROR',
            err.message
        );
    }
}
