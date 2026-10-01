import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileMorningSessionProvider } from '../server/morning/session-provider.js';
import { createMorningSourceClient } from '../server/morning/source-client.js';
import { createMorningShadowApp } from '../server/morning/bootstrap.js';

const ORIGIN = 'https://application.futbolbrain.com';
const fixture = (overrides = {}) => JSON.stringify({ origin: ORIGIN,
    cookieHeader: 'session=test-only', expiresAt: '2026-10-08T00:00:00Z', ...overrides });

test('restricted session file survives provider recreation and never appears in errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morning-session-'));
    try {
        const path = join(directory, 'session.json');
        await writeFile(path, fixture(), { mode: 0o600 });
        const provider = createFileMorningSessionProvider({ path,
            now: () => new Date('2026-10-07T07:00:00Z') });
        assert.equal((await provider()).headers.Cookie, 'session=test-only');
        assert.equal((await createFileMorningSessionProvider({ path,
            now: () => new Date('2026-10-07T08:00:00Z') })()).headers.Cookie, 'session=test-only');
        await writeFile(path, fixture({ expiresAt: null }), { mode: 0o600 });
        assert.equal((await createFileMorningSessionProvider({ path,
            now: () => new Date('2030-01-01T00:00:00Z') })()).headers.Cookie, 'session=test-only');
        await writeFile(path, fixture(), { mode: 0o600 });
        const expired = createFileMorningSessionProvider({ path,
            now: () => new Date('2026-10-07T23:50:00Z') });
        await assert.rejects(expired(), (error) => error.code === 'SESSION_EXPIRED'
            && !error.message.includes('session=test-only'));
        const client = createMorningSourceClient({ baseUrl: `${ORIGIN}/`,
            sessionProvider: expired, transport: async () => { throw new Error('must not fetch'); } });
        await assert.rejects(client.readActiveAlarms(), (error) => error.code === 'SESSION_EXPIRED');
        await chmod(path, 0o644);
        await assert.rejects(provider(), (error) => error.code === 'SESSION_FILE_PERMISSIONS_UNSAFE');
        await chmod(path, 0o600);
        await writeFile(path, fixture({ origin: 'https://invalid.example' }), { mode: 0o600 });
        await assert.rejects(provider(), (error) => error.code === 'SESSION_FILE_INVALID');
        await writeFile(path, fixture({ refreshToken: 'do-not-accept-extra-secret' }), { mode: 0o600 });
        await assert.rejects(provider(), (error) => error.code === 'SESSION_FILE_INVALID');
        await writeFile(path, '{invalid', { mode: 0o600 });
        await assert.rejects(provider(), (error) => error.code === 'SESSION_FILE_INVALID');
        const link = join(directory, 'link.json');
        await symlink(path, link);
        await assert.rejects(createFileMorningSessionProvider({ path: link })(),
            (error) => error.code === 'SESSION_UNAVAILABLE');
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unknown cookie expiry relies on response validation and rejects login HTML', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morning-session-unknown-'));
    try {
        const path = join(directory, 'session.json');
        await writeFile(path, fixture({ expiresAt: null }), { mode: 0o600 });
        const provider = createFileMorningSessionProvider({ path });
        const client = createMorningSourceClient({ baseUrl: `${ORIGIN}/`, sessionProvider: provider,
            transport: async () => new Response('<html>Login</html>',
                { headers: { 'content-type': 'text/html' } }) });
        await assert.rejects(client.readActiveAlarms(), (error) => error.code === 'AUTH_EXPIRED');
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('shadow bootstrap wires file session and fake REST only; nothing starts automatically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morning-bootstrap-'));
    const prior = process.env.MORNING_MODE;
    try {
        const sessionPath = join(directory, 'session.json');
        const statePath = join(directory, 'shadow-state.json');
        await writeFile(sessionPath, fixture(), { mode: 0o600 });
        process.env.MORNING_MODE = 'SHADOW';
        let reads = 0;
        const app = createMorningShadowApp({ sessionPath, statePath,
            transport: async (_url, init) => {
                reads++;
                assert.equal(init.method, 'GET');
                return new Response(JSON.stringify({ ActivePicksCount: 0,
                    ResultsPicksViewModelItems: [] }),
                { headers: { 'content-type': 'application/json' } });
            } });
        assert.equal(reads, 0);
        assert.equal((await app.runner.run()).externalWrites, 0);
        assert.equal(reads, 1);
        process.env.MORNING_MODE = 'LIVE';
        await assert.rejects(app.runner.run(), /MORNING_SHADOW_FIREWALL/);
    } finally {
        if (prior === undefined) delete process.env.MORNING_MODE;
        else process.env.MORNING_MODE = prior;
        await rm(directory, { recursive: true, force: true });
    }
});
