/**
 * @file Reconciliador de candidatos FutbolBrain con proveedores de datos deportivos (P1.5).
 * 
 * Reglas:
 * 1. Match inequívoco + kickoff exacto → usar TheSportsDB (adopta providerKickoffAt y fixtureId).
 * 2. Match inequívoco + diferencia exacta 60/120 min compatible CET/CEST → adoptar automáticamente providerKickoffAt.
 * 3. TheSportsDB NOT_FOUND o incierto → NO bloquear el pick. Usar kickoff FutbolBrain ya corregido
 *    y marcar SPORTS_DATA_UNMATCHED para reconciliación posterior.
 * 4. Nunca aceptar fixture ambiguo o incorrecto (mismatch de kickoff no explicable se rechaza).
 * 
 * Provider-agnostic: opera sobre cualquier subclase de SportsDataProvider.
 */

import { matchTheSportsDbEvent } from './thesportsdb-fixture-matcher.js';
import { buildCanonicalSearchQuery, inferSeason } from './team-normalizer.js';

export const RECONCILIATION_STATUSES = {
    MATCHED: 'MATCHED',
    SPORTS_DATA_UNMATCHED: 'SPORTS_DATA_UNMATCHED'
};

export const KICKOFF_CLASSIFICATIONS = {
    EXACT: 'EXACT',
    EXPLICABLE_TIMEZONE: 'EXPLICABLE_TIMEZONE',
    FUTBOLBRAIN_FALLBACK: 'FUTBOLBRAIN_FALLBACK',
    MISMATCH_REJECTED: 'MISMATCH_REJECTED',
    NOT_FOUND: 'NOT_FOUND'
};

/**
 * Reconcilia un candidato normalizado de FutbolBrain contra el SportsDataProvider.
 * 
 * @param {Object} candidate
 * @param {string} candidate.homeTeam
 * @param {string} candidate.awayTeam
 * @param {string} [candidate.competitionCode]
 * @param {string|Date} candidate.kickoffAt
 * @param {import('./sports-data-provider.js').SportsDataProvider} provider
 * @returns {Promise<Object>}
 */
export async function reconcileCandidateWithSportsData(candidate = {}, provider = null) {
    const home = String(candidate.homeTeam || '').trim();
    const away = String(candidate.awayTeam || '').trim();
    const kickoff = candidate.kickoffAt instanceof Date
        ? candidate.kickoffAt.toISOString()
        : (candidate.kickoffAt ? String(candidate.kickoffAt) : null);
    const compCode = candidate.competitionCode || null;

    const fallbackResult = {
        status: RECONCILIATION_STATUSES.SPORTS_DATA_UNMATCHED,
        fixtureId: null,
        provider: provider ? provider.name : 'NONE',
        providerCompetition: null,
        providerHome: null,
        providerAway: null,
        providerKickoffAt: null,
        adoptedKickoffAt: kickoff,
        kickoffClassification: KICKOFF_CLASSIFICATIONS.FUTBOLBRAIN_FALLBACK,
        differenceMinutes: null,
        reconciliationNote: 'TheSportsDB lookup omitido o sin proveedor. Se utiliza kickoff FutbolBrain.',
        event: null
    };

    if (!provider || !home || !away) {
        return fallbackResult;
    }

    const season = inferSeason(kickoff);
    let rawEvents = [];
    let match = null;

    try {
        // Estrategia 1: Búsqueda con nombres originales y temporada
        const queryRaw = `${home} vs ${away}`;
        rawEvents = await provider.searchEvents(queryRaw, season || '');

        match = matchTheSportsDbEvent({
            competitionCode: compCode,
            homeTeam: home,
            awayTeam: away,
            kickoffAt: kickoff
        }, rawEvents);

        // Estrategia 2: Búsqueda canónica si no hay match
        if (!match.theSportsDbMatchFound) {
            const queryCanonical = buildCanonicalSearchQuery(home, away);
            if (queryCanonical !== queryRaw) {
                const canonicalEvents = await provider.searchEvents(queryCanonical, season || '');
                const canMatch = matchTheSportsDbEvent({
                    competitionCode: compCode,
                    homeTeam: home,
                    awayTeam: away,
                    kickoffAt: kickoff
                }, canonicalEvents);

                if (canMatch.theSportsDbMatchFound) {
                    rawEvents = canonicalEvents;
                    match = canMatch;
                }
            }
        }

        // Estrategia 3: Búsqueda sin temporada si aún no hay match
        if (!match.theSportsDbMatchFound && season) {
            const queryCanonical = buildCanonicalSearchQuery(home, away);
            const fallbackEvents = await provider.searchEvents(queryCanonical);
            const fbMatch = matchTheSportsDbEvent({
                competitionCode: compCode,
                homeTeam: home,
                awayTeam: away,
                kickoffAt: kickoff
            }, fallbackEvents);

            if (fbMatch.theSportsDbMatchFound) {
                rawEvents = fallbackEvents;
                match = fbMatch;
            } else if (queryCanonical !== queryRaw) {
                const fallbackRaw = await provider.searchEvents(queryRaw);
                const fbRawMatch = matchTheSportsDbEvent({
                    competitionCode: compCode,
                    homeTeam: home,
                    awayTeam: away,
                    kickoffAt: kickoff
                }, fallbackRaw);
                if (fbRawMatch.theSportsDbMatchFound) {
                    rawEvents = fallbackRaw;
                    match = fbRawMatch;
                }
            }
        }
    } catch (err) {
        return {
            ...fallbackResult,
            reconciliationNote: `Error en búsqueda de proveedor: ${err.message}`
        };
    }

    // Si no se encontró evento o no es coincidencia estricta
    if (!match || !match.theSportsDbMatchFound) {
        return {
            status: RECONCILIATION_STATUSES.SPORTS_DATA_UNMATCHED,
            fixtureId: null,
            provider: provider.name,
            providerCompetition: null,
            providerHome: null,
            providerAway: null,
            providerKickoffAt: null,
            adoptedKickoffAt: kickoff,
            kickoffClassification: KICKOFF_CLASSIFICATIONS.NOT_FOUND,
            differenceMinutes: null,
            reconciliationNote: 'TheSportsDB NOT_FOUND: no se halló fixture unívoco. Fallback a kickoff FutbolBrain.',
            event: null
        };
    }

    // Validación estricta de confianza para evitar falsos positivos
    const isExactOrKnownMatch = match.matchConfidence === 'EXACT' ||
        match.matchConfidence === 'ALIAS' ||
        match.matchConfidence === 'NORMALIZED';

    if (!isExactOrKnownMatch) {
        return {
            status: RECONCILIATION_STATUSES.SPORTS_DATA_UNMATCHED,
            fixtureId: null,
            provider: provider.name,
            providerCompetition: match.providerLeague,
            providerHome: match.providerHome,
            providerAway: match.providerAway,
            providerKickoffAt: match.providerKickoff,
            adoptedKickoffAt: kickoff,
            kickoffClassification: KICKOFF_CLASSIFICATIONS.MISMATCH_REJECTED,
            differenceMinutes: match.differenceMinutes,
            reconciliationNote: 'Coincidencia ambigua rechazada para evitar falsos positivos. Fallback a kickoff FutbolBrain.',
            event: null
        };
    }

    const f = match.event;

    // Regla 1: Kickoff exacto (diff 0 min)
    if (match.differenceMinutes === 0) {
        return {
            status: RECONCILIATION_STATUSES.MATCHED,
            fixtureId: f.idEvent,
            provider: provider.name,
            providerCompetition: f.leagueName,
            providerHome: f.homeTeam,
            providerAway: f.awayTeam,
            providerKickoffAt: f.kickoffAt,
            adoptedKickoffAt: f.kickoffAt,
            kickoffClassification: KICKOFF_CLASSIFICATIONS.EXACT,
            differenceMinutes: 0,
            reconciliationNote: 'Match inequívoco y kickoff exacto adoptado.',
            event: f
        };
    }

    // Regla 2: Diferencia exacta de 60 o 120 minutos (compatible CET/CEST)
    if (match.differenceMinutes === 60 || match.differenceMinutes === 120) {
        return {
            status: RECONCILIATION_STATUSES.MATCHED,
            fixtureId: f.idEvent,
            provider: provider.name,
            providerCompetition: f.leagueName,
            providerHome: f.homeTeam,
            providerAway: f.awayTeam,
            providerKickoffAt: f.kickoffAt,
            adoptedKickoffAt: f.kickoffAt, // Adopción automática del horario canónico UTC
            kickoffClassification: KICKOFF_CLASSIFICATIONS.EXPLICABLE_TIMEZONE,
            differenceMinutes: match.differenceMinutes,
            reconciliationNote: `Match inequívoco con diferencia de ${match.differenceMinutes}m (CET/CEST). Kickoff canónico adoptado automáticamente.`,
            event: f
        };
    }

    // Regla 4: Mismatch no explicable -> Nunca aceptar fixture incorrecto
    return {
        status: RECONCILIATION_STATUSES.SPORTS_DATA_UNMATCHED,
        fixtureId: null,
        provider: provider.name,
        providerCompetition: f.leagueName,
        providerHome: f.homeTeam,
        providerAway: f.awayTeam,
        providerKickoffAt: f.kickoffAt,
        adoptedKickoffAt: kickoff,
        kickoffClassification: KICKOFF_CLASSIFICATIONS.MISMATCH_REJECTED,
        differenceMinutes: match.differenceMinutes,
        reconciliationNote: `Kickoff mismatch inexplicable (${match.differenceMinutes}m). Fixture rechazado por seguridad. Fallback a kickoff FutbolBrain.`,
        event: null
    };
}
