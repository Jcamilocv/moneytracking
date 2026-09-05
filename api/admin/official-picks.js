import { timingSafeEqual } from 'node:crypto';
import { queueOfficialPick } from '../../server/official-pick-queue.js';
import { getAdminAuth } from '../lib/firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from '../lib/official-pick-data.js';
import { normalizeFutbolBrainOwnerCandidate } from '../../server/futbolbrain-local-ingest.js';

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

const hasValidFutbolBrainDeviceToken = (req) => {
    const expected = process.env.FUTBOLBRAIN_LOCAL_INGEST_SECRET;
    const received = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!expected || !received) return false;
    const expectedBytes = Buffer.from(expected);
    const receivedBytes = Buffer.from(received);
    return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
};

const validationPreview = (input) => {
    const normalized = normalizeOfficialPickInput(input);
    return {
        queueId: publicPickIdFor(normalized),
        publicationPolicy: normalized.publicationPolicy,
        scheduledAt: normalized.scheduledAt.toISOString(),
        kickoffAt: normalized.event.kickoffAt.toISOString(),
        evidenceHash: normalized.source.evidenceHash
    };
};

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });

    // The local browser bridge has an isolated device token. It does not share
    // the owner UI credential and can only submit server-normalized allow-list
    // candidates through the internal rewrite below.
    if (req.query?.mode === 'futbolbrain-local') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
        if (!process.env.FUTBOLBRAIN_LOCAL_INGEST_SECRET) {
            return res.status(503).json({ error: 'El conector local todavía no está configurado' });
        }
        if (!hasValidFutbolBrainDeviceToken(req)) return res.status(401).json({ error: 'No autorizado' });
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

    if (!await isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

    if (req.method === 'GET') return res.status(200).json({ authorized: true });

    try {
        // Esta ruta permite ensayar el contrato desde un puente local sin crear
        // documentos, publicar picks ni enviar nada a Telegram.
        if (req.query?.mode === 'validate') {
            return res.status(200).json({ ok: true, mode: 'validation', preview: validationPreview(req.body) });
        }
        const result = await queueOfficialPick(req.body);
        return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) {
        console.error('No se pudo encolar el pick oficial:', error);
        return res.status(400).json({ error: error.message || 'No se pudo preparar el pick oficial' });
    }
}
