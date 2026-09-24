import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    SYSTEM_REGISTRY,
    SYSTEM_EXECUTION_MODES,
    T5_TRANSPORT_STATUS,
    TELEGRAM_T5_MIGRATION
} from '../server/system-registry.js';
import {
    normalizeFutbolBrainOwnerCandidate,
    ingestFutbolBrainOwnerCandidate,
    FUTBOLBRAIN_OWNER_BROWSER_PROVIDER
} from '../server/futbolbrain-local-ingest.js';
import { isFutbolBrainTelegramIntakeEnabled } from '../server/futbolbrain-telegram-intake.js';
import { semanticOfficialPickKey, publicPickIdFor, normalizeOfficialPickInput } from '../api/_lib/official-pick-data.js';

// In-memory mock Firestore for end-to-end regression without network dependencies
const createRegressionDb = () => {
    const collections = new Map();

    const getCollectionMap = (name) => {
        if (!collections.has(name)) collections.set(name, new Map());
        return collections.get(name);
    };

    return {
        _collections: collections,
        collection: (colName) => ({
            doc: (docId) => {
                const colMap = getCollectionMap(colName);
                return {
                    id: docId,
                    get: async () => {
                        const data = colMap.get(docId);
                        return {
                            exists: Boolean(data),
                            id: docId,
                            data: () => data,
                            ref: {
                                collection: (subColName) => ({
                                    doc: (subDocId) => ({
                                        get: async () => {
                                            const subMap = getCollectionMap(`${colName}/${docId}/${subColName}`);
                                            const subData = subMap.get(subDocId);
                                            return { exists: Boolean(subData), id: subDocId, data: () => subData };
                                        },
                                        set: async (d) => {
                                            const subMap = getCollectionMap(`${colName}/${docId}/${subColName}`);
                                            subMap.set(subDocId, d);
                                        }
                                    })
                                })
                            }
                        };
                    },
                    set: async (data, opts = {}) => {
                        if (opts.merge && colMap.has(docId)) {
                            colMap.set(docId, { ...colMap.get(docId), ...data });
                        } else {
                            colMap.set(docId, data);
                        }
                    },
                    update: async (data) => {
                        colMap.set(docId, { ...(colMap.get(docId) || {}), ...data });
                    },
                    collection: (subColName) => ({
                        doc: (subDocId) => ({
                            id: subDocId,
                            get: async () => {
                                const subMap = getCollectionMap(`${colName}/${docId}/${subColName}`);
                                const subData = subMap.get(subDocId);
                                return { exists: Boolean(subData), id: subDocId, data: () => subData };
                            },
                            set: async (subData) => {
                                const subMap = getCollectionMap(`${colName}/${docId}/${subColName}`);
                                subMap.set(subDocId, subData);
                            }
                        })
                    })
                };
            },
            where: (field, op, val) => ({
                limit: () => ({
                    get: async () => {
                        const colMap = getCollectionMap(colName);
                        const docs = [];
                        for (const [id, data] of colMap.entries()) {
                            if (data[field] === val) {
                                docs.push({ id, data: () => data });
                            }
                        }
                        return { docs, size: docs.length };
                    }
                })
            })
        }),
        runTransaction: async (txHandler) => {
            const tx = {
                get: async (docRef) => docRef.get(),
                set: async (docRef, data, opts) => docRef.set(data, opts),
                create: (docRef, data) => docRef.set(data),
                update: (docRef, data) => docRef.update(data)
            };
            return await txHandler(tx);
        }
    };
};

test('Regression Item 8: Chrome Extension v0.2.11 files are strictly preserved in canonical production form', () => {
    const extensionDir = resolve(process.cwd(), '../futbolbrain-local-alert-pilot');
    const manifest = JSON.parse(readFileSync(resolve(extensionDir, 'manifest.json'), 'utf8'));
    const background = readFileSync(resolve(extensionDir, 'background.js'), 'utf8');
    const content = readFileSync(resolve(extensionDir, 'content.js'), 'utf8');

    // 1. Manifest must be v0.2.11 with only storage permissions (no alarms)
    assert.equal(manifest.version, '0.2.11');
    assert.deepEqual(manifest.permissions, ['storage']);

    // 2. Background script must be simple bridge (no midnight scheduling alarms)
    assert.doesNotMatch(background, /chrome\.alarms/);
    assert.doesNotMatch(background, /money-tips-midnight-scan/);
    assert.match(background, /money-tips-submit-pick/);

    // 3. Content script SYSTEMS must contain ONLY the 6 approved production systems
    assert.match(content, /'MT - CHA EUR - V1\.0': \{ mode: 'AL_RECIBIR'/);
    assert.match(content, /'MT - ENG2 - v1\.0': \{ mode: 'AL_RECIBIR'/);
    assert.match(content, /'MT - ITA1 - V1\.0': \{ mode: 'AL_RECIBIR'/);
    assert.match(content, /'MT - Premier League 02.5': \{ mode: 'AL_RECIBIR'/);
    assert.match(content, /'MT - FRA1 FRA2 - V1\.0': \{ mode: 'T_MINUS_5'/);
    assert.match(content, /'MT-LAB-BTTS-ESP-v0.1': \{ mode: 'T_MINUS_5'/);

    // Paper systems must NOT be in the extension SYSTEMS list
    assert.doesNotMatch(content, /'MT - POR1 - v1\.0'/);
    assert.doesNotMatch(content, /'MT - GER1 - v1\.1'/);
    assert.doesNotMatch(content, /'MT - TUR1 - V1\.0'/);

    // Local T-5 countdown must be intact
    assert.match(content, /now < pick\.kickoffAt\.getTime\(\) - 5 \* 60 \* 1000/);
});

test('Regression Items 1-7: Full Legacy T-5 End-to-End Simulation (MT - FRA1 FRA2 - V1.0)', async () => {
    const mockDb = createRegressionDb();
    const kickoffAt = new Date('2026-09-18T18:00:00.000Z');
    // Received at exactly T-5 minutes (17:55:00)
    const receiptTime = new Date('2026-09-18T17:55:00.000Z');

    // Candidate as formed by Chrome Extension v0.2.8
    const chromePayload = {
        event: {
            sourceEventId: 'fb-own-test-fra-123',
            competition: 'FRA-Ligue 1',
            homeTeam: 'Lyon',
            awayTeam: 'Marseille',
            kickoffAt: kickoffAt.toISOString()
        },
        system: { id: 'MT - FRA1 FRA2 - V1.0' },
        visiblePick: { selection: 'Over 2.5', odds: '1.85' },
        source: { provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER, observedAt: receiptTime.toISOString() }
    };

    let telegramSent = false;
    let telegramPayload = null;
    const mockPublishTelegram = async (pick) => {
        telegramSent = true;
        telegramPayload = pick;
        return { configured: true, messageId: 998877, chatId: -100123456789, permalink: 'https://t.me/c/123/998877' };
    };

    // Simulated queue dispatcher that integrates with mockDb and mock Telegram
    const simulateQueuePick = async (candidate, { now }) => {
        // 1. Normalize
        const normalized = normalizeOfficialPickInput(candidate);
        const pickId = publicPickIdFor(normalized);

        // Check if already published (idempotency)
        const officialCol = mockDb._collections.get('officialPicks') || new Map();
        if (officialCol.has(pickId)) {
            return { created: false, state: 'already_published', queueId: pickId, pick: officialCol.get(pickId) };
        }

        // Write to officialPickQueue
        const queueCol = mockDb.collection('officialPickQueue');
        await queueCol.doc(pickId).set({
            ...normalized,
            status: 'queued',
            scheduledAt: normalized.scheduledAt,
            nextAttemptAt: normalized.scheduledAt
        });

        // 3. Confirm: no retrasa nuevamente el pick si ya llegó a T-5 (scheduledAt <= now)
        assert.ok(normalized.scheduledAt <= now, 'El pick ya llegó a su ventana T-5, scheduledAt <= now');

        // Dispatches immediately to officialPick
        await queueCol.doc(pickId).update({ status: 'dispatching' });

        // Save official pick
        await mockDb.collection('officialPicks').doc(pickId).set({
            ...normalized,
            publishedAt: now.toISOString()
        });
        await mockDb.collection('officialPicks').doc(pickId).collection('events').doc('published').set({
            type: 'published',
            createdAt: now.toISOString()
        });

        // Publish to Telegram
        await mockPublishTelegram(normalized);
        await mockDb.collection('officialPicks').doc(pickId).collection('events').doc('telegram_anchor').set({
            type: 'telegram_anchor',
            messageId: 998877
        });

        // Update queue to published
        await queueCol.doc(pickId).update({ status: 'published', officialPickId: pickId });

        return {
            created: true,
            state: 'published',
            queueId: pickId,
            pick: normalized
        };
    };

    // EXECUTE INGEST
    const result = await ingestFutbolBrainOwnerCandidate(chromePayload, {
        db: mockDb,
        now: receiptTime,
        queuePick: simulateQueuePick
    });

    // ─── VERIFICATIONS ───

    // Check 1: no crea ni espera officialPickPreflight
    const preflightCol = mockDb._collections.get('officialPickPreflight');
    assert.equal(preflightCol?.size || 0, 0, 'No debe existir ningún documento en officialPickPreflight');

    // Check 2: no consulta Telegram inbound
    assert.equal(isFutbolBrainTelegramIntakeEnabled(), false, 'Telegram inbound debe estar desactivado');

    // Check 3: no retrasa nuevamente el pick tras recibirlo a T-5
    assert.equal(result.state, 'published', 'El pick debe publicarse inmediatamente al recibirse a T-5');
    assert.equal(result.ok, true);

    // Check 4: no cambia mercado/selección/cuota recibida
    assert.equal(result.pick.bet.market, 'Total de goles');
    assert.equal(result.pick.bet.selection, 'Más de 2,5 goles');
    assert.equal(result.pick.bet.oddsAtPublication, 1.85);

    // Check 5: aplica el stake esperado (cuota 1.85 en producción controlada: factor 0.75 * base 1.0 = 0.75%)
    assert.equal(result.pick.bet.recommendedStakePct, 0.75);
    assert.equal(result.pick.bet.confidenceFactor, 0.75);
    assert.equal(result.pick.bet.baseStakePct, 1.0);

    // Check 6: mantiene idempotencia absoluta
    const duplicateResult = await ingestFutbolBrainOwnerCandidate(chromePayload, {
        db: mockDb,
        now: new Date(receiptTime.getTime() + 10_000), // 10 segundos después
        queuePick: simulateQueuePick
    });
    assert.equal(duplicateResult.state, 'already_published', 'Segundo envío debe ser detectado como duplicado');
    assert.equal(duplicateResult.ok, true);
    assert.equal(duplicateResult.queueId, result.queueId);

    // Check 7: termina en el mismo publicador Telegram existente
    assert.equal(telegramSent, true, 'Debe haber llamado a publishOfficialPickToTelegram');
    assert.equal(telegramPayload.event.homeTeam, 'Lyon');
    assert.equal(telegramPayload.event.awayTeam, 'Marseille');
});

test('EARLY REGRESSION: Sistema MT - Premier League 02.5 se publica inmediatamente tras medianoche', async () => {
    const earlyCandidate = {
        event: {
            sourceEventId: 'fb-own-test-early-456',
            competition: 'ENG-Premier League',
            homeTeam: 'Arsenal',
            awayTeam: 'Chelsea',
            kickoffAt: '2026-09-18T16:00:00.000Z'
        },
        system: { id: 'MT - Premier League 02.5' },
        visiblePick: { selection: 'Under 3.5', odds: '1.45' },
        source: { provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER, observedAt: '2026-09-18T08:00:00.000Z' }
    };

    const normalized = normalizeFutbolBrainOwnerCandidate(earlyCandidate, { now: new Date('2026-09-18T08:00:00.000Z') });
    assert.equal(normalized.publicationPolicy, 'immediate');
    assert.equal(normalized.bet.market, 'Total de goles');
    assert.equal(normalized.bet.selection, 'Menos de 3,5 goles');
    assert.equal(normalized.bet.recommendedStakePct, 0.75); // base 1.0 * factor 0.75
});

test('PAPER SERVER CAPABILITY: Sistema PAPER se registra con stake 0% y queda aislado', async () => {
    const paperCandidate = {
        event: {
            sourceEventId: 'fb-own-test-paper-789',
            competition: 'POR-Primeira Liga',
            homeTeam: 'Benfica',
            awayTeam: 'Porto',
            kickoffAt: '2026-09-18T20:30:00.000Z'
        },
        system: { id: 'MT - POR1 - v1.0' },
        visiblePick: { selection: 'Team 1 (FT)', odds: '2.10' },
        source: { provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER, observedAt: '2026-09-18T10:00:00.000Z' }
    };

    const normalized = normalizeFutbolBrainOwnerCandidate(paperCandidate, { now: new Date('2026-09-18T10:00:00.000Z') });
    assert.equal(normalized.executionMode, SYSTEM_EXECUTION_MODES.PAPER);
    assert.equal(normalized.bet.recommendedStakePct, 0.0);
    assert.equal(normalized.bet.confidenceFactor, 0.0);
});
