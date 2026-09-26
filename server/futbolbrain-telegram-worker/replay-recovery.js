import { MESSAGE_TYPES } from '../futbolbrain-telegram-poc/message-classifier.js';
import { LOG_TAGS } from './worker-logger.js';

/**
 * Módulo de Replay Recovery post-reconexión o inicio del Worker.
 * 
 * ESTRATEGIA DE RECUPERACIÓN TRAS DESCONEXIÓN:
 * 1. Ventana de Inspección: Al reconectar o iniciar, el worker consulta los últimos N mensajes
 *    (por defecto 20) del diálogo de FutbolBrain directamente a través de MTProto read-only (`getMessages`).
 * 2. Orden Cronológico: Los mensajes se procesan de más antiguo a más reciente para preservar
 *    el orden natural de publicación de alertas.
 * 3. Idempotencia y Deduplicación Estricta:
 *    - Cada mensaje se valida contra el TelegramDeduplicationLedger por su ID de mensaje de Telegram.
 *    - Si es un Active Pick, se valida además contra el sporting fingerprint canónico (evento + mercado + selección + kickoff).
 *    - Si el mensaje o pick ya existía en el ledger, se marca como DUPLICATE y NO se re-simula ni se re-publica.
 * 4. Modo DRY-RUN Garantizado:
 *    - En DRY-RUN simula y registra la acción que habría tenido lugar (WOULD_PUBLISH o WOULD_RECORD_PAPER).
 *    - En ningún caso convierte mensajes históricos en acciones externas reales.
 * 5. Cero Mutaciones:
 *    - No escribe en Firestore ni realiza llamadas externas.
 */
export class ReplayRecovery {
    constructor({
        router,
        logger,
        healthMonitor,
        quarantine,
        limit = 20
    } = {}) {
        this.router = router;
        this.logger = logger;
        this.healthMonitor = healthMonitor;
        this.quarantine = quarantine;
        this.limit = limit;
    }

    /**
     * Ejecuta la reconciliación pasiva sobre los mensajes recientes.
     */
    async recoverRecentMessages({ client, targetEntity, chatId }) {
        const stats = {
            inspected: 0,
            processed: 0,
            duplicates: 0,
            myPicksCount: 0,
            wouldPublish: 0,
            wouldRecordPaper: 0,
            ignoredNonT5: 0,
            errors: 0
        };

        if (!client || !client.client || typeof client.client.getMessages !== 'function') {
            return stats;
        }

        try {
            if (this.logger) {
                this.logger.log(
                    LOG_TAGS.REPLAY_RECOVERY,
                    `Iniciando inspección de replay recovery (últimos ${this.limit} mensajes)...`,
                    { targetChatId: chatId }
                );
            }

            // Lectura pasiva de los últimos N mensajes
            const rawMessages = await client.client.getMessages(targetEntity, { limit: this.limit });
            stats.inspected = rawMessages.length;

            // Procesar de más antiguo a más nuevo
            const chronologicalMessages = [...rawMessages].reverse();

            for (const msg of chronologicalMessages) {
                const text = msg.message || msg.text || '';
                if (!text) continue;

                const msgDate = msg.date ? new Date(msg.date * 1000) : new Date();

                try {
                    const result = await this.router.processMessage({
                        text,
                        chatId,
                        telegramMessageId: msg.id,
                        observedAt: msgDate
                    });

                    stats.processed++;

                    if (result.action === 'DUPLICATE') {
                        stats.duplicates++;
                        if (this.healthMonitor) this.healthMonitor.recordDuplicate();
                    } else if (result.action === 'WOULD_PUBLISH') {
                        stats.wouldPublish++;
                        if (this.healthMonitor) this.healthMonitor.recordMessageSeen({ type: 'ACTIVE_PICK', timestamp: msgDate });
                    } else if (result.action === 'WOULD_RECORD_PAPER') {
                        stats.wouldRecordPaper++;
                        if (this.healthMonitor) this.healthMonitor.recordMessageSeen({ type: 'ACTIVE_PICK', timestamp: msgDate });
                    } else if (result.action === 'MY_PICKS_PROCESSED') {
                        stats.myPicksCount++;
                        if (this.healthMonitor) this.healthMonitor.recordMessageSeen({ type: 'MY_PICKS_SUMMARY', timestamp: msgDate });
                    } else if (result.action === 'EXCLUDED_NON_T5_LISTENER') {
                        stats.ignoredNonT5++;
                        if (this.healthMonitor) this.healthMonitor.recordMessageSeen({ type: 'EXCLUDED_NON_T5_LISTENER', timestamp: msgDate });
                    } else if (result.action === 'IGNORED_INVALID_CANDIDATE') {
                        stats.errors++;
                        if (this.healthMonitor) this.healthMonitor.recordParseError();
                        if (this.quarantine) this.quarantine.quarantineMessage({
                            messageId: msg.id,
                            text,
                            classification: MESSAGE_TYPES.ACTIVE_PICK,
                            reason: result.reason,
                            timestamp: msgDate
                        });
                    }
                } catch (err) {
                    stats.errors++;
                    if (this.healthMonitor) this.healthMonitor.recordParseError();
                    if (this.quarantine) {
                        this.quarantine.quarantineMessage({
                            messageId: msg.id,
                            text,
                            reason: err.message,
                            error: err,
                            timestamp: msgDate
                        });
                    }
                }
            }

            if (this.logger) {
                this.logger.log(
                    LOG_TAGS.REPLAY_RECOVERY,
                    `Replay recovery completado: ${stats.inspected} inspeccionados, ${stats.duplicates} duplicados, ${stats.wouldPublish} WOULD_PUBLISH, ${stats.wouldRecordPaper} WOULD_RECORD_PAPER`,
                    stats
                );
            }

            return stats;
        } catch (err) {
            if (this.logger) {
                this.logger.log(
                    LOG_TAGS.PARSE_FAILED,
                    `Error durante replay recovery: ${err.message}`,
                    { error: err.message }
                );
            }
            throw err;
        }
    }
}
