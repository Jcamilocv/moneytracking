import { publishOfficialPick } from '../lib/official-picks.js';
import { getAdminAuth } from '../lib/firebase-admin.js';

const hasSecretAuthorization = (req) => {
    const secret = process.env.OFFICIAL_PICKS_ADMIN_SECRET;
    const authorization = req.headers.authorization || '';
    return Boolean(secret) && authorization === `Bearer ${secret}`;
};

const hasOwnerTokenAuthorization = async (req) => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!ownerUid || !match) return false;

    try {
        const decodedToken = await getAdminAuth().verifyIdToken(match[1]);
        return decodedToken.uid === ownerUid;
    } catch {
        return false;
    }
};

const isAuthorized = async (req) => hasSecretAuthorization(req) || hasOwnerTokenAuthorization(req);

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    if (!await isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

    if (req.method === 'GET') return res.status(200).json({ authorized: true });

    try {
        const result = await publishOfficialPick(req.body);
        return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) {
        console.error('No se pudo publicar el pick oficial:', error);
        return res.status(400).json({ error: error.message || 'No se pudo publicar el pick oficial' });
    }
}
