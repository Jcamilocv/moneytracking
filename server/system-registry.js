/**
 * @file System Registry - Fuente de Verdad Determinista de Sistemas FutbolBrain.
 * 
 * Derivado directamente del Excel Maestro de Sistemas de Money Tips.
 * Define la clasificación estricta: EARLY, T5 y PAPER.
 * 
 * REGLA ARQUITECTÓNICA INVIOLABLE:
 * La decisión de publicación y clasificación es 100% determinista; ninguna IA interviene en esta decisión.
 */

export const SYSTEM_EXECUTION_MODES = Object.freeze({
    EARLY: 'EARLY',   // Publicar controlado: captura y publicación temprana tras 00:00 Madrid
    T5: 'T5',         // Publicar controlado: requiere mensaje T-5 min verificado de Telegram
    PAPER: 'PAPER'    // Observación: registrar y auditar sin publicar ni exponer capital (stake 0%)
});

export const SYSTEM_TIERS = Object.freeze({
    PUBLICAR_CONTROLADO: 'PUBLICAR_CONTROLADO',
    OBSERVACION_PAPER: 'OBSERVACION_PAPER'
});

export const T5_TRANSPORT_STATUS = 'LEGACY_CHROME_PRODUCTION';
export const TELEGRAM_T5_MIGRATION = 'DEFERRED';

export const SYSTEM_REGISTRY = Object.freeze({
    // ── GRUPO 1: EARLY (PUBLICAR CONTROLADO — SIN T-5) ──
    'MT - CHA EUR - V1.0': {
        name: 'Champions / Europa League BTTS No',
        executionMode: SYSTEM_EXECUTION_MODES.EARLY,
        tier: SYSTEM_TIERS.PUBLICAR_CONTROLADO,
        requiresT5: false,
        market: 'Ambos equipos marcan',
        marketKey: 'btts',
        selections: { 'No': 'No' },
        allowedLeagues: ['EUR-CHL', 'EUR-EUL'],
        stakePolicy: { tier: 'production_controlled', factor: 0.75 }
    },
    'MT - ENG2 - v1.0': {
        name: 'Championship Away Win',
        executionMode: SYSTEM_EXECUTION_MODES.EARLY,
        tier: SYSTEM_TIERS.PUBLICAR_CONTROLADO,
        requiresT5: false,
        market: 'Resultado final',
        marketKey: '1x2',
        selections: { 'Team 2 (FT)': 'Visitante', '2': 'Visitante', 'Away': 'Visitante' },
        allowedLeagues: ['ENG-CHA'],
        stakePolicy: { tier: 'production_controlled', factor: 0.75 }
    },
    'MT - ITA1 - V1.0': {
        name: 'Serie A BTTS No',
        executionMode: SYSTEM_EXECUTION_MODES.EARLY,
        tier: SYSTEM_TIERS.PUBLICAR_CONTROLADO,
        requiresT5: false,
        market: 'Ambos equipos marcan',
        marketKey: 'btts',
        selections: { 'No': 'No' },
        allowedLeagues: ['ITA-SRA'],
        stakePolicy: { tier: 'production_controlled', factor: 0.75 }
    },
    'MT - Premier League 02.5': {
        name: 'Premier League Under 3.5',
        executionMode: SYSTEM_EXECUTION_MODES.EARLY,
        tier: SYSTEM_TIERS.PUBLICAR_CONTROLADO,
        requiresT5: false,
        market: 'Total de goles',
        marketKey: 'under',
        selections: { 'Under 3.5': 'Menos de 3,5 goles', 'U 3.5 FT': 'Menos de 3,5 goles' },
        allowedLeagues: ['ENG-PRE'],
        stakePolicy: { tier: 'production_controlled', factor: 0.75 }
    },

    // ── GRUPO 2: T5 (PUBLICAR CONTROLADO — CON T-5 OBLIGATORIO) ──
    'MT - FRA1 FRA2 - V1.0': {
        name: 'Francia 1 y 2 Over 2.5',
        executionMode: SYSTEM_EXECUTION_MODES.T5,
        tier: SYSTEM_TIERS.PUBLICAR_CONTROLADO,
        requiresT5: true,
        market: 'Total de goles',
        marketKey: 'over',
        selections: { 'Over 2.5': 'Más de 2,5 goles', 'O 2.5 FT': 'Más de 2,5 goles' },
        allowedLeagues: ['FRA-LG1', 'FRA-LG2'],
        stakePolicy: { tier: 'production_controlled', factor: 0.75 }
    },
    'MT-LAB-BTTS-ESP-v0.1': {
        name: 'España BTTS Yes Lab',
        executionMode: SYSTEM_EXECUTION_MODES.T5,
        tier: SYSTEM_TIERS.PUBLICAR_CONTROLADO,
        requiresT5: true,
        market: 'Ambos equipos marcan',
        marketKey: 'btts',
        selections: { 'Yes': 'Sí', 'Si': 'Sí', 'BTTS Yes': 'Sí' },
        allowedLeagues: ['ESP-PRE', 'ESP-SEG'],
        stakePolicy: { tier: 'production_controlled', factor: 0.75 }
    },

    // ── GRUPO 3: PAPER (OBSERVACIÓN — STAKE 0%, CERO PUBLICACIÓN EXTERNA) ──
    'MT - POR1 - v1.0': {
        name: 'Portugal Home Win (Paper)',
        executionMode: SYSTEM_EXECUTION_MODES.PAPER,
        tier: SYSTEM_TIERS.OBSERVACION_PAPER,
        requiresT5: false,
        market: 'Resultado final',
        marketKey: '1x2',
        selections: { 'Team 1 (FT)': 'Local', '1': 'Local', 'Home FT': 'Local' },
        allowedLeagues: ['POR-PRI'],
        stakePolicy: { tier: 'paper', factor: 0.0 }
    },
    'MT - GER1 - v1.1': {
        name: 'Bundesliga Over 3.5 (Paper)',
        executionMode: SYSTEM_EXECUTION_MODES.PAPER,
        tier: SYSTEM_TIERS.OBSERVACION_PAPER,
        requiresT5: true,
        market: 'Total de goles',
        marketKey: 'over',
        selections: { 'Over 3.5': 'Más de 3,5 goles', 'O 3.5 FT': 'Más de 3,5 goles' },
        allowedLeagues: ['GER-BUN'],
        stakePolicy: { tier: 'paper', factor: 0.0 }
    },
    'MT - TUR1 - V1.0': {
        name: 'Turquía Away Win (Paper)',
        executionMode: SYSTEM_EXECUTION_MODES.PAPER,
        tier: SYSTEM_TIERS.OBSERVACION_PAPER,
        requiresT5: true,
        market: 'Resultado final',
        marketKey: '1x2',
        selections: { 'Team 2 (FT)': 'Visitante', '2': 'Visitante', 'Away FT': 'Visitante' },
        allowedLeagues: ['TUR-SUP'],
        stakePolicy: { tier: 'paper', factor: 0.0 }
    }
});

export const getSystemDefinition = (systemId) => {
    if (!systemId) return null;
    return SYSTEM_REGISTRY[String(systemId).trim()] || null;
};

export const isApprovedSystem = (systemId) => {
    return Boolean(getSystemDefinition(systemId));
};

export const getSystemExecutionMode = (systemId) => {
    const def = getSystemDefinition(systemId);
    return def ? def.executionMode : null;
};

export const isEarlyPublicationSystem = (systemId) => {
    const def = getSystemDefinition(systemId);
    return Boolean(def && def.executionMode === SYSTEM_EXECUTION_MODES.EARLY);
};

export const isT5System = (systemId) => {
    const def = getSystemDefinition(systemId);
    return Boolean(def && def.executionMode === SYSTEM_EXECUTION_MODES.T5);
};

export const isPaperSystem = (systemId) => {
    const def = getSystemDefinition(systemId);
    return Boolean(def && def.executionMode === SYSTEM_EXECUTION_MODES.PAPER);
};

export const mapSystemSelection = (systemId, rawSelection) => {
    const def = getSystemDefinition(systemId);
    if (!def) return null;
    const cleanRaw = String(rawSelection || '').trim();
    return def.selections[cleanRaw] || null;
};

/**
 * Calcula la recomendación de stake aplicando el factor de confianza del System Registry.
 */
export const calculateRegistryStake = ({ systemId, odds }) => {
    const def = getSystemDefinition(systemId);
    if (!def) throw new Error(`Sistema desconocido en Registry: ${systemId}`);

    const numericOdds = Number(odds);
    if (!Number.isFinite(numericOdds) || numericOdds < 1.01) {
        throw new Error('Cuota inválida para cálculo de stake');
    }

    let baseStakePct = 1.0;
    if (numericOdds < 1.40) baseStakePct = 1.5;
    else if (numericOdds < 3.00) baseStakePct = 1.0;
    else baseStakePct = 0.5;

    const factor = def.stakePolicy.factor;
    const recommendedStakePct = Number((baseStakePct * factor).toFixed(3));

    return {
        systemId,
        tier: def.tier,
        executionMode: def.executionMode,
        baseStakePct,
        confidenceFactor: factor,
        recommendedStakePct // Será 0.0 para sistemas PAPER
    };
};
