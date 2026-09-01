import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchOfficialPicks } from '../src/index.js';

const env = {
    DISPATCH_ENDPOINT: 'https://app.pronosticosmoneytips.com/api/cron/refresh-official-snapshots?job=official-picks',
    OFFICIAL_PICKS_DISPATCHER_SECRET: 'test-secret'
};

test('calls the protected dispatcher with its secret', async () => {
    let request;
    const result = await dispatchOfficialPicks(env, async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ ok: true, results: [] }), {
            headers: { 'content-type': 'application/json', 'content-length': '24' }
        });
    });

    assert.equal(request.url, env.DISPATCH_ENDPOINT);
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.authorization, 'Bearer test-secret');
    assert.equal(result.ok, true);
});

test('rejects a non-HTTPS dispatcher endpoint', async () => {
    await assert.rejects(
        () => dispatchOfficialPicks({ ...env, DISPATCH_ENDPOINT: 'http://localhost:3000/api/cron/refresh-official-snapshots?job=official-picks' }),
        /HTTPS/
    );
});

test('surfaces dispatcher failures', async () => {
    await assert.rejects(
        () => dispatchOfficialPicks(env, async () => new Response(JSON.stringify({ error: 'No autorizado' }), {
            status: 401,
            headers: { 'content-length': '27' }
        })),
        /401: No autorizado/
    );
});
