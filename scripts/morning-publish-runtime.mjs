import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Build only the existing VPS Morning process's dependency closure. It must
// not carry Firebase credentials, Telegram code, T5 code or third-party packages.
export const morningPublishRuntimeFiles = async root => {
    const files = new Set();
    const visit = async file => {
        const path = relative(root, file).replaceAll('\\', '/');
        if (path.startsWith('../') || /(?:firebase|telegram|t5|official-pick-queue|official-picks\.js)/i.test(path)) throw new Error('MORNING_FORBIDDEN_RUNTIME_MODULE');
        if (files.has(path)) return;
        files.add(path);
        const text = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/\bimport\s*\(/.test(text)) throw new Error('MORNING_DYNAMIC_IMPORT_FORBIDDEN');
        for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
            const dependency = match[1]; if (dependency.startsWith('node:')) continue;
            if (!dependency.startsWith('.')) throw new Error('MORNING_EXTERNAL_PACKAGE_FORBIDDEN');
            await visit(resolve(dirname(file), dependency));
        }
    };
    await visit(resolve(root, 'server/morning/run-publisher.mjs'));
    return [...files].sort();
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    for (const file of await morningPublishRuntimeFiles(process.cwd())) console.log(file);
}
