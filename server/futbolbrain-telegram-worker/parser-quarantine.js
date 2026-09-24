import EventEmitter from 'node:events';
import { redactSecrets } from '../futbolbrain-telegram-poc/secrets-redaction.js';

/**
 * Cola de Cuarentena para Mensajes no parseables o con anomalías de formato.
 * 
 * Si un mensaje procedente de FutbolBrain parece relevante (ej. contiene indicadores de Active Pick o My Picks)
 * pero no puede parsearse de forma limpia y determinista:
 * - NO se descarta silenciosamente.
 * - Se almacena en cuarentena con etiqueta PARSE_REVIEW_REQUIRED.
 * - NUNCA se publica ni se registra como pick oficial ni paper.
 */
export class ParserQuarantine extends EventEmitter {
    constructor({ maxEntries = 500 } = {}) {
        super();
        this.maxEntries = maxEntries;
        this.quarantineEntries = [];
    }

    /**
     * Pone un mensaje en cuarentena para revisión técnica posterior.
     */
    quarantineMessage({
        messageId = null,
        text = '',
        classification = 'UNKNOWN',
        reason = 'Failed to parse message',
        error = null,
        timestamp = new Date()
    } = {}) {
        const entry = redactSecrets({
            type: 'PARSE_REVIEW_REQUIRED',
            messageId: messageId ? String(messageId) : null,
            timestamp: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
            classification,
            reason,
            errorMessage: error ? (error.message || String(error)) : null,
            redactedText: typeof text === 'string' ? text.slice(0, 1000) : ''
        });

        this.quarantineEntries.push(entry);

        if (this.quarantineEntries.length > this.maxEntries) {
            this.quarantineEntries.shift(); // FIFO cap
        }

        this.emit('quarantined', entry);
        return entry;
    }

    getEntries() {
        return [...this.quarantineEntries];
    }

    count() {
        return this.quarantineEntries.length;
    }

    clear() {
        this.quarantineEntries = [];
    }
}

export const defaultParserQuarantine = new ParserQuarantine();
