import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TelegramRequestError,
    matchesConfiguredChat,
    publishOfficialPickToTelegram
} from '../api/_lib/telegram.js';
import {
    deliverTelegramAtMostOnce,
    deliverOfficialPickTelegramOnce
} from '../api/_lib/telegram-delivery.js';
import { publishOfficialPick } from '../api/_lib/official-picks.js';
import { queueOfficialPick, dispatchQueuedOfficialPick } from '../server/official-pick-queue.js';
import {
    ingestFutbolBrainOwnerCandidate,
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
        update: async (patch) => {
            if (!data.has(path)) throw new Error(`NOT_FOUND: No document at ${path}`);
            data.set(path, { ...data.get(path), ...patch });
        },
        delete: async () => {
            data.delete(path);
        }
    });

    const db = {
        collection: (name) => ({
            doc: (id) => createDocRef(`${name}/${id}`),
            where: () => ({
                where: () => ({
                    limit: () => ({
                        get: async () => ({ docs: [], size: 0 })
                    }),
                    orderBy: () => ({
                        limit: () => ({
                            get: async () => ({ docs: [], size: 0 })
                        })
                    })
                }),
                limit: () => ({
                    get: async () => ({ docs: [], size: 0 })
                })
            })
        }),
        runTransaction: async (fn) => {
            const transaction = {
                get: async (ref) => ref.get(),
                set: (ref, docData, options = {}) => {
                    if (options.merge && data.has(ref.path)) {
                        data.set(ref.path, { ...data.get(ref.path), ...docData });
                    } else {
                        data.set(ref.path, docData);
                    }
                },
                create: (ref, docData) => {
                    if (data.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`);
                    data.set(ref.path, docData);
                },
                update: (ref, patch) => {
                    if (!data.has(ref.path)) throw new Error(`NOT_FOUND: ${ref.path}`);
                    data.set(ref.path, { ...data.get(ref.path), ...patch });
                }
            };
            return fn(transaction);
        },
        _dump: () => Object.fromEntries(data.entries()),
        _has: (p) => data.has(p),
        _get: (p) => data.get(p)
    };

    return db;
};

// --- SUITE 1: matchesConfiguredChat ---
test('matchesConfiguredChat correctly accepts both @username and numeric ID', () => {
    // Exact username match
    assert.equal(matchesConfiguredChat('@canalmoneytips', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), true);

    // Case-insensitive username match
    assert.equal(matchesConfiguredChat('@CanalMoneyTips', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), true);

    // Exact numeric ID match
    assert.equal(matchesConfiguredChat('-1001478087155', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), true);

    // Mismatched username
    assert.equal(matchesConfiguredChat('@otherchannel', {
        id: -1001478087155,
        type: 'channel',
        username: 'canalmoneytips'
    }), false);

    // Non-channel type with username target fails closed
    assert.equal(matchesConfiguredChat('@canalmoneytips', {
        id: -1001478087155,
        type: 'group',
        username: 'canalmoneytips'
    }), false);

    // Invalid / missing chat
    assert.equal(matchesConfiguredChat('@canalmoneytips', null), false);
    assert.equal(matchesConfiguredChat('@canalmoneytips', { id: 0 }), false);
    assert.equal(matchesConfiguredChat('@canalmoneytips', { id: 'invalid' }), false);
    assert.equal(matchesConfiguredChat('', { id: -1001478087155 }), false);
});

// --- SUITE 2: publishOfficialPickToTelegram (transport & receipt extraction) ---
test('publishOfficialPickToTelegram validates chat destination and extracts receipt', async () => {
    const origEnv = { ...process.env };
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-1234567890';
    process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@canalmoneytips';
    process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME = 'canalmoneytips';

    const samplePick = {
        id: 'op_test_123',
        status: 'published',
        event: {
            homeTeam: 'Team A',
            awayTeam: 'Team B',
            competition: 'Champions League',
            kickoffAt: new Date(Date.now() + 3600000).toISOString()
        },
        source: { evidenceHash: '1234567890abcdef' }
    };

    const originalFetch = globalThis.fetch;
    try {
        // Case 1: Successful send returning numeric chat ID and message ID
        globalThis.fetch = async (url, options) => {
            assert.match(url, /sendMessage/);
            assert.equal(options.method, 'POST');
            const body = JSON.parse(options.body);
            assert.equal(body.chat_id, '@canalmoneytips');
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    ok: true,
                    result: {
                        message_id: 5241,
                        chat: { id: -1001478087155, type: 'channel', username: 'canalmoneytips' }
                    }
                })
            };
        };

        const receipt = await publishOfficialPickToTelegram(samplePick);
        assert.equal(receipt.configured, true);
        assert.equal(receipt.messageId, 5241);
        assert.equal(receipt.chatId, '-1001478087155');
        assert.equal(receipt.permalink, 'https://t.me/canalmoneytips/5241');

        // Case 2: Incomplete response (missing message_id)
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                result: { chat: { id: -1001478087155, type: 'channel', username: 'canalmoneytips' } }
            })
        });
        await assert.rejects(
            publishOfficialPickToTelegram(samplePick),
            (err) => err instanceof TelegramRequestError && err.definitelyNotSent === false
        );

        // Case 3: Destination chat mismatch
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                result: {
                    message_id: 5242,
                    chat: { id: -1009999999999, type: 'channel', username: 'otherchannel' }
                }
            })
        });
        await assert.rejects(
            publishOfficialPickToTelegram(samplePick),
            (err) => err instanceof TelegramRequestError && err.definitelyNotSent === false
        );

        // Case 4: Telegram definitive rejection (400 Bad Request)
        globalThis.fetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({ ok: false, description: 'Bad Request: chat not found' })
        });
        await assert.rejects(
            publishOfficialPickToTelegram(samplePick),
            (err) => err instanceof TelegramRequestError && err.definitelyNotSent === true
        );

        // Case 5: Telegram server error (500) -> ambiguous / uncertain
        globalThis.fetch = async () => ({
            ok: false,
            status: 500,
            json: async () => ({ ok: false })
        });
        await assert.rejects(
            publishOfficialPickToTelegram(samplePick),
            (err) => err instanceof TelegramRequestError && err.definitelyNotSent === false
        );

        // Case 6: Network timeout / abort
        globalThis.fetch = async () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        };
        await assert.rejects(
            publishOfficialPickToTelegram(samplePick),
            (err) => err instanceof TelegramRequestError && err.definitelyNotSent === false
        );
    } finally {
        globalThis.fetch = originalFetch;
        process.env = origEnv;
    }
});

// --- SUITE 3: deliverTelegramAtMostOnce ---
test('deliverTelegramAtMostOnce handles success, rejection, uncertainty, and receipt preservation', async () => {
    // 3.1 Happy path: anchors receipt
    {
        let claimed = false;
        let sent = false;
        let anchored = null;
        const result = await deliverTelegramAtMostOnce({
            claim: async () => { claimed = true; return true; },
            send: async () => { sent = true; return { configured: true, chatId: '-100', messageId: 101, permalink: 'https://t.me/101' }; },
            anchor: async (receipt) => { anchored = receipt; },
            markUncertain: async () => { throw new Error('MUST_NOT_BE_UNCERTAIN'); },
            markNotConfigured: async () => { throw new Error('MUST_NOT_CALL'); }
        });
        assert.equal(result.status, 'anchored');
        assert.equal(result.messageId, 101);
        assert.ok(claimed && sent && anchored);
        assert.equal(anchored.messageId, 101);
    }

    // 3.2 Network failure: marks uncertain, returns review_required, does NOT allow re-send
    {
        let uncertainReason = null;
        let sends = 0;
        let claimState = 'unclaimed';
        const executeDelivery = () => deliverTelegramAtMostOnce({
            claim: async () => {
                if (claimState !== 'unclaimed') return { status: claimState };
                claimState = 'claimed';
                return true;
            },
            send: async () => {
                sends++;
                throw new TelegramRequestError(false, 'ETIMEDOUT');
            },
            anchor: async () => { throw new Error('MUST_NOT_ANCHOR'); },
            markUncertain: async (reason) => {
                uncertainReason = reason;
                claimState = 'uncertain';
            },
            markNotConfigured: async () => {}
        });

        const first = await executeDelivery();
        assert.equal(first.status, 'review_required');
        assert.equal(uncertainReason, 'send_result_unknown');
        assert.equal(sends, 1);

        // Immediate retry attempt MUST NOT send to Telegram
        const second = await executeDelivery();
        assert.equal(second.status, 'review_required');
        assert.equal(sends, 1); // Strictly 1 send, zero duplicate
    }

    // 3.3 Anchor commit failure: preserves validated receipt inside delivery record
    {
        let uncertainReason = null;
        let preservedReceipt = null;
        let sends = 0;
        let claimState = 'unclaimed';

        const executeDelivery = () => deliverTelegramAtMostOnce({
            claim: async () => {
                if (claimState !== 'unclaimed') return { status: claimState };
                claimState = 'claimed';
                return true;
            },
            send: async () => {
                sends++;
                return { configured: true, chatId: '-100', messageId: 555, permalink: 'https://t.me/555' };
            },
            anchor: async () => {
                throw new Error('DEADLINE_EXCEEDED during Firestore transaction');
            },
            markUncertain: async (reason, receipt) => {
                uncertainReason = reason;
                preservedReceipt = receipt;
                claimState = 'uncertain';
            },
            markNotConfigured: async () => {}
        });

        const outcome = await executeDelivery();
        assert.equal(outcome.status, 'review_required');
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

// --- SUITE 5: End-to-end Morning Chrome candidate -> Ingest -> Queue -> Dispatch ---
test('End-to-end candidate ingest, queue dispatch, Telegram anchor, and strict deduplication', async () => {
    const origEnv = { ...process.env };
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-test';
    process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@canalmoneytips';
    process.env.TELEGRAM_PUBLIC_CHANNEL_USERNAME = 'canalmoneytips';
    delete process.env.MORNING_MODE; // Not in shadow mode for this unit test

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

        // Valid candidate format as sent by Morning Chrome extension
        const chromePayload = {
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

        // Queue simulation that calls deliverOfficialPickTelegramOnce
        const simulateQueuePick = async (candidate) => {
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

        // 1. Ingest via ingestFutbolBrainOwnerCandidate
        const ingestResult = await ingestFutbolBrainOwnerCandidate(chromePayload, {
            db,
            now,
            queuePick: simulateQueuePick
        });

        assert.equal(ingestResult.ok, true);
        assert.equal(ingestResult.state, 'published');
        assert.ok(ingestResult.pick);
        assert.equal(telegramCalls, 1);

        // Verify Firestore documents
        const queueEntry = db._get(`officialPickQueue/${ingestResult.queueId}`);
        assert.ok(queueEntry);
        assert.equal(queueEntry.status, 'published');
        assert.equal(queueEntry.telegramDeliveryStatus, 'anchored');

        const anchorDoc = db._get(`officialPicks/${ingestResult.pick.id}/events/telegram_anchor`);
        assert.ok(anchorDoc);
        assert.equal(anchorDoc.messageId, 8888);
        assert.equal(anchorDoc.chatId, '-1001478087155');

        // 2. Strict Deduplication: re-submitting identical candidate
        const duplicateIngest = await ingestFutbolBrainOwnerCandidate(chromePayload, {
            db,
            now,
            queuePick: simulateQueuePick
        });

        assert.equal(duplicateIngest.ok, true);
        assert.equal(duplicateIngest.state, 'already_published');
        // ZERO additional Telegram calls
        assert.equal(telegramCalls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        process.env = origEnv;
    }
});
