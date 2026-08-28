import { getOfficialPick, listOfficialPicks } from './lib/official-picks.js';

const isValidPickId = (value) => typeof value === 'string' && /^op_[a-f0-9]{40}$/.test(value);

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    try {
        const pickId = req.query.pick;
        if (pickId) {
            if (!isValidPickId(pickId)) return res.status(400).json({ error: 'Identificador de pick no válido' });
            const result = await getOfficialPick(pickId);
            if (!result) return res.status(404).json({ error: 'El comprobante no existe o no es público' });
            res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
            return res.status(200).json({ schemaVersion: 1, ...result });
        }

        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        return res.status(200).json({ schemaVersion: 1, picks: await listOfficialPicks(req.query.limit) });
    } catch (error) {
        console.error('No se pudieron leer los picks oficiales:', error);
        return res.status(500).json({ error: 'No se pudieron cargar los picks oficiales' });
    }
}

