import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TelegramRequestError,
    matchesConfiguredChat,
    publishOfficialPickToTelegram
} from '../api/lib/telegram.js';
import {
    deliverTelegramAtMostOnce,
    deliverOfficialPickTelegramOnce
} from '../api/lib/_telegram-delivery.js';
import {
    normalizeFutbolBrainOwnerCandidate,
    FUTBOLBRAIN_OWNER_BROWSER_PROVIDER
} from '../server/futbolbrain-local-ingest.js';

// --- MOCK IN-MEMORY FIRESTORE ---
const createMockFirestore = () => {
    const data = new Map();

    const createDocRef = (path) => ({
        path,
        id: path.split('/').pop(),
        collection: (subName) => ({
            doc: (subId) => createDocRef(`${path}/${subName}/${subId}`),
            get: async () => {
                const prefix = `${path}/${subName}/`;
                const docs = [];
                for (const [key, val] of data.entries()) {
                    if (key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') === -1) {
                        docs.push({ id: key.split('/').pop(), exists: true, data: () => val, ref: createDocRef(key) });
                    }
                }
                return { docs, size: docs.length, empty: docs.length === 0 };
            }
        }),
        get: async () => ({
            exists: data.has(path),
            data: () => data.get(path),
            ref: createDocRef(path),
            id: path.split('/').pop()
        }),
        set: async (docData, options = {}) => {
            if (options.merge && data.has(path)) {
                data.set(path, { ...data.get(path), ...docData });
            } else {
                data.set(path, docData);
            }
        },
        update: async (docData) => {
            const current = data.get(path) || {};
            data.set(path, { ...current, ...docData });
        }
    });

    return {
        _data: data,
        _get: (path) => data.get(path),
        collection: (colName) => ({
            doc: (docId) => createDocRef(`${colName}/${docId}`)
        }),
        runTransaction: async (txCallback) => {
            const tx = {
                get: async (ref) => ref.get(),
                set: (ref, docData, opts) => ref.set(docData, opts),
                update: (ref, docData) => ref.update(docData)
            };
            return txCallback(tx);
        }
    };
};

// --- SUITE 1: matchesConfiguredChat ---
test('matchesConfiguredChat correctly accepts both @username and numeric ID', () => {
    // 1. Matches when configured is @username (case-insensitive)
    assert.equal(matchesConfiguredChat('@canalmoneytips', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), true);

    assert.equal(matchesConfiguredChat('@CanalMoneyTips', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), true);

    assert.equal(matchesConfiguredChat('@canalmoneytips', {
        id: -1001478087155,
        type: 'channel',
        username: 'CanalMoneyTips'
    }), true);

    // 2. Matches when configured is numeric ID string
    assert.equal(matchesConfiguredChat('-1001478087155', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), true);

    // 3. Rejects username mismatch
    assert.equal(matchesConfiguredChat('@otherchannel', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), false);

    // 4. Rejects numeric ID mismatch
    assert.equal(matchesConfiguredChat('-1009999999999', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), false);

    // 5. Rejects non-channel if configured with @
    assert.equal(matchesConfiguredChat('@somegroup', {
        id: -1001478087155,
        type: 'supergroup',
        username: 'somegroup'
    }), false);

    // 6. Null / undefined / invalid inputs safe handling
    assert.equal(matchesConfiguredChat(null, { id: 123 }), false);
    assert.equal(matchesConfiguredChat('', { id: 123 }), false);
    assert.equal(matchesConfiguredChat('@channel', null), false);
    assert.equal(matchesConfiguredChat('@channel', { id: 0 }), false);
    assert.equal(matchesConfiguredChat('@channel', { id: 'invalid' }), false);
});

// --- SUITE 2: publishOfficialPickToTelegram Destination Validation & Receipts ---
test('publishOfficialPickToTelegram validates chat destination and extracts receipt', async () => {
    const origEnv = { ...process.env };
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-12345';
    process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@canalmoneytips';
    process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME = 'canalmoneytips';

    const samplePick = {
        id: 'op_test_123',
        status: 'published',
        event: {
            homeTeam: 'Union Saint-Gilloise',
            awayTeam: 'Real Sociedad',
            competition: 'EUR-EUL',
            kickoffAt: '2026-10-15T16:45:00.000Z'
        },
        source: { evidenceHash: 'abc123hash' }
    };

    const originalFetch = globalThis.fetch;

    try {
        // Test 2.1: Success case where Telegram returns numeric chat.id and username matching @canalmoneytips
        globalThis.fetch = async (url, options) => {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    ok: true,
                    result: {
                        message_id: 5241,
                        chat: {
                            id: -1001478087155,
                            type: 'channel',
                            title: 'Money Tips Canal Oficial',
                            username: 'canalmoneytips'
                        },
                        date: 1729000000
                    }
                })
            };
        };

        const result = await publishOfficialPickToTelegram(samplePick);
        assert.equal(result.configured, true);
        assert.equal(result.chatId, '-1001478087155');
        assert.equal(result.messageId, 5241);
        assert.equal(result.permalink, 'https://t.me/canalmoneytips/5241');

        // Test 2.2: Telegram returns chat mismatch -> must throw TelegramRequestError(false)
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                result: {
                    message_id: 5242,
                    chat: {
                        id: -1009999999999,
                        type: 'channel',
                        username: 'differentchannel'
                    }
                }
            })
        });

        await assert.rejects(
            async () => publishOfficialPickToTelegram(samplePick),
            (err) => {
                assert.equal(err.name, 'TelegramRequestError');
                assert.equal(err.definitelyNotSent, false);
                return true;
            }
        );

        // Test 2.3: Telegram returns HTTP 400 Bad Request (e.g. Chat not found) -> definitelyNotSent = true
        globalThis.fetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({
                ok: false,
                error_code: 400,
                description: 'Bad Request: chat not found'
            })
        });

        await assert.rejects(
            async () => publishOfficialPickToTelegram(samplePick),
            (err) => {
                assert.equal(err.name, 'TelegramRequestError');
                assert.equal(err.definitelyNotSent, true);
                return true;
            }
        );

        // Test 2.4: Network transport failure -> definitelyNotSent = false
        globalThis.fetch = async () => {
            throw new Error('Connection timeout to api.telegram.org');
        };

        await assert.rejects(
            async () => publishOfficialPickToTelegram(samplePick),
            (err) => {
                assert.equal(err.name, 'TelegramRequestError');
                assert.equal(err.definitelyNotSent, false);
                return true;
            }
        );
    } finally {
        globalThis.fetch = originalFetch;
        process.env = origEnv;
    }
});

// --- SUITE 3: deliverTelegramAtMostOnce Safety, Uncertainty & Receipt Preservation ---
test('deliverTelegramAtMostOnce handles success, rejection, uncertainty, and receipt preservation', async () => {
    // 3.1: Normal success flow
    {
        let claimCalled = false;
        let anchoredReceipt = null;
        const outcome = await deliverTelegramAtMostOnce({
            claim: async () => { claimCalled = true; return true; },
            send: async () => ({ configured: true, chatId: '-1001478087155', messageId: 1001 }),
            anchor: async (receipt) => { anchoredReceipt = receipt; },
            markUncertain: async () => { assert.fail('Should not mark uncertain'); },
            markNotConfigured: async () => { assert.fail('Should not mark not configured'); },
            markRejected: async () => { assert.fail('Should not mark rejected'); }
        });

        assert.equal(claimCalled, true);
        assert.equal(outcome.status, 'anchored');
        assert.equal(outcome.messageId, 1001);
        assert.deepEqual(anchoredReceipt, { configured: true, chatId: '-1001478087155', messageId: 1001 });
    }

    // 3.2: Definitive 4xx rejection (definitelyNotSent = true) -> status: retryable
    {
        let rejectedMarked = false;
        let uncertainMarked = false;
        const outcome = await deliverTelegramAtMostOnce({
            claim: async () => true,
            send: async () => { throw new TelegramRequestError(true, 'Chat not found'); },
            anchor: async () => { assert.fail('Should not anchor'); },
            markUncertain: async () => { uncertainMarked = true; },
            markNotConfigured: async () => { assert.fail('Should not mark not configured'); },
            markRejected: async () => { rejectedMarked = true; }
        });

        assert.equal(rejectedMarked, true);
        assert.equal(uncertainMarked, false);
        assert.equal(outcome.status, 'retryable');
    }

    // 3.3: Network error during send (definitelyNotSent = false) -> status: review_required
    {
        let uncertainReason = null;
        const outcome = await deliverTelegramAtMostOnce({
            claim: async () => true,
            send: async () => { throw new TelegramRequestError(false, 'Network abort'); },
            anchor: async () => { assert.fail('Should not anchor'); },
            markUncertain: async (reason) => { uncertainReason = reason; },
            markNotConfigured: async () => { assert.fail('Should not mark not configured'); },
            markRejected: async () => { assert.fail('Should not mark rejected'); }
        });

        assert.equal(uncertainReason, 'send_result_unknown');
        assert.equal(outcome.status, 'review_required');
    }

    // 3.4: Send succeeded, but anchor to Firestore failed -> preserves receipt, returns review_required
    {
        let preservedReceipt = null;
        let uncertainReason = null;
        let sends = 0;

        const executeDelivery = () => deliverTelegramAtMostOnce({
            claim: async () => (sends === 0 ? true : { status: 'uncertain' }),
            send: async () => {
                sends++;
                return { configured: true, chatId: '-100', messageId: 555, permalink: 'https://t.me/555' };
            },
            anchor: async () => { throw new Error('Firestore transaction aborted'); },
            markUncertain: async (reason, receipt) => {
                uncertainReason = reason;
                preservedReceipt = receipt;
            },
            markNotConfigured: async () => {},
            markRejected: async () => {}
        });

        const initialOutcome = await executeDelivery();
        assert.equal(initialOutcome.status, 'review_required');
        assert.equal(uncertainReason, 'send_succeeded_anchor_unknown');
        assert.deepEqual(preservedReceipt, {
            configured: true,
            chatId: '-100',
            messageId: 555,
            permalink: 'https://t.me/555'
        });
        assert.equal(sends, 1);

        // Retry must not re-send
        const retryOutcome = await executeDelivery();
        assert.equal(retryOutcome.status, 'review_required');
        assert.equal(sends, 1);
    }
});

// --- SUITE 4: deliverOfficialPickTelegramOnce with In-Memory Database ---
test('deliverOfficialPickTelegramOnce persists anchor and prevents duplicate sends', async () => {
    const db = createMockFirestore();
    const pickRef = db.collection('officialPicks').doc('op_unit_001');
    const pick = { id: 'op_unit_001' };

    let sends = 0;
    const sendFn = async () => {
        sends++;
        return {
            configured: true,
            chatId: '-1001478087155',
            messageId: 7777,
            permalink: 'https://t.me/canalmoneytips/7777'
        };
    };

    // 1. Initial successful delivery
    const deliveryResult = await deliverOfficialPickTelegramOnce({
        db,
        pickRef,
        pick,
        send: sendFn,
        allowFreshClaim: true
    });

    assert.equal(deliveryResult.status, 'anchored');
    assert.equal(deliveryResult.messageId, 7777);
    assert.equal(sends, 1);

    // Verify Firestore document contents
    const anchorDoc = db._get('officialPicks/op_unit_001/events/telegram_anchor');
    assert.ok(anchorDoc);
    assert.equal(anchorDoc.type, 'telegram_anchor');
    assert.equal(anchorDoc.chatId, '-1001478087155');
    assert.equal(anchorDoc.messageId, 7777);
    assert.equal(anchorDoc.permalink, 'https://t.me/canalmoneytips/7777');

    const deliveryDoc = db._get('officialPicks/op_unit_001/events/telegram_delivery');
    assert.ok(deliveryDoc);
    assert.equal(deliveryDoc.status, 'anchored');
    assert.equal(deliveryDoc.attempts, 1);

    // 2. Second delivery call on the SAME pick: MUST be deduplicated
    const secondCall = await deliverOfficialPickTelegramOnce({
        db,
        pickRef,
        pick,
        send: sendFn,
        allowFreshClaim: false
    });

    assert.equal(secondCall.status, 'anchored');
    assert.equal(sends, 1); // ZERO additional Telegram calls
});

// --- SUITE 5: End-to-end candidate normalization, queue dispatch, Telegram anchor, and strict deduplication ---
test('End-to-end candidate normalization, queue dispatch, Telegram anchor, and strict deduplication', async () => {
    const origEnv = { ...process.env };
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-test';
    process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@canalmoneytips';
    process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME = 'canalmoneytips';

    const originalFetch = globalThis.fetch;
    let telegramCalls = 0;
    globalThis.fetch = async (url, options) => {
        telegramCalls++;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                result: {
                    message_id: 8888,
                    chat: { id: -1001478087155, type: 'channel', username: 'canalmoneytips' }
                }
            })
        };
    };

    try {
        const db = createMockFirestore();
        const now = new Date('2026-10-15T12:00:00Z');
        const kickoffAt = new Date('2026-10-15T18:45:00Z');

        // Candidate format from browser extension
        const rawPayload = {
            source: {
                provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER,
                observedAt: now.toISOString()
            },
            system: {
                id: 'MT - CHA EUR - V1.0'
            },
            event: {
                sourceEventId: 'uefa:test-001',
                competition: 'EUR-EUL',
                homeTeam: 'Union Saint-Gilloise',
                awayTeam: 'Real Sociedad',
                kickoffAt: kickoffAt.toISOString()
            },
            visiblePick: {
                selection: 'No',
                odds: '2.62'
            }
        };

        // 1. Normalize candidate
        const normalized = normalizeFutbolBrainOwnerCandidate(rawPayload, { now });
        assert.equal(normalized.event.homeTeam, 'Union Saint-Gilloise');
        assert.equal(normalized.bet.selection, 'No');
        assert.equal(normalized.publicationPolicy, 'immediate');

        // 2. Queue & Dispatch simulation
        const simulateQueueAndDispatch = async (candidate) => {
            const pickId = 'pick_e2e_test_001';
            const existingPick = db._get(`officialPicks/${pickId}`);
            if (existingPick) {
                return {
                    created: false,
                    state: 'already_published',
                    queueId: pickId,
                    pick: existingPick
                };
            }

            const queueDoc = {
                id: pickId,
                status: 'dispatching',
                event: candidate.event,
                bet: candidate.bet,
                system: candidate.system
            };
            await db.collection('officialPickQueue').doc(pickId).set(queueDoc);

            const pickData = { id: pickId, ...candidate, publishedAt: now.toISOString() };
            await db.collection('officialPicks').doc(pickId).set(pickData);
            await db.collection('officialPicks').doc(pickId).collection('events').doc('published').set({
                type: 'published',
                createdAt: now.toISOString()
            });

            const pickRef = db.collection('officialPicks').doc(pickId);
            const deliveryResult = await deliverOfficialPickTelegramOnce({
                db,
                pickRef,
                pick: pickData,
                send: () => publishOfficialPickToTelegram(pickData),
                allowFreshClaim: true
            });

            const queueStatus = deliveryResult.status === 'anchored' ? 'published' : 'review_required';
            const telStatus = deliveryResult.status === 'anchored' ? 'anchored' : deliveryResult.status;
            await db.collection('officialPickQueue').doc(pickId).set({
                ...queueDoc,
                status: queueStatus,
                telegramDeliveryStatus: telStatus
            });

            return {
                created: true,
                state: queueStatus,
                queueId: pickId,
                pick: pickData
            };
        };

        const result = await simulateQueueAndDispatch(normalized);
        assert.equal(result.created, true);
        assert.equal(result.state, 'published');
        assert.equal(telegramCalls, 1);

        // Verify Firestore documents
        const queueEntry = db._get(`officialPickQueue/${result.queueId}`);
        assert.ok(queueEntry);
        assert.equal(queueEntry.status, 'published');
        assert.equal(queueEntry.telegramDeliveryStatus, 'anchored');

        const anchorDoc = db._get(`officialPicks/${result.pick.id}/events/telegram_anchor`);
        assert.ok(anchorDoc);
        assert.equal(anchorDoc.messageId, 8888);
        assert.equal(anchorDoc.chatId, '-1001478087155');

        // 3. Strict Deduplication: re-submitting identical candidate
        const duplicateResult = await simulateQueueAndDispatch(normalized);
        assert.equal(duplicateResult.created, false);
        assert.equal(duplicateResult.state, 'already_published');
        // ZERO additional Telegram calls
        assert.equal(telegramCalls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        process.env = origEnv;
    }
});
