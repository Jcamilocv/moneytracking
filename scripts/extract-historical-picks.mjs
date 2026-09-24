/**
 * @file Extractor de picks históricos reales de Money Tips desde Telegram
 * Extrae picks reales de los canales oficiales para la validación ampliada P1.2.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { parseMadridDateTimeToUTC } from '../server/futbolbrain-telegram-poc/canonical-normalizer.js';

const COMP_MAP = {
    'ESP-PRE': 'ESP-PRE',
    'ESP-PRIMERA DIVISION': 'ESP-PRE',
    'LA LIGA': 'ESP-PRE',
    'LALIGA EA SPORTS': 'ESP-PRE',
    'ESP-SEG': 'ESP-SEG',
    'SEGUNDA DIVISIÓN': 'ESP-SEG',
    'LALIGA HYPERMOTION': 'ESP-SEG',
    'ENG-PRE': 'ENG-PRE',
    'PREMIER LEAGUE': 'ENG-PRE',
    'ENG-PREMIER LEAGUE': 'ENG-PRE',
    'ENG-CHA': 'ENG-CHA',
    'CHAMPIONSHIP': 'ENG-CHA',
    'ENG-CHAMPIONSHIP': 'ENG-CHA',
    'ITA-SRA': 'ITA-SRA',
    'SERIE A': 'ITA-SRA',
    'ITA-SERIE A': 'ITA-SRA',
    'FRA-LG1': 'FRA-LG1',
    'LIGUE 1': 'FRA-LG1',
    'FRA-LIGUE 1': 'FRA-LG1',
    'FRA-LG2': 'FRA-LG2',
    'LIGUE 2': 'FRA-LG2',
    'FRA-LIGUE 2': 'FRA-LG2',
    'GER-BUN': 'GER-BUN',
    'BUNDESLIGA': 'GER-BUN',
    'GER-BUNDESLIGA': 'GER-BUN',
    'POR-PRI': 'POR-PRI',
    'PRIMEIRA LIGA': 'POR-PRI',
    'POR-PRIMEIRA LIGA': 'POR-PRI',
    'TUR-SUP': 'TUR-SUP',
    'SÜPER LIG': 'TUR-SUP',
    'TUR-SUPER LIG': 'TUR-SUP',
    'EUR-CHL': 'EUR-CHL',
    'CHAMPIONS LEAGUE': 'EUR-CHL',
    'UEFA CHAMPIONS LEAGUE': 'EUR-CHL',
    'EUR-CHAMPIONS-LEAGUE': 'EUR-CHL',
    'EUR-EUL': 'EUR-EUL',
    'EUROPA LEAGUE': 'EUR-EUL',
    'UEFA EUROPA LEAGUE': 'EUR-EUL',
    'EUR-EUROPA-LEAGUE': 'EUR-EUL'
};

function normalizeCompetitionCode(raw = '') {
    const clean = String(raw || '').trim().toUpperCase();
    if (COMP_MAP[clean]) return COMP_MAP[clean];
    for (const [k, v] of Object.entries(COMP_MAP)) {
        if (clean.includes(k)) return v;
    }
    return null;
}

async function main() {
    console.log('Iniciando extracción de picks históricos reales...');

    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const session = new StringSession(process.env.TELEGRAM_STRING_SESSION);

    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });
    await client.connect();
    console.log('Conectado a MTProto en modo lectura.');

    const dialogs = await client.getDialogs({ limit: 50 });
    const mtOficial = dialogs.find(d => String(d.id || '').includes('1478087155'));
    const fbBot = dialogs.find(d => String(d.id || '').includes('6168168880'));

    const picksMap = new Map();

    // 1. Extraer de Money Tips Oficial
    if (mtOficial) {
        console.log('Extrayendo mensajes de Money Tips Oficial...');
        const msgs = await client.getMessages(mtOficial.inputEntity, { limit: 250 });
        for (const m of msgs) {
            const text = m.message || '';
            if (!text.includes('PICK OFICIAL') && !text.includes('🎯')) continue;

            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            let teamsLine = '';
            let compLine = '';
            let kickoffLine = '';

            for (const line of lines) {
                if (line.includes(' vs ') || line.includes(' VS ')) {
                    teamsLine = line;
                } else if (line.includes('🏆')) {
                    compLine = line.replace('🏆', '').trim();
                } else if (line.includes('⏰ Inicio:')) {
                    kickoffLine = line.replace('⏰ Inicio:', '').trim();
                }
            }

            if (teamsLine && kickoffLine) {
                const parts = teamsLine.split(/\s+vs\s+|\s+VS\s+/i);
                if (parts.length === 2) {
                    const homeTeam = parts[0].trim();
                    const awayTeam = parts[1].trim();
                    const compCode = normalizeCompetitionCode(compLine);

                    // Parsear fecha kickoff (ej: "20/9/26, 22:45" o "19/9/26, 14:00")
                    let kickoffUtc = null;
                    const dateMatch = kickoffLine.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})/);
                    if (dateMatch) {
                        const day = dateMatch[1].padStart(2, '0');
                        const month = dateMatch[2].padStart(2, '0');
                        let year = dateMatch[3];
                        if (year.length === 2) year = `20${year}`;
                        const hour = dateMatch[4].padStart(2, '0');
                        const min = dateMatch[5].padStart(2, '0');
                        const madridStr = `${year}-${month}-${day} ${hour}:${min}`;
                        kickoffUtc = parseMadridDateTimeToUTC(madridStr);
                    }

                    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}_${kickoffUtc || ''}`;
                    if (!picksMap.has(key)) {
                        picksMap.set(key, {
                            source: 'MONEY_TIPS_OFICIAL',
                            messageId: m.id,
                            rawCompetition: compLine,
                            competitionCode: compCode,
                            homeTeam,
                            awayTeam,
                            originalKickoffMadrid: kickoffLine,
                            originalKickoffUtc: kickoffUtc
                        });
                    }
                }
            }
        }
    }

    // 2. Extraer de FutbolBrain
    if (fbBot) {
        console.log('Extrayendo mensajes de FutbolBrain...');
        const msgs = await client.getMessages(fbBot.inputEntity, { limit: 250 });
        for (const m of msgs) {
            const text = m.message || '';
            if (!text.includes('AI Model') || !text.includes('VS')) continue;

            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            let compCode = null;
            let homeTeam = '';
            let awayTeam = '';
            let kickoffTime = '';

            for (const line of lines) {
                // Formato: "ESP-SEG: Leganés VS Granada"
                const matchLine = line.match(/^([A-Z0-9\-]+):\s*(.+?)\s+VS\s+(.+)$/i);
                if (matchLine) {
                    compCode = normalizeCompetitionCode(matchLine[1]);
                    homeTeam = matchLine[2].trim();
                    awayTeam = matchLine[3].trim();
                }
                const kickoffMatch = line.match(/-Kickoff:\s*(\d{1,2}:\d{2})/i);
                if (kickoffMatch) {
                    kickoffTime = kickoffMatch[1].trim();
                }
            }

            if (homeTeam && awayTeam && kickoffTime) {
                const msgDate = m.date ? new Date(m.date * 1000) : new Date();
                const yyyy = msgDate.getFullYear();
                const mm = String(msgDate.getMonth() + 1).padStart(2, '0');
                const dd = String(msgDate.getDate()).padStart(2, '0');
                const madridStr = `${yyyy}-${mm}-${dd} ${kickoffTime}`;
                const kickoffUtc = parseMadridDateTimeToUTC(madridStr);

                const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}_${kickoffUtc || ''}`;
                if (!picksMap.has(key)) {
                    picksMap.set(key, {
                        source: 'FUTBOLBRAIN_TELEGRAM',
                        messageId: m.id,
                        rawCompetition: compCode,
                        competitionCode: compCode,
                        homeTeam,
                        awayTeam,
                        originalKickoffMadrid: `${yyyy}-${mm}-${dd} ${kickoffTime}`,
                        originalKickoffUtc: kickoffUtc
                    });
                }
            }
        }
    }

    await client.disconnect();

    const picks = Array.from(picksMap.values());
    console.log(`\nTotal picks únicos recolectados: ${picks.length}`);

    // Distribución por competición
    const compDistribution = {};
    for (const p of picks) {
        const c = p.competitionCode || 'UNKNOWN';
        compDistribution[c] = (compDistribution[c] || 0) + 1;
    }
    console.log('Distribución por competición:');
    for (const [c, count] of Object.entries(compDistribution)) {
        console.log(`  - ${c}: ${count}`);
    }

    // Guardar en archivo JSON de datos
    const outDir = path.resolve('data');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, 'historical-picks.json');
    fs.writeFileSync(outFile, JSON.stringify(picks, null, 2), 'utf8');
    console.log(`Guardado en: ${outFile}`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
