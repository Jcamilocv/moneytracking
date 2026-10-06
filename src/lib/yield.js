/** Same numerator and denominator as the existing Dashboard Yield KPI. */
export function calculateYieldPercent(profit, staked) {
    return staked > 0 ? (profit / staked) * 100 : 0;
}

/** Aggregate already calculated settled-bet results by week or month. */
export function aggregatePeriodYield(entries, keyField) {
    const totals = new Map();
    for (const entry of entries) {
        const key = entry[keyField];
        if (!key || key === 'Unknown') continue;
        const current = totals.get(key) || { profit: 0, staked: 0 };
        current.profit += entry.profit;
        current.staked += entry.stake;
        totals.set(key, current);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, total]) => ({
        key,
        ...total,
        yield: calculateYieldPercent(total.profit, total.staked),
    }));
}
