/**
 * Gestor de Reconexión con Backoff Exponencial y Jitter.
 * 
 * Estrategia de reintentos:
 * Intento 1: 1s (+ jitter)
 * Intento 2: 2s (+ jitter)
 * Intento 3: 4s (+ jitter)
 * Intento 4: 8s (+ jitter)
 * Intento 5: 16s (+ jitter)
 * Intento 6+: 30s cap (+ jitter)
 */
export class ReconnectManager {
    constructor({
        baseDelayMs = 1000,
        maxDelayMs = 30000,
        factor = 2,
        jitterMs = 500,
        maxRetries = Infinity
    } = {}) {
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.factor = factor;
        this.jitterMs = jitterMs;
        this.maxRetries = maxRetries;
        this.attempts = 0;
        this.totalReconnects = 0;
        this.lastError = null;
        this.lastReconnectAt = null;
    }

    /**
     * Calcula el siguiente retraso en milisegundos aplicando backoff y jitter.
     */
    getNextDelay() {
        if (this.attempts >= this.maxRetries) {
            return null;
        }

        const exponentialDelay = this.baseDelayMs * Math.pow(this.factor, this.attempts);
        const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
        const randomJitter = Math.floor(Math.random() * (this.jitterMs + 1));
        const finalDelay = cappedDelay + randomJitter;

        this.attempts++;
        return finalDelay;
    }

    /**
     * Registra un fallo de conexión.
     */
    recordFailure(error) {
        this.lastError = error ? (error.message || String(error)) : 'Unknown error';
    }

    /**
     * Registra una reconexión exitosa, reseteando los intentos de backoff
     * pero incrementando el contador total de reconexiones.
     */
    recordSuccess() {
        this.attempts = 0;
        this.totalReconnects++;
        this.lastError = null;
        this.lastReconnectAt = new Date().toISOString();
    }

    reset() {
        this.attempts = 0;
        this.lastError = null;
    }

    getAttempts() {
        return this.attempts;
    }

    getTotalReconnects() {
        return this.totalReconnects;
    }

    getLastError() {
        return this.lastError;
    }

    getLastReconnectAt() {
        return this.lastReconnectAt;
    }

    isMaxRetriesExceeded() {
        return this.attempts >= this.maxRetries;
    }
}
