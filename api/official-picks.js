import { getOfficialPick, listOfficialPicks } from './lib/official-picks.js';
import { getAdminAuth } from './lib/firebase-admin.js';
import { getPremiumSubscription } from '../server/subscription.js';
import { listOfficialPickReportsForAdmin, resolveOfficialPickReports, submitOfficialPickReport } from './lib/official-pick-reports.js';

const isValidPickId = (value) => typeof value === 'string' && /^op_[a-f0-9]{40}$/.test(value);

const getTokenUid = async (req) => {
    const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    try {
        return (await getAdminAuth().verifyIdToken(match[1])).uid;
    } catch {
        return null;
    }
};

const isOwner = async (req) => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    return Boolean(ownerUid) && await getTokenUid(req) === ownerUid;
};

const getAudience = async (req) => {
    const uid = await getTokenUid(req);
    if (!uid) return { canViewActiveDetails: false };
    if (uid === process.env.OFFICIAL_SNAPSHOT_OWNER_UID) return { canViewActiveDetails: true };
    const subscription = await getPremiumSubscription(uid);
    return { canViewActiveDetails: subscription.active };
};

const handleReport = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const reporterUid = await getTokenUid(req);
    if (!reporterUid) return res.status(401).json({ error: 'Inicia sesión para reportar una incidencia.' });
    const result = await submitOfficialPickReport({
        pickId: req.body?.pickId,
        reporterUid,
        category: req.body?.category
    });
    return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
};

const handleAdminReports = async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    if (!await isOwner(req)) return res.status(401).json({ error: 'No autorizado' });
    if (req.method === 'GET') return res.status(200).json({ reports: await listOfficialPickReportsForAdmin(req.query.pick) });
    const result = await resolveOfficialPickReports({
        pickId: req.body?.pickId,
        decision: req.body?.decision,
        message: req.body?.message
    });
    return res.status(200).json({ ok: true, ...result });
};

export default async function handler(req, res) {
    try {
        if (req.query.mode === 'report') return await handleReport(req, res);
        if (req.query.mode === 'admin-reports') return await handleAdminReports(req, res);
        if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
        const audience = await getAudience(req);
        const pickId = req.query.pick;
        if (pickId) {
            if (!isValidPickId(pickId)) return res.status(400).json({ error: 'Identificador de pick no válido' });
            const result = await getOfficialPick(pickId, audience);
            if (!result) return res.status(404).json({ error: 'El comprobante no existe o no es público' });
            res.setHeader('Cache-Control', audience.canViewActiveDetails ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=300');
            return res.status(200).json({ schemaVersion: 1, ...result });
        }

        res.setHeader('Cache-Control', audience.canViewActiveDetails ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=120');
        return res.status(200).json({ schemaVersion: 1, picks: await listOfficialPicks(req.query.limit, audience) });
    } catch (error) {
        if (req.query.mode === 'report') return res.status(400).json({ error: error.message || 'No se pudo registrar la incidencia.' });
        if (req.query.mode === 'admin-reports') return res.status(400).json({ error: error.message || 'No se pudo resolver la incidencia.' });
        console.error('No se pudieron leer los picks oficiales:', error);
        return res.status(500).json({ error: 'No se pudieron cargar los picks oficiales' });
    }
}
