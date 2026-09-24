import { scanUnresolvedOrders } from '../../server/revenue-reconciliation.js';

// H2 Auditoría: Solo aceptar autenticación por secreto Bearer.
// La cabecera x-vercel-cron es falsificable por un atacante externo.
const isAuthorizedCron = (req) => {
    const authHeader = req.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET || process.env.OFFICIAL_PICKS_DISPATCHER_SECRET;
    return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
};

export default async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'No autorizado para ejecutar monitorización de pedidos.' });
    }

    try {
        // H4 Auditoría: Los parámetros de ventana temporal son constantes del
        // servidor y no se aceptan desde query string para evitar manipulación.
        const results = await scanUnresolvedOrders();

        return res.status(200).json({
            ok: true,
            timestamp: new Date().toISOString(),
            ...results
        });
    } catch (error) {
        console.error('Error durante la monitorización de pedidos de pago:', error);
        return res.status(500).json({
            ok: false,
            error: error.message || 'Error interno en monitor de pedidos'
        });
    }
}
