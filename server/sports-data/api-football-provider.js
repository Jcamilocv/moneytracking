/**
 * @file Implementación del proveedor de datos deportivos contra API-Football (v3.football.api-sports.io).
 * 
 * CARACTERÍSTICAS DE SEGURIDAD Y CONTROL DE COSTES:
 * 1. La API Key se lee exclusivamente de opciones o process.env.API_FOOTBALL_KEY.
 * 2. La API Key nunca se expone en logs, errores ni cadenas serializadas.
 * 3. Seguimiento riguroso de cuota diaria y por minuto (headers x-ratelimit-*).
 * 4. Presupuesto estricto de requests (maxRequests) para proteger el plan gratuito.
 * 5. Caché en memoria para evitar llamadas redundantes.
 */

import { SportsDataProvider } from './sports-data-provider.js';

export class BudgetExceededError extends Error {
    constructor(message, { requestsMade, maxRequests } = {}) {
        super(message);
        this.name = 'BudgetExceededError';
        this.requestsMade = requestsMade;
        this.maxRequests = maxRequests;
    }
}

export class ApiFootballError extends Error {
    constructor(message, { statusCode, endpoint, errors } = {}) {
        super(message);
        this.name = 'ApiFootballError';
        this.statusCode = statusCode;
        this.endpoint = endpoint;
        this.errors = errors;
    }
}

export class ApiFootballProvider extends SportsDataProvider {
    constructor({
        apiKey = process.env.API_FOOTBALL_KEY,
        baseUrl = 'https://v3.football.api-sports.io',
        maxRequests = 30,
        cacheTtlMs = 1000 * 60 * 60, // 1 hora por defecto
        fetchFn = globalThis.fetch,
        silent = false
    } = {}) {
        super('ApiFootballProvider');
        this._apiKey = apiKey ? String(apiKey).trim() : null;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.maxRequests = Number(maxRequests) || 30;
        this.cacheTtlMs = Number(cacheTtlMs) || 3600000;
        this._fetch = fetchFn;
        this.silent = Boolean(silent);

        // Estado de Rate Limit y métricas de consumo
        this.stats = {
            requestsMade: 0,
            dailyLimit: null,
            dailyRemaining: null,
            minuteLimit: null,
            minuteRemaining: null,
            lastRequestAt: null
        };

        // Caché en memoria: key -> { timestamp, data }
        this._cache = new Map();
    }

    /**
     * Comprueba si la API key está presente sin exponer su contenido.
     */
    isKeyPresent() {
        return Boolean(this._apiKey && this._apiKey.length >= 8);
    }

    /**
     * Devuelve el estado de rate limit y consumo de cuota.
     */
    getRateLimitStatus() {
        return {
            requestsMade: this.stats.requestsMade,
            dailyLimit: this.stats.dailyLimit,
            dailyRemaining: this.stats.dailyRemaining,
            minuteLimit: this.stats.minuteLimit,
            minuteRemaining: this.stats.minuteRemaining,
            lastRequestAt: this.stats.lastRequestAt,
            cacheEntries: this._cache.size
        };
    }

    /**
     * Limpia la caché en memoria.
     */
    clearCache() {
        this._cache.clear();
    }

    /**
     * Ejecuta una llamada HTTP autenticada contra API-Football con control de cuota y caché.
     */
    async _request(endpoint, params = {}) {
        if (!this.isKeyPresent()) {
            throw new ApiFootballError('Falta API_FOOTBALL_KEY para conectar con API-Football', {
                endpoint,
                statusCode: 401
            });
        }

        // Construir URL con query params ordenados para consistencia de caché
        const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`);
        const sortedKeys = Object.keys(params).sort();
        for (const key of sortedKeys) {
            if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                url.searchParams.append(key, String(params[key]));
            }
        }
        const cacheKey = url.toString();

        // 1. Comprobar caché en memoria
        const cached = this._cache.get(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < this.cacheTtlMs) {
            if (!this.silent) {
                console.log(`[API-Football] Cache HIT: ${endpoint} (${url.search})`);
            }
            return cached.data;
        }

        // 2. Control de presupuesto estricto (PoC Guard)
        if (this.stats.requestsMade >= this.maxRequests) {
            throw new BudgetExceededError(
                `Presupuesto de requests para la PoC alcanzado (max: ${this.maxRequests}). Operación detenida para proteger el plan gratuito.`,
                { requestsMade: this.stats.requestsMade, maxRequests: this.maxRequests }
            );
        }

        // 3. Ejecutar HTTP fetch
        this.stats.requestsMade++;
        this.stats.lastRequestAt = new Date();

        if (!this.silent) {
            console.log(`[API-Football] Request #${this.stats.requestsMade}/${this.maxRequests}: ${endpoint} (${url.search})`);
        }

        let response;
        try {
            response = await this._fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'x-apisports-key': this._apiKey,
                    'Accept': 'application/json'
                }
            });
        } catch (netErr) {
            throw new ApiFootballError(`Fallo de red al conectar con API-Football: ${netErr.message}`, {
                endpoint,
                statusCode: 0
            });
        }

        // 4. Extraer metadatos de Rate Limit de los headers
        this._updateRateLimitFromHeaders(response.headers);

        if (response.status === 429) {
            const retryAfterSec = Number(response.headers?.get('retry-after')) || 15;
            if (!this.silent) {
                console.log(`[API-Football] 429 per-minute rate limit alcanzado. Esperando ${retryAfterSec}s para reintento automático...`);
            }
            await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
            response = await this._fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'x-apisports-key': this._apiKey,
                    'Accept': 'application/json'
                }
            });
            this._updateRateLimitFromHeaders(response.headers);
        }

        if (!response.ok) {
            let errorBody = '';
            try { errorBody = await response.text(); } catch {}
            const safeError = this._redact(errorBody);
            throw new ApiFootballError(`API-Football respondió con HTTP ${response.status}: ${safeError.slice(0, 200)}`, {
                statusCode: response.status,
                endpoint
            });
        }

        let data;
        try {
            data = await response.json();
        } catch (parseErr) {
            throw new ApiFootballError(`Respuesta no JSON de API-Football: ${parseErr.message}`, {
                statusCode: response.status,
                endpoint
            });
        }

        // 5. Validar si el payload contiene errores de API-Football (ej. rateLimit, token, etc.)
        if (data?.errors && Object.keys(data.errors).length > 0) {
            // Manejar rateLimit en el body (10 req/min del plan gratuito)
            if (data.errors.rateLimit) {
                if (!this.silent) {
                    console.log('[API-Football] errors.rateLimit alcanzado (10 req/min). Esperando 20s para reintento automático...');
                }
                await new Promise(resolve => setTimeout(resolve, 20000));
                response = await this._fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        'x-apisports-key': this._apiKey,
                        'Accept': 'application/json'
                    }
                });
                this._updateRateLimitFromHeaders(response.headers);
                data = await response.json();
            }

            if (data?.errors && Object.keys(data.errors).length > 0) {
                const firstMsg = typeof data.errors === 'object'
                    ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join('; ')
                    : String(data.errors);

                const safeMsg = this._redact(firstMsg);

                throw new ApiFootballError(`API-Football devolvió errores en respuesta: ${safeMsg}`, {
                    statusCode: response.status,
                    endpoint,
                    errors: data.errors
                });
            }
        }

        const resultPayload = data?.response || [];

        // 6. Guardar en caché
        this._cache.set(cacheKey, {
            timestamp: now,
            data: resultPayload
        });

        return resultPayload;
    }

    /**
     * Parsea headers de rate limit de API-Football.
     */
    _updateRateLimitFromHeaders(headers) {
        if (!headers || typeof headers.get !== 'function') return;

        // Daily requests
        const dailyLimit = headers.get('x-ratelimit-requests-limit');
        if (dailyLimit !== null && !Number.isNaN(Number(dailyLimit))) {
            this.stats.dailyLimit = Number(dailyLimit);
        }

        const dailyRemaining = headers.get('x-ratelimit-requests-remaining');
        if (dailyRemaining !== null && !Number.isNaN(Number(dailyRemaining))) {
            this.stats.dailyRemaining = Number(dailyRemaining);
        }

        // Minute requests
        const minuteLimit = headers.get('x-ratelimit-limit');
        if (minuteLimit !== null && !Number.isNaN(Number(minuteLimit))) {
            this.stats.minuteLimit = Number(minuteLimit);
        }

        const minuteRemaining = headers.get('x-ratelimit-remaining');
        if (minuteRemaining !== null && !Number.isNaN(Number(minuteRemaining))) {
            this.stats.minuteRemaining = Number(minuteRemaining);
        }
    }

    /**
     * Redacta la API key en caso de que aparezca en strings de error.
     */
    _redact(str) {
        if (!str || !this._apiKey) return str;
        return String(str).split(this._apiKey).join('[REDACTED_API_KEY]');
    }

    /**
     * Obtiene ligas/competiciones según filtros.
     * @param {Object} [filters]
     * @param {number} [filters.id]
     * @param {string} [filters.name]
     * @param {string} [filters.country]
     * @param {string} [filters.code]
     * @param {number} [filters.season]
     * @param {boolean} [filters.current]
     * @returns {Promise<Array<Object>>}
     */
    async getLeagues(filters = {}) {
        return this._request('leagues', filters);
    }

    /**
     * Obtiene fixtures según filtros.
     * @param {Object} [filters]
     * @param {number} [filters.id]
     * @param {number} [filters.league]
     * @param {number} [filters.season]
     * @param {string} [filters.date] YYYY-MM-DD
     * @param {string} [filters.from] YYYY-MM-DD
     * @param {string} [filters.to] YYYY-MM-DD
     * @param {number} [filters.team]
     * @param {string} [filters.status]
     * @returns {Promise<Array<Object>>}
     */
    async getFixtures(filters = {}) {
        return this._request('fixtures', filters);
    }

    /**
     * Obtiene un fixture específico por su ID.
     * @param {number|string} fixtureId
     * @returns {Promise<Object|null>}
     */
    async getFixture(fixtureId) {
        if (!fixtureId) return null;
        const fixtures = await this._request('fixtures', { id: fixtureId });
        return fixtures && fixtures.length > 0 ? fixtures[0] : null;
    }
}
