import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export class MorningSessionError extends Error {
    constructor(code) { super(code); this.name = 'MorningSessionError'; this.code = code; }
}

const assertPrivate = (stat, kind) => {
    if ((stat.mode & 0o077) !== 0) throw new MorningSessionError(`${kind}_PERMISSIONS_UNSAFE`);
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
        throw new MorningSessionError(`${kind}_OWNER_MISMATCH`);
    }
};

// The owner installs a short-lived, authorized session file manually. The
// provider only reads it; no login, challenge solving or silent refresh.
export const createFileMorningSessionProvider = ({ path, origin = 'https://application.futbolbrain.com',
    now = () => new Date() } = {}) => {
    if (!isAbsolute(path || '')) throw new MorningSessionError('SESSION_PATH_REQUIRED');
    return async () => {
        let handle;
        try {
            const directory = await lstat(dirname(path));
            if (!directory.isDirectory() || directory.isSymbolicLink()) throw new MorningSessionError('SESSION_DIRECTORY_INVALID');
            assertPrivate(directory, 'SESSION_DIRECTORY');
            handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 16_384) throw new MorningSessionError('SESSION_FILE_INVALID');
            assertPrivate(stat, 'SESSION_FILE');
            let data;
            try { data = JSON.parse(await handle.readFile({ encoding: 'utf8' })); }
            catch { throw new MorningSessionError('SESSION_FILE_INVALID'); }
            if (!data || Object.keys(data).sort().join(',') !== 'cookieHeader,expiresAt,origin'
                || data.origin !== origin || typeof data.cookieHeader !== 'string'
                || !data.cookieHeader || data.cookieHeader.length > 8_192
                || Array.from(data.cookieHeader).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)) {
                throw new MorningSessionError('SESSION_FILE_INVALID');
            }
            // Browser-session cookies have no advertised expiry. In that case
            // the source client must verify authorization from each response.
            if (data.expiresAt !== null) {
                if (typeof data.expiresAt !== 'string'
                    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(data.expiresAt)) {
                    throw new MorningSessionError('SESSION_EXPIRY_REQUIRED');
                }
                const expiresAt = new Date(data.expiresAt);
                if (Number.isNaN(expiresAt.getTime())) throw new MorningSessionError('SESSION_EXPIRY_REQUIRED');
                if (expiresAt.getTime() <= now().getTime() + 15 * 60_000) throw new MorningSessionError('SESSION_EXPIRED');
            }
            return { headers: { Cookie: data.cookieHeader } };
        } catch (error) {
            if (error instanceof MorningSessionError) throw error;
            throw new MorningSessionError('SESSION_UNAVAILABLE');
        } finally {
            await handle?.close();
        }
    };
};
