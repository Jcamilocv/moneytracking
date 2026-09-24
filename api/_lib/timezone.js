/**
 * @file api/lib/timezone.js
 * 
 * Helper canónico compartido para el manejo y normalización de fechas en Money Tips.
 * 
 * REGLA ARQUITECTÓNICA CANÓNICA:
 * Toda fecha/hora procedente de FutbolBrain (DOM, Telegram, JSON) sin offset explícito
 * debe interpretarse estrictamente como Europe/Madrid (CET en invierno UTC+1, CEST en verano UTC+2),
 * NUNCA como UTC.
 */

/**
 * Convierte una fecha y hora expresada en horario de Europe/Madrid a su timestamp UTC exacto (ISO 8601).
 * Soporta formatos ISO (YYYY-MM-DDTHH:mm:ss) y europeos (DD/MM/YYYY HH:mm:ss).
 * Es 100% determinista y seguro ante cambios de hora (DST-safe).
 * 
 * @param {string} dateStr - Cadena de fecha y hora.
 * @returns {string|null} Cadena ISO 8601 en UTC (terminada en Z), o null si es inválida.
 */
export const parseMadridDateTimeToUTC = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const trimmed = dateStr.trim();

    // 1. Si contiene offset explícito o indicador UTC 'Z', respetar directamente
    if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(trimmed)) {
        const d = new Date(trimmed);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    // 2. Extraer componentes año, mes, día, hora, minuto, segundo
    const clean = trimmed.replace('T', ' ');
    let year, month, day, hour = '00', minute = '00', second = '00';

    const euroMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (euroMatch) {
        [, day, month, year, hour = '00', minute = '00', second = '00'] = euroMatch;
    } else {
        const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!isoMatch) return null;
        [, year, month, day, hour = '00', minute = '00', second = '00'] = isoMatch;
    }

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
 * Valida y limpia una fecha con fallback canónico a Europe/Madrid cuando carece de offset.
 * 
 * @param {*} value - Valor de fecha a limpiar (Date, string, etc.).
 * @param {string} field - Nombre del campo para mensajes de error.
 * @returns {Date} Objeto Date válido.
 */
export const cleanDateWithMadridFallback = (value, field = 'date') => {
    if (!value) throw new Error(`Falta ${field}`);
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new Error(`${field} no es una fecha válida`);
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        // Si tiene offset o Z, Date() estándar lo respeta
        if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(trimmed)) {
            const d = new Date(trimmed);
            if (Number.isNaN(d.getTime())) throw new Error(`${field} no es una fecha válida`);
            return d;
        }

        // Si no tiene offset, parsear interpretando en Europe/Madrid
        const isoUtc = parseMadridDateTimeToUTC(trimmed);
        if (isoUtc) {
            const d = new Date(isoUtc);
            if (!Number.isNaN(d.getTime())) return d;
        }

        const fallback = new Date(trimmed);
        if (Number.isNaN(fallback.getTime())) throw new Error(`${field} no es una fecha válida`);
        return fallback;
    }

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error(`${field} no es una fecha válida`);
    return d;
};
