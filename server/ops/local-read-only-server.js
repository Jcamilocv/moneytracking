import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleOpsRequest } from './ops-router.js';
import { isOpsReadOnlyMode, OPS_READ_PATHS } from './read-only-mode.js';

const HOST = '127.0.0.1';
const PORT = 4174; // Existing local Ops URL in docs/openapi-ops.json.

export function createLocalOpsReadOnlyServer() {
    if (!isOpsReadOnlyMode()) throw new Error('OPS_READ_ONLY_MODE=1 is required');
    if (!process.env.OPS_ADMIN_SECRET) throw new Error('A local OPS_ADMIN_SECRET is required');

    return createServer(async (req, res) => {
        const url = new URL(req.url, `http://${HOST}:${PORT}`);
        const path = url.pathname.match(/^\/api\/ops\/([^/]+)\/?$/)?.[1];
        if (req.method !== 'GET' || !OPS_READ_PATHS.has(path)) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: { code: 'OPS_READ_ONLY_MODE' } }));
            return;
        }
        await handleOpsRequest(req, res);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    createLocalOpsReadOnlyServer().listen(PORT, HOST, () => {
        console.log(`Local Ops read-only server listening on http://${HOST}:${PORT}`);
    });
}
