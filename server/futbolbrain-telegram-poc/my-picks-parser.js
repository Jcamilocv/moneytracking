import { getSystemDefinition, SYSTEM_REGISTRY, normalizeSystemId } from '../system-registry.js';

/**
 * Parsea un mensaje de resumen "My Picks" de FutbolBrain Telegram.
 * 
 * REGLA ARQUITECTÓNICA INVIOLABLE:
 * "My Picks" es exclusivamente para observabilidad y reconciliación.
 * NUNCA cambia ningún candidato a ELIGIBLE ni publica picks.
 * 
 * @param {string} text - Contenido del mensaje de Telegram.
 * @param {Object} options
 * @param {Date|string} options.observedAt - Timestamp de observación.
 * @returns {Object} Resumen parseado.
 */
export const parseMyPicksSummary = (text = '', { observedAt = new Date() } = {}) => {
    const raw = String(text || '').trim();
    if (!raw) {
        throw new Error('Mensaje My Picks vacío');
    }

    // 1. Extraer Total Picks (si está explícito en la cabecera)
    // Ejemplos: "You have a total of 12 picks", "📊 My Picks (23)", "Total Picks: 23", "Mis Picks: 23"
    let totalPicks = null;
    const totalMatch = raw.match(/(?:total\s+of|total\s*(?:picks|selecciones)?|my\s*picks|mis\s*picks)[^\d\r\n]*(\d+)/i)
        || raw.match(/(?:Total|Total Picks):\s*(\d+)/i);
    
    if (totalMatch) {
        totalPicks = parseInt(totalMatch[1], 10);
    }

    // 2. Extraer conteos por sistema
    // Patrones:
    // "MT-LAB-BTTS-ESP-v0.1: You have 3 picks in the next 24 hours."
    // "MT-LAB-BTTS-ESP-v0.1: 4"
    // "- MT - FRA1 FRA2 - V1.0: 2 picks"
    const systems = [];
    const systemLineRegex = /(?:^|[\r\n])\s*[-•*]?\s*(MT\s*-[A-Za-z0-9\s._-]+?)\s*:\s*(?:(?:You have\s*)?(\d+)|.*?\b(\d+)\s*picks?)/gi;
    
    let match;
    while ((match = systemLineRegex.exec(raw)) !== null) {
        const rawSystemId = normalizeSystemId(match[1]);
        const countStr = match[2] || match[3] || '0';
        const upcomingPickCount = parseInt(countStr, 10);

        // Validar contra SystemRegistry
        // Buscar coincidencia exacta o case-insensitive / trimmed
        let matchedSystemId = rawSystemId;
        const exactDef = getSystemDefinition(rawSystemId);
        if (!exactDef) {
            const registryKey = Object.keys(SYSTEM_REGISTRY).find(
                key => key.toLowerCase().replace(/\s+/g, ' ') === rawSystemId.toLowerCase().replace(/\s+/g, ' ')
            );
            if (registryKey) {
                matchedSystemId = registryKey;
            }
        }

        systems.push({
            systemId: matchedSystemId,
            upcomingPickCount: Number.isFinite(upcomingPickCount) ? upcomingPickCount : 0
        });
    }

    // Si totalPicks no venía explícito en cabecera, calcular como suma de sistemas
    if (totalPicks === null) {
        totalPicks = systems.reduce((acc, sys) => acc + sys.upcomingPickCount, 0);
    }

    return {
        source: 'FUTBOLBRAIN_TELEGRAM',
        type: 'MY_PICKS_SUMMARY',
        totalPicks,
        systems,
        observedAt: observedAt instanceof Date ? observedAt.toISOString() : observedAt
    };
};
