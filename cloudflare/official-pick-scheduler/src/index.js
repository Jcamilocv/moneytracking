const jsonHeaders = {
    accept: 'application/json',
    'user-agent': 'money-tips-official-pick-scheduler/1.0'
};

const safeJson = async (response) => {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 64 * 1024) return null;
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const dispatchEndpoint = (value) => {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:') throw new Error('DISPATCH_ENDPOINT debe usar HTTPS');
    return endpoint.toString();
};

export const dispatchOfficialPicks = async (env, fetcher = fetch) => {
    if (!env.OFFICIAL_PICKS_DISPATCHER_SECRET) throw new Error('Falta OFFICIAL_PICKS_DISPATCHER_SECRET');

    const response = await fetcher(dispatchEndpoint(env.DISPATCH_ENDPOINT), {
        method: 'POST',
        headers: {
            ...jsonHeaders,
            authorization: `Bearer ${env.OFFICIAL_PICKS_DISPATCHER_SECRET}`
        }
    });
    const result = await safeJson(response);

    if (!response.ok) {
        throw new Error(`El dispatcher respondió ${response.status}${result?.error ? `: ${result.error}` : ''}`);
    }
    return result;
};

const runScheduledDispatch = async (env) => {
    try {
        const result = await dispatchOfficialPicks(env);
        console.log(JSON.stringify({ message: 'official_picks_dispatch_completed', result }));
    } catch (error) {
        console.error(JSON.stringify({
            message: 'official_picks_dispatch_failed',
            error: error instanceof Error ? error.message : String(error)
        }));
        throw error;
    }
};

export default {
    async scheduled(_controller, env, ctx) {
        ctx.waitUntil(runScheduledDispatch(env));
    },
    async fetch(request) {
        if (new URL(request.url).pathname === '/health') {
            return Response.json({ ok: true, service: 'money-tips-official-pick-scheduler' });
        }
        return new Response('Not found', { status: 404 });
    }
};
