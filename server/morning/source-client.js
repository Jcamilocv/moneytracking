const ENDPOINT = '/api/alarms/active-alarms';
const MAX_ITEMS = 100;
const MAX_RESPONSE_BYTES = 1_000_000;
const MIN_INTERVAL_MS = 30 * 60_000;

const validText = (value) => typeof value === 'string' && value.trim().length > 0
    && value.length <= 160 && !Array.from(value).some((char) => char.charCodeAt(0) < 32);
const validId = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value));
const validKickoff = (value) => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
    && !Number.isNaN(Date.parse(value));
const validItem = (item) => item && typeof item === 'object' && !Array.isArray(item)
    && validId(item.MatchId) && validId(item.SystemId) && validText(item.SystemName)
    && validText(item.HomeTeam?.TeamName) && validText(item.AwayTeam?.TeamName)
    && validText(item.League?.ShortName) && validKickoff(item.DateOfMatch)
    && validText(item.TargetMarket?.MarketCategory)
    && (validText(item.TargetMarket?.MarketName) || validText(item.TargetMarket?.MarketShortName))
    && (typeof item.TargetMarket?.Odds === 'number' || typeof item.TargetMarket?.Odds === 'string')
    && Number.isFinite(Number(item.TargetMarket.Odds)) && Number(item.TargetMarket.Odds) > 1;

export class MorningSourceError extends Error {
    constructor(code) { super(code); this.name = 'MorningSourceError'; this.code = code; }
}

// Session provider owns renewal/storage. The client receives headers in memory
// and never serializes them, response bodies, cookies or tokens to diagnostics.
export const createMorningSourceClient = ({ baseUrl, sessionProvider, transport = fetch,
    timeoutMs = 8_000, clock = () => new Date() }) => {
    const origin = new URL(baseUrl);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) {
        throw new MorningSourceError('INVALID_SOURCE_ORIGIN');
    }
    if (typeof sessionProvider !== 'function') throw new MorningSourceError('SESSION_PROVIDER_REQUIRED');
    let lastAttemptAt = -Infinity;
    return {
        async readActiveAlarms() {
            const now = clock().getTime();
            if (now - lastAttemptAt < MIN_INTERVAL_MS) throw new MorningSourceError('RATE_LIMITED');
            lastAttemptAt = now;
            let session;
            try { session = await sessionProvider(); }
            catch (error) {
                if (error?.name === 'MorningSessionError' && ['SESSION_EXPIRED',
                    'SESSION_FILE_PERMISSIONS_UNSAFE', 'SESSION_DIRECTORY_PERMISSIONS_UNSAFE',
                    'SESSION_FILE_OWNER_MISMATCH', 'SESSION_DIRECTORY_OWNER_MISMATCH'
                ].includes(error.code)) throw new MorningSourceError(error.code);
                throw new MorningSourceError('SESSION_UNAVAILABLE');
            }
            if (!session?.headers || typeof session.headers !== 'object') throw new MorningSourceError('SESSION_UNAVAILABLE');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            let response;
            try {
                response = await transport(new URL(ENDPOINT, origin), {
                    method: 'GET', headers: session.headers, redirect: 'manual',
                    signal: controller.signal
                });
            } catch (error) {
                throw new MorningSourceError(error?.name === 'AbortError' ? 'SOURCE_TIMEOUT' : 'SOURCE_UNAVAILABLE');
            } finally { clearTimeout(timeout); }
            if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) throw new MorningSourceError('AUTH_EXPIRED');
            if (response.status !== 200) throw new MorningSourceError('SOURCE_HTTP_ERROR');
            const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
            if (contentType.includes('text/html')) throw new MorningSourceError('AUTH_EXPIRED');
            if (!contentType.includes('application/json')) {
                throw new MorningSourceError('MALFORMED_RESPONSE');
            }
            let body;
            try {
                const raw = await response.text();
                if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new MorningSourceError('RESPONSE_TOO_LARGE');
                body = JSON.parse(raw);
            } catch (error) {
                if (error instanceof MorningSourceError) throw error;
                throw new MorningSourceError('MALFORMED_JSON');
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)
                || !Array.isArray(body.ResultsPicksViewModelItems)
                || !Number.isInteger(body.ActivePicksCount) || body.ActivePicksCount < 0
                || body.ResultsPicksViewModelItems.length > MAX_ITEMS
                || !body.ResultsPicksViewModelItems.every(validItem)) {
                throw new MorningSourceError('PARTIAL_RESPONSE');
            }
            // ActivePicksCount is independent dashboard metadata, not an array checksum.
            return { items: body.ResultsPicksViewModelItems,
                activePicksCount: body.ActivePicksCount, observedAt: clock().toISOString() };
        }
    };
};
