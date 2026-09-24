/**
 * Tipos de mensajes clasificados para la ingesta de FutbolBrain.
 */
export const MESSAGE_TYPES = Object.freeze({
    ACTIVE_PICK: 'ACTIVE_PICK',
    MY_PICKS_SUMMARY: 'MY_PICKS_SUMMARY',
    IGNORED_EXTERNAL: 'IGNORED_EXTERNAL',
    UNKNOWN: 'UNKNOWN'
});

/**
 * Clasifica los mensajes entrantes de Telegram de FutbolBrain.
 * 
 * @param {Object} params
 * @param {string} params.text - Contenido textual del mensaje.
 * @param {string|number} params.chatId - ID del chat emisor.
 * @param {string|number} params.expectedChatId - ID del chat oficial configurado.
 * @returns {Object} Clasificación del mensaje.
 */
export const classifyTelegramMessage = ({ text = '', chatId = null, expectedChatId = null } = {}) => {
    const raw = String(text || '').trim();

    // 1. Filtrado de origen / chat
    if (expectedChatId && chatId && String(chatId) !== String(expectedChatId)) {
        return {
            type: MESSAGE_TYPES.IGNORED_EXTERNAL,
            reason: `Chat ID ${chatId} does not match expected FutbolBrain chat ${expectedChatId}`,
            rawText: raw
        };
    }

    if (!raw) {
        return {
            type: MESSAGE_TYPES.UNKNOWN,
            reason: 'Empty message text',
            rawText: raw
        };
    }

    // 2. Comprobar si es resumen "My Picks" / "Mis Picks"
    if (/(?:My\s*Picks|Mis\s*Picks|Upcoming\s*Picks)/i.test(raw) || /Total\s*(?:Picks|Selecciones):/i.test(raw)) {
        return {
            type: MESSAGE_TYPES.MY_PICKS_SUMMARY,
            rawText: raw
        };
    }

    // 3. Comprobar si es alerta "ACTIVE PICK"
    const hasActivePickHeader = /(?:ACTIVE\s*PICK|PICK\s*ACTIVO)/i.test(raw);
    const hasSystem = /(?:System|Sistema):\s*[^\r\n]+/i.test(raw) || /(?:MT\s*-[^\r\n]+)/i.test(raw);
    const hasMatch = /(?:Match|Partido|Evento):\s*[^\r\n]+/i.test(raw) || /\b[A-Za-zÀ-ÿ0-9\s.]+\s+(?:vs\.?|-)\s+[A-Za-zÀ-ÿ0-9\s.]+\b/i.test(raw);

    if (hasActivePickHeader || (hasSystem && hasMatch)) {
        return {
            type: MESSAGE_TYPES.ACTIVE_PICK,
            rawText: raw
        };
    }

    return {
        type: MESSAGE_TYPES.UNKNOWN,
        reason: 'Unrecognized message format',
        rawText: raw
    };
};
