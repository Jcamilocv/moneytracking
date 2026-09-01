import { getAdminAuth } from '../lib/firebase-admin.js';
import { queueOfficialPick } from '../lib/official-pick-queue.js';

const isOwner = async (req) => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    const token = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!ownerUid || !token) return false;
    try {
        return (await getAdminAuth().verifyIdToken(token)).uid === ownerUid;
    } catch {
        return false;
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (!await isOwner(req)) return res.status(401).json({ error: 'No autorizado' });

    try {
        const result = await queueOfficialPick(req.body);
        return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) {
        console.error('No se pudo encolar el pick oficial:', error);
        return res.status(400).json({ error: error.message || 'No se pudo encolar el pick oficial' });
    }
}
