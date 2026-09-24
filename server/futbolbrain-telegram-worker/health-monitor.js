/**
 * Monitor de Salud y Estado Operativo del Worker de Telegram MTProto.
 * 
 * Mantiene métricas precisas en tiempo real:
 * - connected
 * - authenticated
 * - targetChatResolved
 * - listenerActive
 * - lastMessageAt
 * - lastActivePickAt
 * - lastMyPicksAt
 * - reconnectCount
 * - messagesSeen
 * - messagesParsed
 * - messagesIgnored
 * - duplicates
 * - parseErrors
 * - routingErrors
 * - uptime
 * 
 * Estados de salud:
 * - HEALTHY: Conectado, autenticado, chat resuelto, listener activo y sin anomalías críticas.
 * - DEGRADED: En proceso de reconexión, conexión transitoria caída, o presencia de errores de parseo/cuarentena.
 * - UNHEALTHY: Desconectado sin poder recuperarse, fallo de autenticación o error fatal de proceso.
 */
export class HealthMonitor {
    constructor() {
        this.startedAt = new Date();
        this.connected = false;
        this.authenticated = false;
        this.targetChatResolved = false;
        this.listenerActive = false;

        this.lastMessageAt = null;
        this.lastActivePickAt = null;
        this.lastMyPicksAt = null;

        this.reconnectCount = 0;
        this.messagesSeen = 0;
        this.messagesParsed = 0;
        this.messagesIgnored = 0;
        this.duplicates = 0;
        this.parseErrors = 0;
        this.routingErrors = 0;

        this.isReconnecting = false;
        this.fatalError = null;
    }

    recordConnected({ authenticated = true, targetChatResolved = true, listenerActive = true } = {}) {
        this.connected = true;
        this.authenticated = authenticated;
        this.targetChatResolved = targetChatResolved;
        this.listenerActive = listenerActive;
        this.isReconnecting = false;
    }

    recordDisconnected({ error = null, reconnecting = false } = {}) {
        this.connected = false;
        this.listenerActive = false;
        this.isReconnecting = reconnecting;
        if (error) {
            this.fatalError = error.message || String(error);
        }
    }

    recordReconnect() {
        this.reconnectCount++;
        this.isReconnecting = true;
    }

    recordMessageSeen({ type = null, timestamp = new Date() } = {}) {
        this.messagesSeen++;
        this.lastMessageAt = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();

        if (type === 'ACTIVE_PICK') {
            this.lastActivePickAt = this.lastMessageAt;
            this.messagesParsed++;
        } else if (type === 'MY_PICKS_SUMMARY') {
            this.lastMyPicksAt = this.lastMessageAt;
            this.messagesParsed++;
        } else if (type === 'IGNORED' || type === 'IGNORED_EXTERNAL' || type === 'EXCLUDED_NON_T5_LISTENER') {
            this.messagesIgnored++;
        }
    }

    recordDuplicate() {
        this.duplicates++;
    }

    recordParseError() {
        this.parseErrors++;
    }

    recordRoutingError() {
        this.routingErrors++;
    }

    setFatalError(error) {
        this.fatalError = error ? (error.message || String(error)) : 'Fatal error';
        this.connected = false;
        this.listenerActive = false;
    }

    /**
     * Calcula y devuelve el estado consolidado de salud.
     */
    getHealth() {
        const uptimeSeconds = Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000));

        let status = 'HEALTHY';

        if (this.fatalError) {
            status = 'UNHEALTHY';
        } else if (!this.connected && !this.isReconnecting) {
            status = 'UNHEALTHY';
        } else if (this.isReconnecting || !this.connected) {
            status = 'DEGRADED';
        } else if (this.parseErrors > 5 || this.routingErrors > 5) {
            status = 'DEGRADED';
        } else if (this.connected && this.authenticated && this.targetChatResolved && this.listenerActive) {
            status = 'HEALTHY';
        } else {
            status = 'DEGRADED';
        }

        return {
            status,
            uptimeSeconds,
            startedAt: this.startedAt.toISOString(),
            metrics: {
                connected: this.connected,
                authenticated: this.authenticated,
                targetChatResolved: this.targetChatResolved,
                listenerActive: this.listenerActive,
                lastMessageAt: this.lastMessageAt,
                lastActivePickAt: this.lastActivePickAt,
                lastMyPicksAt: this.lastMyPicksAt,
                reconnectCount: this.reconnectCount,
                messagesSeen: this.messagesSeen,
                messagesParsed: this.messagesParsed,
                messagesIgnored: this.messagesIgnored,
                duplicates: this.duplicates,
                parseErrors: this.parseErrors,
                routingErrors: this.routingErrors,
                isReconnecting: this.isReconnecting,
                fatalError: this.fatalError
            }
        };
    }
}
