import { refreshOfficialSnapshots } from '../lib/official-snapshots.js';
import { dispatchDueOfficialPicks } from '../../server/official-pick-queue.js';

const hasDispatcherAuthorization = (req) => {
    const secret = process.env.OFFICIAL_PICKS_DISPATCHER_SECRET;
    return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
};

export default async function handler(req, res) {
    const job = req.query?.job;
    if (job === 'official-picks') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
        if (!hasDispatcherAuthorization(req)) return res.status(401).json({ error: 'No autorizado' });

        try {
            return res.status(200).json({ ok: true, ...await dispatchDueOfficialPicks({ limit: req.query?.limit }) });
        } catch (error) {
            console.error('No se pudo ejecutar el publicador de picks:', error);
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
