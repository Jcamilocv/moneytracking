import { dispatchDueOfficialPicks } from '../lib/official-pick-queue.js';

const isAuthorized = (req) => {
    const secret = process.env.OFFICIAL_PICKS_DISPATCHER_SECRET;
    return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
};

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

    try {
        const result = await dispatchDueOfficialPicks({ limit: req.query?.limit });
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        console.error('No se pudo ejecutar el publicador de picks:', error);
        return res.status(500).json({ error: 'No se pudo ejecutar el publicador de picks' });
    }
}
