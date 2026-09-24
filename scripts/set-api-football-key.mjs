/**
 * @file set-api-football-key.mjs
 * 
 * Script auxiliar interactivo para configurar de forma segura API_FOOTBALL_KEY en .env.local
 * sin necesidad de navegar por carpetas ocultas en Finder.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        console.log('\n=== CONFIGURACIÓN LOCAL DE API_FOOTBALL_KEY ===\n');
        const key = await rl.question('Introduce tu API_FOOTBALL_KEY (de API-Football / API-Sports): ');
        const trimmedKey = key?.trim();

        if (!trimmedKey || trimmedKey.length < 8) {
            console.error('\nError: La clave proporcionada no es válida (demasiado corta).');
            process.exit(1);
        }

        const envPath = resolve(process.cwd(), '.env.local');
        let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

        if (/^API_FOOTBALL_KEY=/m.test(content)) {
            content = content.replace(/^API_FOOTBALL_KEY=.*$/m, `API_FOOTBALL_KEY=${trimmedKey}`);
        } else {
            content += `\nAPI_FOOTBALL_KEY=${trimmedKey}\n`;
        }

        writeFileSync(envPath, content, 'utf8');

        console.log('\n[OK] API_FOOTBALL_KEY guardada exitosamente en .env.local.');
        console.log('Ahora puedes confirmar en el chat: API_FOOTBALL_KEY_PRESENT=true\n');
    } finally {
        rl.close();
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
