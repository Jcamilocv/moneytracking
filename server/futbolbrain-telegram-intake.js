import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../api/_lib/firebase-admin.js';
import {
    getSystemDefinition,
    isApprovedSystem,
    mapSystemSelection,
    calculateRegistryStake,
    SYSTEM_EXECUTION_MODES,
    normalizeSystemId
} from './system-registry.js';
import {
    semanticOfficialPickKey,
    publicPickIdFor,
    preflightKeyForEvent
} from '../api/_lib/official-pick-data.js';
import { publishOfficialPick } from '../api/_lib/official-picks.js';
import { recordPaperPick } from './paper-picks.js';
import { markPreflightConfirmed } from './official-pick-preflight.js';
import { logSystemEvent, DEPARTMENTS, EVENT_STATUSES } from '../api/_lib/system-events.js';

export const TELEGRAM_INTAKE_PROVIDER = 'futbolbrain-telegram';

/**
 * Feature flag: Por defecto desactivada hasta validar experimentalmente
 * si el bot de Telegram en el grupo privado recibe los mensajes Active Pick de FutbolBrain.
 */
export const isFutbolBrainTelegramIntakeEnabled = () => {
    return process.env.FUTBOLBRAIN_TELEGRAM_INTAKE_ENABLED === 'true';
};

/**
 * Interfaz / Clase base abstracta del proveedor de ingesta de Telegram.
 */
export class FutbolBrainTelegramIntakeProvider {
    constructor(name = 'BaseFutbolBrainTelegramIntakeProvider') {
        this.name = name;
    }

    async parseMessage(/* rawMessage */) {
        throw new Error(`El proveedor ${this.name} no implementa parseMessage()`);
    }

    async processUpdate(/* update */) {
        throw new Error(`El proveedor ${this.name} no implementa processUpdate()`);
    }
}

/**
 * Proveedor concreto para Bot API en Grupo Privado (estado actual en validación).
 */
export class BotApiGroupTelegramIntakeProvider extends FutbolBrainTelegramIntakeProvider {
    constructor() {
        super('BotApiGroupTelegramIntakeProvider');
    }

    /**
     * Parsea un mensaje de texto de FutbolBrain con formato 'Active Pick'.
     */
    parseMessage(text) {
        return parseFutbolBrainTelegramText(text);
    }
}

/**
 * Unwraps complete outer Markdown wrappers if they enclose the entire match clause
 * without closing internally (e.g. "__Eldense VS Real Oviedo__").
 */
const unwrapMatchClause = (clause = '') => {
    let text = String(clause || '').trim();
    const wrappers = ['***', '___', '**', '__', '*', '_', '`'];
    for (const w of wrappers) {
        if (text.startsWith(w) && text.endsWith(w) && text.length >= w.length * 2) {
            const nextIdx = text.indexOf(w, w.length);
            if (nextIdx === text.length - w.length) {
                text = text.slice(w.length, -w.length).trim();
            }
        }
    }
    return text;
};

/**
 * Parsea el texto sin formato de una alerta 'Active Pick' de FutbolBrain.
 * Extrae: sistema, equipos, cuota, selección y competición.
 */
export const parseFutbolBrainTelegramText = (text = '') => {
    const raw = String(text || '').trim();
    if (!raw) return null;

    // FutbolBrain may bold the whole header or only the ID. Unwrap the
    // complete header first so a trailing ** cannot be mistaken for part of
    // an otherwise valid ID. Never search inside a malformed header for an
    // MT substring: the registry must receive the entire extracted ID.
    let systemId = null;
    for (const rawLine of raw.split(/\r?\n/)) {
        const header = normalizeSystemId(rawLine);
        const match = header.match(/^(?:AI\s+Model|System|Sistema)(?:\s*:\s*|\s+)(.+)$/i);
        if (match) {
            systemId = normalizeSystemId(match[1]);
            break;
        }
    }
    if (!systemId) return null;

    // Buscar partido y competición:
    // 1. Si existe línea explícita de Partido / Match / Evento (formato clásico / tests):
    let homeTeam = '';
    let awayTeam = '';
    let competition = 'Fútbol';

    const explicitMatchLine = raw.match(/(?:Match|Partido|Evento):\s*([^\r\n]+)/i);
    if (explicitMatchLine) {
        const parts = explicitMatchLine[1].split(/\s+(?:VS|vs\.?|-)\s+/i);
        if (parts.length >= 2) {
            homeTeam = normalizeSystemId(parts[0].trim());
            awayTeam = normalizeSystemId(parts[1].trim());
        }
    } else {
        // 2. Formato real FutbolBrain: "ESP-PRE: Sevilla VS Barcelona" o "**ESP-SEG:** __Eldense VS Real Oviedo__"
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (!/\s+(?:VS|vs\.?)\s+/i.test(trimmed)) continue;

            const compMatch = trimmed.match(/^\s*([*_`~]*)\s*(?!(?:Sistema|System|Market|Yield|AI\s*Model|Pick|Odds|Cuota|Hora|Kickoff|Probability)\b)([A-Za-z0-9-]+)(?:\s*:\s*\1|\1\s*:)\s*(.+)$/i);
            if (compMatch) {
                competition = normalizeSystemId(compMatch[2].trim());
                const matchClause = unwrapMatchClause(compMatch[3]);
                const parts = matchClause.split(/\s+(?:VS|vs\.?)\s+/i);
                if (parts.length >= 2) {
                    homeTeam = normalizeSystemId(parts[0].trim());
                    awayTeam = normalizeSystemId(parts[1].trim());
                    break;
                }
            }

            const colonIdx = trimmed.indexOf(':');
            const vsIdx = trimmed.search(/\s+(?:VS|vs\.?)\s+/i);
            if (colonIdx !== -1 && colonIdx < vsIdx) {
                const rawPrefix = trimmed.slice(0, colonIdx);
                const normalizedPrefix = normalizeSystemId(rawPrefix);
                if (!/^(?:Sistema|System|Market|Yield|AI\s*Model|Pick|Odds|Cuota|Hora|Kickoff|Probability)$/i.test(normalizedPrefix)) {
                    competition = 'MALFORMED';
                    const afterColon = trimmed.slice(colonIdx + 1);
                    const matchClause = unwrapMatchClause(afterColon);
                    const parts = matchClause.split(/\s+(?:VS|vs\.?)\s+/i);
                    if (parts.length >= 2) {
                        homeTeam = normalizeSystemId(parts[0].trim());
                        awayTeam = normalizeSystemId(parts[1].trim());
                    }
                    break;
                }
            }

            const matchClause = unwrapMatchClause(trimmed);
            const parts = matchClause.split(/\s+(?:VS|vs\.?)\s+/i);
            if (parts.length >= 2) {
                homeTeam = normalizeSystemId(parts[0].trim());
                awayTeam = normalizeSystemId(parts[1].trim());
                break;
            }
        }
    }

    const compMatch = raw.match(/(?:League|Liga|Competición):\s*([^\r\n]+)/i);
    if (compMatch) {
        competition = normalizeSystemId(compMatch[1].trim());
    }

    // Buscar mercado, selección y cuota:
    // Formato real FutbolBrain: "Market BTTS Yes (Bet365): 1.61" o "**__Market BTTS Yes (Bet365): 2**__"
    // Formato clásico: "Mercado: Total de goles \n Selección: Over 2.5 \n Cuota: 1.85"
    let rawSelection = '';
    let market = null;
    let odds = null;

    const realMarketMatch = raw.match(/Market\s+([*_`~A-Za-z0-9\s.,()]+?)\s*(?:\(([^)]+)\))?:\s*[*_`~]*(\d+(?:[.,]\d+)?)/i);
    if (realMarketMatch) {
        rawSelection = normalizeSystemId(realMarketMatch[1].trim());
        odds = parseFloat(realMarketMatch[3].replace(',', '.'));
    } else {
        const marketMatch = raw.match(/(?:Market|Mercado):\s*([^\r\n]+)/i);
        const selectionMatch = raw.match(/(?:Pick|Selecci[oó]n|Apuesta):\s*([^\r\n]+)/i);
        rawSelection = selectionMatch ? normalizeSystemId(selectionMatch[1].trim()) : '';
        market = marketMatch ? normalizeSystemId(marketMatch[1].trim()) : null;

        const oddsMatch = raw.match(/(?:Odds|Cuota|@):\s*[*_`~]*(\d+(?:[.,]\d+)?)/i);
        odds = oddsMatch ? parseFloat(oddsMatch[1].replace(',', '.')) : null;
    }

    const systemDef = getSystemDefinition(systemId);
    if (!market) {
        market = systemDef?.market || null;
    }

    return {
        systemId,
        homeTeam,
        awayTeam,
        competition,
        market,
        rawSelection,
        odds,
        rawText: raw
    };
};

/**
 * Ingesta un pick recibido de Telegram convergente con el intake general.
 * 
 * REGLAS ARQUITECTÓNICAS OBLIGATORIAS:
 * 1. EARLY recibido después por Telegram:
 *    - Si ya existe como publicado: NO publicar otra vez, NO copiar a banca otra vez.
 *    - Correlacionar, registrar timestamp T5 y cuota T5 para análisis CLV / línea.
 * 2. T5 recibido por Telegram:
 *    - Validar con SystemRegistry (requiresT5: true).
 *    - Publicar inmediatamente a través del pipeline oficial (`publishOfficialPickToTelegram()`).
 *    - Marcar el preflight como confirmado.
 * 3. PAPER:
 *    - Registrar en paperPicks (stake 0, cero difusión pública).
 */
export const ingestFutbolBrainTelegramPick = async ({
    parsed,
    kickoffAt = new Date(Date.now() + 5 * 60 * 1000), // ~5 min antes
    sourceEventId = null,
    telegramMessageId = null,
    db = null,
    now = new Date()
} = {}) => {
    if (!parsed?.systemId) throw new Error('Falta identificador del sistema en mensaje Telegram');
    const database = db || getAdminDb();

    const systemDef = getSystemDefinition(parsed.systemId);
    if (!systemDef) {
        throw new Error(`Sistema ${parsed.systemId} no autorizado en SystemRegistry`);
    }

    const selection = mapSystemSelection(parsed.systemId, parsed.rawSelection) || parsed.rawSelection;
    const odds = Number(parsed.odds) || 1.80;
    const stakePolicy = calculateRegistryStake({ systemId: parsed.systemId, odds });

    // Construir candidato normalizado source-agnostic
    const candidatePayload = {
        event: {
            sourceEventId: sourceEventId || `tg_${telegramMessageId || Date.now()}`,
            competition: parsed.competition || 'Fútbol',
            homeTeam: parsed.homeTeam,
            awayTeam: parsed.awayTeam,
            kickoffAt
        },
        bet: {
            market: systemDef.market,
            selection,
            oddsAtPublication: odds,
            stakeUnits: 1,
            recommendedStakePct: stakePolicy.recommendedStakePct,
            confidenceFactor: stakePolicy.confidenceFactor,
            baseStakePct: stakePolicy.baseStakePct
        },
        system: {
            id: parsed.systemId,
            version: 'telegram-active-pick-v1',
            tier: systemDef.tier,
            executionMode: systemDef.executionMode
        },
        source: {
            provider: TELEGRAM_INTAKE_PROVIDER,
            observedAt: now
        },
        executionMode: systemDef.executionMode
    };

    // Calcular la huella canónica deportiva (source-agnostic)
    const semanticKey = semanticOfficialPickKey(candidatePayload);
    const expectedPickId = `op_${semanticKey.slice(0, 40)}`;

    // ── REGLA 9: COMPROBAR SI YA FUE PUBLICADO COMO EARLY ──
    const existingPickRef = database.collection('officialPicks').doc(expectedPickId);
    const existingSnap = await existingPickRef.get();

    if (existingSnap.exists && existingSnap.data()?.status === 'published') {
        const existingData = existingSnap.data();

        // 1. NO publicar otra vez
        // 2. NO copiar a la banca otra vez
        // 3. Registrar auditoría CLV / correlación T5
        const earlyOdds = Number(existingData.bet?.oddsAtPublication) || null;
        const oddsDiff = (earlyOdds && odds) ? Number((odds - earlyOdds).toFixed(2)) : 0;

        const nowVal = (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) ? FieldValue.serverTimestamp() : new Date();
        await existingPickRef.update({
            telegramT5Correlation: {
                receivedAt: nowVal,
                telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
                oddsAtT5: odds,
                earlyOdds,
                oddsDiff,
                correlatedAt: nowVal
            },
            updatedAt: nowVal
        });

        // Registrar evento inmutable de correlación
        const correlationEventRef = existingPickRef.collection('events').doc(`tg_corr_${Date.now()}`);
        await correlationEventRef.set({
            type: 'telegram_t5_correlated',
            telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
            oddsAtT5: odds,
            earlyOdds,
            oddsDiff,
            createdAt: nowVal
        });

        await logSystemEvent({
            department: DEPARTMENTS.PICKS_RISK || 'picks_risk',
            workerId: 'telegram-intake-worker',
            eventType: 'picks_risk.early_pick_correlated_at_t5',
            status: EVENT_STATUSES.SUCCESS,
            payload: {
                officialPickId: expectedPickId,
                systemId: parsed.systemId,
                earlyOdds,
                oddsAtT5: odds,
                oddsDiff
            },
            rulesApplied: ['rule_early_t5_deduplication_clv_audit']
        }).catch(() => {});

        return {
            ok: true,
            action: 'correlated_early',
            duplicate: true,
            officialPickId: expectedPickId,
            message: 'Pick EARLY ya publicado previamente. Correlación y auditoría CLV registradas sin duplicidad.'
        };
    }

    // ── REGLA 10: MANEJO DE PAPER ──
    if (systemDef.executionMode === SYSTEM_EXECUTION_MODES.PAPER) {
        const paperResult = await recordPaperPick({ candidate: candidatePayload, db: database, now });
        return {
            ok: true,
            action: 'paper_recorded',
            paperPickId: paperResult.paperPickId,
            executionMode: SYSTEM_EXECUTION_MODES.PAPER
        };
    }

    // ── REGLA 6 & 12: PUBLICACIÓN OFICIAL (T5 o EARLY no capturado previamente) ──
    // Reutiliza el pipeline oficial canónico:
    // officialPick -> publishOfficialPickToTelegram() -> auto-copy banca temporada
    const publishResult = await publishOfficialPick(candidatePayload);

    // Si había un preflight esperando este evento, marcarlo como confirmado
    const preflightId = preflightKeyForEvent({ event: candidatePayload.event, system: candidatePayload.system });
    await markPreflightConfirmed({ preflightId, officialPickId: publishResult.pick.id, db: database });

    return {
        ok: true,
        action: 'published_official',
        officialPickId: publishResult.pick.id,
        executionMode: systemDef.executionMode,
        created: publishResult.created,
        pick: publishResult.pick
    };
};
