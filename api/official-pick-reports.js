import { getAdminAuth } from './lib/firebase-admin.js';
import { submitOfficialPickReport } from './lib/official-pick-reports.js';

const getReporterUid = async (req) => {
    const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    try {
        return (await getAdminAuth().verifyIdToken(match[1])).uid;
    } catch {
        return null;
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const reporterUid = await getReporterUid(req);
    if (!reporterUid) return res.status(401).json({ error: 'Inicia sesión para reportar una incidencia.' });

    try {
        const result = await submitOfficialPickReport({
            pickId: req.body?.pickId,
            reporterUid,
            category: req.body?.category
        });
        return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'No se pudo registrar la incidencia.' });
    }
}
