import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregatePeriodYield, calculateYieldPercent } from '../src/lib/yield.js';

test('periodo positivo: beneficio neto entre importe apostado', () => {
    assert.equal(calculateYieldPercent(24, 200), 12);
});

test('periodo negativo', () => {
    assert.equal(calculateYieldPercent(-18, 120), -15);
});

test('resultado cero y stake cero se manejan sin NaN ni Infinity', () => {
    assert.equal(calculateYieldPercent(0, 100), 0);
    assert.equal(calculateYieldPercent(0, 0), 0);
    assert.equal(calculateYieldPercent(25, 0), 0);
});

const bets = [
    { weekKey: '2026-W01', monthKey: '2026-01', profit: 20, stake: 100 },
    { weekKey: '2026-W01', monthKey: '2026-01', profit: -5, stake: 50 },
    { weekKey: '2026-W02', monthKey: '2026-01', profit: -12, stake: 80 },
    { weekKey: '2026-W05', monthKey: '2026-02', profit: 30, stake: 120 },
];

test('agregación semanal: suma resultado y stake antes de calcular el yield', () => {
    assert.deepEqual(aggregatePeriodYield(bets, 'weekKey'), [
        { key: '2026-W01', profit: 15, staked: 150, yield: 10 },
        { key: '2026-W02', profit: -12, staked: 80, yield: -15 },
        { key: '2026-W05', profit: 30, staked: 120, yield: 25 },
    ]);
});

test('agregación mensual y varios periodos', () => {
    assert.deepEqual(aggregatePeriodYield(bets, 'monthKey'), [
        { key: '2026-01', profit: 3, staked: 230, yield: calculateYieldPercent(3, 230) },
        { key: '2026-02', profit: 30, staked: 120, yield: 25 },
    ]);
});

test('coincide con el KPI canónico para los mismos datos', () => {
    const periods = aggregatePeriodYield(bets, 'monthKey');
    const totalProfit = periods.reduce((sum, period) => sum + period.profit, 0);
    const totalStaked = periods.reduce((sum, period) => sum + period.staked, 0);
    assert.equal(calculateYieldPercent(totalProfit, totalStaked), calculateYieldPercent(33, 350));
});

test('historial vacío y claves inválidas no generan puntos engañosos', () => {
    assert.deepEqual(aggregatePeriodYield([], 'weekKey'), []);
    assert.deepEqual(aggregatePeriodYield([{ weekKey: 'Unknown', profit: 1, stake: 1 }], 'weekKey'), []);
});
