import { getAdminAuth, getAdminDb } from '../lib/firebase-admin.js';
import {
    entitlementForManualGrant,
    entitlementForRevocation,
    normalizePremiumAccessRequest
} from '../../server/premium-access.js';

const isOwner = async (req) => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!ownerUid || !match) return false;
    try {
        return (await getAdminAuth().verifyIdToken(match[1])).uid === ownerUid;
    } catch {
        return false;
    }
};

const dateFromFirestoreValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (!await isOwner(req)) return res.status(401).json({ error: 'No autorizado' });

    try {
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
        const now = new Date();
        const previous = snapshot.exists ? snapshot.data() : {};
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
    } catch (error) {
        console.error('No se pudo actualizar el acceso Premium:', error);
        return res.status(400).json({ error: error.message || 'No se pudo actualizar el acceso Premium.' });
    }
}
