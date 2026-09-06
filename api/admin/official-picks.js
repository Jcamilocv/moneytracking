import { timingSafeEqual } from 'node:crypto';
import { queueOfficialPick } from '../../server/official-pick-queue.js';
import { getAdminAuth, getAdminDb } from '../lib/firebase-admin.js';
import { normalizeOfficialPickInput, publicPickIdFor } from '../lib/official-pick-data.js';
import { normalizeFutbolBrainOwnerCandidate } from '../../server/futbolbrain-local-ingest.js';
import {
    entitlementForManualGrant,
    entitlementForRevocation,
    normalizePremiumAccessRequest
} from '../../server/premium-access.js';

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

const dateFromFirestoreValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const handlePremiumAccess = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    // Esta ruta nunca acepta el secreto de automatización: solo la sesión del propietario.
    if (!await hasOwnerTokenAuthorization(req)) return res.status(401).json({ error: 'No autorizado' });

    const request = normalizePremiumAccessRequest(req.body);
    const auth = getAdminAuth();
    let user;
    try {
        user = await auth.getUserByEmail(request.email);
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            return res.status(404).json({ error: 'Ese correo aún no ha creado una cuenta en MoneyTracKING.' });
        }
        throw error;
    }

    const entitlementRef = getAdminDb().collection('users').doc(user.uid).collection('entitlements').doc('subscription');
    const snapshot = await entitlementRef.get();
    const previous = snapshot.exists ? snapshot.data() : {};
    const now = new Date();
    const previousAccessUntil = dateFromFirestoreValue(previous.accessUntil);
    const renewalStartsAt = previous.status === 'active' && previousAccessUntil && previousAccessUntil > now
        ? previousAccessUntil
        : now;
    const entitlement = request.action === 'grant'
        ? entitlementForManualGrant({ plan: request.plan, paymentReference: request.paymentReference, now, startsAt: renewalStartsAt })
        : entitlementForRevocation({ previous, now });

    await entitlementRef.set(entitlement);
    return res.status(200).json({
        ok: true,
        action: request.action,
        email: request.email,
        status: entitlement.status,
        plan: entitlement.plan || request.plan,
        accessUntil: entitlement.accessUntil?.toISOString?.() || null
    });
};

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

    if (req.query?.mode === 'premium-access') {
        try {
            return await handlePremiumAccess(req, res);
        } catch (error) {
            console.error('No se pudo actualizar el acceso Premium:', error);
            return res.status(400).json({ error: error.message || 'No se pudo actualizar el acceso Premium.' });
        }
    }

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
