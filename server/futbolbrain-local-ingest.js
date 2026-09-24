import { PUBLICATION_POLICIES } from './official-pick-scheduling.js';
import {
    getSystemDefinition,
    isApprovedSystem,
    mapSystemSelection,
    calculateRegistryStake,
    SYSTEM_EXECUTION_MODES,
    SYSTEM_REGISTRY
} from './system-registry.js';
import { queueOfficialPick } from './official-pick-queue.js';
import { registerOfficialPickPreflight } from './official-pick-preflight.js';
import { recordPaperPick } from './paper-picks.js';

export const FUTBOLBRAIN_OWNER_BROWSER_PROVIDER = 'futbolbrain-owner-browser';

const cleanText = (value, field) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`Falta ${field}`);
    if (text.length > 160) throw new Error(`${field} supera el tamaño permitido`);
    return text;
};

import { cleanDateWithMadridFallback } from '../api/_lib/timezone.js';

const cleanDate = cleanDateWithMadridFallback;

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

export const approvedFutbolBrainSystems = () => Object.keys(SYSTEM_REGISTRY);

/**
 * Normaliza y valida un candidato extraído visualmente por la extensión de Chrome.
 * Consulta exclusivamente el SystemRegistry como fuente de verdad determinista.
 */
export const normalizeFutbolBrainOwnerCandidate = (input = {}, { now = new Date() } = {}) => {
    if (input?.source?.provider !== FUTBOLBRAIN_OWNER_BROWSER_PROVIDER) {
        throw new Error('La fuente local no está autorizada');
    }

    const systemId = cleanText(input?.system?.id, 'system.id');
    const systemDef = getSystemDefinition(systemId);
    if (!systemDef) {
        throw new Error(`El sistema no está aprobado para publicación automática (${systemId})`);
    }

    const rawSelection = cleanText(input?.visiblePick?.selection, 'visiblePick.selection');
    const selection = mapSystemSelection(systemId, rawSelection);
    if (!selection) {
        throw new Error(`El mercado visible no coincide con el sistema aprobado: ${rawSelection}`);
    }

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

    const oddsAtPublication = cleanOdds(input?.visiblePick?.odds);
    const stakePolicy = calculateRegistryStake({ systemId, odds: oddsAtPublication });

    // Determinar política de publicación según el modo de ejecución del System Registry
    let publicationPolicy = PUBLICATION_POLICIES.IMMEDIATE;
    if (systemDef.executionMode === SYSTEM_EXECUTION_MODES.T5) {
        publicationPolicy = PUBLICATION_POLICIES.T_MINUS_5;
    } else if (systemDef.executionMode === SYSTEM_EXECUTION_MODES.PAPER) {
        publicationPolicy = 'paper';
    }

    return {
        event: {
            sourceEventId: cleanText(input?.event?.sourceEventId, 'event.sourceEventId'),
            competition: cleanText(input?.event?.competition, 'event.competition'),
            homeTeam: cleanText(input?.event?.homeTeam, 'event.homeTeam'),
            awayTeam: cleanText(input?.event?.awayTeam, 'event.awayTeam'),
            kickoffAt
        },
        bet: {
            market: systemDef.market,
            selection,
            oddsAtPublication,
            stakeUnits: 1,
            recommendedStakePct: stakePolicy.recommendedStakePct,
            confidenceFactor: stakePolicy.confidenceFactor,
            baseStakePct: stakePolicy.baseStakePct
        },
        system: {
            id: systemId,
            version: 'visible-table-v1',
            tier: systemDef.tier,
            executionMode: systemDef.executionMode
        },
        source: {
            provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER,
            observedAt
        },
        executionMode: systemDef.executionMode,
        publicationPolicy
    };
};

export { T5_TRANSPORT_STATUS, TELEGRAM_T5_MIGRATION } from './system-registry.js';
export const registerCandidatePreflightDeferred = registerOfficialPickPreflight;

/**
 * Enrutador de ingesta desacoplado para candidatos procedentes de la extensión local.
 * 
 * POLÍTICA DE OPERACIONES (T5_TRANSPORT_STATUS = LEGACY_CHROME_PRODUCTION):
 * 1. EARLY: Se encola en el pipeline oficial de publicación inmediata (officialPickQueue -> officialPicks -> Telegram público).
 * 2. T5: Flujo canónico de producción preservado. La extensión Chrome v0.2.8 detecta y envía el pick en la ventana T-5,
 *        encolándose con publicationPolicy: 't_minus_5' en officialPickQueue.
 *        La migración a Telegram inbound queda como arquitectura diferida (TELEGRAM_T5_MIGRATION = DEFERRED).
 * 3. PAPER: Se registra en paperPicks con stake 0%, sin publicación pública ni afección a bancas.
 */
export const ingestFutbolBrainOwnerCandidate = async (input, {
    db = null,
    now = new Date(),
    experimentalPreflight = false,
    queuePick = queueOfficialPick
} = {}) => {
    const candidate = normalizeFutbolBrainOwnerCandidate(input, { now });

    if (candidate.executionMode === SYSTEM_EXECUTION_MODES.EARLY) {
        const result = await queuePick(candidate, { now });
        return {
            ok: true,
            executionMode: SYSTEM_EXECUTION_MODES.EARLY,
            state: result.state,
            queueId: result.queueId,
            publicationPolicy: candidate.publicationPolicy,
            pick: result.pick || null
        };
    }

    if (candidate.executionMode === SYSTEM_EXECUTION_MODES.T5) {
        if (experimentalPreflight) {
            const preflight = await registerOfficialPickPreflight({
                event: candidate.event,
                system: candidate.system,
                source: candidate.source,
                db,
                now
            });
            return {
                ok: true,
                executionMode: SYSTEM_EXECUTION_MODES.T5,
                state: 'preflight_registered',
                preflightId: preflight.preflightId,
                publicationPolicy: candidate.publicationPolicy
            };
        }

        const result = await queuePick(candidate, { now });
        return {
            ok: true,
            executionMode: SYSTEM_EXECUTION_MODES.T5,
            state: result.state,
            queueId: result.queueId,
            publicationPolicy: candidate.publicationPolicy,
            pick: result.pick || null
        };
    }

    if (candidate.executionMode === SYSTEM_EXECUTION_MODES.PAPER) {
        const paper = await recordPaperPick({ candidate, db, now });
        return {
            ok: true,
            executionMode: SYSTEM_EXECUTION_MODES.PAPER,
            state: 'paper_recorded',
            paperPickId: paper.paperPickId,
            publicationPolicy: candidate.publicationPolicy
        };
    }

    throw new Error(`Modo de ejecución no reconocido para el sistema ${candidate.system.id}`);
};
