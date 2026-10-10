import { timingSafeEqual } from 'node:crypto';
import { adaptMorningCandidate, toMorningQueueInput } from './candidate.js';
import { morningSlotKey } from './one-shot.js';
import { MAX_MORNING_SOURCE_ITEMS } from './source-client.js';
import { SYSTEM_EXECUTION_MODES } from '../system-registry.js';
import { normalizeOfficialPickInput, publicPickIdFor } from '../../api/lib/official-pick-data.js';

export const MAX_MORNING_OFFICIAL_PICKS = 50;
export class MorningPublishError extends Error {
    constructor(code) { super(code); this.code = code; this.name = 'MorningPublishError'; }
}
export const hasMorningAuthorization = (authorization, secret) => {
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256
        || typeof authorization !== 'string' || authorization.length > 270) return false;
    const expected = Buffer.from(`Bearer ${secret}`); const actual = Buffer.from(authorization);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// Validate the entire bounded batch before any queue or ledger mutation.
export const prepareMorningBatch = (body, { now = new Date() } = {}) => {
    const slot = morningSlotKey(now);
    if (!slot || body?.slot !== slot) throw new MorningPublishError('MORNING_OUTSIDE_WINDOW');
    const observedAt = new Date(body?.observedAt);
    const age = now.getTime() - observedAt.getTime();
    if (typeof body?.observedAt !== 'string' || !/Z$/.test(body.observedAt)
        || !Number.isFinite(age) || age < -5_000 || age > 3 * 60_000
        || morningSlotKey(observedAt) !== slot) throw new MorningPublishError('MORNING_OBSERVATION_EXPIRED');
    if (!Array.isArray(body.items) || body.items.length > MAX_MORNING_SOURCE_ITEMS) {
        throw new MorningPublishError('MORNING_BATCH_LIMIT');
    }
    const seen = new Set(); const semantics = new Set(); const candidates = []; const rejected = {};
    for (const item of body.items) {
        const sourceKey = `${item?.MatchId}|${item?.SystemId}`;
        if (seen.has(sourceKey)) throw new MorningPublishError('DUPLICATE_SOURCE_ID');
        seen.add(sourceKey);
        const adapted = adaptMorningCandidate(item, { observedAt: observedAt.toISOString(), now });
        const { validation } = adapted;
        const reason = !validation.ok ? validation.reason
            : validation.definition.executionMode !== SYSTEM_EXECUTION_MODES.EARLY || validation.definition.requiresT5
                ? 'NOT_MORNING_SYSTEM' : null;
        if (reason) { rejected[reason] = (rejected[reason] || 0) + 1; continue; }
        const input = toMorningQueueInput(adapted);
        const normalized = normalizeOfficialPickInput(input);
        if (semantics.has(normalized.semanticDuplicateKey)) {
            rejected.SEMANTIC_DUPLICATE = (rejected.SEMANTIC_DUPLICATE || 0) + 1; continue;
        }
        semantics.add(normalized.semanticDuplicateKey);
        candidates.push({ input, id: publicPickIdFor(normalized) });
    }
    if (candidates.length > MAX_MORNING_OFFICIAL_PICKS) throw new MorningPublishError('MORNING_PUBLICATION_LIMIT');
    return { slot, candidates, rejected, observedAt: observedAt.toISOString() };
};

export const createMorningSubmissionHandler = ({ queue, loadLegacyLookup, dispatch,
    clock = () => new Date(), budgetMs = 40_000, monotonic = () => performance.now() } = {}) => {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
        if (process.env.MORNING_PUBLISH_ENABLED !== 'true') return res.status(503).json({ error: 'MORNING_DISABLED' });
        if (!hasMorningAuthorization(req.headers?.authorization, process.env.MORNING_PUBLISH_SECRET)) {
            return res.status(401).json({ error: 'UNAUTHORIZED' });
        }
        const started = monotonic();
        try {
            const batch = prepareMorningBatch(req.body, { now: clock() });
            if (!batch.candidates.length) return res.status(200).json({ ok: true, slot: batch.slot,
                accepted: 0, dispatched: 0, rejected: batch.rejected, results: [] });
            const legacyLookup = await loadLegacyLookup(clock());
            const queued = [];
            for (const candidate of batch.candidates) {
                if (!morningSlotKey(clock()) || morningSlotKey(clock()) !== batch.slot) {
                    throw new MorningPublishError('MORNING_WINDOW_CLOSED');
                }
                if (monotonic() - started > budgetMs) throw new MorningPublishError('MORNING_ENQUEUE_BUDGET_REACHED');
                const result = await queue(candidate.input, { now: clock(), deferDispatch: true, legacyLookup,
                    morningSlot: batch.slot });
                queued.push({ id: result.queueId, state: result.state, created: result.created });
            }
            const results = [];
            const dispatchable = queued.filter(x => ['queued', 'dispatching', 'not_due'].includes(x.state));
            for (const result of dispatchable) {
                // Leave room for the bounded Telegram request and response. The
                // existing durable dispatcher handles the remaining queue next.
                if (monotonic() - started > budgetMs - 8_000) break;
                const delivery = await dispatch({ pickId: result.id, now: clock() });
                results.push({ id: result.id, state: delivery.state,
                    telegramStatus: delivery.telegramStatus || null });
            }
            return res.status(200).json({ ok: true, slot: batch.slot,
                accepted: queued.length, created: queued.filter(x => x.created).length,
                dispatched: results.length,
                telegramConfirmed: results.filter(x => x.telegramStatus === 'anchored').length,
                retryScheduled: results.filter(x => x.state === 'retry_scheduled').length,
                reviewRequired: results.filter(x => x.state === 'review_required').length,
                pendingDispatch: dispatchable.length - results.length,
                rejected: batch.rejected, results });
        } catch (error) {
            // No provider bodies, URLs, raw exception messages or credentials.
            const code = error instanceof MorningPublishError ? error.code : 'MORNING_SUBMISSION_FAILED';
            return res.status(error instanceof MorningPublishError ? 422 : 503).json({ error: code });
        }
    };
};
