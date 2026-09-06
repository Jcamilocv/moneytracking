import { PUBLICATION_POLICIES } from './official-pick-scheduling.js';

export const FUTBOLBRAIN_OWNER_BROWSER_PROVIDER = 'futbolbrain-owner-browser';

// This is deliberately an allow-list. A browser may only submit the systems
// the account owner has approved for Money Tips distribution.
const SYSTEMS = Object.freeze({
    'MT - CHA EUR - V1.0': {
        policy: PUBLICATION_POLICIES.IMMEDIATE,
        market: 'Ambos equipos marcan',
        selections: { No: 'No' }
    },
    'MT - ENG2 - v1.0': {
        policy: PUBLICATION_POLICIES.IMMEDIATE,
        market: 'Resultado final',
        selections: { 'Team 2 (FT)': 'Visitante' }
    },
    'MT - ITA1 - V1.0': {
        policy: PUBLICATION_POLICIES.IMMEDIATE,
        market: 'Ambos equipos marcan',
        selections: { No: 'No' }
    },
    'MT - Premier League 02.5': {
        policy: PUBLICATION_POLICIES.IMMEDIATE,
        market: 'Total de goles',
        selections: { 'Under 3.5': 'Menos de 3,5 goles' }
    },
    'MT - FRA1 FRA2 - V1.0': {
        policy: PUBLICATION_POLICIES.T_MINUS_5,
        market: 'Total de goles',
        selections: { 'Over 2.5': 'Más de 2,5 goles' }
    },
    'MT-LAB-BTTS-ESP-v0.1': {
        policy: PUBLICATION_POLICIES.T_MINUS_5,
        market: 'Ambos equipos marcan',
        selections: { Yes: 'Sí' }
    }
});

const cleanText = (value, field) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`Falta ${field}`);
    if (text.length > 160) throw new Error(`${field} supera el tamaño permitido`);
    return text;
};

const cleanDate = (value, field) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${field} no es una fecha válida`);
    return date;
};

const cleanOdds = (value) => {
    const odds = Number(value);
    if (!Number.isFinite(odds) || odds < 1.01 || odds > 1000) throw new Error('La cuota observada no es válida');
    return Number(odds.toFixed(2));
};

const madridDateKey = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
};

export const approvedFutbolBrainSystems = () => Object.keys(SYSTEMS);

// Converts the small, visible-table contract into the canonical server-side
// official-pick contract. The browser never chooses policy, market labels, or
// arbitrary system names.
export const normalizeFutbolBrainOwnerCandidate = (input = {}, { now = new Date() } = {}) => {
    if (input?.source?.provider !== FUTBOLBRAIN_OWNER_BROWSER_PROVIDER) {
        throw new Error('La fuente local no está autorizada');
    }

    const systemId = cleanText(input?.system?.id, 'system.id');
    const rule = SYSTEMS[systemId];
    if (!rule) throw new Error('El sistema no está aprobado para publicación automática');

    const rawSelection = cleanText(input?.visiblePick?.selection, 'visiblePick.selection');
    const selection = rule.selections[rawSelection];
    if (!selection) throw new Error('El mercado visible no coincide con el sistema aprobado');

    const kickoffAt = cleanDate(input?.event?.kickoffAt, 'event.kickoffAt');
    if (kickoffAt.getTime() <= now.getTime() + 60 * 1000) {
        throw new Error('El inicio debe ser al menos un minuto posterior a la recepción');
    }
    if (madridDateKey(kickoffAt) !== madridDateKey(now)) {
        throw new Error('Solo se admiten picks activos del día actual en horario de Madrid');
    }

    const observedAt = input?.source?.observedAt
        ? cleanDate(input.source.observedAt, 'source.observedAt')
        : now;

    return {
        event: {
            sourceEventId: cleanText(input?.event?.sourceEventId, 'event.sourceEventId'),
            competition: cleanText(input?.event?.competition, 'event.competition'),
            homeTeam: cleanText(input?.event?.homeTeam, 'event.homeTeam'),
            awayTeam: cleanText(input?.event?.awayTeam, 'event.awayTeam'),
            kickoffAt
        },
        bet: {
            market: rule.market,
            selection,
            oddsAtPublication: cleanOdds(input?.visiblePick?.odds)
        },
        system: {
            id: systemId,
            version: 'visible-table-v1'
        },
        source: {
            provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER,
            observedAt
        },
        publicationPolicy: rule.policy
    };
};
