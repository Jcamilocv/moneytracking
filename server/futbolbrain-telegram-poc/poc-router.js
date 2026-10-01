import { getSystemDefinition, SYSTEM_EXECUTION_MODES } from '../system-registry.js';
import { classifyTelegramMessage, MESSAGE_TYPES } from './message-classifier.js';
import { normalizeFutbolBrainTelegramPick } from './canonical-normalizer.js';
import { parseMyPicksSummary } from './my-picks-parser.js';
import { defaultDedupLedger } from './deduplication-ledger.js';
import { reconcileCandidateWithSportsData, RECONCILIATION_STATUSES } from '../sports-data/sports-data-reconciler.js';
import { validateCanonicalCandidate } from '../canonical-candidate-validation.js';

/**
 * Router determinista de eventos para la PoC de Ingesta Telegram MTProto.
 * 
 * BARRERA DE SEGURIDAD ABSOLUTA (DRY-RUN):
 * En ningún caso este router escribe en Firestore, publica en Telegram de clientes,
 * modifica el Forward o altera la banca.
 */
export class TelegramPocRouter {
    constructor({
        dedupLedger = defaultDedupLedger,
        expectedChatId = process.env.FUTBOLBRAIN_TELEGRAM_CHAT_ID || 'futbolbrain_official_chat',
        sportsDataProvider = null,
        dryRun = true
    } = {}) {
        this.dedupLedger = dedupLedger;
        this.expectedChatId = expectedChatId;
        this.sportsDataProvider = sportsDataProvider;
        this.dryRun = Boolean(dryRun);
        this.stats = {
            messagesProcessed: 0,
            activePicksWouldPublish: 0,
            activePicksWouldRecordPaper: 0,
            duplicatesDetected: 0,
            morningSystemsExcluded: 0,
            externalIgnored: 0,
            myPicksSummaries: 0,
            sportsDataMatched: 0,
            sportsDataUnmatched: 0,
            firestoreWrites: 0,
            outboundTelegramMessages: 0,
            productionMutations: 0
        };
    }

    /**
     * Procesa un mensaje entrante de Telegram de forma 100% aislada.
     */
    async processMessage({
        text = '',
        chatId = this.expectedChatId,
        telegramMessageId = null,
        observedAt = new Date()
    } = {}) {
        this.stats.messagesProcessed++;

        // 1. Clasificación del mensaje y origen
        const classified = classifyTelegramMessage({
            text,
            chatId,
            expectedChatId: this.expectedChatId
        });

        if (classified.type === MESSAGE_TYPES.IGNORED_EXTERNAL) {
            this.stats.externalIgnored++;
            return {
                action: 'IGNORED_EXTERNAL',
                reason: classified.reason,
                dryRun: this.dryRun,
                safety: this._getSafetyReport()
            };
        }

        if (classified.type === MESSAGE_TYPES.UNKNOWN) {
            return {
                action: 'IGNORED_UNKNOWN_FORMAT',
                reason: classified.reason,
                dryRun: this.dryRun,
                safety: this._getSafetyReport()
            };
        }

        // 2. Manejo de "My Picks" (Observabilidad y Reconciliación)
        if (classified.type === MESSAGE_TYPES.MY_PICKS_SUMMARY) {
            this.stats.myPicksSummaries++;
            const summary = parseMyPicksSummary(text, { observedAt });
            return {
                action: 'MY_PICKS_PROCESSED',
                summary,
                eligibilityModified: false, // NUNCA cambia elegibilidad
                dryRun: this.dryRun,
                safety: this._getSafetyReport()
            };
        }

        // 3. Manejo de "ACTIVE PICK"
        if (classified.type === MESSAGE_TYPES.ACTIVE_PICK) {
            const normalized = normalizeFutbolBrainTelegramPick(text, {
                telegramMessageId,
                observedAt
            });

            const systemDef = getSystemDefinition(normalized.systemId);
            if (!systemDef) {
                return {
                    action: 'IGNORED_UNKNOWN_SYSTEM',
                    systemId: normalized.systemId,
                    dryRun: this.dryRun,
                    safety: this._getSafetyReport()
                };
            }

            // ── CASO A: SISTEMAS MORNING / NON-T5 (REVISIÓN 10:00 MADRID) ──
            // Se reconocen en el portfolio pero se excluyen del listener MTProto T-5.
            if (!systemDef.requiresT5) {
                this.stats.morningSystemsExcluded++;
                const isPaper = systemDef.executionMode === SYSTEM_EXECUTION_MODES.PAPER;
                return {
                    action: 'EXCLUDED_NON_T5_LISTENER',
                    systemId: normalized.systemId,
                    executionMode: isPaper ? 'PAPER' : 'PRODUCTION',
                    timing: 'MORNING',
                    requiresT5: false,
                    reason: isPaper
                        ? 'Paper morning system processed via 10:00 Madrid review, excluded from T-5 MTProto listener'
                        : 'Production morning system processed via 10:00 Madrid review, excluded from T-5 MTProto listener',
                    dryRun: this.dryRun,
                    safety: this._getSafetyReport()
                };
            }

            // ── CASO B: SISTEMAS T-5 (CONFIRMACIÓN T-5) ──
            // A known ID alone does not make a message publishable. Keep the
            // candidate inside the same league, selection and data boundaries
            // as the approved registry before claiming WOULD_PUBLISH.
            const checked = validateCanonicalCandidate({
                systemId: normalized.systemId, competition: normalized.competition,
                market: normalized.market, selection: normalized.selection,
                selectionIsCanonical: true, odds: normalized.odds,
                kickoffAt: normalized.kickoffAt, homeTeam: normalized.homeTeam,
                awayTeam: normalized.awayTeam
            }, { now: new Date(observedAt), requireToday: false, enforceKickoffGuard: false });
            const invalidReason = checked.ok ? null : (checked.reason === 'MISSING_ODDS' ? 'INVALID_ODDS' : checked.reason);
            if (invalidReason) {
                return {
                    action: 'IGNORED_INVALID_CANDIDATE',
                    reason: invalidReason,
                    systemId: normalized.systemId,
                    dryRun: this.dryRun,
                    safety: this._getSafetyReport()
                };
            }

            // Comprobación de idempotencia y deduplicación
            const dedupCheck = this.dedupLedger.checkDuplicate({
                fingerprint: normalized.fingerprint,
                telegramMessageId: normalized.telegramMessageId
            });

            if (dedupCheck.isDuplicate) {
                this.stats.duplicatesDetected++;
                return {
                    action: 'DUPLICATE',
                    reason: dedupCheck.reason,
                    fingerprint: normalized.fingerprint,
                    systemId: normalized.systemId,
                    originalRecord: dedupCheck.originalRecord,
                    dryRun: this.dryRun,
                    safety: this._getSafetyReport()
                };
            }

            // Reconciliación con SportsDataProvider (TheSportsDB)
            let sportsData = {
                status: RECONCILIATION_STATUSES.SPORTS_DATA_UNMATCHED,
                fixtureId: null,
                provider: this.sportsDataProvider ? this.sportsDataProvider.name : 'NONE',
                providerKickoffAt: null,
                adoptedKickoffAt: normalized.kickoffAt,
                kickoffClassification: 'FUTBOLBRAIN_FALLBACK',
                reconciliationNote: 'Sin SportsDataProvider configurado. Se usa kickoff FutbolBrain.'
            };

            if (this.sportsDataProvider) {
                sportsData = await reconcileCandidateWithSportsData(normalized, this.sportsDataProvider);
            }

            if (sportsData.status === RECONCILIATION_STATUSES.MATCHED) {
                this.stats.sportsDataMatched++;
            } else {
                this.stats.sportsDataUnmatched++;
            }

            // Integrar identidad canónica y kickoff en el candidato
            normalized.sportsData = sportsData;
            normalized.sportsDataStatus = sportsData.status;
            normalized.fixtureId = sportsData.fixtureId;
            normalized.kickoffAt = sportsData.adoptedKickoffAt;

            // Sub-caso B.1: PRODUCTION T-5 (FRA1 FRA2, BTTS-ESP)
            if (systemDef.executionMode === SYSTEM_EXECUTION_MODES.T5 || systemDef.executionMode === 'PRODUCTION') {
                this.stats.activePicksWouldPublish++;
                this.dedupLedger.record({
                    fingerprint: normalized.fingerprint,
                    telegramMessageId: normalized.telegramMessageId,
                    systemId: normalized.systemId,
                    event: normalized.event,
                    action: 'WOULD_PUBLISH',
                    observedAt
                });

                return {
                    action: 'WOULD_PUBLISH',
                    candidate: normalized,
                    eligibility: 'ELIGIBLE',
                    executionMode: 'PRODUCTION',
                    dryRun: this.dryRun,
                    safety: this._getSafetyReport()
                };
            }

            // Sub-caso B.2: PAPER T-5 (GER1, TUR1)
            if (systemDef.executionMode === SYSTEM_EXECUTION_MODES.PAPER) {
                this.stats.activePicksWouldRecordPaper++;
                this.dedupLedger.record({
                    fingerprint: normalized.fingerprint,
                    telegramMessageId: normalized.telegramMessageId,
                    systemId: normalized.systemId,
                    event: normalized.event,
                    action: 'WOULD_RECORD_PAPER',
                    observedAt
                });

                return {
                    action: 'WOULD_RECORD_PAPER',
                    candidate: normalized,
                    eligibility: 'ELIGIBLE',
                    executionMode: 'PAPER',
                    stake: 0,
                    dryRun: this.dryRun,
                    safety: this._getSafetyReport()
                };
            }
        }

        return {
            action: 'UNHANDLED_MESSAGE',
            rawText: text,
            dryRun: this.dryRun,
            safety: this._getSafetyReport()
        };
    }

    _getSafetyReport() {
        return {
            externalFirestoreWrites: this.stats.firestoreWrites,
            outboundTelegramMessages: this.stats.outboundTelegramMessages,
            productionMutations: this.stats.productionMutations,
            dryRunActive: this.dryRun
        };
    }
}
