/**
 * @file Normalizador y emparejador de eventos para TheSportsDB.
 * 
 * Reutiliza team-normalizer de forma provider-agnostic.
 */

import { matchTeamNames, MATCH_CONFIDENCE } from './team-normalizer.js';

/**
 * Normaliza un evento de TheSportsDB al contrato común de Money Tips.
 */
export function normalizeTheSportsDbEvent(raw = {}) {
    if (!raw || !raw.idEvent) return null;

    // TheSportsDB entrega strTime en UTC (ej. "14:15:00") y dateEvent (ej. "2026-09-20")
    // y strTimeLocal en hora local (ej. "16:15:00").
    let kickoffUtc = null;
    if (raw.dateEvent && raw.strTime) {
        const cleanTime = raw.strTime.includes(':') ? raw.strTime : `${raw.strTime}:00`;
        const isoGuess = `${raw.dateEvent}T${cleanTime}Z`;
        const d = new Date(isoGuess);
        if (!Number.isNaN(d.getTime())) {
            kickoffUtc = d.toISOString();
        }
    } else if (raw.strTimestamp) {
        const d = new Date(raw.strTimestamp.endsWith('Z') ? raw.strTimestamp : `${raw.strTimestamp}Z`);
        if (!Number.isNaN(d.getTime())) {
            kickoffUtc = d.toISOString();
        }
    }

    const homeScore = (raw.intHomeScore !== null && raw.intHomeScore !== undefined && raw.intHomeScore !== '')
        ? Number(raw.intHomeScore)
        : null;
    const awayScore = (raw.intAwayScore !== null && raw.intAwayScore !== undefined && raw.intAwayScore !== '')
        ? Number(raw.intAwayScore)
        : null;

    return {
        id: String(raw.idEvent),
        idEvent: String(raw.idEvent),
        idAPIfootball: raw.idAPIfootball || null,
        name: raw.strEvent || `${raw.strHomeTeam} vs ${raw.strAwayTeam}`,
        leagueId: String(raw.idLeague || ''),
        leagueName: raw.strLeague || '',
        season: raw.strSeason || '',
        homeTeam: raw.strHomeTeam || '',
        awayTeam: raw.strAwayTeam || '',
        homeTeamId: raw.idHomeTeam || null,
        awayTeamId: raw.idAwayTeam || null,
        kickoffAt: kickoffUtc,
        dateEventLocal: raw.dateEventLocal || raw.dateEvent,
        timeLocal: raw.strTimeLocal || null,
        status: raw.strStatus || 'UNKNOWN',
        postponed: raw.strPostponed === 'yes',
        homeScore,
        awayScore,
        source: 'THE_SPORTS_DB'
    };
}

/**
 * Empareja un evento de FutbolBrain contra un evento o lista de eventos de TheSportsDB.
 * 
 * @param {Object} fbEvent
 * @param {string} fbEvent.homeTeam
 * @param {string} fbEvent.awayTeam
 * @param {string} [fbEvent.competitionCode]
 * @param {string|Date} fbEvent.kickoffAt Fecha en ISO UTC
 * @param {Array<Object>|Object} theSportsDbData Evento individual o lista devuelta por TheSportsDB
 * @returns {Object}
 */
export function matchTheSportsDbEvent(fbEvent = {}, theSportsDbData = []) {
    const rawFbHome = fbEvent.homeTeam || '';
    const rawFbAway = fbEvent.awayTeam || '';
    const fbKickoffStr = fbEvent.kickoffAt instanceof Date
        ? fbEvent.kickoffAt.toISOString()
        : (fbEvent.kickoffAt ? String(fbEvent.kickoffAt) : null);

    const candidates = Array.isArray(theSportsDbData)
        ? theSportsDbData
        : (theSportsDbData ? [theSportsDbData] : []);

    const isCompetitive = Boolean(fbEvent.competitionCode);
    const fbTargetMs = fbKickoffStr ? new Date(fbKickoffStr).getTime() : null;

    let matchingCandidates = [];

    for (const rawItem of candidates) {
        const normalized = normalizeTheSportsDbEvent(rawItem);
        if (!normalized) continue;

        // Regla determinista 1: Descartar partidos amistosos si el candidato es de competición oficial
        if (isCompetitive && normalized.leagueName) {
            const lName = normalized.leagueName.toLowerCase();
            if (lName.includes('friendly') || lName.includes('amistoso')) {
                continue;
            }
        }

        // Regla determinista 2: Descartar eventos de temporadas distintas o con diferencia > 30 días
        if (fbTargetMs && normalized.kickoffAt) {
            const candMs = new Date(normalized.kickoffAt).getTime();
            const diffDays = Math.abs(candMs - fbTargetMs) / (1000 * 60 * 60 * 24);
            if (diffDays > 30) {
                continue;
            }
        }

        const homeMatch = matchTeamNames(rawFbHome, normalized.homeTeam);
        const awayMatch = matchTeamNames(rawFbAway, normalized.awayTeam);

        if (homeMatch.matched && awayMatch.matched) {
            let conf = MATCH_CONFIDENCE.NORMALIZED;
            if (homeMatch.confidence === MATCH_CONFIDENCE.EXACT && awayMatch.confidence === MATCH_CONFIDENCE.EXACT) {
                conf = MATCH_CONFIDENCE.EXACT;
            } else if (homeMatch.confidence === MATCH_CONFIDENCE.ALIAS || awayMatch.confidence === MATCH_CONFIDENCE.ALIAS) {
                conf = MATCH_CONFIDENCE.ALIAS;
            }
            matchingCandidates.push({ event: normalized, confidence: conf });
        }
    }

    if (matchingCandidates.length === 0) {
        return {
            status: 'NOT_FOUND',
            futbolBrainEvent: `${rawFbHome} vs ${rawFbAway}`,
            futbolBrainCompetition: fbEvent.competitionCode || null,
            futbolBrainKickoff: fbKickoffStr,
            theSportsDbMatchFound: false,
            eventId: null,
            providerHome: null,
            providerAway: null,
            providerLeague: null,
            providerKickoff: null,
            kickoffMatch: 'NOT_APPLICABLE',
            kickoffClassification: 'NOT_APPLICABLE',
            isKickoffExactOrExplicable: false,
            differenceMinutes: null,
            strongIdentity: null
        };
    }

    // Si hay múltiples partidos entre los mismos equipos en el histórico devuelto,
    // seleccionar el más cercano a la fecha prevista de kickoff
    let selected = matchingCandidates[0];
    if (matchingCandidates.length > 1 && fbKickoffStr) {
        const targetMs = new Date(fbKickoffStr).getTime();
        let minDiff = Infinity;
        for (const cand of matchingCandidates) {
            if (cand.event.kickoffAt) {
                const diff = Math.abs(new Date(cand.event.kickoffAt).getTime() - targetMs);
                if (diff < minDiff) {
                    minDiff = diff;
                    selected = cand;
                }
            }
        }
    }

    const bestMatch = selected.event;
    const matchConfidence = selected.confidence;

    // Reconciliación de Kickoff
    let kickoffMatch = 'KICKOFF_UNKNOWN';
    let kickoffClassification = 'NOT_APPLICABLE';
    let isKickoffExactOrExplicable = false;
    let differenceMinutes = null;

    if (fbKickoffStr && bestMatch.kickoffAt) {
        const fbMs = new Date(fbKickoffStr).getTime();
        const provMs = new Date(bestMatch.kickoffAt).getTime();
        const diffMs = Math.abs(provMs - fbMs);
        differenceMinutes = Math.round(diffMs / 60000);

        if (differenceMinutes === 0) {
            kickoffMatch = 'KICKOFF_RECONCILED';
            kickoffClassification = 'EXACT';
            isKickoffExactOrExplicable = true;
        } else if (differenceMinutes === 60 || differenceMinutes === 120) {
            kickoffMatch = 'KICKOFF_MISMATCH';
            kickoffClassification = 'EXPLICABLE_TIMEZONE';
            isKickoffExactOrExplicable = true;
        } else {
            kickoffMatch = 'KICKOFF_MISMATCH';
            kickoffClassification = 'MISMATCH';
            isKickoffExactOrExplicable = false;
        }
    }

    // Identidad fuerte
    const strongIdentity = {
        sportsProvider: 'THE_SPORTS_DB',
        providerEventId: bestMatch.idEvent,
        providerLeagueId: bestMatch.leagueId,
        providerHomeTeamId: bestMatch.homeTeamId,
        providerAwayTeamId: bestMatch.awayTeamId,
        providerKickoffAt: bestMatch.kickoffAt,
        futbolBrainKickoffAt: fbKickoffStr,
        fixtureMatchedAt: new Date().toISOString()
    };

    return {
        status: 'MATCHED',
        futbolBrainEvent: `${rawFbHome} vs ${rawFbAway}`,
        futbolBrainCompetition: fbEvent.competitionCode || null,
        futbolBrainKickoff: fbKickoffStr,
        theSportsDbMatchFound: true,
        matchConfidence,
        eventId: bestMatch.idEvent,
        providerHome: bestMatch.homeTeam,
        providerAway: bestMatch.awayTeam,
        providerLeague: bestMatch.leagueName,
        providerKickoff: bestMatch.kickoffAt,
        dateLocal: bestMatch.dateEventLocal,
        timeLocal: bestMatch.timeLocal,
        providerStatus: bestMatch.status,
        homeScore: bestMatch.homeScore,
        awayScore: bestMatch.awayScore,
        kickoffMatch,
        kickoffClassification,
        isKickoffExactOrExplicable,
        differenceMinutes,
        strongIdentity,
        event: bestMatch,
        fixture: bestMatch
    };
}
