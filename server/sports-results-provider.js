/**
 * @file Contrato y abstracción de proveedores de resultados deportivos.
 *
 * Permite cambiar o conectar múltiples proveedores de datos (API-Football, TheSportsDB,
 * football-data.org o mocks de prueba) sin acoplar el motor de liquidación a una API concreta.
 */

/**
 * ESTADO ARQUITECTÓNICO DE LA INTEGRACIÓN DE RESULTADOS:
 * ENGINE READY / PROVIDER NOT CONNECTED
 * El motor determinista de liquidación está completamente construido y testeado.
 * La conexión a un proveedor comercial en vivo (ej. API-Football / TheSportsDB)
 * queda aislada tras la interfaz SportsResultsProvider y controlada por feature flag.
 */
export const SPORTS_PROVIDER_INTEGRATION_STATE = {
    ENGINE_STATE: 'READY',
    PROVIDER_STATE: 'NOT_CONNECTED'
};

export const FIXTURE_STATUSES = {
    FINISHED: 'finished',
    IN_PLAY: 'in_play',
    HALF_TIME: 'half_time',
    EXTRA_TIME: 'extra_time',
    POSTPONED: 'postponed',
    CANCELLED: 'cancelled',
    INTERRUPTED: 'interrupted',
    SUSPENDED: 'suspended',
    DELAYED: 'delayed',
    NOT_STARTED: 'not_started',
    UNKNOWN: 'unknown'
};

/**
 * Normaliza y valida la respuesta de cualquier proveedor al contrato estándar.
 */
export const normalizeSportsResult = (raw = {}) => {
    const fixtureId = String(raw.fixtureId || raw.id || '').trim();
    if (!fixtureId) throw new Error('El resultado deportivo debe contener un fixtureId');

    const homeScore = raw.regularTimeScore?.home != null ? Number(raw.regularTimeScore.home) : null;
    const awayScore = raw.regularTimeScore?.away != null ? Number(raw.regularTimeScore.away) : null;

    const regularTimeScore = (Number.isInteger(homeScore) && Number.isInteger(awayScore))
        ? { home: homeScore, away: awayScore }
        : null;

    return {
        fixtureId,
        competition: String(raw.competition || '').trim(),
        teams: {
            home: String(raw.teams?.home || '').trim(),
            away: String(raw.teams?.away || '').trim()
        },
        kickoff: raw.kickoff ? new Date(raw.kickoff) : null,
        status: Object.values(FIXTURE_STATUSES).includes(raw.status) ? raw.status : FIXTURE_STATUSES.UNKNOWN,
        regularTimeScore,
        extraTimeScore: raw.extraTimeScore ? { home: Number(raw.extraTimeScore.home), away: Number(raw.extraTimeScore.away) } : null,
        penalties: raw.penalties ? { home: Number(raw.penalties.home), away: Number(raw.penalties.away) } : null,
        source: String(raw.source || 'unspecified'),
        fetchedAt: raw.fetchedAt ? new Date(raw.fetchedAt) : new Date()
    };
};

/**
 * Clase base / Interfaz del proveedor de resultados deportivos.
 */
export class SportsResultsProvider {
    constructor(name = 'BaseSportsResultsProvider') {
        this.name = name;
    }

    /**
     * Obtiene el resultado de un partido dado su identificador o metadatos de búsqueda.
     * @param {Object} query
     * @param {string} [query.fixtureId]
     * @param {string} [query.sourceEventId]
     * @param {string} [query.competition]
     * @param {string} [query.homeTeam]
     * @param {string} [query.awayTeam]
     * @param {Date} [query.kickoffAt]
     * @returns {Promise<Object|null>}
     */
    async getFixtureResult(/* query */) {
        throw new Error(`El proveedor ${this.name} no implementa getFixtureResult()`);
    }
}

/**
 * Proveedor de pruebas / memoria para tests deterministas y entornos locales.
 */
export class MockSportsResultsProvider extends SportsResultsProvider {
    constructor(fixtures = []) {
        super('MockSportsResultsProvider');
        this.fixtures = new Map();
        for (const fixture of fixtures) {
            const normalized = normalizeSportsResult(fixture);
            this.fixtures.set(normalized.fixtureId, normalized);
            if (fixture.sourceEventId) {
                this.fixtures.set(String(fixture.sourceEventId), normalized);
            }
        }
    }

    addFixture(fixture) {
        const normalized = normalizeSportsResult(fixture);
        this.fixtures.set(normalized.fixtureId, normalized);
        if (fixture.sourceEventId) {
            this.fixtures.set(String(fixture.sourceEventId), normalized);
        }
        return normalized;
    }

    async getFixtureResult(query = {}) {
        // 1. Prioridad: fixtureId o sourceEventId
        if (query.fixtureId && this.fixtures.has(String(query.fixtureId))) {
            return this.fixtures.get(String(query.fixtureId));
        }
        if (query.sourceEventId && this.fixtures.has(String(query.sourceEventId))) {
            return this.fixtures.get(String(query.sourceEventId));
        }

        // 2. Fallback: búsqueda por equipos canonicalizados
        const clean = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const homeTarget = clean(query.homeTeam);
        const awayTarget = clean(query.awayTeam);

        for (const fixture of this.fixtures.values()) {
            if (clean(fixture.teams.home) === homeTarget && clean(fixture.teams.away) === awayTarget) {
                return fixture;
            }
        }

        return null;
    }
}
