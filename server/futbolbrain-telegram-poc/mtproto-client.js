import EventEmitter from 'node:events';
import { createReadOnlyClientProxy } from './read-only-guard.js';
import { redactSecrets } from './secrets-redaction.js';

/**
 * MTProto Client Adapter / Skeleton para Ingesta Telegram de FutbolBrain.
 * 
 * Stack Técnico Seleccionado: Node.js + GramJS (paquete telegram).
 * 
 * Seguridad y Aislamiento:
 * - Utiliza EXCLUSIVAMENTE variables de entorno:
 *   TELEGRAM_API_ID
 *   TELEGRAM_API_HASH
 *   TELEGRAM_STRING_SESSION
 *   FUTBOLBRAIN_TELEGRAM_CHAT_ID
 * - Cero credenciales hardcodeadas.
 * - Modo Mock integrado para tests unitarios y verificación local sin conexión real a Telegram.
 * - Filtrado estricto por FUTBOLBRAIN_TELEGRAM_CHAT_ID.
 * - Manejo de eventos NewMessage.
 * - Registro de auditoría para MessageEdited y MessageDeleted (sin mutaciones de negocio).
 * - Garantía Read-Only: Prohíbe y bloquea deterministamente cualquier llamada mutante (sendMessage, etc.).
 */
export class FutbolBrainMtprotoClient extends EventEmitter {
    constructor({
        apiId = process.env.TELEGRAM_API_ID,
        apiHash = process.env.TELEGRAM_API_HASH,
        stringSession = process.env.TELEGRAM_STRING_SESSION,
        chatId = process.env.FUTBOLBRAIN_TELEGRAM_CHAT_ID,
        isMock = process.env.TELEGRAM_POC_DRY_RUN === 'true' || !process.env.TELEGRAM_STRING_SESSION
    } = {}) {
        super();
        this.apiId = apiId ? Number(apiId) : null;
        this.apiHash = apiHash || null;
        this.stringSession = stringSession || null;
        this.chatId = chatId ? String(chatId) : null;
        this.isMock = Boolean(isMock);
        this.client = null;
        this.isRunning = false;
        this.auditLog = [];
    }

    /**
     * Inicia el cliente MTProto.
     * En producción conectará vía GramJS si existen credenciales válidas y autorizadas.
     * En modo mock / dry-run no abre sockets externos.
     */
    async start() {
        if (this.isRunning) return;

        if (this.isMock) {
            this.isRunning = true;
            return;
        }

        if (!this.apiId || !this.apiHash || !this.stringSession) {
            throw new Error('Faltan credenciales MTProto (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION)');
        }

        // Lazy load GramJS únicamente cuando la conexión real está configurada y autorizada
        const { TelegramClient } = await import('telegram');
        const { StringSession } = await import('telegram/sessions/index.js');
        const { NewMessage } = await import('telegram/events/index.js');

        const session = new StringSession(this.stringSession);
        const rawClient = new TelegramClient(session, this.apiId, this.apiHash, {
            connectionRetries: 5
        });

        // Aplicar proxy estricto de solo lectura para garantizar 0 mutaciones en Telegram
        this.client = createReadOnlyClientProxy(rawClient);

        await this.client.connect();
        this.isRunning = true;

        // Suscripción a NewMessage filtrando por chat
        this.client.addEventHandler((event) => {
            this._handleIncomingTelegramMessage(event.message);
        }, new NewMessage({ chats: this.chatId ? [this.chatId] : [] }));
    }

    /**
     * Descubre y localiza diálogos accesibles para identificar el chat de FutbolBrain
     * sin que el usuario tenga que averiguar manualmente un ID interno de Telegram.
     */
    async discoverFutbolBrainChat({ query = 'futbolbrain', limit = 100 } = {}) {
        if (this.isMock) {
            return [
                {
                    id: '-1009876543210',
                    title: 'FutbolBrain Official Alerts',
                    username: 'futbolbrain_alerts_bot',
                    isGroup: true,
                    isChannel: false,
                    isUser: false
                }
            ];
        }

        if (!this.client || !this.isRunning) {
            throw new Error('El cliente debe estar autenticado e iniciado para descubrir chats');
        }

        const dialogs = await this.client.getDialogs({ limit });
        const cleanQuery = query.toLowerCase();

        return dialogs
            .filter(d => {
                const title = (d.title || d.name || '').toLowerCase();
                const username = (d.entity?.username || '').toLowerCase();
                return title.includes(cleanQuery) || username.includes(cleanQuery);
            })
            .map(d => ({
                id: String(d.id),
                title: d.title || d.name || '',
                username: d.entity?.username || null,
                isGroup: Boolean(d.isGroup),
                isChannel: Boolean(d.isChannel),
                isUser: Boolean(d.isUser)
            }));
    }

    /**
     * Detiene el cliente MTProto.
     */
    async stop() {
        if (!this.isRunning) return;
        if (this.client && typeof this.client.disconnect === 'function') {
            await this.client.disconnect();
        }
        this.isRunning = false;
    }

    /**
     * Inyecta un mensaje simulado (modo Mock / Test).
     */
    simulateIncomingMessage({
        id = Date.now(),
        text = '',
        chatId = this.chatId,
        senderId = 'futbolbrain_bot',
        date = Math.floor(Date.now() / 1000)
    } = {}) {
        this._handleIncomingTelegramMessage({
            id,
            text,
            chatId: String(chatId),
            senderId: String(senderId),
            date
        });
    }

    /**
     * Inyecta un evento simulado de mensaje editado (para auditoría).
     */
    simulateMessageEdited({
        id,
        text,
        chatId = this.chatId,
        date = Math.floor(Date.now() / 1000)
    }) {
        this._handleMessageEdited({ id, text, chatId: String(chatId), date });
    }

    /**
     * Inyecta un evento simulado de mensaje eliminado (para auditoría).
     */
    simulateMessageDeleted({
        ids = [],
        chatId = this.chatId
    }) {
        this._handleMessageDeleted({ ids, chatId: String(chatId) });
    }

    /**
     * Procesa y valida el mensaje recibido antes de emitir.
     */
    _handleIncomingTelegramMessage(message) {
        if (!message) return;

        const incomingChatId = String(message.chatId || message.peerId?.channelId || message.peerId?.chatId || message.peerId?.userId || '');
        
        // FILTRADO ESTRICTO: Solo el chat configurado de FutbolBrain
        if (this.chatId && incomingChatId && incomingChatId !== this.chatId) {
            this.emit('external_message_ignored', {
                messageId: message.id,
                chatId: incomingChatId,
                expectedChatId: this.chatId,
                reason: 'Chat no autorizado'
            });
            return;
        }

        const parseTelegramDate = (d) => {
            if (!d) return new Date();
            if (d instanceof Date) return d;
            if (typeof d === 'number') {
                // Telegram MTProto entrega timestamps en segundos (< 1e11)
                return d < 1e11 ? new Date(d * 1000) : new Date(d);
            }
            const parsed = new Date(d);
            return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
        };

        const payload = {
            messageId: message.id,
            text: message.text || message.message || '',
            chatId: incomingChatId || this.chatId,
            senderId: message.senderId || null,
            date: parseTelegramDate(message.date)
        };

        this.emit('message', payload);
    }

    /**
     * Manejo de Mensajes Editados:
     * REGLA DE NEGOCIO: Ninguna acción sobre picks oficiales ya publicados.
     * Solo registro de auditoría operacional.
     */
    _handleMessageEdited(editEvent) {
        const auditEntry = redactSecrets({
            type: 'TELEGRAM_MESSAGE_EDITED_AUDIT',
            messageId: editEvent.id,
            chatId: editEvent.chatId,
            newText: editEvent.text,
            timestamp: new Date(),
            policyApplied: 'NO_BUSINESS_MUTATION_ON_EDIT'
        });
        this.auditLog.push(auditEntry);
        this.emit('message_edited_audit', auditEntry);
    }

    /**
     * Manejo de Mensajes Eliminados:
     * REGLA DE NEGOCIO: Ninguna acción sobre picks oficiales ya publicados.
     * Solo registro de auditoría operacional.
     */
    _handleMessageDeleted(deleteEvent) {
        const auditEntry = redactSecrets({
            type: 'TELEGRAM_MESSAGE_DELETED_AUDIT',
            messageIds: deleteEvent.ids,
            chatId: deleteEvent.chatId,
            timestamp: new Date(),
            policyApplied: 'NO_BUSINESS_MUTATION_ON_DELETE'
        });
        this.auditLog.push(auditEntry);
        this.emit('message_deleted_audit', auditEntry);
    }
}
