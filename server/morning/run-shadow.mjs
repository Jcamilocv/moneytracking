import { resolve } from 'node:path';
import { createMorningShadowApp } from './bootstrap.js';
import { assertMorningShadow } from './shadow-runner.js';
import { morningSlotKey, claimMorningSlot, appendBoundedMorningLog } from './one-shot.js';

const startedAt = new Date();
const stateDirectory = process.env.MORNING_STATE_DIRECTORY;
const record = { timestamp: startedAt.toISOString(), mode: 'SHADOW', authStatus: 'NOT_CHECKED',
    sourceItemCount: null, classification: null, todayCount: null, futureCount: null,
    validMorningCandidates: null, rejectedReasons: null, reconciliation: null, virtualDedupCount: null,
    httpStatus: null, durationMs: 0, firestoreWrites: 0, officialPicks: 0,
    paperWrites: 0, bankWrites: 0, telegramSends: 0 };
let requests = 0;
try {
    assertMorningShadow(process.env.MORNING_MODE);
    if (!stateDirectory || !stateDirectory.startsWith('/') || !process.env.MORNING_SESSION_FILE) {
        throw new Error('SHADOW_CONFIG_REQUIRED');
    }
    const kind = process.argv[2];
    if (!['--scheduled', '--smoke'].includes(kind) || process.argv.length !== 3) {
        throw new Error('SHADOW_RUN_KIND_INVALID');
    }
    if (kind === '--scheduled') {
        const slot = morningSlotKey(startedAt);
        if (!slot || !await claimMorningSlot(resolve(stateDirectory, 'slots.json'), slot)) {
            record.result = 'SKIPPED_OUTSIDE_OR_CLAIMED_WINDOW';
        }
    }
    if (!record.result) {
        const transport = async (url, options) => {
            if (String(url) !== 'https://application.futbolbrain.com/api/alarms/active-alarms'
                || options.method !== 'GET' || options.redirect !== 'manual' || requests !== 0) {
                throw new Error('SHADOW_REQUEST_FIREWALL');
            }
            requests++;
            const response = await fetch(url, {
                ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
            });
            record.httpStatus = response.status;
            record.authStatus = response.status === 200
                && String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')
                ? 'ACCEPTED_PENDING_VALIDATION' : 'REJECTED';
            return response;
        };
        const app = createMorningShadowApp({
            sessionPath: process.env.MORNING_SESSION_FILE,
            statePath: resolve(stateDirectory, 'state.json'),
            transport, sportsDataProvider: null
        });
        const result = await app.runner.run();
        record.authStatus = 'VALID';
        Object.assign(record, result.telemetry);
        record.result = 'PASS';
    }
} catch (error) {
    record.result = 'FAIL';
    // Never forward an exception message, URL, headers or provider payload.
    record.errorCode = /^[A-Z_]{1,64}$/.test(error?.code || '') ? error.code
        : ['MORNING_SHADOW_FIREWALL', 'SHADOW_CONFIG_REQUIRED', 'SHADOW_RUN_KIND_INVALID',
            'SHADOW_SLOT_STATE_INVALID'].includes(error?.message) ? error.message : 'MORNING_RUN_FAILED';
    process.exitCode = 1;
} finally {
    record.durationMs = Date.now() - startedAt.getTime();
    record.requests = requests;
    if (stateDirectory && process.env.MORNING_MODE === 'SHADOW') {
        try { await appendBoundedMorningLog(resolve(stateDirectory, 'runs.jsonl'), record); }
        catch { record.logError = 'SHADOW_LOG_FAILED'; process.exitCode = 1; }
    }
    console.log(JSON.stringify(record));
}
