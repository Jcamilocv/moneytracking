import { publishOfficialPick } from '../lib/official-picks.js';

const isAuthorized = (req) => {
    const secret = process.env.OFFICIAL_PICKS_ADMIN_SECRET;
    const authorization = req.headers.authorization || '';
    return Boolean(secret) && authorization === `Bearer ${secret}`;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

    try {
        const result = await publishOfficialPick(req.body);
        return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) {
        console.error('No se pudo publicar el pick oficial:', error);
        return res.status(400).json({ error: error.message || 'No se pudo publicar el pick oficial' });
    }
}
