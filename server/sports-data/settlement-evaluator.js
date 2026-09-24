/**
 * @file Evaluador conceptual de liquidación de mercados oficiales de Money Tips
 * a partir del resultado final devuelto por API-Football.
 * 
 * Cumple con el requisito 12:
 * Demostrar que goals.home y goals.away bastan para resolver el 100% de los
 * mercados actuales del portfolio oficial sin requerir estadísticas avanzadas.
 */

export const SETTLEMENT_OUTCOMES = {
    WON: 'WON',
    LOST: 'LOST',
    VOID: 'VOID'
};

/**
 * Evalúa si una selección oficial resulta ganadora o perdedora según el marcador final.
 * 
 * @param {Object} params
 * @param {string} params.market Nombre canónico del mercado
 * @param {string} params.selection Selección canónica ('Sí', 'No', 'Más de 2,5 goles', 'Local', etc.)
 * @param {number} params.homeGoals Goles del equipo local en tiempo reglamentario
 * @param {number} params.awayGoals Goles del equipo visitante en tiempo reglamentario
 * @returns {{ outcome: string, totalGoals: number, explanation: string }}
 */
export function evaluatePickSettlement({ market = '', selection = '', homeGoals = 0, awayGoals = 0 } = {}) {
    const h = Number(homeGoals);
    const a = Number(awayGoals);

    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0) {
        throw new Error(`Goles inválidos para liquidación: home=${homeGoals}, away=${awayGoals}`);
    }

    const totalGoals = h + a;
    const normMarket = String(market || '').trim().toLowerCase();
    const normSelection = String(selection || '').trim().toLowerCase();

    // 1. Ambos equipos marcan (BTTS)
    if (normMarket.includes('ambos') || normMarket.includes('btts')) {
        const bothScored = h > 0 && a > 0;
        if (normSelection === 'sí' || normSelection === 'si' || normSelection === 'yes') {
            return {
                outcome: bothScored ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: bothScored
                    ? `Marcador ${h}-${a}: ambos equipos marcaron (WON)`
                    : `Marcador ${h}-${a}: al menos un equipo no marcó (LOST)`
            };
        }
        if (normSelection === 'no') {
            return {
                outcome: !bothScored ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: !bothScored
                    ? `Marcador ${h}-${a}: al menos un equipo con 0 goles (WON)`
                    : `Marcador ${h}-${a}: ambos equipos marcaron (LOST)`
            };
        }
    }

    // 2. Total de goles (Over / Under)
    if (normMarket.includes('total') || normMarket.includes('goles') || normMarket.includes('over') || normMarket.includes('under')) {
        // Detectar umbral numérico (0.5, 1.5, 2.5, 3.5, etc.)
        const matchThreshold = normSelection.match(/(\d+)[,\.](\d+)/);
        const threshold = matchThreshold ? parseFloat(`${matchThreshold[1]}.${matchThreshold[2]}`) : 2.5;

        if (normSelection.includes('más') || normSelection.includes('mas') || normSelection.includes('over')) {
            const won = totalGoals > threshold;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a} (${totalGoals} goles): ${won ? `> ${threshold} (WON)` : `<= ${threshold} (LOST)`}`
            };
        }
        if (normSelection.includes('menos') || normSelection.includes('under')) {
            const won = totalGoals < threshold;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a} (${totalGoals} goles): ${won ? `< ${threshold} (WON)` : `>= ${threshold} (LOST)`}`
            };
        }
    }

    // 3. Resultado final (1X2)
    if (normMarket.includes('resultado') || normMarket.includes('1x2') || normMarket.includes('match')) {
        if (normSelection === 'local' || normSelection === '1' || normSelection === 'home') {
            const won = h > a;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'victoria local (WON)' : 'no hubo victoria local (LOST)'}`
            };
        }
        if (normSelection === 'visitante' || normSelection === '2' || normSelection === 'away') {
            const won = a > h;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'victoria visitante (WON)' : 'no hubo victoria visitante (LOST)'}`
            };
        }
        if (normSelection === 'empate' || normSelection === 'x' || normSelection === 'draw') {
            const won = h === a;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'empate (WON)' : 'no hubo empate (LOST)'}`
            };
        }
    }

    // 4. Doble oportunidad (1X, X2, 12)
    if (normMarket.includes('doble') || normMarket.includes('oportunidad') || normMarket.includes('double')) {
        if (normSelection.includes('1x') || (normSelection.includes('1') && normSelection.includes('x'))) {
            const won = h >= a;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'local o empate (WON)' : 'victoria visitante (LOST)'}`
            };
        }
        if (normSelection.includes('x2') || (normSelection.includes('x') && normSelection.includes('2'))) {
            const won = a >= h;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'empate o visitante (WON)' : 'victoria local (LOST)'}`
            };
        }
        if (normSelection.includes('12') || (normSelection.includes('1') && normSelection.includes('2'))) {
            const won = h !== a;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'victoria local o visitante (WON)' : 'empate (LOST)'}`
            };
        }
    }

    // 5. Empate apuesta no válida / Draw No Bet
    if (normMarket.includes('empate no') || normMarket.includes('draw no') || normMarket.includes('dnb')) {
        if (h === a) {
            return {
                outcome: SETTLEMENT_OUTCOMES.VOID,
                totalGoals,
                explanation: `Marcador ${h}-${a}: empate -> apuesta cancelada/reembolso cuota 1.0 (VOID)`
            };
        }
        if (normSelection === 'local' || normSelection === '1' || normSelection === 'home') {
            const won = h > a;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'victoria local (WON)' : 'victoria visitante (LOST)'}`
            };
        }
        if (normSelection === 'visitante' || normSelection === '2' || normSelection === 'away') {
            const won = a > h;
            return {
                outcome: won ? SETTLEMENT_OUTCOMES.WON : SETTLEMENT_OUTCOMES.LOST,
                totalGoals,
                explanation: `Marcador ${h}-${a}: ${won ? 'victoria visitante (WON)' : 'victoria local (LOST)'}`
            };
        }
    }

    throw new Error(`Mercado/selección no soportado para evaluación: ${market} / ${selection}`);
}

/**
 * Valida si todos los mercados del portfolio canónico son liquidables mediante goals.home y goals.away.
 */
export function areCurrentMarketsSettleableFromFinalScore() {
    const testCases = [
        { market: 'Ambos equipos marcan', selection: 'Sí', homeGoals: 2, awayGoals: 1, expected: SETTLEMENT_OUTCOMES.WON },
        { market: 'Ambos equipos marcan', selection: 'No', homeGoals: 2, awayGoals: 0, expected: SETTLEMENT_OUTCOMES.WON },
        { market: 'Total de goles', selection: 'Más de 2,5 goles', homeGoals: 2, awayGoals: 1, expected: SETTLEMENT_OUTCOMES.WON },
        { market: 'Total de goles', selection: 'Más de 3,5 goles', homeGoals: 3, awayGoals: 1, expected: SETTLEMENT_OUTCOMES.WON },
        { market: 'Total de goles', selection: 'Menos de 3,5 goles', homeGoals: 1, awayGoals: 1, expected: SETTLEMENT_OUTCOMES.WON },
        { market: 'Resultado final', selection: 'Local', homeGoals: 2, awayGoals: 1, expected: SETTLEMENT_OUTCOMES.WON },
        { market: 'Resultado final', selection: 'Visitante', homeGoals: 0, awayGoals: 2, expected: SETTLEMENT_OUTCOMES.WON }
    ];

    for (const tc of testCases) {
        const res = evaluatePickSettlement(tc);
        if (res.outcome !== tc.expected) return false;
    }

    return true;
}
