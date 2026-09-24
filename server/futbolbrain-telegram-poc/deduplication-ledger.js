/**
 * Ledger de Idempotencia y Deduplicación en memoria para la PoC de Telegram MTProto.
 * 
 * Protege contra:
 * - Retry de red.
 * - Replay del mismo telegramMessageId.
 * - Reconexión de MTProto con reenvío de mensajes históricos.
 * - Múltiples workers concurrentes.
 * - Diferencias irrelevantes de formato (gracias a fingerprint canónico normalizado).
 * - Mismo pick recibido simultáneamente por Telegram y extensión legacy.
 */
export class TelegramDeduplicationLedger {
    constructor() {
        this.fingerprints = new Map();
        this.messageIds = new Map();
    }

    /**
     * Verifica si un mensaje o pick ya ha sido procesado.
     */
    checkDuplicate({ fingerprint = null, telegramMessageId = null } = {}) {
        if (telegramMessageId && this.messageIds.has(String(telegramMessageId))) {
            return {
                isDuplicate: true,
                reason: 'DUPLICATE_MESSAGE_ID',
                originalRecord: this.messageIds.get(String(telegramMessageId))
            };
        }

        if (fingerprint && this.fingerprints.has(fingerprint)) {
            return {
                isDuplicate: true,
                reason: 'DUPLICATE_SPORTING_FINGERPRINT',
                originalRecord: this.fingerprints.get(fingerprint)
            };
        }

        return {
            isDuplicate: false
        };
    }

    /**
     * Registra un pick procesado en el ledger.
     */
    record({
        fingerprint,
        telegramMessageId = null,
        systemId,
        event,
        action,
        observedAt = new Date()
    } = {}) {
        const recordEntry = {
            fingerprint,
            telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
            systemId,
            event,
            action,
            recordedAt: observedAt instanceof Date ? observedAt : new Date(observedAt)
        };

        if (fingerprint) {
            this.fingerprints.set(fingerprint, recordEntry);
        }

        if (telegramMessageId) {
            this.messageIds.set(String(telegramMessageId), recordEntry);
        }

        return recordEntry;
    }

    hasFingerprint(fingerprint) {
        return Boolean(fingerprint && this.fingerprints.has(fingerprint));
    }

    hasMessageId(telegramMessageId) {
        return Boolean(telegramMessageId && this.messageIds.has(String(telegramMessageId)));
    }

    getRecord(fingerprint) {
        return this.fingerprints.get(fingerprint) || null;
    }

    clear() {
        this.fingerprints.clear();
        this.messageIds.clear();
    }
}

export const defaultDedupLedger = new TelegramDeduplicationLedger();
