/**
 * @file Implementación del proveedor de datos deportivos contra TheSportsDB (v1 API).
 * 
 * CARACTERÍSTICAS:
 * 1. Utiliza la clave gratuita de TheSportsDB (por defecto '3' o process.env.THESPORTSDB_KEY).
 * 2. Seguimiento de rate limits y métricas de consumo en memoria.
 * 3. Caché en memoria para evitar peticiones redundantes.
 * 4. Pacing inteligente para respetar los límites de la API gratuita.
 * 5. Redacción de claves en logs y errores.
 */

import { SportsDataProvider } from './sports-data-provider.js';

export class TheSportsDbProvider extends SportsDataProvider {
    constructor({
        apiKey = process.env.THESPORTSDB_API_KEY || process.env.THESPORTSDB_KEY || '123',
        baseUrl = 'https://www.thesportsdb.com/api/v1/json',
        maxRequests = 50,
        cacheTtlMs = 1000 * 60 * 60, // 1 hora
        fetchFn = globalThis.fetch,
        minIntervalMs = 0,
        silent = false
    } = {}) {
        super('TheSportsDbProvider');
        this._apiKey = String(apiKey || '123').trim();
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.maxRequests = Number(maxRequests) || 50;
        this.cacheTtlMs = Number(cacheTtlMs) || 3600000;
        this.minIntervalMs = Number(minIntervalMs) || 0;
        this._fetch = fetchFn;
        this.silent = Boolean(silent);
        this._lastNetworkRequestTime = 0;

        this.stats = {
            requestsMade: 0,
            dailyLimit: 1000, // Estimación estándar de cortesía TheSportsDB free
            dailyRemaining: 1000,
            minuteLimit: 30,
            minuteRemaining: 30,
            cacheHits: 0,
            cacheMisses: 0,
            rateLimitHits: 0,
            lastRequestAt: null
        };

        this._cache = new Map();
    }

    isKeyPresent() {
        return Boolean(this._apiKey && this._apiKey.length >= 1);
    }

    getStats() {
        return {
            totalRequests: this.stats.requestsMade,
            cacheHits: this.stats.cacheHits,
            cacheMisses: this.stats.cacheMisses,
            rateLimitHits: this.stats.rateLimitHits,
            lastRequestAt: this.stats.lastRequestAt
        };
    }

    getRateLimitStatus() {
        return {
            requestsMade: this.stats.requestsMade,
            dailyLimit: this.stats.dailyLimit,
            dailyRemaining: Math.max(0, this.stats.dailyLimit - this.stats.requestsMade),
            minuteLimit: this.stats.minuteLimit,
            lastRequestAt: this.stats.lastRequestAt,
            cacheEntries: this._cache.size
        };
    }

    clearCache() {
        this._cache.clear();
    }

    async _request(endpoint, params = {}) {
        const url = new URL(`${this.baseUrl}/${this._apiKey}/${endpoint.replace(/^\/+/, '')}`);
        const sortedKeys = Object.keys(params).sort();
        for (const key of sortedKeys) {
            if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                url.searchParams.append(key, String(params[key]));
            }
        }
        const cacheKey = url.toString();

        // 1. Caché
        const cached = this._cache.get(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < this.cacheTtlMs) {
            this.stats.cacheHits++;
            if (!this.silent) {
                console.log(`[TheSportsDB] Cache HIT: ${endpoint} (${url.search})`);
            }
            return cached.data;
        }

        this.stats.cacheMisses++;

        // 2. Budget Guard
        if (this.stats.requestsMade >= this.maxRequests) {
            throw new Error(`Presupuesto de requests TheSportsDB alcanzado (max: ${this.maxRequests})`);
        }

        this.stats.requestsMade++;
        this.stats.lastRequestAt = new Date();

        if (!this.silent) {
            console.log(`[TheSportsDB] Request #${this.stats.requestsMade}/${this.maxRequests}: ${endpoint} (${url.search})`);
        }

        // Pacing entre peticiones de red si minIntervalMs está configurado
        if (this.minIntervalMs > 0) {
            const elapsed = Date.now() - (this._lastNetworkRequestTime || 0);
            if (elapsed < this.minIntervalMs) {
                await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
            }
        }

        let response;
        try {
            response = await this._fetch(url.toString(), {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            this._lastNetworkRequestTime = Date.now();
        } catch (netErr) {
            throw new Error(`Fallo de red al conectar con TheSportsDB: ${netErr.message}`);
        }

        let maxRetries = 3;
        while (response.status === 429 && maxRetries > 0) {
            this.stats.rateLimitHits++;
            const waitMs = (4 - maxRetries) * 15000; // 15s, 30s, 45s
            if (!this.silent) {
                console.log(`[TheSportsDB] Rate limit (429) alcanzado. Esperando ${waitMs / 1000}s para reintento automático (${maxRetries} restantes)...`);
            }
            await new Promise(resolve => setTimeout(resolve, waitMs));
            try {
                response = await this._fetch(url.toString(), {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });
                this._lastNetworkRequestTime = Date.now();
            } catch (netErr) {
                throw new Error(`Fallo de red al reintentar TheSportsDB: ${netErr.message}`);
            }
            maxRetries--;
        }

        if (!response.ok) {
            throw new Error(`TheSportsDB respondió con HTTP ${response.status}`);
        }

        let data;
        try {
            data = await response.json();
        } catch (parseErr) {
            throw new Error(`Respuesta no JSON de TheSportsDB: ${parseErr.message}`);
        }

        this._cache.set(cacheKey, {
            timestamp: now,
            data
        });

        return data;
    }

    /**
     * Lista ligas principales.
     */
    async getLeagues() {
        const res = await this._request('all_leagues.php');
        return res?.leagues || [];
    }

    /**
     * Obtiene detalles de una liga por su ID.
     */
    async getLeagueDetails(idLeague) {
        if (!idLeague) return null;
        const res = await this._request('lookupleague.php', { id: idLeague });
        return res?.leagues?.[0] || null;
    }

    /**
     * Busca un evento por nombre (ej: "Arsenal_vs_Chelsea" o "Atletico Madrid vs Real Madrid").
     * @param {string} eventName
     * @param {string} [season] ej: "2026-2027"
     */
    async searchEvent(eventName = '', season = '') {
        const cleanName = String(eventName || '').replace(/\s+/g, '_');
        const params = { e: cleanName };
        if (season) params.s = season;
        const res = await this._request('searchevents.php', params);
        return res?.event || [];
    }

    async searchEvents(eventName = '', season = '') {
        return this.searchEvent(eventName, season);
    }

    /**
     * Obtiene los detalles de un evento específico por su ID.
     * @param {string|number} idEvent
     */
    async getEvent(idEvent) {
        if (!idEvent) return null;
        const res = await this._request('lookupevent.php', { id: idEvent });
        return res?.events?.[0] || null;
    }

    /**
     * Obtiene los eventos de una liga y temporada (nota: en plan Free está limitado a 5 eventos).
     * @param {string|number} idLeague
     * @param {string} season ej: "2026-2027"
     */
    async getSeasonEvents(idLeague, season = '2026-2027') {
        const res = await this._request('eventsseason.php', { id: idLeague, s: season });
        return res?.events || [];
    }
}
