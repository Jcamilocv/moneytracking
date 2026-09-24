import { handleOpsRequest } from '../server/ops/ops-router.js';

/**
 * Entrypoint serverless de Vercel para la API de Operaciones de Astra HQ.
 */
export default async function handler(req, res) {
    return handleOpsRequest(req, res);
}
