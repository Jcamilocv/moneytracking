import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export const MORNING_PUBLISH_URL = 'https://app.pronosticosmoneytips.com/api/admin/official-picks?mode=morning';
export const readMorningPublishSecret = async (path) => {
    if (!isAbsolute(path || '')) throw new Error('MORNING_SECRET_PATH_REQUIRED');
    let handle;
    try {
        const directory = await lstat(dirname(path));
        if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)
            || directory.uid !== process.getuid()) throw new Error('MORNING_SECRET_UNSAFE');
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const metadata = await handle.stat();
        if (!metadata.isFile() || (metadata.mode & 0o077) || metadata.uid !== process.getuid()
            || metadata.size > 258) throw new Error('MORNING_SECRET_UNSAFE');
        const secret = (await handle.readFile('utf8')).trim();
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error('MORNING_SECRET_INVALID');
        return secret;
    } finally { await handle?.close(); }
};

// Forward only the fields needed for server-side verification. Never forward
// source headers, cookies, unknown fields, provider metadata or observed odds history.
export const morningSubmissionBody = ({ items, observedAt }, slot) => ({ slot, observedAt,
    items: items.map(item => ({ MatchId: item.MatchId, SystemId: item.SystemId, SystemName: item.SystemName,
        DateOfMatch: item.DateOfMatch, HomeTeam: { TeamName: item.HomeTeam.TeamName },
        AwayTeam: { TeamName: item.AwayTeam.TeamName }, League: { ShortName: item.League.ShortName },
        TargetMarket: { MarketCategory: item.TargetMarket.MarketCategory,
            MarketName: item.TargetMarket.MarketName, MarketShortName: item.TargetMarket.MarketShortName,
            Odds: item.TargetMarket.Odds, InOddsRanges: item.TargetMarket.InOddsRanges } })) });

export const submitMorningBatch = async ({ body, secret, transport = fetch, timeoutMs = 50_000 }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort',
        () => reject(new Error('MORNING_SUBMISSION_UNCONFIRMED')), { once: true }));
    const bounded = operation => Promise.race([operation, aborted]);
    try {
        const response = await bounded(transport(MORNING_PUBLISH_URL, { method: 'POST', redirect: 'manual',
            signal: controller.signal, headers: { Authorization: `Bearer ${secret}`,
                'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
        let result;
        if (response.body?.getReader) {
            const reader = response.body.getReader(); const chunks = []; let bytes = 0;
            try {
                for (;;) {
                    const { done, value } = await bounded(reader.read());
                    if (done) break;
                    bytes += value.byteLength;
                    if (bytes > 65_536) throw new Error('MORNING_SUBMISSION_UNCONFIRMED');
                    chunks.push(Buffer.from(value));
                }
                result = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
            } finally { reader.releaseLock(); }
        } else {
            result = await bounded(response.json());
            if (Buffer.byteLength(JSON.stringify(result)) > 65_536) throw new Error('MORNING_SUBMISSION_UNCONFIRMED');
        }
        if (response.status !== 200 || result?.ok !== true) throw new Error('MORNING_SUBMISSION_UNCONFIRMED');
        const counts = ['accepted', 'created', 'dispatched', 'telegramConfirmed', 'retryScheduled', 'reviewRequired', 'pendingDispatch'];
        if (counts.some(k => result[k] !== undefined && (!Number.isInteger(result[k]) || result[k] < 0 || result[k] > 50))
            || !Number.isInteger(result.accepted) || !Number.isInteger(result.dispatched)
            || !result.rejected || typeof result.rejected !== 'object' || Array.isArray(result.rejected)
            || Object.entries(result.rejected).some(([k, v]) => !/^[A-Z_]{1,64}$/.test(k) || !Number.isInteger(v) || v < 0 || v > 200)) {
            throw new Error('MORNING_SUBMISSION_UNCONFIRMED');
        }
        return { accepted: result.accepted, created: result.created || 0,
            dispatched: result.dispatched, telegramConfirmed: result.telegramConfirmed || 0,
            retryScheduled: result.retryScheduled || 0, reviewRequired: result.reviewRequired || 0,
            pendingDispatch: result.pendingDispatch || 0, rejected: result.rejected };
    } catch { throw new Error('MORNING_SUBMISSION_UNCONFIRMED'); }
    finally { clearTimeout(timeout); controller.abort(); }
};
