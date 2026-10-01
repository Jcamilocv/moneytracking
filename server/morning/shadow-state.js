import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const createLocalShadowState = (path) => {
    if (!path || typeof path !== 'string') throw new Error('SHADOW_STATE_PATH_REQUIRED');
    return {
        async read() {
            try {
                const state = JSON.parse(await readFile(path, 'utf8'));
                if (state?.schemaVersion !== 1 || !state.observations || typeof state.observations !== 'object') throw new Error('SHADOW_STATE_INVALID');
                return state;
            } catch (error) {
                if (error.code === 'ENOENT') return { schemaVersion: 1, observations: {},
                    semanticKeys: {}, history: [] };
                throw error;
            }
        },
        async write(state) {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            const temporary = `${path}.tmp-${process.pid}`;
            await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
            await rename(temporary, path);
        }
    };
};
