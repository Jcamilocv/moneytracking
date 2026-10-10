import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMorningSourceClient } from './source-client.js';
import { createFileMorningSessionProvider } from './session-provider.js';
import { morningSlotKey, claimMorningSlot, appendBoundedMorningLog } from './one-shot.js';
import { morningSubmissionBody, readMorningPublishSecret, submitMorningBatch } from './publish-client.js';

const safeCodes = new Set(['MORNING_PUBLISH_CONFIG_REQUIRED', 'MORNING_PUBLISH_DISABLED',
    'MORNING_SECRET_PATH_REQUIRED', 'MORNING_SECRET_UNSAFE', 'MORNING_SECRET_INVALID',
    'MORNING_SUBMISSION_UNCONFIRMED']);
export const runMorningPublisher = async ({ mode, enabled, stateDirectory, sessionPath, secretPath,
    clock = () => new Date(), sourceTransport = fetch, publishTransport = fetch,
    claim = claimMorningSlot, readSecret = readMorningPublishSecret,
    sessionProvider = createFileMorningSessionProvider, log = appendBoundedMorningLog } = {}) => {
    const record = { mode: 'PUBLISH', result: 'FAIL', requests: 0, submissions: 0,
        timestamp: clock().toISOString(), accepted: 0, created: 0, dispatched: 0 };
    try {
        if (mode !== 'PUBLISH' || enabled !== true) throw new Error('MORNING_PUBLISH_DISABLED');
        if (![stateDirectory, sessionPath, secretPath].every(x => typeof x === 'string' && x.startsWith('/'))) {
            throw new Error('MORNING_PUBLISH_CONFIG_REQUIRED');
        }
        const slot = morningSlotKey(clock());
        if (!slot || !await claim(resolve(stateDirectory, 'publish-slots.json'), slot)) {
            record.result = 'SKIPPED_OUTSIDE_OR_CLAIMED_WINDOW'; return record;
        }
        const secret = await readSecret(secretPath);
        const client = createMorningSourceClient({ baseUrl: 'https://application.futbolbrain.com/',
            sessionProvider: sessionProvider({ path: sessionPath }), clock,
            transport: (...args) => { record.requests++; return sourceTransport(...args); } });
        const source = await client.readActiveAlarms();
        if (morningSlotKey(clock()) !== slot) throw new Error('MORNING_SUBMISSION_UNCONFIRMED');
        const body = morningSubmissionBody(source, slot);
        record.submissions++;
        Object.assign(record, await submitMorningBatch({ body, secret, transport: publishTransport }));
        record.result = record.reviewRequired ? 'DELIVERY_REVIEW_REQUIRED'
            : record.retryScheduled ? 'DELIVERY_RETRY_SCHEDULED'
                : record.pendingDispatch ? 'QUEUED' : 'PASS';
    } catch (error) {
        record.errorCode = error?.name === 'MorningSourceError' ? error.code
            : safeCodes.has(error?.message) ? error.message : 'MORNING_PUBLISH_FAILED';
    } finally {
        if (mode === 'PUBLISH' && stateDirectory?.startsWith('/')) {
            try { await log(resolve(stateDirectory, 'publish-runs.jsonl'), record); }
            catch { record.logError = 'MORNING_LOG_FAILED'; record.result = 'FAIL'; }
        }
    }
    return record;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 3 || process.argv[2] !== '--scheduled') {
        console.log(JSON.stringify({ result: 'FAIL', errorCode: 'MORNING_RUN_KIND_INVALID' })); process.exitCode = 1;
    } else {
        const record = await runMorningPublisher({ mode: process.env.MORNING_MODE,
            enabled: process.env.MORNING_PUBLISH_ENABLED === 'true',
            stateDirectory: process.env.MORNING_STATE_DIRECTORY,
            sessionPath: process.env.MORNING_SESSION_FILE, secretPath: process.env.MORNING_PUBLISH_SECRET_FILE });
        console.log(JSON.stringify(record));
        if (['FAIL', 'DELIVERY_REVIEW_REQUIRED'].includes(record.result)) process.exitCode = 1;
    }
}
