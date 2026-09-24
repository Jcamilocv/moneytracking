/**
 * @file FutbolBrain Telegram MTProto Ingestion PoC - Entry Point.
 */

export { FutbolBrainMtprotoClient } from './mtproto-client.js';
export { classifyTelegramMessage, MESSAGE_TYPES } from './message-classifier.js';
export {
    normalizeFutbolBrainTelegramPick,
    normalizeSelection,
    normalizeMarket,
    extractKickoff,
    extractProbability,
    parseMadridDateTimeToUTC
} from './canonical-normalizer.js';
export { parseMyPicksSummary } from './my-picks-parser.js';
export { TelegramDeduplicationLedger, defaultDedupLedger } from './deduplication-ledger.js';
export { TelegramPocRouter } from './poc-router.js';
