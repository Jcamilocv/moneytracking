import { timingSafeEqual } from 'node:crypto';
import { queueOfficialPick } from '../../server/official-pick-queue.js';
import { normalizeFutbolBrainOwnerCandidate } from '../../server/futbolbrain-local-ingest.js';

const hasValidDeviceToken = (req) => {
    const expected = process.env.FUTBOLBRAIN_LOCAL_INGEST_SECRET;
    const received = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!expected || !received) return false;
    const expectedBytes = Buffer.from(expected);
    const receivedBytes = Buffer.from(received);
    return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (!process.env.FUTBOLBRAIN_LOCAL_INGEST_SECRET) {
        return res.status(503).json({ error: 'El conector local todavía no está configurado' });
    }
    if (!hasValidDeviceToken(req)) return res.status(401).json({ error: 'No autorizado' });

    try {
        const pick = normalizeFutbolBrainOwnerCandidate(req.body);
        const result = await queueOfficialPick(pick);
        return res.status(result.created ? 201 : 200).json({
            ok: true,
            state: result.state,
            queueId: result.queueId,
            publicationPolicy: pick.publicationPolicy
        });
    } catch (error) {
        console.error('No se pudo recibir el pick local de FutbolBrain:', error);
        return res.status(400).json({ error: error.message || 'No se pudo recibir el pick local' });
    }
}
