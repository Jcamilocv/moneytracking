import { refreshOfficialSnapshots } from '../lib/official-snapshots.js';
import { dispatchDueOfficialPicks, inspectDueOfficialPicks } from '../../server/official-pick-queue.js';
import { discoverOperationsTelegramChannel, notifyOperations } from '../../server/operations-alerts.js';

const hasDispatcherAuthorization = (req) => {
    const secret = process.env.OFFICIAL_PICKS_DISPATCHER_SECRET;
    return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
};

const isDryRun = (req) => req.headers['x-money-tips-dispatch-mode'] === 'dry-run';
const shouldDiscoverOperationsChannel = (req) => req.headers['x-money-tips-operations-discovery'] === 'true';

export default async function handler(req, res) {
    const job = req.query?.job;
    if (job === 'official-picks') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
        if (!hasDispatcherAuthorization(req)) return res.status(401).json({ error: 'No autorizado' });

        try {
            const operations = shouldDiscoverOperationsChannel(req) && isDryRun(req)
                ? await discoverOperationsTelegramChannel()
                : null;
            const result = isDryRun(req)
                ? await inspectDueOfficialPicks({ limit: req.query?.limit })
                : await dispatchDueOfficialPicks({ limit: req.query?.limit });
            return res.status(200).json({ ok: true, ...result, ...(operations ? { operations } : {}) });
        } catch (error) {
            console.error('No se pudo ejecutar el publicador de picks:', error);
            try {
                await notifyOperations({
                    key: 'official-pick-dispatcher-failure',
                    text: '⚠️ Money Tips Ops\n\nEl publicador automático de picks ha detectado un fallo. La cola conservará los picks y reintentará la publicación cuando corresponda. Revisa Cloudflare o Vercel.'
                });
            } catch (notificationError) {
                console.error('No se pudo enviar el aviso operativo:', notificationError);
            }
            return res.status(500).json({ error: 'No se pudo ejecutar el publicador de picks' });
        }
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
    if (process.env.SNAPSHOT_AUTOMATION_ENABLED !== 'true') {
        return res.status(204).end();
    }

    const authorization = req.headers.authorization || '';
    if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        return res.status(200).json({ ok: true, snapshots: await refreshOfficialSnapshots() });
    } catch (error) {
        console.error('No se pudieron actualizar los históricos públicos:', error);
        return res.status(500).json({ error: 'No se pudieron actualizar los históricos públicos' });
    }
}
