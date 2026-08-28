import { getAdminAuth } from '../lib/firebase-admin.js';
import { listOfficialPickReportsForAdmin, resolveOfficialPickReports } from '../lib/official-pick-reports.js';

const isAuthorized = async (req) => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!ownerUid || !match) return false;
    try {
        return (await getAdminAuth().verifyIdToken(match[1])).uid === ownerUid;
    } catch {
        return false;
    }
};

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    if (!await isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

    try {
        if (req.method === 'GET') return res.status(200).json({ reports: await listOfficialPickReportsForAdmin(req.query.pick) });
        const result = await resolveOfficialPickReports({
            pickId: req.body?.pickId,
            decision: req.body?.decision,
            message: req.body?.message
        });
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'No se pudo resolver la incidencia.' });
    }
}
