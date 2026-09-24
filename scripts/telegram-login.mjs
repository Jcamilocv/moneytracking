/**
 * @file telegram-login.mjs
 * 
 * Script CLI Interactivo de un solo uso para autenticación MTProto y generación de StringSession.
 * 
 * INSTRUCCIONES DE USO (SOLO TRAS AUTORIZACIÓN DEL CEO):
 * 1. Ejecutar en terminal local interactiva:
 *    node scripts/telegram-login.mjs
 * 2. Introducir API_ID y API_HASH de my.telegram.org (o configurar en variables de entorno).
 * 3. Introducir número de teléfono internacional (+34...).
 * 4. Introducir el código OTP enviado por Telegram a la app.
 * 5. Si la cuenta tiene verificación en dos pasos (2FA), introducir la contraseña cuando se solicite.
 * 6. El script generará la StringSession y listará los chats para seleccionar el ID del canal de FutbolBrain.
 * 7. Guardar los valores resultantes en .env.local (ignorado por Git).
 * 
 * AVISO DE SEGURIDAD:
 * Este script NO se ejecuta automáticamente ni contiene credenciales por defecto.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        console.log('\n=== MONEY TIPS — TELEGRAM MTPROTO ONE-TIME AUTHENTICATION ===\n');

        // Cargar .env.local si existe en el directorio de trabajo
        const envPath = resolve(process.cwd(), '.env.local');
        if (existsSync(envPath)) {
            const lines = readFileSync(envPath, 'utf8').split('\n');
            for (const line of lines) {
                const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
                if (match && !process.env[match[1]]) {
                    process.env[match[1]] = match[2]?.trim() || '';
                }
            }
        }

        // 1. Obtener API_ID y API_HASH
        let apiId = process.env.TELEGRAM_API_ID;
        if (!apiId) {
            apiId = await rl.question('Introduce TELEGRAM_API_ID (de my.telegram.org): ');
        }
        apiId = Number(apiId?.trim());
        if (!apiId || Number.isNaN(apiId)) {
            throw new Error('TELEGRAM_API_ID inválido');
        }

        let apiHash = process.env.TELEGRAM_API_HASH;
        if (!apiHash) {
            apiHash = await rl.question('Introduce TELEGRAM_API_HASH (de my.telegram.org): ');
        }
        apiHash = apiHash?.trim();
        if (!apiHash || apiHash.length < 10) {
            throw new Error('TELEGRAM_API_HASH inválido');
        }

        console.log('\nIniciando cliente GramJS temporal para autenticación...');
        const session = new StringSession('');
        const client = new TelegramClient(session, apiId, apiHash, {
            connectionRetries: 5
        });

        // 2, 3 & 4. Autenticación interactiva (Teléfono, OTP, 2FA si aplica)
        await client.start({
            phoneNumber: async () => await rl.question('\nIntroduce tu número de teléfono (+34...): '),
            password: async () => await rl.question('Introduce tu contraseña 2FA (si está activa): '),
            phoneCode: async () => await rl.question('Introduce el código de verificación OTP recibido en Telegram: '),
            onError: (err) => console.error('Error de autenticación:', err.message)
        });

        console.log('\n Autenticación completada con éxito.');

        // 5. Guardar StringSession directamente en .env.local (sin imprimirla en stdout)
        const sessionString = client.session.save();
        console.log('\n[OK] StringSession generada con éxito (longitud: ' + sessionString.length + ' caracteres).');

        // 6. Descubrir chat de FutbolBrain
        console.log('\nBuscando chats y canales de FutbolBrain en tu cuenta...');
        const dialogs = await client.getDialogs({ limit: 100 });
        
        const matchingDialogs = dialogs.filter(d => {
            const title = (d.title || d.name || '').toLowerCase();
            const username = (d.entity?.username || '').toLowerCase();
            return title.includes('futbolbrain') || username.includes('futbolbrain');
        });

        let selectedChatId = null;
        let selectedChatTitle = '';
        if (matchingDialogs.length > 0) {
            console.log(`\nSe encontraron ${matchingDialogs.length} chat(s) relacionados con FutbolBrain:`);
            matchingDialogs.forEach((d, index) => {
                console.log(`  [${index + 1}] ID: ${d.id} | Título: "${d.title || d.name}" | Username: @${d.entity?.username || 'N/A'}`);
            });

            const choice = await rl.question(`\nSelecciona el número de chat correspondiente (1-${matchingDialogs.length}) o Enter para manual: `);
            const idx = parseInt(choice, 10) - 1;
            if (matchingDialogs[idx]) {
                selectedChatId = String(matchingDialogs[idx].id);
                selectedChatTitle = matchingDialogs[idx].title || matchingDialogs[idx].name || '';
            }
        } else {
            console.log('No se encontraron chats con la palabra "futbolbrain" en el título.');
        }

        if (!selectedChatId) {
            selectedChatId = await rl.question('\nIntroduce manualmente el FUTBOLBRAIN_TELEGRAM_CHAT_ID: ');
        }

        // 7. Persistir de forma segura en .env.local
        let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

        const setEnvVar = (content, key, val) => {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(content)) {
                return content.replace(regex, `${key}=${val}`);
            }
            return content.trimEnd() + `\n${key}=${val}\n`;
        };

        envContent = setEnvVar(envContent, 'TELEGRAM_API_ID', String(apiId));
        envContent = setEnvVar(envContent, 'TELEGRAM_API_HASH', String(apiHash));
        envContent = setEnvVar(envContent, 'TELEGRAM_STRING_SESSION', String(sessionString));
        envContent = setEnvVar(envContent, 'FUTBOLBRAIN_TELEGRAM_CHAT_ID', String(selectedChatId));

        writeFileSync(envPath, envContent, 'utf8');

        console.log('\n======================================================');
        console.log('[OK] Configuración guardada de forma segura en .env.local');
        console.log('API_ID_PRESENT=true');
        console.log('API_HASH_PRESENT=true');
        console.log('STRING_SESSION_PRESENT=true');
        console.log('CHAT_ID_PRESENT=true');
        if (selectedChatTitle) {
            console.log(`CHAT_TITLE="${selectedChatTitle}"`);
        }
        console.log('======================================================\n');

        await client.disconnect();
        console.log('Cliente desconectado de forma segura.');
    } catch (error) {
        console.error('\n Error durante el proceso de autenticación:', error.message);
    } finally {
        rl.close();
    }
}

// Ejecutar únicamente si se invoca directamente desde CLI
if (process.argv[1]?.endsWith('telegram-login.mjs')) {
    main();
}
