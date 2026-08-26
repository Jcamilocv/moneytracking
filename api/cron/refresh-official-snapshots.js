import { refreshOfficialSnapshots } from '../lib/official-snapshots.js';

export default async function handler(req, res) {
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
