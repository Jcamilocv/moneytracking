export const isOpsReadOnlyMode = () => process.env.OPS_READ_ONLY_MODE === '1';

export const OPS_READ_PATHS = new Set([
    'health', 'kpis', 'incidents', 'systems', 'picks', 'paper', 'automation', 'audit-logs'
]);

export function readOnlyError() {
    const error = new Error('OPS_READ_ONLY_MODE: esta instancia solo permite las ocho lecturas Ops.');
    error.code = 'OPS_READ_ONLY_MODE';
    return error;
}

// All non-Ops API entrypoints call this before touching auth, Firestore or a provider.
export function blockOutsideOpsInReadOnlyMode(res) {
    if (!isOpsReadOnlyMode()) return false;
    res.status(403).json({ ok: false, error: { code: 'OPS_READ_ONLY_MODE', message: readOnlyError().message } });
    return true;
}
