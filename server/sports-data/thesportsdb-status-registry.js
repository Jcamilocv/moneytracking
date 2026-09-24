/**
 * @file Catálogo y mapeo de estados de partido en TheSportsDB y compatibilidad con Bet365 Rules.
 * 
 * Reglas Oficiales Bet365 para Fútbol:
 * 1. UNPLAYED / POSTPONED:
 *    - Si se juega dentro de 5 días del kickoff original -> apuesta permanece válida.
 *    - Si no se juega dentro de 5 días -> VOID (cuota 1.0).
 * 2. INTERRUPTED:
 *    - Si continúa desde el punto de interrupción y termina dentro de 48 horas del kickoff original -> apuestas permanecen.
 *    - Si no -> tratar como Abandoned (VOID salvo mercados ya determinados).
 * 3. ABANDONED:
 *    - VOID (cuota 1.0), salvo mercados cuyo resultado ya estuviese matemáticamente determinado.
 * 4. STANDARD MATCH MARKETS:
 *    - 90 minutos reglamentarios + descuento.
 *    - No incluye prórroga (AET) ni penaltis (PEN).
 *    - En TheSportsDB, AET y PEN/AP devuelven el marcador tras prórroga (120 min), por lo que
 *      intHomeScore/intAwayScore NO es seguro para liquidar mercados estándar a 90 min:
 *      marca REGULATION_SCORE_UNAVAILABLE.
 */

export const BET365_RULES = {
    POSTPONED_WINDOW_DAYS: 5,
    INTERRUPTED_WINDOW_HOURS: 48,
    REVIEW_REQUIRED_CODE: 'BET365_RULE_REVIEW_REQUIRED',
    REGULATION_SCORE_UNAVAILABLE_CODE: 'REGULATION_SCORE_UNAVAILABLE'
};

export const THESPORTSDB_STATUSES = {
    NS: {
        code: 'NS',
        meaning: 'Not Started',
        category: 'SCHEDULED',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Apuesta activa pendiente de inicio.'
    },
    '1H': {
        code: '1H',
        meaning: 'First Half',
        category: 'IN_PLAY',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'En juego.'
    },
    HT: {
        code: 'HT',
        meaning: 'Halftime',
        category: 'IN_PLAY',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Descanso.'
    },
    '2H': {
        code: '2H',
        meaning: 'Second Half',
        category: 'IN_PLAY',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'En juego.'
    },
    FT: {
        code: 'FT',
        meaning: 'Full Time',
        category: 'FINISHED',
        isSettleable: true,
        regulationScoreSafe: true,
        bet365Policy: 'Liquidación oficial inmediata según resultado en 90 minutos reglamentarios + tiempo de descuento.'
    },
    AET: {
        code: 'AET',
        meaning: 'After Extra Time',
        category: 'FINISHED',
        isSettleable: false, // NO liquidable directamente con intHomeScore porque incluye prórroga
        regulationScoreSafe: false,
        errorCode: BET365_RULES.REGULATION_SCORE_UNAVAILABLE_CODE,
        bet365Policy: 'Regla Bet365: Mercados estándar se liquidan a 90 min. TheSportsDB intHomeScore incluye prórroga (120 min): REGULATION_SCORE_UNAVAILABLE.'
    },
    PEN: {
        code: 'PEN',
        meaning: 'Penalties',
        category: 'FINISHED',
        isSettleable: false,
        regulationScoreSafe: false,
        errorCode: BET365_RULES.REGULATION_SCORE_UNAVAILABLE_CODE,
        bet365Policy: 'Regla Bet365: Mercados estándar se liquidan a 90 min. TheSportsDB intHomeScore incluye prórroga (120 min): REGULATION_SCORE_UNAVAILABLE.'
    },
    AP: {
        code: 'AP',
        meaning: 'After Penalties',
        category: 'FINISHED',
        isSettleable: false,
        regulationScoreSafe: false,
        errorCode: BET365_RULES.REGULATION_SCORE_UNAVAILABLE_CODE,
        bet365Policy: 'Regla Bet365: Mercados estándar se liquidan a 90 min. TheSportsDB intHomeScore incluye prórroga (120 min): REGULATION_SCORE_UNAVAILABLE.'
    },
    PST: {
        code: 'PST',
        meaning: 'Postponed',
        category: 'POSTPONED',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Regla Bet365: Si se juega dentro de 5 días del kickoff original, la apuesta permanece válida. Si no se juega dentro de 5 días, se liquida como VOID (cuota 1.0).'
    },
    CANC: {
        code: 'CANC',
        meaning: 'Cancelled',
        category: 'CANCELLED',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Regla Bet365: Partido cancelado sin reprogramación dentro de 5 días se liquida como VOID (cuota 1.0).'
    },
    ABD: {
        code: 'ABD',
        meaning: 'Abandoned',
        category: 'ABANDONED',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Regla Bet365: Se declara VOID (cuota 1.0), salvo mercados cuyo resultado ya estuviese matemáticamente determinado antes del abandono.'
    },
    SUSP: {
        code: 'SUSP',
        meaning: 'Suspended',
        category: 'IN_PLAY',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Regla Bet365: Partido interrumpido. Si se reanuda y termina dentro de 48 horas del kickoff original, las apuestas permanecen. Si no, tratar como Abandoned.'
    },
    INT: {
        code: 'INT',
        meaning: 'Interrupted',
        category: 'IN_PLAY',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Regla Bet365: Partido interrumpido. Si se reanuda y termina dentro de 48 horas del kickoff original, las apuestas permanecen. Si no, tratar como Abandoned.'
    },
    AWD: {
        code: 'AWD',
        meaning: 'Awarded / Technical Loss',
        category: 'TECHNICAL',
        isSettleable: false,
        regulationScoreSafe: false,
        bet365Policy: 'Regla Bet365: Decisiones administrativas posteriores no modifican la liquidación deportiva original.'
    }
};

/**
 * Obtiene la información técnica y política Bet365 para un estado de TheSportsDB.
 */
export function getTheSportsDbStatusInfo(status = '') {
    const key = String(status || '').trim().toUpperCase();
    return THESPORTSDB_STATUSES[key] || {
        code: key || 'UNKNOWN',
        meaning: 'Unknown',
        category: 'UNKNOWN',
        isSettleable: false,
        regulationScoreSafe: false,
        errorCode: BET365_RULES.REVIEW_REQUIRED_CODE,
        bet365Policy: 'Regla Bet365: BET365_RULE_REVIEW_REQUIRED. Caso no cubierto explícitamente.'
    };
}

/**
 * Evalúa la validez de una apuesta para un partido aplazado bajo la regla de 5 días de Bet365.
 * 
 * @param {Object} params
 * @param {string|Date} params.originalKickoff Kickoff originalmente programado
 * @param {string|Date} [params.rescheduledKickoff] Nuevo kickoff si ya ha sido reprogramado
 * @param {string|Date} [params.currentTime] Fecha actual de evaluación
 * @returns {{ outcome: 'REMAINS_VALID' | 'VOID' | 'PENDING', daysDiff: number, explanation: string }}
 */
export function evaluateBet365Postponed({ originalKickoff, rescheduledKickoff = null, currentTime = new Date() } = {}) {
    const origMs = new Date(originalKickoff).getTime();
    if (Number.isNaN(origMs)) {
        return { outcome: 'VOID', daysDiff: null, explanation: 'Fecha original de kickoff inválida' };
    }

    const fiveDaysMs = BET365_RULES.POSTPONED_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // Si ya existe fecha reprogramada
    if (rescheduledKickoff) {
        const reschedMs = new Date(rescheduledKickoff).getTime();
        const diffMs = reschedMs - origMs;
        const daysDiff = diffMs / (24 * 60 * 60 * 1000);

        if (diffMs <= fiveDaysMs && diffMs >= 0) {
            return {
                outcome: 'REMAINS_VALID',
                daysDiff,
                explanation: `Partido reprogramado dentro de los 5 días (${daysDiff.toFixed(1)} días): la apuesta permanece válida.`
            };
        } else {
            return {
                outcome: 'VOID',
                daysDiff,
                explanation: `Partido reprogramado fuera de los 5 días (${daysDiff.toFixed(1)} días): la apuesta es VOID (cuota 1.0).`
            };
        }
    }

    // Si aún no hay fecha reprogramada, evaluar tiempo transcurrido desde el kickoff original
    const currMs = new Date(currentTime).getTime();
    const elapsedMs = currMs - origMs;
    const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);

    if (elapsedMs > fiveDaysMs) {
        return {
            outcome: 'VOID',
            daysDiff: elapsedDays,
            explanation: `Han transcurrido más de 5 días (${elapsedDays.toFixed(1)} días) sin jugarse: la apuesta es VOID (cuota 1.0).`
        };
    }

    return {
        outcome: 'PENDING',
        daysDiff: elapsedDays,
        explanation: `Partido aplazado pendiente de reprogramación (transcurridos ${elapsedDays.toFixed(1)} de 5 días máximos).`
    };
}

/**
 * Evalúa un partido interrumpido bajo la regla de 48 horas de Bet365.
 * 
 * @param {Object} params
 * @param {string|Date} params.originalKickoff
 * @param {string|Date} [params.resumedFinishTime] Fecha de finalización tras reanudación
 * @param {string|Date} [params.currentTime]
 * @returns {{ outcome: 'REMAINS_VALID' | 'ABANDONED' | 'PENDING', hoursDiff: number, explanation: string }}
 */
export function evaluateBet365Interrupted({ originalKickoff, resumedFinishTime = null, currentTime = new Date() } = {}) {
    const origMs = new Date(originalKickoff).getTime();
    if (Number.isNaN(origMs)) {
        return { outcome: 'ABANDONED', hoursDiff: null, explanation: 'Fecha original de kickoff inválida' };
    }

    const fortyEightHoursMs = BET365_RULES.INTERRUPTED_WINDOW_HOURS * 60 * 60 * 1000;

    if (resumedFinishTime) {
        const finishMs = new Date(resumedFinishTime).getTime();
        const diffMs = finishMs - origMs;
        const hoursDiff = diffMs / (60 * 60 * 1000);

        if (diffMs <= fortyEightHoursMs) {
            return {
                outcome: 'REMAINS_VALID',
                hoursDiff,
                explanation: `Partido reanudado y finalizado dentro de 48 horas (${hoursDiff.toFixed(1)} h): apuestas permanecen válidas.`
            };
        } else {
            return {
                outcome: 'ABANDONED',
                hoursDiff,
                explanation: `Partido no finalizó dentro de 48 horas (${hoursDiff.toFixed(1)} h): se trata como Abandoned.`
            };
        }
    }

    const currMs = new Date(currentTime).getTime();
    const elapsedMs = currMs - origMs;
    const elapsedHours = elapsedMs / (60 * 60 * 1000);

    if (elapsedMs > fortyEightHoursMs) {
        return {
            outcome: 'ABANDONED',
            hoursDiff: elapsedHours,
            explanation: `Han transcurrido más de 48 horas (${elapsedHours.toFixed(1)} h) desde el kickoff: se trata como Abandoned.`
        };
    }

    return {
        outcome: 'PENDING',
        hoursDiff: elapsedHours,
        explanation: `Partido interrumpido a la espera de reanudación (${elapsedHours.toFixed(1)} de 48 horas máximas).`
    };
}
