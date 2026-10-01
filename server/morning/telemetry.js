import { getSystemDefinition } from '../system-registry.js';
import { madridDayKey } from '../canonical-candidate-validation.js';
import { parseFutbolBrainKickoff } from './candidate.js';

const countBy = (values) => values.reduce((counts, value) => {
    if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
}, {});
const technicalText = (value) => typeof value === 'string' && value.length <= 160
    && !Array.from(value).some((char) => char.charCodeAt(0) < 32) ? value : null;

export const summarizeMorningRun = (items, diagnostics, observedAt) => {
    const now = new Date(observedAt);
    const today = madridDayKey(now);
    const classification = { EARLY: 0, T5: 0, PAPER: 0, UNKNOWN: 0 };
    let todayCount = 0, futureCount = 0, expiredCount = 0, ambiguousTimeCount = 0;
    const unverifiedMarketTuples = new Map();
    for (const item of items) {
        const definition = getSystemDefinition(item?.SystemName);
        classification[definition?.executionMode || 'UNKNOWN']++;
        const kickoff = parseFutbolBrainKickoff(item?.DateOfMatch);
        if (!kickoff) ambiguousTimeCount++;
        else {
            const day = madridDayKey(kickoff);
            if (day === today) todayCount++;
            else if (day > today) futureCount++;
            if (kickoff <= now) expiredCount++;
        }
        if (item?.SystemName === 'MT - CHA EUR - V1.0') {
            const tuple = {
                system: 'CHA/EUR',
                category: technicalText(item.TargetMarket?.MarketCategory),
                name: technicalText(item.TargetMarket?.MarketName),
                shortName: technicalText(item.TargetMarket?.MarketShortName)
            };
            unverifiedMarketTuples.set(JSON.stringify(tuple), tuple);
        }
    }
    return {
        sourceItemCount: items.length, classification, todayCount, futureCount,
        expiredCount, ambiguousTimeCount,
        validMorningCandidates: diagnostics.filter((entry) =>
            ['WOULD_QUEUE_OFFICIAL', 'WOULD_DEDUP_OFFICIAL'].includes(entry.action)).length,
        actions: countBy(diagnostics.map((entry) => entry.action)),
        rejectedReasons: countBy(diagnostics.filter((entry) => entry.action === 'REJECTED').map((entry) => entry.reason)),
        reconciliation: countBy(diagnostics.map((entry) => entry.reconciliationStatus)),
        virtualDedupCount: diagnostics.filter((entry) =>
            ['WOULD_DEDUP_OFFICIAL', 'PAPER_DUPLICATE'].includes(entry.action)).length,
        unverifiedMarketTuples: [...unverifiedMarketTuples.values()].slice(0, 10),
        timezone: 'Europe/Madrid = operational hypothesis',
        firestoreWrites: 0, officialPicks: 0, paperWrites: 0, bankWrites: 0, telegramSends: 0
    };
};
