import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const morningRuntimeFiles = async (root) => {
    const files = new Set();
    const visit = async (file) => {
        const path = relative(root, file).replaceAll('\\', '/');
        if (path.startsWith('../') || /(?:firebase|telegram|official-pick-queue|official-pick-auto-copy|paper-picks|official-picks\.js)/.test(path)) {
            throw new Error('SHADOW_FORBIDDEN_RUNTIME_MODULE');
        }
        if (files.has(path)) return;
        files.add(path);
        const text = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        if (/\bimport\s*\(/.test(text)) throw new Error('SHADOW_DYNAMIC_IMPORT_FORBIDDEN');
        for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
            const dependency = match[1];
            if (dependency.startsWith('node:')) continue;
            if (!dependency.startsWith('.')) throw new Error('SHADOW_EXTERNAL_PACKAGE_FORBIDDEN');
            await visit(resolve(dirname(file), dependency));
        }
    };
    await visit(resolve(root, 'server/morning/run-shadow.mjs'));
    return [...files].sort();
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    for (const file of await morningRuntimeFiles(process.cwd())) console.log(file);
}
