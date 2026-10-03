import { getSystemDefinition, normalizeSystemId } from '../system-registry.js';
import { parseFutbolBrainTelegramText } from '../futbolbrain-telegram-intake.js';
import { semanticOfficialPickKey } from '../../api/_lib/official-pick-data.js';

/**
 * Normaliza las variantes conocidas de selección a su representación canónica única.
 */
export const normalizeSelection = (rawSelection = '', { market = '', systemId = '' } = {}) => {
    const text = normalizeSystemId(String(rawSelection || '').trim());
    if (!text) return '';

    const lower = text.toLowerCase();

    // 1. Ambos equipos marcan (BTTS)
    if (/^(?:yes|si|sí|btts\s*yes|ambos\s*marcan\s*s[ií])$/i.test(lower)) {
        return 'Sí';
    }
    if (/^(?:no|btts\s*no|ambos\s*marcan\s*no)$/i.test(lower)) {
        return 'No';
    }

    // 2. Over / Más de goles
    if (/^(?:over|o|m[aá]s\s*de)\s*2[.,]5(?:\s*ft)?$/i.test(lower)) {
        return 'Más de 2,5 goles';
    }
    if (/^(?:over|o|m[aá]s\s*de)\s*3[.,]5(?:\s*ft)?$/i.test(lower)) {
        return 'Más de 3,5 goles';
    }

    // 3. Under / Menos de goles
    if (/^(?:under|u|menos\s*de)\s*3[.,]5(?:\s*ft)?$/i.test(lower)) {
        return 'Menos de 3,5 goles';
    }

    // 4. Resultado final (1X2)
    if (/^(?:team\s*2(?:\s*\(ft\))?|2|away(?:\s*ft)?|visitante)$/i.test(lower)) {
        return 'Visitante';
    }
    if (/^(?:team\s*1(?:\s*\(ft\))?|1|home(?:\s*ft)?|local)$/i.test(lower)) {
        return 'Local';
    }
    if (/^(?:x|draw|empate)$/i.test(lower)) {
        return 'Empate';
    }

    // 5. Fallback al SystemRegistry si existe mapeo
    if (systemId) {
        const sysDef = getSystemDefinition(systemId);
        if (sysDef?.selections?.[text]) {
            return sysDef.selections[text];
        }
    }

    return text;
};

/**
 * Normaliza el nombre del mercado.
 */
export const normalizeMarket = (rawMarket = '', systemDef = null) => {
    const text = String(rawMarket || '').trim().toLowerCase();
    if (/^(?:total\s*de\s*goles|over\/under|total\s*goals)$/i.test(text)) {
        return 'Total de goles';
    }
    if (/^(?:ambos\s*equipos\s*marcan|btts|both\s*teams\s*to\s*score)$/i.test(text)) {
        return 'Ambos equipos marcan';
    }
    if (/^(?:resultado\s*final|1x2|match\s*odds|match\s*result)$/i.test(text)) {
        return 'Resultado final';
    }
    return systemDef?.market || rawMarket || '';
};

/**
 * Convierte un timestamp en formato YYYY-MM-DD HH:mm(:ss) interpretado en Europe/Madrid
 * a su instante UTC exacto, respetando horario de verano (CEST = UTC+2) e invierno (CET = UTC+1).
 * Si el string contiene offset explícito o 'Z', lo respeta directamente.
 * Totalmente independiente del timezone local del servidor.
 */
export const parseMadridDateTimeToUTC = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const trimmed = dateStr.trim();

    // 1. Si contiene offset explícito o indicador UTC 'Z', respetar directamente
    if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(trimmed)) {
        const d = new Date(trimmed);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    // 2. Extraer componentes YYYY-MM-DD HH:mm(:ss)
    const clean = trimmed.replace('T', ' ');
    const parts = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!parts) return null;

    const [_, year, month, day, hour = '00', minute = '00', second = '00'] = parts;
    const naiveUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);

    // 3. Formateador determinista anclado en Europe/Madrid (DST-safe)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });

    let guess = naiveUtc;
    for (let i = 0; i < 3; i++) {
        const formatted = formatter.formatToParts(new Date(guess));
        const getPart = (t) => formatted.find(p => p.type === t)?.value;
        const fYear = +getPart('year');
        const fMonth = +getPart('month');
        const fDay = +getPart('day');
        let fHour = +getPart('hour');
        if (fHour === 24) fHour = 0;
        const fMinute = +getPart('minute');
        const fSecond = +getPart('second');

        const formattedAsUtc = Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, fSecond);
        const diff = formattedAsUtc - naiveUtc;
        if (diff === 0) break;
        guess -= diff;
    }

    const resultDate = new Date(guess);
    return Number.isNaN(resultDate.getTime()) ? null : resultDate.toISOString();
};

/**
 * Parsea y normaliza la fecha de kickoff si está presente en el texto.
 * Si no contiene timezone, se interpreta estrictamente en Europe/Madrid (canónico de FutbolBrain).
 * Si no está presente, devuelve null (nunca inventa datos).
 */
export const extractKickoff = (text = '', { observedAt = new Date() } = {}) => {
    const raw = String(text || '');
    // 1. Patrones con fecha completa: "Hora: 2026-09-20 20:45", "Kickoff: 2026-09-20T20:45:00Z"
    const fullMatch = raw.match(/(?:Hora|Kickoff|Time|Fecha):\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T\s][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?)/i);
    if (fullMatch) {
        return parseMadridDateTimeToUTC(fullMatch[1]);
    }

    // 2. Patrón con solo hora de FutbolBrain: "-Kickoff: 21:00" o "Hora: 20:45"
    const timeOnlyMatch = raw.match(/(?:-?Kickoff|-?Hora|-?Time):\s*(\d{1,2}:\d{2})/i);
    if (timeOnlyMatch) {
        const timePart = timeOnlyMatch[1];
        const refDate = observedAt instanceof Date ? observedAt : new Date(observedAt);
        const madridDay = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(refDate);
        return parseMadridDateTimeToUTC(`${madridDay} ${timePart}`);
    }

    return null;
};

/**
 * Parsea y normaliza la probabilidad si está presente en el texto.
 */
export const extractProbability = (text = '') => {
    const raw = String(text || '');
    const match = raw.match(/(?:-?Predicted Probability|-?Probabilidad|Probability|Probabilidad):\s*([0-9]+(?:\.[0-9]+)?%?)/i);
    if (!match) return null;
    const num = parseFloat(match[1].replace('%', ''));
    return Number.isNaN(num) ? null : num;
};

/**
 * Normaliza una alerta ACTIVE PICK de FutbolBrain a la estructura canónica de Money Tips.
 * 
 * Cumple con el requisito 5:
 * Si algún dato no existe en el mensaje, usa null (nunca inventa datos).
 * La identidad deportiva (fingerprint) se construye DESPUÉS de normalizar.
 */
export const normalizeFutbolBrainTelegramPick = (text = '', {
    telegramMessageId = null,
    observedAt = new Date().toISOString()
} = {}) => {
    const base = parseFutbolBrainTelegramText(text);
    if (!base || !base.systemId) {
        throw new Error('No se pudo extraer información básica de la alerta FutbolBrain');
    }

    const systemDef = getSystemDefinition(base.systemId);
    const executionMode = systemDef ? (systemDef.executionMode === 'PAPER' ? 'PAPER' : 'PRODUCTION') : 'UNKNOWN';

    const market = normalizeMarket(base.market, systemDef);
    const selection = normalizeSelection(base.rawSelection, { market, systemId: base.systemId });
    const kickoffAt = extractKickoff(text, { observedAt });
    const probability = extractProbability(text);
    const odds = base.odds !== null ? Number(base.odds) : null;

    const homeTeam = base.homeTeam || '';
    const awayTeam = base.awayTeam || '';
    const event = (homeTeam && awayTeam) ? `${homeTeam} vs ${awayTeam}` : (base.rawText.match(/([A-ZÀ-ÿ0-9\s.]+)\s+(?:vs\.?|-)\s+([A-ZÀ-ÿ0-9\s.]+)/i)?.[0] || '');

    // Construir huella canónica (fingerprint) usando semanticOfficialPickKey
    const referenceDate = kickoffAt ? new Date(kickoffAt) : new Date(observedAt);
    const fingerprint = semanticOfficialPickKey({
        event: {
            competition: base.competition || 'Fútbol',
            homeTeam,
            awayTeam,
            kickoffAt: referenceDate
        },
        bet: {
            market,
            selection
        },
        system: {
            id: base.systemId
        }
    });

    return {
        source: 'FUTBOLBRAIN_TELEGRAM',
        systemId: base.systemId,
        executionMode,
        event,
        competition: base.competition || 'Fútbol',
        homeTeam,
        awayTeam,
        kickoffAt,
        market,
        selection,
        odds,
        probability,
        telegramMessageId: telegramMessageId !== null ? String(telegramMessageId) : null,
        observedAt: typeof observedAt === 'string' ? observedAt : observedAt.toISOString(),
        eligibility: 'ELIGIBLE',
        fingerprint
    };
};
