import { createHash } from 'node:crypto';
import { normalizePublicationPolicy, scheduledAtForOfficialPick } from '../../server/official-pick-scheduling.js';

const MAX_TEXT_LENGTH = 160;

const cleanText = (value, field, { required = true, maxLength = MAX_TEXT_LENGTH } = {}) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (required && !text) throw new Error(`Falta ${field}`);
    if (text.length > maxLength) throw new Error(`${field} supera el tamaño permitido`);
    return text;
};

const cleanOdds = (value) => {
    const odds = Number(value);
    if (!Number.isFinite(odds) || odds < 1.01 || odds > 1000) throw new Error('La cuota no es válida');
    return Number(odds.toFixed(2));
};

const cleanDate = (value, field) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${field} no es una fecha válida`);
    return date;
};

const stableStringify = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

export const hashOfficialPickPayload = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');

export const normalizeOfficialPickInput = (input = {}) => {
    const kickoffAt = cleanDate(input?.event?.kickoffAt, 'event.kickoffAt');
    const sourceEventId = cleanText(input?.event?.sourceEventId, 'event.sourceEventId');
    const market = cleanText(input?.bet?.market, 'bet.market');
    const selection = cleanText(input?.bet?.selection, 'bet.selection');
    const systemId = cleanText(input?.system?.id, 'system.id');
    const systemVersion = cleanText(input?.system?.version, 'system.version');
    const sourceProvider = cleanText(input?.source?.provider || 'money-tips-owned', 'source.provider');
    const observedAt = input?.source?.observedAt ? cleanDate(input.source.observedAt, 'source.observedAt') : new Date();
    const publicationPolicy = normalizePublicationPolicy(input?.publicationPolicy);
    const scheduledAt = input?.scheduledAt
        ? cleanDate(input.scheduledAt, 'scheduledAt')
        : scheduledAtForOfficialPick({ policy: publicationPolicy, kickoffAt, observedAt });

    const normalized = {
        schemaVersion: 1,
        status: 'published',
        event: {
            sourceEventId,
            competition: cleanText(input?.event?.competition, 'event.competition'),
            homeTeam: cleanText(input?.event?.homeTeam, 'event.homeTeam'),
            awayTeam: cleanText(input?.event?.awayTeam, 'event.awayTeam'),
            kickoffAt
        },
        bet: {
            market,
            selection,
            oddsAtPublication: cleanOdds(input?.bet?.oddsAtPublication),
            stakeUnits: 1
        },
        system: { id: systemId, version: systemVersion },
        source: { provider: sourceProvider, observedAt },
        publicationPolicy,
        scheduledAt
    };

    const idempotencySeed = {
        sourceEventId,
        market,
        selection,
        systemId,
        systemVersion
    };
    normalized.idempotencyKey = hashOfficialPickPayload(idempotencySeed);
    normalized.source.evidenceHash = hashOfficialPickPayload({
        event: { ...normalized.event, kickoffAt: kickoffAt.toISOString() },
        bet: normalized.bet,
        system: normalized.system,
        source: { provider: sourceProvider, observedAt: observedAt.toISOString() }
    });
    return normalized;
};

export const publicPickIdFor = (normalizedPick) => `op_${normalizedPick.idempotencyKey.slice(0, 40)}`;
