import { redactSecrets, redactSecretString } from '../futbolbrain-telegram-poc/secrets-redaction.js';

export const LOG_TAGS = {
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    MESSAGE_CLASSIFIED: 'MESSAGE_CLASSIFIED',
    PICK_PARSED: 'PICK_PARSED',
    DUPLICATE: 'DUPLICATE',
    WOULD_PUBLISH: 'WOULD_PUBLISH',
    WOULD_RECORD_PAPER: 'WOULD_RECORD_PAPER',
    MY_PICKS_SUMMARY: 'MY_PICKS_SUMMARY',
    CONNECTION_LOST: 'CONNECTION_LOST',
    RECONNECTING: 'RECONNECTING',
    CONNECTION_RESTORED: 'CONNECTION_RESTORED',
    PARSE_FAILED: 'PARSE_FAILED',
    STARTUP: 'STARTUP',
    SHUTDOWN: 'SHUTDOWN',
    HEALTH_CHECK: 'HEALTH_CHECK',
    REPLAY_RECOVERY: 'REPLAY_RECOVERY',
    PUBLISHED: 'PUBLISHED',
    RECORDED_PAPER: 'RECORDED_PAPER'
};

/**
 * Logger estructurado con redacción automática de secretos de Telegram.
 */
export class WorkerLogger {
    constructor({ silent = false, knownSecrets = [] } = {}) {
        this.silent = Boolean(silent);
        this.knownSecrets = knownSecrets;
        this.logs = [];
    }

    log(tag, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const safeMessage = redactSecretString(message);
        const safeMetadata = redactSecrets(metadata, { knownSecrets: this.knownSecrets });

        const logEntry = {
            timestamp,
            tag,
            message: safeMessage,
            ...safeMetadata
        };

        this.logs.push(logEntry);

        if (!this.silent) {
            const metaStr = Object.keys(safeMetadata).length > 0
                ? ' ' + JSON.stringify(safeMetadata)
                : '';
            console.log(`[${timestamp}] [${tag}] ${safeMessage}${metaStr}`);
        }

        return logEntry;
    }

    getLogs() {
        return [...this.logs];
    }

    clear() {
        this.logs = [];
    }
}

export const defaultWorkerLogger = new WorkerLogger();
