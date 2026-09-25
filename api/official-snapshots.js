import { FALLBACK_SNAPSHOT_IDS } from './_lib/official-snapshot-data.js';
import { blockOutsideOpsInReadOnlyMode } from '../server/ops/read-only-mode.js';
import { readOfficialSnapshotIds } from './_lib/official-snapshots.js';

const ALLOWED_ORIGIN = 'https://pronosticosmoneytips.com';

export default async function handler(req, res) {
    if (blockOutsideOpsInReadOnlyMode(res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');

    try {
        const snapshots = { ...FALLBACK_SNAPSHOT_IDS, ...(await readOfficialSnapshotIds()) };
        return res.status(200).json({ schemaVersion: 1, snapshots });
    } catch (error) {
        console.warn('Registro de snapshots no disponible; se usan enlaces de respaldo.', error.message);
        return res.status(200).json({ schemaVersion: 1, snapshots: FALLBACK_SNAPSHOT_IDS, fallback: true });
    }
}
