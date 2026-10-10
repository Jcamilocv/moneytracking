import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { morningPublishRuntimeFiles } from '../scripts/morning-publish-runtime.mjs';
import { morningEgressConfig } from '../scripts/morning-egress-config.mjs';
import { semanticOfficialPickKey } from '../api/lib/official-pick-data.js';
const root = fileURLToPath(new URL('../', import.meta.url));
test('VPS package is Node-only and contains no T5, Telegram or DB runtime', async () => {
    const files = await morningPublishRuntimeFiles(root);
    assert.deepEqual(files, ['server/morning/one-shot.js', 'server/morning/publish-client.js', 'server/morning/run-publisher.mjs', 'server/morning/session-provider.js', 'server/morning/source-client.js']);
    assert.ok(files.includes('server/morning/run-publisher.mjs'));
    assert.ok(files.every(x => x.startsWith('server/morning/')));
});
test('schedule reuses existing unit, flock and shadow smoke; disabled until explicit enable', async () => {
    const read = name => readFile(new URL(`../deploy/morning/${name}`, import.meta.url), 'utf8');
    const service = await read('scheduled-publish.conf'); const timer = await read('timer-10-only.conf');
    assert.match(service, /MORNING_PUBLISH_ENABLED=false/); assert.match(service, /flock --nonblock/);
    assert.match(service, /--scheduled/); assert.doesNotMatch(service, /TELEGRAM_BOT_TOKEN|FIREBASE|moneytips-t5/);
    assert.match(timer, /OnCalendar=\nOnCalendar=\*-\*-\* 10:00:00 Europe\/Madrid/); assert.match(timer, /Persistent=false/);
});
test('network drop-in keeps deny-all and uses only bounded approved DNS IPs', async () => {
    const hosts = [];
    const result = await morningEgressConfig(async host => { hosts.push(host); return ['192.0.2.10']; }, async () => ['2001:db8::10']);
    assert.deepEqual(hosts, ['application.futbolbrain.com', 'app.pronosticosmoneytips.com']);
    assert.match(result, /IPAddressDeny=any/); assert.match(result, /IPAddressAllow=127.0.0.53/);
    await assert.rejects(morningEgressConfig(async () => [], async () => []), /MORNING_DNS_ALLOWLIST_UNAVAILABLE/);
});
test('canonical identity exactly matches committed T5 reference, including Madrid DST boundaries', async () => {
    const fixtures = JSON.parse(await readFile(new URL('./fixtures/t5-identity-reference.json', import.meta.url), 'utf8'));
    assert.equal(fixtures.referenceCommit, 'e17cdad6d7172c22ecfba3aac3368f358c94fed6');
    for (const { input, expected } of fixtures.cases) {
        assert.equal(semanticOfficialPickKey(input), expected);
        assert.equal(semanticOfficialPickKey({ ...input, source: { provider: 'different-source' }, system: { ...input.system, version: 'different-version' } }), expected);
    }
});
