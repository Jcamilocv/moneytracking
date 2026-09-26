import EventEmitter from 'node:events';
import { FutbolBrainMtprotoClient } from '../futbolbrain-telegram-poc/mtproto-client.js';
import { TelegramPocRouter } from '../futbolbrain-telegram-poc/poc-router.js';
import { TelegramDeduplicationLedger } from '../futbolbrain-telegram-poc/deduplication-ledger.js';
import { classifyTelegramMessage, MESSAGE_TYPES } from '../futbolbrain-telegram-poc/message-classifier.js';
import { parseMyPicksSummary } from '../futbolbrain-telegram-poc/my-picks-parser.js';
import { SingleInstanceLock } from './single-instance-lock.js';
import { ReconnectManager } from './reconnect-manager.js';
import { HealthMonitor } from './health-monitor.js';
import { ParserQuarantine } from './parser-quarantine.js';
import { WorkerLogger, LOG_TAGS } from './worker-logger.js';
import { ReplayRecovery } from './replay-recovery.js';
import { ingestFutbolBrainTelegramPick } from '../futbolbrain-telegram-intake.js';

export class FutbolBrainTelegramWorker extends EventEmitter {
    constructor({
        apiId = process.env.TELEGRAM_API_ID,
        apiHash = process.env.TELEGRAM_API_HASH,
        stringSession = process.env.TELEGRAM_STRING_SESSION,
        chatId = process.env.FUTBOLBRAIN_TELEGRAM_CHAT_ID,
        mode = process.env.FUTBOLBRAIN_WORKER_MODE || 'DRY_RUN',
        lockPath,
        isMock = process.env.TELEGRAM_POC_DRY_RUN === 'true' || !process.env.TELEGRAM_STRING_SESSION,
        silent = false,
        autoAttachSignals = false,
        dedupLedger = new TelegramDeduplicationLedger(),
        reconnectManager = new ReconnectManager(),
        healthMonitor = new HealthMonitor(),
        quarantine = new ParserQuarantine(),
        logger = new WorkerLogger({ silent }),
        replayLimit = 20,
        sportsDataProvider = null,
        ingestPick = ingestFutbolBrainTelegramPick,
        processingClock = () => new Date()
    } = {}) {
        super();

        // 1. FIREWALL ABSOLUTO: Modo de operación estricto
        if (mode !== 'DRY_RUN' && mode !== 'PRODUCTION') {
            throw new Error(`OPERATIONAL_FIREWALL: Only FUTBOLBRAIN_WORKER_MODE=DRY_RUN or PRODUCTION is authorized. Received: '${mode}'`);
        }

        this.apiId = apiId ? Number(apiId) : null;
        this.apiHash = apiHash || null;
        this.stringSession = stringSession || null;
        this.chatId = chatId ? String(chatId) : null;
        this.mode = mode;
        this.isMock = Boolean(isMock);
        this.autoAttachSignals = Boolean(autoAttachSignals);
        this.replayLimit = replayLimit;
        this.sportsDataProvider = sportsDataProvider;
        this.ingestPick = ingestPick;
        this.processingClock = processingClock;

        this.lock = new SingleInstanceLock({ lockPath });
        this.reconnectManager = reconnectManager;
        this.healthMonitor = healthMonitor;
        this.quarantine = quarantine;
        this.logger = logger;
        this.dedupLedger = dedupLedger;

        this.router = new TelegramPocRouter({
            dedupLedger: this.dedupLedger,
            expectedChatId: this.chatId,
            sportsDataProvider: this.sportsDataProvider,
            dryRun: true
        });

        this.replayRecovery = new ReplayRecovery({
            router: this.router,
            logger: this.logger,
            healthMonitor: this.healthMonitor,
            quarantine: this.quarantine,
            limit: this.replayLimit
        });

        this.client = null;
        this.targetEntity = null;
        this.chatTitle = 'FutbolBrain';
        this.isRunning = false;
        this._boundSigint = null;
        this._boundSigterm = null;
    }

    /**
     * Inicia el worker con protección de instancia única, conexión MTProto y replay recovery.
     */
    async start() {
        if (process.env.OPS_READ_ONLY_MODE === '1') {
            const error = new Error('OPS_READ_ONLY_MODE: Telegram worker disabled');
            error.code = 'OPS_READ_ONLY_MODE';
            throw error;
        }
        if (this.isRunning) return;

        this.logger.log(LOG_TAGS.STARTUP, `Iniciando FutbolBrain Telegram Worker en modo ${this.mode}...`, {
            mode: this.mode,
            isMock: this.isMock,
            apiIdPresent: Boolean(this.apiId),
            apiHashPresent: Boolean(this.apiHash),
            stringSessionPresent: Boolean(this.stringSession),
            chatIdPresent: Boolean(this.chatId)
        });

        // 1. Adquisición del Lockfile de instancia única
        this.lock.acquire();

        // 2. Inicialización del cliente MTProto con proxy Read-Only
        this.client = new FutbolBrainMtprotoClient({
            apiId: this.apiId,
            apiHash: this.apiHash,
            stringSession: this.stringSession,
            chatId: this.chatId,
            isMock: this.isMock
        });

        try {
            await this.client.start();
            this.reconnectManager.recordSuccess();

            // 3. Resolución de entidad del chat FutbolBrain
            if (!this.isMock && this.client.client && typeof this.client.client.getDialogs === 'function') {
                const dialogs = await this.client.client.getDialogs({ limit: 100 });
                const targetDialog = dialogs.find(d => String(d.id) === String(this.chatId) || String(d.entity?.id) === String(this.chatId));
                this.targetEntity = targetDialog?.inputEntity || targetDialog?.entity || this.chatId;
                this.chatTitle = targetDialog?.title || targetDialog?.name || 'FutbolBrain';
            } else {
                this.targetEntity = this.chatId;
            }

            // 4. Actualización de Health: conectado y verificado
            this.healthMonitor.recordConnected({
                authenticated: true,
                targetChatResolved: Boolean(this.targetEntity),
                listenerActive: true
            });

            // 5. Replay Recovery: Reconciliación pasiva de los últimos N mensajes sin duplicar
            if (this.targetEntity) {
                this.replayStats = await this.replayRecovery.recoverRecentMessages({
                    client: this.client,
                    targetEntity: this.targetEntity,
                    chatId: this.chatId
                });
            }

            // 6. Suscripción a eventos de mensajes
            this.client.on('message', async (msg) => {
                await this._handleIncomingMessage(msg);
            });

            // 7. Configuración de señales de parada limpia
            if (this.autoAttachSignals) {
                this._boundSigint = async () => {
                    this.logger.log(LOG_TAGS.SHUTDOWN, 'Señal SIGINT recibida. Ejecutando parada limpia...');
                    await this.stop();
                };
                this._boundSigterm = async () => {
                    this.logger.log(LOG_TAGS.SHUTDOWN, 'Señal SIGTERM recibida. Ejecutando parada limpia...');
                    await this.stop();
                };
                process.on('SIGINT', this._boundSigint);
                process.on('SIGTERM', this._boundSigterm);
            }

            this.isRunning = true;
            this.logger.log(LOG_TAGS.STARTUP, `Worker iniciado y a la escucha en chat "${this.chatTitle}" (modo ${this.mode})`);
            this.emit('started');
        } catch (err) {
            this.healthMonitor.setFatalError(err);
            this.logger.log(LOG_TAGS.CONNECTION_LOST, `Error crítico durante el arranque del worker: ${err.message}`);
            this.lock.release();
            throw err;
        }
    }

    /**
     * Procesa un mensaje entrante a través del pipeline de clasificación,
     * cuarentena, normalización y enrutamiento simulado.
     */
    async _handleIncomingMessage(message) {
        const text = message.text || '';
        const msgId = message.messageId || message.id;
        const msgDate = message.date instanceof Date ? message.date : (message.date ? new Date(message.date) : new Date());

        this.healthMonitor.recordMessageSeen({ timestamp: msgDate });
        this.emit('live_message', { messageId: msgId, text, chatId: message.chatId, date: msgDate });

        this.logger.log(LOG_TAGS.MESSAGE_RECEIVED, `Mensaje recibido de Telegram (ID: ${msgId})`, {
            messageId: msgId,
            chatId: message.chatId
        });

        // 1. Clasificación
        const classification = classifyTelegramMessage({
            text,
            chatId: message.chatId,
            expectedChatId: this.chatId
        });

        this.logger.log(LOG_TAGS.MESSAGE_CLASSIFIED, `Mensaje clasificado como ${classification.type}`, {
            messageId: msgId,
            type: classification.type,
            reason: classification.reason
        });

        // 2. Manejo de mensajes externos o ignorados
        if (classification.type === MESSAGE_TYPES.IGNORED_EXTERNAL) {
            this.healthMonitor.recordMessageSeen({ type: 'IGNORED_EXTERNAL', timestamp: msgDate });
            return;
        }

        // 3. Cuarentena si el mensaje parece una alerta relevante pero no es clasificable
        if (classification.type === MESSAGE_TYPES.UNKNOWN) {
            const looksRelevant = /active\s*pick/i.test(text) ||
                                  /ai\s*model/i.test(text) ||
                                  /my\s*picks/i.test(text) ||
                                  /sistema:/i.test(text);

            if (looksRelevant) {
                this.healthMonitor.recordParseError();
                const quarantined = this.quarantine.quarantineMessage({
                    messageId: msgId,
                    text,
                    classification: 'UNKNOWN',
                    reason: 'Formato desconocido pero contiene palabras clave de alerta FutbolBrain',
                    timestamp: msgDate
                });
                this.logger.log(LOG_TAGS.PARSE_FAILED, `Mensaje en cuarentena (PARSE_REVIEW_REQUIRED): ${quarantined.reason}`, {
                    messageId: msgId
                });
            } else {
                this.healthMonitor.recordMessageSeen({ type: 'IGNORED', timestamp: msgDate });
            }
            return;
        }

        // 4. My Picks (Observabilidad y Reconciliación)
        if (classification.type === MESSAGE_TYPES.MY_PICKS_SUMMARY) {
            try {
                const summary = parseMyPicksSummary(text, { observedAt: msgDate });
                this.healthMonitor.recordMessageSeen({ type: 'MY_PICKS_SUMMARY', timestamp: msgDate });
                this.logger.log(LOG_TAGS.MY_PICKS_SUMMARY, `My Picks reporta ${summary.totalPicks} picks en las próximas 24h`, {
                    totalPicks: summary.totalPicks,
                    systems: summary.systems
                });
                this.emit('my_picks', summary);
                return;
            } catch (err) {
                this.healthMonitor.recordParseError();
                this.quarantine.quarantineMessage({
                    messageId: msgId,
                    text,
                    classification: MESSAGE_TYPES.MY_PICKS_SUMMARY,
                    reason: `Error al parsear My Picks: ${err.message}`,
                    error: err,
                    timestamp: msgDate
                });
                this.logger.log(LOG_TAGS.PARSE_FAILED, `Fallo en parser de My Picks: ${err.message}`);
                return;
            }
        }

        // 5. Active Pick
        if (classification.type === MESSAGE_TYPES.ACTIVE_PICK) {
            try {
                const routed = await this.router.processMessage({
                    text,
                    chatId: message.chatId,
                    telegramMessageId: msgId,
                    observedAt: msgDate
                });

                if (routed.action === 'DUPLICATE') {
                    this.healthMonitor.recordDuplicate();
                    this.logger.log(LOG_TAGS.DUPLICATE, `Pick duplicado detectado: ${routed.reason}`, {
                        fingerprint: routed.fingerprint,
                        systemId: routed.systemId
                    });
                    this.emit('duplicate', routed);
                } else if (routed.action === 'WOULD_PUBLISH') {
                    this.healthMonitor.recordMessageSeen({ type: 'ACTIVE_PICK', timestamp: msgDate });
                    if (this.mode === 'PRODUCTION') {
                        if (this._rejectExpiredCandidate(routed, msgId)) return;
                        try {
                            const intakeResult = await this.ingestPick({
                                parsed: {
                                    systemId: routed.candidate.systemId,
                                    homeTeam: routed.candidate.homeTeam,
                                    awayTeam: routed.candidate.awayTeam,
                                    competition: routed.candidate.competition,
                                    market: routed.candidate.market,
                                    rawSelection: routed.candidate.selection,
                                    odds: routed.candidate.odds,
                                    rawText: text
                                },
                                kickoffAt: routed.candidate.kickoffAt,
                                sourceEventId: routed.candidate.fixtureId || `tg_${msgId}`,
                                telegramMessageId: msgId,
                                now: msgDate
                            });
                            this.logger.log(LOG_TAGS.PUBLISHED, `[PRODUCTION] Pick publicado exitosamente: ${intakeResult.officialPickId}`, {
                                officialPickId: intakeResult.officialPickId,
                                action: intakeResult.action
                            });
                            this.emit('published', intakeResult);
                        } catch (err) {
                            this.logger.log(LOG_TAGS.PARSE_FAILED, `Error publicando pick en producción: ${err.message}`, { error: err.message });
                            this.emit('publish_error', err);
                        }
                    } else {
                        this.logger.log(LOG_TAGS.WOULD_PUBLISH, `[DRY_RUN] Confirmación T-5: WOULD_PUBLISH (${routed.candidate.systemId})`, {
                            systemId: routed.candidate.systemId,
                            event: routed.candidate.event,
                            selection: routed.candidate.selection,
                            odds: routed.candidate.odds,
                            kickoffAt: routed.candidate.kickoffAt
                        });
                        this.emit('active_pick', routed);
                    }
                } else if (routed.action === 'WOULD_RECORD_PAPER') {
                    this.healthMonitor.recordMessageSeen({ type: 'ACTIVE_PICK', timestamp: msgDate });
                    if (this.mode === 'PRODUCTION') {
                        if (this._rejectExpiredCandidate(routed, msgId)) return;
                        try {
                            const intakeResult = await this.ingestPick({
                                parsed: {
                                    systemId: routed.candidate.systemId,
                                    homeTeam: routed.candidate.homeTeam,
                                    awayTeam: routed.candidate.awayTeam,
                                    competition: routed.candidate.competition,
                                    market: routed.candidate.market,
                                    rawSelection: routed.candidate.selection,
                                    odds: routed.candidate.odds,
                                    rawText: text
                                },
                                kickoffAt: routed.candidate.kickoffAt,
                                sourceEventId: routed.candidate.fixtureId || `tg_${msgId}`,
                                telegramMessageId: msgId,
                                now: msgDate
                            });
                            this.logger.log(LOG_TAGS.RECORDED_PAPER, `[PRODUCTION] Paper pick registrado exitosamente: ${intakeResult.paperPickId}`, {
                                paperPickId: intakeResult.paperPickId,
                                action: intakeResult.action
                            });
                            this.emit('paper_recorded', intakeResult);
                        } catch (err) {
                            this.logger.log(LOG_TAGS.PARSE_FAILED, `Error registrando paper pick: ${err.message}`, { error: err.message });
                            this.emit('paper_error', err);
                        }
                    } else {
                        this.logger.log(LOG_TAGS.WOULD_RECORD_PAPER, `[DRY_RUN] Confirmación T-5 PAPER: WOULD_RECORD_PAPER (${routed.candidate.systemId})`, {
                            systemId: routed.candidate.systemId,
                            event: routed.candidate.event,
                            selection: routed.candidate.selection,
                            odds: routed.candidate.odds,
                            stake: 0
                        });
                        this.emit('active_pick', routed);
                    }
                } else if (routed.action === 'EXCLUDED_NON_T5_LISTENER') {
                    this.healthMonitor.recordMessageSeen({ type: 'EXCLUDED_NON_T5_LISTENER', timestamp: msgDate });
                    this.logger.log(LOG_TAGS.MESSAGE_CLASSIFIED, `Sistema Morning sin T-5 excluido del listener MTProto (${routed.systemId})`, {
                        systemId: routed.systemId,
                        timing: routed.timing
                    });
                    this.emit('excluded_morning', routed);
                } else if (routed.action === 'IGNORED_UNKNOWN_SYSTEM') {
                    this.healthMonitor.recordMessageSeen({ type: 'IGNORED_UNKNOWN_SYSTEM', timestamp: msgDate });
                    this.logger.log(LOG_TAGS.MESSAGE_CLASSIFIED, `Sistema desconocido ignorado en router (${routed.systemId})`, {
                        systemId: routed.systemId
                    });
                    this.emit('ignored_unknown_system', routed);
                } else if (routed.action === 'IGNORED_INVALID_CANDIDATE') {
                    this.healthMonitor.recordParseError();
                    this.logger.log(LOG_TAGS.PARSE_FAILED, `Candidato T-5 incompleto o fuera del sistema aprobado (${routed.reason})`, {
                        messageId: msgId,
                        systemId: routed.systemId,
                        reason: routed.reason
                    });
                    this.emit('ignored_invalid_candidate', routed);
                }
            } catch (err) {
                this.healthMonitor.recordParseError();
                const quarantined = this.quarantine.quarantineMessage({
                    messageId: msgId,
                    text,
                    classification: MESSAGE_TYPES.ACTIVE_PICK,
                    reason: `Error al procesar Active Pick: ${err.message}`,
                    error: err,
                    timestamp: msgDate
                });
                this.logger.log(LOG_TAGS.PARSE_FAILED, `Fallo al procesar Active Pick: ${err.message}`, {
                    messageId: msgId
                });
                this.emit('parse_failed', quarantined);
            }
        }
    }

    _rejectExpiredCandidate(routed, messageId) {
        const processingAt = this.processingClock();
        const kickoffAt = new Date(routed.candidate.kickoffAt);
        if (!Number.isNaN(kickoffAt.getTime()) && kickoffAt.getTime() > processingAt.getTime()) return false;
        this.healthMonitor.recordParseError();
        this.logger.log(LOG_TAGS.PARSE_FAILED, 'Mensaje T-5 recibido después del inicio; ingesta omitida', {
            messageId,
            systemId: routed.candidate.systemId,
            kickoffAt: routed.candidate.kickoffAt
        });
        this.emit('ignored_stale_candidate', {
            action: 'IGNORED_STALE_CANDIDATE',
            systemId: routed.candidate.systemId,
            telegramMessageId: messageId,
            kickoffAt: routed.candidate.kickoffAt
        });
        return true;
    }

    /**
     * Dispara una reconexión con backoff exponencial y replay recovery.
     */
    async triggerReconnect(error = null) {
        this.healthMonitor.recordReconnect();
        this.reconnectManager.recordFailure(error);

        const delay = this.reconnectManager.getNextDelay();
        if (delay === null) {
            this.healthMonitor.setFatalError(new Error('Máximo número de reintentos de reconexión excedido'));
            this.logger.log(LOG_TAGS.CONNECTION_LOST, 'Máximo número de reintentos de reconexión alcanzado. Worker en estado UNHEALTHY.');
            return false;
        }

        this.logger.log(LOG_TAGS.RECONNECTING, `Pérdida de conexión. Reconectando en ${delay}ms (intento #${this.reconnectManager.getAttempts()})...`, {
            delayMs: delay,
            attempt: this.reconnectManager.getAttempts()
        });

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            if (this.client && typeof this.client.stop === 'function') {
                await this.client.stop().catch(() => {});
            }

            await this.client.start();
            this.reconnectManager.recordSuccess();

            this.healthMonitor.recordConnected({
                authenticated: true,
                targetChatResolved: Boolean(this.targetEntity),
                listenerActive: true
            });

            this.logger.log(LOG_TAGS.CONNECTION_RESTORED, 'Conexión MTProto restaurada con éxito. Ejecutando replay recovery...');

            if (this.targetEntity) {
                await this.replayRecovery.recoverRecentMessages({
                    client: this.client,
                    targetEntity: this.targetEntity,
                    chatId: this.chatId
                });
            }

            return true;
        } catch (reconnectErr) {
            this.logger.log(LOG_TAGS.CONNECTION_LOST, `Fallo en intento de reconexión: ${reconnectErr.message}`);
            return this.triggerReconnect(reconnectErr);
        }
    }

    /**
     * Parada limpia (Graceful Shutdown).
     */
    async stop() {
        if (!this.isRunning) return;

        this.logger.log(LOG_TAGS.SHUTDOWN, 'Deteniendo FutbolBrain Telegram Worker limpiamente...');

        if (this._boundSigint) {
            process.removeListener('SIGINT', this._boundSigint);
            this._boundSigint = null;
        }
        if (this._boundSigterm) {
            process.removeListener('SIGTERM', this._boundSigterm);
            this._boundSigterm = null;
        }

        try {
            if (this.client) {
                await this.client.stop();
            }
        } catch {
            // Ignorar errores en cierre de socket
        }

        this.healthMonitor.recordDisconnected();
        this.lock.release();
        this.isRunning = false;

        this.logger.log(LOG_TAGS.SHUTDOWN, 'Worker detenido con éxito. Lockfile liberado.');
        this.emit('stopped');
    }

    getHealth() {
        return this.healthMonitor.getHealth();
    }

    getQuarantine() {
        return this.quarantine.getEntries();
    }

    getRouterSafetyReport() {
        return this.router._getSafetyReport();
    }
}
