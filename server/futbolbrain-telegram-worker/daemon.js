import { FutbolBrainTelegramWorker } from './worker.js';
import { TheSportsDbProvider } from '../sports-data/thesportsdb-provider.js';

const mode = process.env.FUTBOLBRAIN_WORKER_MODE || 'DRY_RUN';

console.log(`[DAEMON] Starting FutbolBrain Telegram Worker in ${mode} mode...`);

const sportsDataProvider = new TheSportsDbProvider({
    apiKey: process.env.THESPORTSDB_API_KEY || '3'
});

const worker = new FutbolBrainTelegramWorker({
    mode,
    autoAttachSignals: true,
    sportsDataProvider
});

worker.on('started', () => {
    console.log('[DAEMON] Worker started successfully and is now listening.');
});

worker.on('live_message', (data) => {
    console.log(`[DAEMON] Message received: ${data.messageId}`);
});

worker.on('active_pick', (data) => {
    console.log(`[DAEMON] Active pick: ${data.candidate?.systemId} - ${data.candidate?.event}`);
});

worker.on('published', (data) => {
    console.log(`[DAEMON] Pick published: ${data.officialPickId}`);
});

worker.on('paper_recorded', (data) => {
    console.log(`[DAEMON] Paper pick recorded: ${data.paperPickId}`);
});

worker.on('duplicate', (data) => {
    console.log(`[DAEMON] Duplicate ignored: ${data.systemId}`);
});

worker.on('excluded_morning', (data) => {
    console.log(`[DAEMON] Morning pick excluded from T-5 listener: ${data.systemId}`);
});

worker.start().catch((err) => {
    console.error('[DAEMON] Fatal error starting worker:', err);
    process.exit(1);
});
