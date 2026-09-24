/**
 * @file Registro y descubrimiento de las 12 competiciones canónicas de Money Tips.
 * 
 * REGLA DE ORO:
 * No asumir ni inventar IDs de API-Football.
 * Se descubren mediante consulta real al endpoint /leagues del proveedor.
 */

export const MONEY_TIPS_COMPETITIONS = [
    {
        internalCode: 'EUR-CHL',
        canonicalName: 'UEFA Champions League',
        country: 'World',
        matchRules: {
            names: ['UEFA Champions League', 'Champions League'],
            country: 'World',
            type: 'Cup'
        }
    },
    {
        internalCode: 'EUR-EUL',
        canonicalName: 'UEFA Europa League',
        country: 'World',
        matchRules: {
            names: ['UEFA Europa League', 'Europa League'],
            country: 'World',
            type: 'Cup'
        }
    },
    {
        internalCode: 'ENG-PRE',
        canonicalName: 'Premier League',
        country: 'England',
        matchRules: {
            names: ['Premier League'],
            country: 'England',
            type: 'League'
        }
    },
    {
        internalCode: 'ENG-CHA',
        canonicalName: 'Championship',
        country: 'England',
        matchRules: {
            names: ['Championship'],
            country: 'England',
            type: 'League'
        }
    },
    {
        internalCode: 'ITA-SRA',
        canonicalName: 'Serie A',
        country: 'Italy',
        matchRules: {
            names: ['Serie A'],
            country: 'Italy',
            type: 'League'
        }
    },
    {
        internalCode: 'FRA-LG1',
        canonicalName: 'Ligue 1',
        country: 'France',
        matchRules: {
            names: ['Ligue 1'],
            country: 'France',
            type: 'League'
        }
    },
    {
        internalCode: 'FRA-LG2',
        canonicalName: 'Ligue 2',
        country: 'France',
        matchRules: {
            names: ['Ligue 2'],
            country: 'France',
            type: 'League'
        }
    },
    {
        internalCode: 'ESP-PRE',
        canonicalName: 'La Liga',
        country: 'Spain',
        matchRules: {
            names: ['La Liga', 'Primera Division'],
            country: 'Spain',
            type: 'League'
        }
    },
    {
        internalCode: 'ESP-SEG',
        canonicalName: 'Segunda División',
        country: 'Spain',
        matchRules: {
            names: ['Segunda Division', 'La Liga 2', 'Segunda División', 'LaLiga2'],
            country: 'Spain',
            type: 'League'
        }
    },
    {
        internalCode: 'POR-PRI',
        canonicalName: 'Primeira Liga',
        country: 'Portugal',
        matchRules: {
            names: ['Primeira Liga', 'Liga Portugal'],
            country: 'Portugal',
            type: 'League'
        }
    },
    {
        internalCode: 'GER-BUN',
        canonicalName: 'Bundesliga',
        country: 'Germany',
        matchRules: {
            names: ['Bundesliga'],
            country: 'Germany',
            type: 'League'
        }
    },
    {
        internalCode: 'TUR-SUP',
        canonicalName: 'Süper Lig',
        country: 'Turkey',
        matchRules: {
            names: ['Süper Lig', 'Super Lig'],
            country: 'Turkey',
            type: 'League'
        }
    }
];

/**
 * Normaliza strings para comparación insensible a mayúsculas y acentos.
 */
const normalizeText = (text = '') => {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Descubre el mapeo de las 12 competiciones Money Tips consultando al proveedor.
 * Utiliza 1 sola llamada a /leagues para minimizar consumo de rate limit.
 * 
 * @param {import('./sports-data-provider.js').SportsDataProvider} provider
 * @returns {Promise<{ registry: Array<Object>, coverageCount: number, total: number }>}
 */
export async function discoverCompetitionRegistry(provider) {
    // 1 sola petición para obtener las ligas y sus temporadas
    const allLeagues = await provider.getLeagues();

    const registry = [];

    for (const comp of MONEY_TIPS_COMPETITIONS) {
        const targetNames = comp.matchRules.names.map(normalizeText);
        const targetCountry = normalizeText(comp.matchRules.country);

        const matched = allLeagues.find((item) => {
            const leagueName = normalizeText(item.league?.name);
            const countryName = normalizeText(item.country?.name);

            // Coincidencia de país
            const countryMatches = targetCountry === 'world' || countryName === targetCountry;
            if (!countryMatches) return false;

            // Coincidencia exacta de nombre
            return targetNames.some(tn => leagueName === tn || leagueName === `la liga ${tn}`);
        });

        if (matched) {
            const seasons = matched.seasons || [];
            // Temporada actual o más reciente
            const currentSeasonObj = seasons.find(s => s.current) || seasons[seasons.length - 1] || null;
            const currentYear = currentSeasonObj?.year || null;
            const coverage = currentSeasonObj?.coverage || {};

            registry.push({
                internalCode: comp.internalCode,
                canonicalName: comp.canonicalName,
                provider: 'API_FOOTBALL',
                providerLeagueId: matched.league?.id,
                providerLeagueName: matched.league?.name,
                country: matched.country?.name,
                type: matched.league?.type,
                logo: matched.league?.logo,
                currentSeason: currentYear,
                coverageAvailable: Boolean(coverage.fixtures?.events && coverage.fixtures?.lineups),
                found: true,
                seasonsAvailable: seasons.length > 0
            });
        } else {
            registry.push({
                internalCode: comp.internalCode,
                canonicalName: comp.canonicalName,
                provider: 'API_FOOTBALL',
                providerLeagueId: null,
                providerLeagueName: null,
                country: comp.country,
                currentSeason: null,
                coverageAvailable: false,
                found: false,
                seasonsAvailable: false,
                reason: 'No se encontró coincidencia en API-Football'
            });
        }
    }

    const coverageCount = registry.filter(r => r.found).length;

    return {
        registry,
        coverageCount,
        total: MONEY_TIPS_COMPETITIONS.length,
        isCompleteCoverage: coverageCount === MONEY_TIPS_COMPETITIONS.length
    };
}
