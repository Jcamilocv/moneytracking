import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from './official-pick-data.js';
import { attachOfficialPickReviewSummaries } from './official-pick-reports.js';
import { publishOfficialPickToTelegram, TelegramRequestError } from './telegram.js';
import { deliverOfficialPickTelegramOnce } from './_telegram-delivery.js';
import { stakeRecommendationForOfficialPick } from '../../server/money-tips-stake-policy.js';

const toPlainValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(toPlainValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    return value;
};

export const toPublicOfficialPick = (snapshot) => ({ id: snapshot.id, ...toPlainValue(snapshot.data()) });

// Picks published before the stake-policy launch have no recommendation stored
// in Firestore. Derive it only in the response, so their original ledger and
// evidence remain untouched while the owner can safely synchronise their bank.
const withStakeRecommendation = (pick) => {
    if (!pick?.bet || Number.isFinite(Number(pick.bet.recommendedStakePct))) return pick;
    try {
        return {
            ...pick,
            bet: {
                ...pick.bet,
                ...stakeRecommendationForOfficialPick({
                    systemId: pick.system?.id,
                    oddsAtPublication: pick.bet.oddsAtPublication
                })
            }
        };
    } catch {
        return pick;
    }
};

const isPickStillActive = (pick, now = new Date()) => {
    const kickoffAt = new Date(pick?.event?.kickoffAt);
    return !Number.isNaN(kickoffAt.getTime()) && kickoffAt.getTime() > now.getTime();
};

// Future events are absent from public responses, including direct-ID reads.
// Historical event summaries are whitelisted; strategy/odds/stake stay private.
export const pickForAudience = (pick, { canViewActiveDetails = false, now = new Date() } = {}) => {
    if (canViewActiveDetails) return { ...pick, isLocked: false, isPublicSummary: false,
        ...(pick.status === 'withdrawn' ? { isWithdrawn: true } : {}) };
    const kickoffAt = new Date(pick?.event?.kickoffAt);
    if (!Number.isFinite(kickoffAt.getTime()) || isPickStillActive(pick, now)) return null;
    // Public response is a whitelist, not a spread of the private document.
    // Future/unknown events are absent even when their per-pick ID is known.
    return {
        id: pick.id, status: pick.status,
        event: { homeTeam: pick.event.homeTeam, awayTeam: pick.event.awayTeam,
            competition: pick.event.competition, kickoffAt: kickoffAt.toISOString() },
        publishedAt: pick.publishedAt,
        isLocked: true,
        isPublicSummary: true,
        bet: {
            market: null,
            selection: null,
            oddsAtPublication: null, recommendedStakePct: null, baseStakePct: null, confidenceFactor: null
        },
        system: { id: null, version: null },
        settlement: pick.settlement ? { status: pick.settlement.status,
            regularTimeScore: pick.settlement.regularTimeScore || null, settledAt: pick.settlement.settledAt || null } : null
    };
};

// Technical checks remain immutable in the ledger, but must never be promoted
// alongside real Money Tips recommendations in the public feed.
export const isPublicOfficialPickData = (data = {}) => (
    data.status === 'published' && !String(data.source?.provider || '').startsWith('test-')
);

// Los picks sintéticos sirven para probar el ledger y la cola, pero nunca deben
// dejar el entorno de pruebas ni aparecer como una recomendación real.
export const shouldNotifyTelegramForOfficialPick = (pick) => isPublicOfficialPickData(pick);

export const publishOfficialPick = async (input, { now = new Date(), db = getAdminDb(),
    send = publishOfficialPickToTelegram, clock = () => new Date() } = {}) => {
    const normalized = normalizeOfficialPickInput(input);
    if (normalized.event.kickoffAt.getTime() <= now.getTime() + 60_000) throw new Error('PICK_KICKOFF_EXPIRED');
    const pickId = publicPickIdFor(normalized);
    const pickRef = db.collection('officialPicks').doc(pickId);
    const eventRef = pickRef.collection('events').doc('published');
    let created = false;

    await db.runTransaction(async (transaction) => {
        created = false;
        const existing = await transaction.get(pickRef);
        if (existing.exists) return;
        if (normalized.event.kickoffAt.getTime() <= clock().getTime() + 60_000) throw new Error('PICK_KICKOFF_EXPIRED');
        created = true;
        transaction.set(pickRef, {
            ...normalized,
            event: { ...normalized.event, kickoffAt: Timestamp.fromDate(normalized.event.kickoffAt) },
            source: { ...normalized.source, observedAt: Timestamp.fromDate(normalized.source.observedAt) },
            scheduledAt: Timestamp.fromDate(normalized.scheduledAt),
            createdAt: FieldValue.serverTimestamp(),
            publishedAt: FieldValue.serverTimestamp()
        });
        transaction.set(eventRef, {
            type: 'published',
            evidenceHash: normalized.source.evidenceHash,
            createdAt: FieldValue.serverTimestamp()
        });
    });

    const snapshot = await pickRef.get();
    const pick = withStakeRecommendation(toPublicOfficialPick(snapshot));

    const telegramDelivery = shouldNotifyTelegramForOfficialPick(pick)
        ? await deliverOfficialPickTelegramOnce({ db, pickRef, pick, allowFreshClaim: created,
            send: async value => {
                // A slow transaction must not turn a valid initial check into
                // a publication after kickoff. This failure is definitely unsent.
                if (new Date(value.event.kickoffAt).getTime() <= clock().getTime() + 60_000) {
                    throw new TelegramRequestError(true);
                }
                return send(value);
            } })
        : { status: 'not_applicable' };
    return { created, pick, telegramDelivery };
};

export const listOfficialPicks = async (limit = 20, audience = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const scanLimit = Math.min(safeLimit + 10, 50);
    const collection = getAdminDb().collection('officialPicks');
    const query = audience.canViewActiveDetails ? collection.orderBy('publishedAt', 'desc')
        : collection.where('event.kickoffAt', '<=', Timestamp.fromDate(audience.now || new Date()))
            .orderBy('event.kickoffAt', 'desc');
    const snapshot = await query.limit(scanLimit).get();
    const picks = snapshot.docs
        .filter((document) => isPublicOfficialPickData(document.data()))
        .slice(0, safeLimit)
        .map((document) => withStakeRecommendation(toPublicOfficialPick(document)));
    const reviewed = await attachOfficialPickReviewSummaries(picks);
    return reviewed.map((pick) => pickForAudience(pick, audience)).filter(Boolean);
};

export const getOfficialPick = async (pickId, audience = {}) => {
    const db = getAdminDb();
    const pickSnapshot = await db.collection('officialPicks').doc(pickId).get();
    if (!pickSnapshot.exists || !['published', 'withdrawn'].includes(pickSnapshot.data().status)) return null;
    if (!pickForAudience(toPublicOfficialPick(pickSnapshot), audience)) return null;
    const eventsSnapshot = await pickSnapshot.ref.collection('events').orderBy('createdAt', 'asc').get();
    const [pick] = await attachOfficialPickReviewSummaries([withStakeRecommendation(toPublicOfficialPick(pickSnapshot))]);
    return {
        pick: pickForAudience(pick, audience),
        events: eventsSnapshot.docs.map(doc => {
            const event = toPublicOfficialPick(doc);
            return audience.canViewActiveDetails ? event : { type: event.type, createdAt: event.createdAt };
        })
    };
};
