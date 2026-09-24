/**
 * @file Contrato y clase base conceptual para proveedores de datos deportivos (SportsDataProvider).
 * 
 * Abstracción para desacoplar el origen de fixtures, competiciones y resultados
 * (API-Football, TheSportsDB, Sportmonks, etc.) del núcleo de Money Tips.
 */

export class SportsDataProvider {
    constructor(name = 'BaseSportsDataProvider') {
        this.name = name;
    }

    /**
     * Obtiene competiciones/ligas según filtros.
     * @param {Object} [filters]
     * @returns {Promise<Array<Object>>}
     */
    async getLeagues(/* filters = {} */) {
        throw new Error(`El proveedor ${this.name} no implementa getLeagues()`);
    }

    /**
     * Obtiene una lista de partidos/fixtures según filtros.
     * @param {Object} [filters]
     * @returns {Promise<Array<Object>>}
     */
    async getFixtures(/* filters = {} */) {
        throw new Error(`El proveedor ${this.name} no implementa getFixtures()`);
    }

    /**
     * Obtiene el detalle de un fixture específico por su ID.
     * @param {string|number} fixtureId
     * @returns {Promise<Object|null>}
     */
    async getFixture(/* fixtureId */) {
        throw new Error(`El proveedor ${this.name} no implementa getFixture()`);
    }

    /**
     * Devuelve el estado de consumo y rate limit del proveedor.
     * @returns {Object}
     */
    getRateLimitStatus() {
        return {
            requestsMade: 0,
            dailyLimit: null,
            dailyRemaining: null,
            minuteLimit: null,
            minuteRemaining: null,
            lastRequestAt: null
        };
    }
}
