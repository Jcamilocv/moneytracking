import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SYSTEM_REGISTRY } from '../server/system-registry.js';
import { adaptMorningCandidate, toMorningQueueInput } from '../server/morning/candidate.js';
import { parseFutbolBrainKickoff } from '../server/morning/candidate.js';
import { normalizeOfficialPickInput, publicPickIdFor } from '../api/_lib/official-pick-data.js';
import { createMorningSourceClient, MorningSourceError } from '../server/morning/source-client.js';
import { createLocalShadowState } from '../server/morning/shadow-state.js';
import { createMorningShadowRunner, assertMorningShadow } from '../server/morning/shadow-runner.js';
import { nextMorningRun } from '../server/morning/schedule.js';
import { deliverTelegramAtMostOnce, deliverOfficialPickTelegramOnce } from '../api/_lib/telegram-delivery.js';
import { queueOfficialPick } from '../server/official-pick-queue.js';
import { recordPaperPick } from '../server/paper-picks.js';
import { publishOfficialPick } from '../api/_lib/official-picks.js';
import { publishOfficialPickToTelegram } from '../api/_lib/telegram.js';
import { dispatchOfficialPickAutoCopy } from '../server/official-pick-auto-copy.js';

const OBSERVED = '2026-10-07T07:00:00.000Z';
const sourceItem = ({ id = 'MT - ITA1 - V1.0', league, market, selection,
    odds = 1.8, kickoff = '2026-10-07T18:00:00', matchId = 731 } = {}) => {
    const definitions = {
        'MT - CHA EUR - V1.0': ['EUR-CHL', 'Both Teams To Score', 'No'],
        'MT - ENG2 - v1.0': ['ENG-CHA', 'Match Odds', 'Team 2 (FT)'],
        'MT - ITA1 - V1.0': ['ITA-SRA', 'Both Teams To Score', 'No'],
        'MT - Premier League 02.5': ['ENG-PRE', 'Over/Under 3.5', 'Under 3.5'],
        'MT - FRA1 FRA2 - V1.0': ['FRA-LG1', 'Total Goals', 'Over 2.5'],
        'MT-LAB-BTTS-ESP-v0.1': ['ESP-SEG', 'Both Teams To Score', 'Yes'],
        'MT - POR1 - v1.0': ['POR-PRI', 'Match Odds', 'Team 1 (FT)'],
        'MT - GER1 - v1.1': ['GER-BUN', 'Total Goals', 'Over 3.5'],
        'MT - TUR1 - V1.0': ['TUR-SUP', 'Match Odds', 'Team 2 (FT)']
    };
    const [defaultLeague, defaultMarket, defaultSelection] = Object.hasOwn(definitions, id)
        ? definitions[id] : ['ENG-CHA', 'Match Odds', 'Team 2 (FT)'];
    return {
        MatchId: matchId, SystemId: 21001, SystemName: id,
        League: { ShortName: league ?? defaultLeague },
        HomeTeam: { TeamName: 'Home FC' }, AwayTeam: { TeamName: 'Away FC' },
        DateOfMatch: kickoff, Probability: 0.72,
        TargetMarket: { MarketCategory: market ?? defaultMarket,
            MarketName: selection ?? defaultSelection, Odds: odds }
    };
};

test('all nine exact registry identifiers are recognized; unobserved market formats fail closed', () => {
    assert.equal(Object.keys(SYSTEM_REGISTRY).length, 9);
    for (const id of Object.keys(SYSTEM_REGISTRY)) {
        const result = adaptMorningCandidate(sourceItem({ id }), { observedAt: OBSERVED });
        if (id === 'MT - CHA EUR - V1.0') {
            assert.equal(result.validation.reason, 'UNVERIFIED_MARKET_TUPLE');
        } else if (['Both Teams To Score', 'Match Odds', 'Over/Under 3.5'].includes(
            sourceItem({ id }).TargetMarket.MarketCategory)
            && ['MT - CHA EUR - V1.0', 'MT - ENG2 - v1.0', 'MT - ITA1 - V1.0',
                'MT - Premier League 02.5', 'MT-LAB-BTTS-ESP-v0.1'].includes(id)) {
            assert.equal(result.validation.ok, true, `${id}: ${result.validation.reason}`);
        } else {
            assert.equal(result.validation.reason, 'MISSING_OR_UNKNOWN_MARKET');
        }
        assert.equal(result.candidate.systemId, id);
        assert.match(result.candidate.snapshotHash, /^[a-f0-9]{64}$/);
    }
    for (const id of ['UNKNOWN-SYSTEM', 'constructor', 'MT - ENG2 - v1.0**']) {
        assert.equal(adaptMorningCandidate(sourceItem({ id }), { observedAt: OBSERVED }).validation.reason, 'UNKNOWN_SYSTEM');
    }
});

test('observed ENG2 and Premier market tuples map exactly; near matches and unverified CHA/EUR fail closed', () => {
    const examples = [
        ['MT - ENG2 - v1.0', 'Match Odds', 'Team 2 (FT)', 'Away FT', 'Resultado final', 'Visitante'],
        ['MT - Premier League 02.5', 'Over/Under 3.5', 'Under 3.5', 'U 3.5 FT', 'Total de goles', 'Menos de 3,5 goles']
    ];
    for (const [id, category, name, shortName, market, selection] of examples) {
        const item = sourceItem({ id, market: category, selection: name });
        item.TargetMarket.MarketShortName = shortName;
        const accepted = adaptMorningCandidate(item, { observedAt: OBSERVED });
        assert.equal(accepted.validation.ok, true, `${id}: ${accepted.validation.reason}`);
        assert.equal(accepted.candidate.market, market);
        assert.equal(accepted.candidate.selection, selection);
        assert.equal(accepted.validation.league, item.League.ShortName);
        const future = structuredClone(item);
        future.DateOfMatch = '2026-10-08T18:00:00';
        assert.equal(adaptMorningCandidate(future, { observedAt: OBSERVED }).validation.reason,
            'NOT_TODAY_MADRID');
        const wrongCategory = structuredClone(item);
        wrongCategory.TargetMarket.MarketCategory = `${category} Extra`;
        assert.equal(adaptMorningCandidate(wrongCategory, { observedAt: OBSERVED }).validation.reason,
            'MISSING_OR_UNKNOWN_MARKET');
        const wrongSelection = structuredClone(item);
        wrongSelection.TargetMarket.MarketName = `${name} Extra`;
        wrongSelection.TargetMarket.MarketShortName = `${shortName} Extra`;
        assert.equal(adaptMorningCandidate(wrongSelection, { observedAt: OBSERVED }).validation.reason,
            'SELECTION_MISMATCH');
    }
    const unverified = sourceItem({ id: 'MT - CHA EUR - V1.0', market: 'Unverified European BTTS' });
    assert.equal(adaptMorningCandidate(unverified, { observedAt: OBSERVED }).validation.reason,
        'UNVERIFIED_MARKET_TUPLE');
    assert.equal(adaptMorningCandidate(sourceItem({ id: 'MT - CHA EUR - V1.0' }),
        { observedAt: OBSERVED }).validation.reason, 'UNVERIFIED_MARKET_TUPLE');
    // An observed ENG2 category is not a global alias for PAPER systems.
    assert.equal(adaptMorningCandidate(sourceItem({ id: 'MT - POR1 - v1.0' }),
        { observedAt: OBSERVED }).validation.reason, 'MISSING_OR_UNKNOWN_MARKET');
});

test('Morning rejects wrong league, market, selection, odds, kickoff, Madrid day and expired kickoff', () => {
    const cases = [
        [sourceItem({ league: 'ESP-SEG' }), 'LEAGUE_MISMATCH'],
        [sourceItem({ id: 'MT - ENG2 - v1.0', market: 'Both Teams To Score', selection: 'No' }), 'MARKET_MISMATCH'],
        [sourceItem({ selection: 'Yes' }), 'SELECTION_MISMATCH'],
        [sourceItem({ odds: null }), 'MISSING_ODDS'],
        [sourceItem({ odds: 1 }), 'INVALID_ODDS'],
        [sourceItem({ kickoff: null }), 'MISSING_KICKOFF'],
        [sourceItem({ kickoff: '2026-10-08T00:30:00' }), 'NOT_TODAY_MADRID'],
        [sourceItem({ kickoff: '2026-10-07T09:00:00' }), 'KICKOFF_EXPIRED']
    ];
    for (const [item, reason] of cases) {
        const result = adaptMorningCandidate(item, { observedAt: OBSERVED });
        assert.equal(result.validation.reason, reason);
    }
    const missingMatch = sourceItem(); delete missingMatch.MatchId;
    assert.equal(adaptMorningCandidate(missingMatch, { observedAt: OBSERVED }).validation.reason, 'MISSING_SOURCE_ID');
});

test('EARLY maps to the existing official queue contract; PAPER and T5 cannot map', () => {
    const early = adaptMorningCandidate(sourceItem(), { observedAt: OBSERVED });
    const normalized = normalizeOfficialPickInput(toMorningQueueInput(early));
    assert.match(publicPickIdFor(normalized), /^op_[a-f0-9]{40}$/);
    assert.equal(normalized.bet.selection, 'No');
    assert.equal(normalized.event.competition, 'ITA-SRA');
    for (const id of ['MT - POR1 - v1.0', 'MT-LAB-BTTS-ESP-v0.1']) {
        assert.throws(() => toMorningQueueInput(adaptMorningCandidate(sourceItem({ id }),
            { observedAt: OBSERVED })), /MORNING_NOT_OFFICIAL_ELIGIBLE/);
    }
});

test('unknown source fields are logged by name only; values never enter sanitized snapshot', () => {
    const item = sourceItem();
    item.NewProviderField = 'do-not-store-this-value';
    item.TargetMarket.NewMarketField = 'also-private';
    const { candidate } = adaptMorningCandidate(item, { observedAt: OBSERVED });
    assert.deepEqual(candidate.unknownFields, ['NewProviderField', 'TargetMarket.NewMarketField']);
    assert.equal(JSON.stringify(candidate.snapshot).includes('do-not-store-this-value'), false);
    assert.equal(JSON.stringify(candidate.snapshot).includes('also-private'), false);
});

test('Madrid day boundary and DST schedule are Europe/Madrid anchored', () => {
    const atBoundary = adaptMorningCandidate(sourceItem({ kickoff: '2026-10-07T00:30:00' }), {
        observedAt: '2026-10-06T22:10:00Z'
    });
    assert.equal(atBoundary.validation.ok, true);
    assert.equal(atBoundary.candidate.kickoffAt, '2026-10-06T22:30:00.000Z');
    assert.equal(nextMorningRun(new Date('2026-03-29T06:00:00Z')).toISOString(), '2026-03-29T08:00:00.000Z');
    assert.equal(nextMorningRun(new Date('2026-10-25T07:00:00Z')).toISOString(), '2026-10-25T09:00:00.000Z');
    assert.equal(nextMorningRun(new Date('2026-10-07T08:01:00Z')).toISOString(), '2026-10-07T11:00:00.000Z');
    assert.equal(nextMorningRun(new Date('2026-10-07T11:01:00Z')).toISOString(), '2026-10-07T14:00:00.000Z');
    assert.equal(parseFutbolBrainKickoff('2026-03-29T02:30:00'), null);
    assert.equal(parseFutbolBrainKickoff('2026-10-25T02:30:00'), null);
});

test('source client treats ActivePicksCount as independent metadata and rejects incomplete items', async () => {
    const body = { ActivePicksCount: 1, ResultsPicksViewModelItems: [sourceItem()] };
    const response = (value, status = 200, type = 'application/json') => new Response(value, {
        status, headers: { 'content-type': type }
    });
    const client = (transport) => createMorningSourceClient({
        baseUrl: 'https://application.futbolbrain.com/',
        sessionProvider: async () => ({ headers: { Cookie: 'never-log-this' } }),
        transport, clock: () => new Date(OBSERVED)
    });
    const normal = client(async () => response(JSON.stringify(body)));
    assert.equal((await normal.readActiveAlarms()).items.length, 1);
    for (const activePicksCount of [0, 1]) {
        const result = await client(async () => response(JSON.stringify({ ...body,
            ActivePicksCount: activePicksCount }))).readActiveAlarms();
        assert.equal(result.items.length, 1);
        assert.equal(result.activePicksCount, activePicksCount);
    }
    const multiple = await client(async () => response(JSON.stringify({ ...body,
        ActivePicksCount: 1, ResultsPicksViewModelItems: [sourceItem(), sourceItem({ matchId: 732 })]
    }))).readActiveAlarms();
    assert.equal(multiple.items.length, 2);
    assert.equal(multiple.activePicksCount, 1);
    const incomplete = sourceItem(); delete incomplete.TargetMarket.Odds;
    const failures = [
        [async () => response(JSON.stringify({ ...body, ResultsPicksViewModelItems: [sourceItem(), incomplete] })), 'PARTIAL_RESPONSE'],
        [async () => response(JSON.stringify([body])), 'PARTIAL_RESPONSE'],
        [async () => response(JSON.stringify({ ActivePicksCount: 0 })), 'PARTIAL_RESPONSE'],
        [async () => response(JSON.stringify({ ...body, ResultsPicksViewModelItems: Array.from({ length: 101 }, () => sourceItem()) })), 'PARTIAL_RESPONSE'],
        [async () => response(JSON.stringify({ ...body, ActivePicksCount: -1 })), 'PARTIAL_RESPONSE'],
        [async () => response('{}', 500), 'SOURCE_HTTP_ERROR'],
        [async () => response('{}', 401), 'AUTH_EXPIRED'],
        [async () => response('{}', 302), 'AUTH_EXPIRED'],
        [async () => response('{bad'), 'MALFORMED_JSON'],
        [async () => response('<html>login</html>', 200, 'text/html'), 'AUTH_EXPIRED']
    ];
    for (const [transport, code] of failures) {
        await assert.rejects(client(transport).readActiveAlarms(), (error) => error instanceof MorningSourceError && error.code === code);
    }
    const limited = createMorningSourceClient({ baseUrl: 'https://application.futbolbrain.com/',
        sessionProvider: async () => ({ headers: {} }), transport: async () => response(JSON.stringify(body)),
        clock: () => new Date(OBSERVED) });
    await limited.readActiveAlarms();
    await assert.rejects(limited.readActiveAlarms(), (error) => error.code === 'RATE_LIMITED');
    await assert.rejects(client(async () => { throw new DOMException('aborted', 'AbortError'); }).readActiveAlarms(),
        (error) => error.code === 'SOURCE_TIMEOUT');
    await assert.rejects(createMorningSourceClient({ baseUrl: 'https://application.futbolbrain.com/',
        sessionProvider: async () => { throw new Error('secret in provider error'); },
        transport: async () => { throw new Error('must not fetch'); } }).readActiveAlarms(),
    (error) => error.code === 'SESSION_UNAVAILABLE' && error.message === 'SESSION_UNAVAILABLE');
});

test('shadow firewall, EARLY/PAPER/T5 separation, virtual dedup, changed odds/kickoff, vanish and reboot recovery', async () => {
    assert.throws(() => assertMorningShadow('LIVE'), /FIREWALL/);
    const directory = await mkdtemp(join(tmpdir(), 'morning-shadow-'));
    const priorMode = process.env.MORNING_MODE;
    process.env.MORNING_MODE = 'SHADOW';
    try {
        const store = createLocalShadowState(join(directory, 'state.json'));
        let items = [sourceItem(), sourceItem({ id: 'MT - POR1 - v1.0', matchId: 732 }),
            sourceItem({ id: 'MT-LAB-BTTS-ESP-v0.1', matchId: 733 })];
        const runner = () => createMorningShadowRunner({
            sourceClient: { readActiveAlarms: async () => ({ items, observedAt: OBSERVED }) },
            stateStore: store, minIntervalMs: 0,
            reconcile: async () => ({ status: 'SPORTS_DATA_UNMATCHED' }) });
        const first = await runner().run();
        assert.deepEqual(first.diagnostics.map((entry) => entry.action), ['WOULD_QUEUE_OFFICIAL', 'REJECTED', 'IGNORED_T5']);
        assert.equal(first.diagnostics[1].reason, 'MISSING_OR_UNKNOWN_MARKET');
        assert.equal(first.externalWrites, 0); assert.equal(first.telegramMessages, 0);
        assert.equal(first.officialPicksCreated, 0);
        const second = await runner().run();
        assert.ok(second.diagnostics.every((entry) => entry.change === 'duplicate'));
        assert.equal(second.diagnostics[0].action, 'WOULD_DEDUP_OFFICIAL');
        assert.equal(second.diagnostics[1].action, 'REJECTED');
        items = [sourceItem({ odds: 1.9 }), sourceItem({ id: 'MT - POR1 - v1.0', matchId: 732,
            kickoff: '2026-10-07T19:00:00' })];
        const third = await runner().run();
        assert.equal(third.diagnostics[0].change, 'changed_odds');
        assert.equal(third.diagnostics[0].previousOdds, 1.8);
        assert.equal(third.diagnostics[0].currentOdds, 1.9);
        assert.equal(third.diagnostics[1].change, 'changed_kickoff');
        assert.equal(third.diagnostics[0].action, 'WOULD_DEDUP_OFFICIAL');
        assert.equal(third.diagnostics[1].action, 'REJECTED');
        assert.equal(third.diagnostics[2].action, 'VANISHED');
        assert.equal((await store.read()).observations['731|21001'].odds, 1.9);
        assert.equal((await store.read()).history.length, 3);
        items = [sourceItem({ matchId: 999, odds: 1.9 })];
        const fourth = await runner().run();
        assert.equal(fourth.diagnostics[0].change, 'new');
        assert.equal(fourth.diagnostics[0].action, 'WOULD_DEDUP_OFFICIAL');
    } finally {
        if (priorMode === undefined) delete process.env.MORNING_MODE;
        else process.env.MORNING_MODE = priorMode;
        await rm(directory, { recursive: true, force: true });
    }
});

test('durable claim prevents Telegram resend after send succeeds but anchor fails', async () => {
    let claimState = 'unclaimed'; let sends = 0; let anchorAttempts = 0;
    const delivery = () => deliverTelegramAtMostOnce({
        claim: async () => {
            if (claimState !== 'unclaimed') return { status: claimState };
            claimState = 'claimed'; return true;
        },
        send: async () => { sends++; return { configured: true, messageId: 99 }; },
        anchor: async () => { anchorAttempts++; throw new Error('simulated crash after Telegram success'); },
        markUncertain: async () => { claimState = 'uncertain'; },
        markNotConfigured: async () => { claimState = 'not_configured'; }
    });
    assert.equal((await delivery()).status, 'review_required');
    assert.equal((await delivery()).status, 'review_required');
    assert.equal(sends, 1); assert.equal(anchorAttempts, 1);
});

test('Firestore delivery claim and anchor prevent duplicate sends across retries', async () => {
    const documents = new Map();
    const ref = (path) => ({ path,
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
        get: async () => ({ exists: documents.has(path), data: () => documents.get(path) }),
        update: async (patch) => documents.set(path, { ...documents.get(path), ...patch })
    });
    let transactionCount = 0;
    let failAnchor = true;
    const db = { runTransaction: async (callback) => {
        transactionCount++;
        if (failAnchor && transactionCount === 2) throw new Error('commit unknown after send');
        return callback({
            get: (reference) => reference.get(),
            set: (reference, data) => documents.set(reference.path, data),
            update: (reference, patch) => documents.set(reference.path, { ...documents.get(reference.path), ...patch })
        });
    } };
    const pickRef = ref('officialPicks/op_1');
    const pick = { id: 'op_1' };
    let sends = 0;
    const send = async () => { sends++; return { configured: true, chatId: 'channel', messageId: 99, permalink: null }; };
    const first = await deliverOfficialPickTelegramOnce({ db, pickRef, pick, send, allowFreshClaim: true });
    assert.equal(first.status, 'review_required');
    assert.equal(documents.get('officialPicks/op_1/events/telegram_delivery').status, 'uncertain');
    failAnchor = false;
    const retry = await deliverOfficialPickTelegramOnce({ db, pickRef, pick, send });
    assert.equal(retry.status, 'review_required');
    assert.equal(sends, 1);

    const otherRef = ref('officialPicks/op_2');
    const success = await deliverOfficialPickTelegramOnce({ db, pickRef: otherRef,
        pick: { id: 'op_2' }, send, allowFreshClaim: true });
    assert.equal(success.status, 'anchored');
    assert.equal(documents.get('officialPicks/op_2/events/telegram_anchor').messageId, 99);
    await deliverOfficialPickTelegramOnce({ db, pickRef: otherRef,
        pick: { id: 'op_2' }, send });
    assert.equal(sends, 2);
    const legacy = await deliverOfficialPickTelegramOnce({ db, pickRef: ref('officialPicks/legacy'),
        pick: { id: 'legacy' }, send });
    assert.equal(legacy.status, 'review_required');
    assert.equal(sends, 2);
});

test('SHADOW blocks official queue, paper, publisher and Telegram before external I/O', async () => {
    const prior = process.env.MORNING_MODE;
    process.env.MORNING_MODE = 'SHADOW';
    try {
        for (const call of [
            () => queueOfficialPick({}), () => recordPaperPick({}),
            () => publishOfficialPick({}), () => publishOfficialPickToTelegram({}),
            () => dispatchOfficialPickAutoCopy({})
        ]) await assert.rejects(call(), /MORNING_SHADOW_MUTATION_BLOCKED/);
    } finally {
        if (prior === undefined) delete process.env.MORNING_MODE;
        else process.env.MORNING_MODE = prior;
    }
});
