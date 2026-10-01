import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { morningSlotKey, claimMorningSlot, appendBoundedMorningLog } from '../server/morning/one-shot.js';
import { summarizeMorningRun } from '../server/morning/telemetry.js';
import { morningRuntimeFiles } from '../scripts/morning-shadow-runtime.mjs';

test('Madrid slots are DST-safe, have a short admission window and cannot be reclaimed after restart', async () => {
    assert.equal(morningSlotKey(new Date('2026-03-29T08:00:00Z')), '2026-03-29T10:00 Europe/Madrid');
    assert.equal(morningSlotKey(new Date('2026-10-25T09:00:00Z')), '2026-10-25T10:00 Europe/Madrid');
    assert.equal(morningSlotKey(new Date('2026-10-07T08:03:00Z')), null);
    assert.equal(morningSlotKey(new Date('2026-10-07T09:00:00Z')), null);
    const directory = await mkdtemp(join(tmpdir(), 'morning-slots-'));
    try {
        const path = join(directory, 'slots.json');
        assert.equal(await claimMorningSlot(path, 'slot-1'), true);
        assert.equal(await claimMorningSlot(path, 'slot-1'), false);
        assert.equal(await claimMorningSlot(path, 'slot-2'), true);
        assert.equal(JSON.parse(await readFile(path, 'utf8')).slots.length, 2);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('one-shot refuses non-Shadow mode before any source request', () => {
    const result = spawnSync(process.execPath, ['server/morning/run-shadow.mjs', '--smoke'], {
        cwd: resolve('.'), encoding: 'utf8', env: { MORNING_MODE: 'LIVE' }
    });
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.requests, 0);
    assert.equal(output.errorCode, 'MORNING_SHADOW_FIREWALL');
});

test('sanitized telemetry contains only aggregates and technical CHA/EUR evidence', () => {
    const items = [{
        SystemName: 'MT - CHA EUR - V1.0', DateOfMatch: '2026-10-08T18:00:00',
        HomeTeam: { TeamName: 'PRIVATE TEAM' }, MatchId: 'PRIVATE ID', Probability: 'PRIVATE VALUE',
        TargetMarket: { MarketCategory: 'Synthetic BTTS', MarketName: 'No', MarketShortName: 'No', Odds: 'PRIVATE ODDS' }
    }];
    const report = summarizeMorningRun(items, [{ action: 'REJECTED', reason: 'UNVERIFIED_MARKET_TUPLE' }],
        '2026-10-07T08:00:00Z');
    assert.equal(report.futureCount, 1);
    assert.equal(report.classification.EARLY, 1);
    assert.equal(report.validMorningCandidates, 0);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
    assert.equal(report.unverifiedMarketTuples[0].category, 'Synthetic BTTS');
    assert.equal(report.firestoreWrites + report.bankWrites + report.telegramSends + report.paperWrites + report.officialPicks, 0);
});

test('bounded log rotates and Shadow artifact excludes all write modules and external packages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morning-log-'));
    try {
        const path = join(directory, 'runs.jsonl');
        await appendBoundedMorningLog(path, { result: 'PASS' });
        assert.equal(JSON.parse(await readFile(path, 'utf8')).result, 'PASS');
        await appendBoundedMorningLog(path, { padding: 'x'.repeat(999_960) });
        await appendBoundedMorningLog(path, { result: 'NEXT' });
        assert.equal(JSON.parse(await readFile(path, 'utf8')).result, 'NEXT');
        assert.ok((await readFile(path + '.previous', 'utf8')).length <= 1_000_000);
    } finally { await rm(directory, { recursive: true, force: true }); }
    const files = await morningRuntimeFiles(resolve('.'));
    assert.ok(files.includes('server/morning/run-shadow.mjs'));
    assert.ok(files.includes('api/_lib/official-pick-data.js'));
    assert.equal(files.some((path) => /firebase|telegram|paper-picks|official-pick-queue/.test(path)), false);
    const unit = await readFile('deploy/morning/moneytips-morning-shadow@.service', 'utf8');
    const timer = await readFile('deploy/morning/moneytips-morning-shadow.timer', 'utf8');
    assert.match(unit, /flock --nonblock/);
    assert.match(unit, /IPAddressDeny=any/);
    assert.match(unit, /User=nobody/);
    assert.match(unit, /Environment=MORNING_MODE=SHADOW/);
    assert.match(timer, /Persistent=false/);
    assert.match(timer, /10,13,16:00:00 Europe\/Madrid/);
});
