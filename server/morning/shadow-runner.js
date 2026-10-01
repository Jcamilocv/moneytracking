import { adaptMorningCandidate, toMorningQueueInput } from './candidate.js';
import { getSystemDefinition, SYSTEM_EXECUTION_MODES } from '../system-registry.js';
import { semanticOfficialPickKey, publicPickIdFor, normalizeOfficialPickInput } from '../../api/_lib/official-pick-data.js';
import { reconcileCandidateWithSportsData } from '../sports-data/sports-data-reconciler.js';
import { summarizeMorningRun } from './telemetry.js';

export const assertMorningShadow = (mode) => {
    if (mode !== 'SHADOW') throw new Error('MORNING_SHADOW_FIREWALL');
};

const observationKey = (candidate) => `${candidate.matchId}|${candidate.sourceSystemId}`;
const changeType = (previous, current) => !previous ? 'new'
    : previous.snapshotHash === current.snapshotHash ? 'duplicate'
        : previous.odds !== current.odds ? 'changed_odds'
            : previous.kickoffAt !== current.kickoffAt ? 'changed_kickoff' : 'changed_other';

// This module deliberately does not import Firebase, queue, bank or Telegram.
// A future live dispatcher must be a separate entry point with its own review.
export const createMorningShadowRunner = ({ sourceClient, stateStore, sportsDataProvider = null,
    reconcile = reconcileCandidateWithSportsData,
    minIntervalMs = 30 * 60_000, clock = () => new Date() } = {}) => {
    assertMorningShadow(process.env.MORNING_MODE);
    if (!sourceClient?.readActiveAlarms || !stateStore?.read || !stateStore?.write) throw new Error('SHADOW_DEPENDENCIES_REQUIRED');
    return {
        async run() {
            assertMorningShadow(process.env.MORNING_MODE);
            const previous = await stateStore.read();
            const attemptedAt = clock().toISOString();
            if (minIntervalMs > 0 && previous.lastAttemptAt
                && clock().getTime() - new Date(previous.lastAttemptAt).getTime() < minIntervalMs) {
                throw new Error('MORNING_READ_RATE_LIMITED');
            }
            await stateStore.write({ ...previous, lastAttemptAt: attemptedAt });
            const { items, observedAt, activePicksCount } = await sourceClient.readActiveAlarms();
            const cutoff = new Date(new Date(observedAt).getTime() - 3 * 24 * 60 * 60_000).getTime();
            const next = { schemaVersion: 1, lastAttemptAt: attemptedAt,
                lastObservedAt: observedAt, observations: {},
                semanticKeys: Object.fromEntries(Object.entries(previous.semanticKeys || {})
                    .filter(([, lastSeen]) => new Date(lastSeen).getTime() >= cutoff)) };
            const diagnostics = [];
            const seen = new Set();
            for (const item of items) {
                const { candidate, validation } = adaptMorningCandidate(item, { observedAt });
                const key = observationKey(candidate);
                if (seen.has(key)) throw new Error('DUPLICATE_SOURCE_ID');
                seen.add(key);
                const old = previous.observations[key];
                const change = changeType(old, candidate);
                const definition = getSystemDefinition(candidate.systemId);
                let action = !validation.ok ? 'REJECTED'
                    : definition.requiresT5 ? 'IGNORED_T5'
                        : definition.executionMode === SYSTEM_EXECUTION_MODES.PAPER ? 'PAPER_ONLY'
                            : 'WOULD_QUEUE_OFFICIAL';
                let reconciliation = null;
                let semanticKey = null;
                let officialPickId = null;
                if (validation.ok && action !== 'IGNORED_T5') {
                    reconciliation = await reconcile({
                        homeTeam: candidate.homeTeam, awayTeam: candidate.awayTeam,
                        competitionCode: validation.league, kickoffAt: candidate.kickoffAt
                    }, sportsDataProvider);
                    // Preserve the same semantic identity as the official queue,
                    // including for a corrected source kickoff within the same Madrid day.
                    if (action === 'WOULD_QUEUE_OFFICIAL') {
                        const normalized = normalizeOfficialPickInput(toMorningQueueInput({ candidate, validation }));
                        semanticKey = normalized.semanticDuplicateKey;
                        officialPickId = publicPickIdFor(normalized);
                    } else {
                        semanticKey = semanticOfficialPickKey({
                            event: { competition: validation.league, homeTeam: candidate.homeTeam,
                                awayTeam: candidate.awayTeam, kickoffAt: validation.kickoffAt },
                            bet: { market: candidate.market, selection: validation.selection },
                            system: { id: candidate.systemId }
                        });
                    }
                    if (old?.semanticKey === semanticKey || next.semanticKeys[semanticKey]) {
                        action = action === 'PAPER_ONLY' ? 'PAPER_DUPLICATE' : 'WOULD_DEDUP_OFFICIAL';
                    }
                    next.semanticKeys[semanticKey] = observedAt;
                }
                next.observations[key] = {
                    matchId: candidate.matchId, sourceSystemId: candidate.sourceSystemId,
                    systemId: candidate.systemId, snapshotHash: candidate.snapshotHash,
                    odds: candidate.odds, kickoffAt: candidate.kickoffAt,
                    semanticKey, lastObservedAt: observedAt,
                    snapshot: candidate.snapshot,
                    unknownFields: candidate.unknownFields,
                    sourceDateFormat: candidate.sourceDateFormat
                };
                diagnostics.push({ key, action, reason: validation.ok ? null : validation.reason,
                    change, semanticKey, officialPickId,
                    reconciliationStatus: reconciliation?.status || null,
                    snapshotHash: candidate.snapshotHash,
                    unknownFields: candidate.unknownFields,
                    sourceDateFormat: candidate.sourceDateFormat });
            }
            for (const [key, old] of Object.entries(previous.observations)) {
                if (!seen.has(key)) diagnostics.push({ key, action: 'VANISHED',
                    previousSnapshotHash: old.snapshotHash });
            }
            for (const diagnostic of diagnostics) {
                const old = previous.observations[diagnostic.key];
                const current = next.observations[diagnostic.key];
                if (diagnostic.change === 'changed_odds') {
                    diagnostic.previousOdds = old?.odds ?? null;
                    diagnostic.currentOdds = current?.odds ?? null;
                }
                if (diagnostic.change === 'changed_kickoff') {
                    diagnostic.previousKickoffAt = old?.kickoffAt ?? null;
                    diagnostic.currentKickoffAt = current?.kickoffAt ?? null;
                }
            }
            next.history = [...(previous.history || []), { observedAt, diagnostics }].slice(-100);
            await stateStore.write(next);
            return { mode: 'SHADOW', observedAt, diagnostics,
                telemetry: { ...summarizeMorningRun(items, diagnostics, observedAt),
                    activePicksCount: activePicksCount ?? null },
                externalWrites: 0, telegramMessages: 0, officialPicksCreated: 0 };
        }
    };
};
