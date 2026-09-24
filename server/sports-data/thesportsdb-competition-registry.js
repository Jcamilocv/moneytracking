/**
 * @file Registro y mapeo de las 12 competiciones Money Tips en TheSportsDB.
 */

export const THESPORTSDB_COMPETITIONS = [
    {
        internalCode: 'EUR-CHL',
        canonicalName: 'UEFA Champions League',
        theSportsDbId: '4480',
        theSportsDbName: 'UEFA Champions League',
        country: 'Europe'
    },
    {
        internalCode: 'EUR-EUL',
        canonicalName: 'UEFA Europa League',
        theSportsDbId: '4481',
        theSportsDbName: 'UEFA Europa League',
        country: 'Europe'
    },
    {
        internalCode: 'ENG-PRE',
        canonicalName: 'Premier League',
        theSportsDbId: '4328',
        theSportsDbName: 'English Premier League',
        country: 'England'
    },
    {
        internalCode: 'ENG-CHA',
        canonicalName: 'Championship',
        theSportsDbId: '4329',
        theSportsDbName: 'English League Championship',
        country: 'England'
    },
    {
        internalCode: 'ITA-SRA',
        canonicalName: 'Serie A',
        theSportsDbId: '4332',
        theSportsDbName: 'Italian Serie A',
        country: 'Italy'
    },
    {
        internalCode: 'FRA-LG1',
        canonicalName: 'Ligue 1',
        theSportsDbId: '4334',
        theSportsDbName: 'French Ligue 1',
        country: 'France'
    },
    {
        internalCode: 'FRA-LG2',
        canonicalName: 'Ligue 2',
        theSportsDbId: '4401',
        theSportsDbName: 'French Ligue 2',
        country: 'France'
    },
    {
        internalCode: 'ESP-PRE',
        canonicalName: 'La Liga',
        theSportsDbId: '4335',
        theSportsDbName: 'Spanish La Liga',
        country: 'Spain'
    },
    {
        internalCode: 'ESP-SEG',
        canonicalName: 'Segunda División',
        theSportsDbId: '4400',
        theSportsDbName: 'Spanish La Liga 2',
        country: 'Spain'
    },
    {
        internalCode: 'POR-PRI',
        canonicalName: 'Primeira Liga',
        theSportsDbId: '4344',
        theSportsDbName: 'Portuguese Primeira Liga',
        country: 'Portugal'
    },
    {
        internalCode: 'GER-BUN',
        canonicalName: 'Bundesliga',
        theSportsDbId: '4331',
        theSportsDbName: 'German Bundesliga',
        country: 'Germany'
    },
    {
        internalCode: 'TUR-SUP',
        canonicalName: 'Süper Lig',
        theSportsDbId: '4339',
        theSportsDbName: 'Turkish Super Lig',
        country: 'Turkey'
    }
];

/**
 * Valida la cobertura de las 12 competiciones en TheSportsDB consultando los detalles de cada liga.
 * 
 * @param {import('./thesportsdb-provider.js').TheSportsDbProvider} provider
 * @returns {Promise<{ registry: Array<Object>, coverageCount: number, total: number }>}
 */
export async function discoverTheSportsDbRegistry(provider) {
    const registry = [];

    for (const comp of THESPORTSDB_COMPETITIONS) {
        let details = null;
        try {
            details = await provider.getLeagueDetails(comp.theSportsDbId);
        } catch (err) {
            // Manejo de error de red
        }

        if (details && details.strLeague) {
            const currentSeason = details.strCurrentSeason || details.strSeason || '2026-2027';
            registry.push({
                internalCode: comp.internalCode,
                canonicalName: comp.canonicalName,
                provider: 'THE_SPORTS_DB',
                providerLeagueId: comp.theSportsDbId,
                providerLeagueName: details.strLeague,
                country: details.strCountry,
                currentSeason,
                found: true,
                currentSeasonFound: Boolean(currentSeason.includes('2026')),
                fixturesAvailable: true,
                resultsAvailable: true
            });
        } else {
            registry.push({
                internalCode: comp.internalCode,
                canonicalName: comp.canonicalName,
                provider: 'THE_SPORTS_DB',
                providerLeagueId: comp.theSportsDbId,
                providerLeagueName: null,
                country: comp.country,
                currentSeason: null,
                found: false,
                currentSeasonFound: false,
                fixturesAvailable: false,
                resultsAvailable: false
            });
        }
    }

    const coverageCount = registry.filter(r => r.found).length;

    return {
        registry,
        coverageCount,
        total: THESPORTSDB_COMPETITIONS.length,
        isCompleteCoverage: coverageCount === THESPORTSDB_COMPETITIONS.length
    };
}
