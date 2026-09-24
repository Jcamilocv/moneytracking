/**
 * @file Motor de emparejamiento de eventos FutbolBrain con Fixtures de API-Football
 * y reconciliación de kickoffs.
 */

import { matchTeamNames, MATCH_CONFIDENCE } from './team-normalizer.js';

/**
 * Empareja un evento de FutbolBrain contra una lista de fixtures candidatos del proveedor.
 * 
 * @param {Object} fbEvent
 * @param {string} fbEvent.homeTeam
 * @param {string} fbEvent.awayTeam
 * @param {string} [fbEvent.competitionCode]
 * @param {string|Date} fbEvent.kickoffAt Fecha en ISO UTC
 * @param {Array<Object>} candidateFixtures Lista de fixtures devueltos por API-Football
 * @returns {Object} Resultado estructurado del emparejamiento
 */
export function matchFutbolBrainFixture(fbEvent = {}, candidateFixtures = []) {
    const rawFbHome = fbEvent.homeTeam || '';
    const rawFbAway = fbEvent.awayTeam || '';
    const fbKickoffStr = fbEvent.kickoffAt instanceof Date
        ? fbEvent.kickoffAt.toISOString()
        : (fbEvent.kickoffAt ? String(fbEvent.kickoffAt) : null);

    let bestMatch = null;
    let matchConfidence = MATCH_CONFIDENCE.NO_MATCH;

    for (const fixtureItem of candidateFixtures) {
        const fixture = fixtureItem.fixture || {};
        const teams = fixtureItem.teams || {};
        const league = fixtureItem.league || {};

        const provHome = teams.home?.name || '';
        const provAway = teams.away?.name || '';

        const homeMatch = matchTeamNames(rawFbHome, provHome);
        const awayMatch = matchTeamNames(rawFbAway, provAway);

        if (homeMatch.matched && awayMatch.matched) {
            bestMatch = fixtureItem;
            // Confianza compuesta
            if (homeMatch.confidence === MATCH_CONFIDENCE.EXACT && awayMatch.confidence === MATCH_CONFIDENCE.EXACT) {
                matchConfidence = MATCH_CONFIDENCE.EXACT;
            } else if (homeMatch.confidence === MATCH_CONFIDENCE.ALIAS || awayMatch.confidence === MATCH_CONFIDENCE.ALIAS) {
                matchConfidence = MATCH_CONFIDENCE.ALIAS;
            } else {
                matchConfidence = MATCH_CONFIDENCE.NORMALIZED;
            }
            break;
        }
    }

    if (!bestMatch) {
        return {
            status: 'NOT_FOUND',
            futbolBrainEvent: `${rawFbHome} vs ${rawFbAway}`,
            futbolBrainCompetition: fbEvent.competitionCode || null,
            futbolBrainKickoff: fbKickoffStr,
            apiFootballMatchFound: false,
            fixtureId: null,
            providerHome: null,
            providerAway: null,
            providerCompetition: null,
            providerKickoff: null,
            kickoffMatch: 'NOT_APPLICABLE',
            differenceMinutes: null,
            strongIdentity: null
        };
    }

    // 1. Extraer kickoff de API-Football
    // fixture.date viene en formato ISO estándar (ej. "2026-09-20T16:15:00+02:00" o "2026-09-20T14:15:00Z")
    const fixtureDateRaw = bestMatch.fixture?.date;
    const fixtureTimestamp = bestMatch.fixture?.timestamp;

    let providerKickoffAt = null;
    if (fixtureDateRaw) {
        const parsed = new Date(fixtureDateRaw);
        if (!Number.isNaN(parsed.getTime())) {
            providerKickoffAt = parsed.toISOString();
        }
    } else if (fixtureTimestamp) {
        providerKickoffAt = new Date(fixtureTimestamp * 1000).toISOString();
    }

    // 2. Reconciliación de Kickoffs
    let kickoffMatch = 'KICKOFF_UNKNOWN';
    let differenceMinutes = null;

    if (fbKickoffStr && providerKickoffAt) {
        const fbMs = new Date(fbKickoffStr).getTime();
        const provMs = new Date(providerKickoffAt).getTime();
        const diffMs = Math.abs(provMs - fbMs);
        differenceMinutes = Math.round(diffMs / 60000);

        if (differenceMinutes === 0) {
            kickoffMatch = 'KICKOFF_RECONCILED';
        } else {
            kickoffMatch = 'KICKOFF_MISMATCH';
        }
    }

    // 3. Modelo de Identidad Fuerte (Futura referencia)
    const strongIdentity = {
        sportsProvider: 'API_FOOTBALL',
        providerFixtureId: bestMatch.fixture?.id,
        providerLeagueId: bestMatch.league?.id,
        providerHomeTeamId: bestMatch.teams?.home?.id,
        providerAwayTeamId: bestMatch.teams?.away?.id,
        providerKickoffAt,
        futbolBrainKickoffAt: fbKickoffStr,
        fixtureMatchedAt: new Date().toISOString()
    };

    return {
        status: 'MATCHED',
        futbolBrainEvent: `${rawFbHome} vs ${rawFbAway}`,
        futbolBrainCompetition: fbEvent.competitionCode || null,
        futbolBrainKickoff: fbKickoffStr,
        apiFootballMatchFound: true,
        matchConfidence,
        fixtureId: bestMatch.fixture?.id,
        providerHome: bestMatch.teams?.home?.name,
        providerAway: bestMatch.teams?.away?.name,
        providerCompetition: bestMatch.league?.name,
        providerKickoff: providerKickoffAt,
        providerTimezone: bestMatch.fixture?.timezone,
        providerStatus: bestMatch.fixture?.status?.short,
        providerStatusLong: bestMatch.fixture?.status?.long,
        goals: bestMatch.goals || { home: null, away: null },
        score: bestMatch.score || {},
        kickoffMatch,
        differenceMinutes,
        strongIdentity
    };
}
