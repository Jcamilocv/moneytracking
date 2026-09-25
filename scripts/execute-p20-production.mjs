/**
 * @file P2.0: Producción - Reconciliación + Inserción 9 Missing + Settlement Real de los 81.
 * Ejecución autorizada por el CEO bajo estricto control y verificación.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OWNER_UID = 'Rvp7qaQBC5RQwSKICRKnAb8vaI93';
const BANK_ID = 'WwdyzJ4UCiTu2M7Uysnd';
const BANK_NAME = 'Money Tips 26/27';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/money-tracking-d908b/databases/(default)/documents`;

// Helper para obtener token de Firebase Tools
function getAuthToken() {
    const cfgPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
    if (!fs.existsSync(cfgPath)) throw new Error('No se encontró firebase-tools.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const token = cfg.tokens?.access_token;
    if (!token) throw new Error('No hay access token disponible en firebase-tools.json');
    return token;
}

// Convertir documento Firestore REST a objeto JS plano
function firestoreDocToObj(doc) {
    const id = doc.name.split('/').pop();
    const obj = { id, _name: doc.name };
    for (const [k, v] of Object.entries(doc.fields || {})) {
        if ('stringValue' in v) obj[k] = v.stringValue;
        else if ('integerValue' in v) obj[k] = Number(v.integerValue);
        else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
        else if ('booleanValue' in v) obj[k] = v.booleanValue;
        else if ('timestampValue' in v) obj[k] = v.timestampValue;
        else if ('nullValue' in v) obj[k] = null;
        else if ('arrayValue' in v) {
            obj[k] = (v.arrayValue.values || []).map(val => {
                if ('mapValue' in val) {
                    const m = {};
                    for (const [mk, mv] of Object.entries(val.mapValue.fields || {})) {
                        if ('stringValue' in mv) m[mk] = mv.stringValue;
                        else if ('integerValue' in mv) m[mk] = Number(mv.integerValue);
                        else if ('doubleValue' in mv) m[mk] = Number(mv.doubleValue);
                        else if ('booleanValue' in mv) m[mk] = mv.booleanValue;
                        else m[mk] = mv;
                    }
                    return m;
                }
                return val;
            });
        }
    }
    return obj;
}

// Convertir objeto JS a campos Firestore REST
function objToFirestoreFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('_') || k === 'id') continue;
        if (v === null || v === undefined) {
            fields[k] = { nullValue: null };
        } else if (typeof v === 'string') {
            fields[k] = { stringValue: v };
        } else if (typeof v === 'boolean') {
            fields[k] = { booleanValue: v };
        } else if (typeof v === 'number') {
            if (Number.isInteger(v)) fields[k] = { integerValue: String(v) };
            else fields[k] = { doubleValue: v };
        } else if (Array.isArray(v)) {
            fields[k] = {
                arrayValue: {
                    values: v.map(item => {
                        if (typeof item === 'object' && item !== null) {
                            return { mapValue: { fields: objToFirestoreFields(item) } };
                        }
                        return { stringValue: String(item) };
                    })
                }
            };
        }
    }
    return fields;
}

async function queryBankBets(token) {
    const url = `${BASE_URL}/users/${OWNER_UID}:runQuery`;
    const body = {
        structuredQuery: {
            from: [{ collectionId: 'bets' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'bankId' },
                    op: 'EQUAL',
                    value: { stringValue: BANK_ID }
                }
            }
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Error consultando apuestas: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.filter(d => d.document).map(d => firestoreDocToObj(d.document));
}

// Definición canónica de los 9 picks faltantes identificados en P1.9
const MISSING_9_PICKS = [
    {
        officialPickId: 'op_e4644593ed406783b62b154f94906a114e564ab9',
        homeTeam: 'Juventus',
        awayTeam: 'Atalanta',
        competition: 'ITA-Serie A',
        market: 'Ambos equipos marcan',
        selection: 'No',
        odds: 2.00,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-20T18:00:00.000Z',
        publishedAt: '2026-09-20T07:00:00.000Z',
        systemId: 'MT - ITA1 - V1.0',
        date: '2026-09-20',
        time: '20:00',
        expectedOutcome: 'won',
        score: '2 - 0',
        providerEventId: '2482181'
    },
    {
        officialPickId: 'op_fbc5bcc593d441a70745d791571412272a790eac',
        homeTeam: 'Milan',
        awayTeam: 'Lecce',
        competition: 'ITA-Serie A',
        market: 'Ambos equipos marcan',
        selection: 'No',
        odds: 1.66,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-20T20:45:00.000Z',
        publishedAt: '2026-09-20T07:00:00.000Z',
        systemId: 'MT - ITA1 - V1.0',
        date: '2026-09-20',
        time: '22:45',
        expectedOutcome: 'won',
        score: '3 - 0',
        providerEventId: '2482182'
    },
    {
        officialPickId: 'op_5b88bd03055ded2f002aab57080485577df2c0a5',
        homeTeam: 'Brighton & Hove Albion',
        awayTeam: 'Arsenal',
        competition: 'ENG-Premier League',
        market: 'Total de goles',
        selection: 'Menos de 3,5 goles',
        odds: 1.44,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T14:00:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - Premier League 02.5',
        date: '2026-09-19',
        time: '16:00',
        expectedOutcome: 'won',
        score: '3 - 0',
        providerEventId: '2494038'
    },
    {
        officialPickId: 'op_ad03143bc5cc224b982596fa86e18728c52ff3bd',
        homeTeam: 'Udinese',
        awayTeam: 'Cagliari',
        competition: 'ITA-Serie A',
        market: 'Ambos equipos marcan',
        selection: 'No',
        odds: 1.75,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T13:00:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - ITA1 - V1.0',
        date: '2026-09-19',
        time: '15:00',
        expectedOutcome: 'won',
        score: '0 - 1',
        providerEventId: '2482178'
    },
    {
        officialPickId: 'op_b231571d68a4556931ff3ec73b9fd57f7cdf1b7e',
        homeTeam: 'Bologna',
        awayTeam: 'Torino',
        competition: 'ITA-Serie A',
        market: 'Ambos equipos marcan',
        selection: 'No',
        odds: 1.95,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T13:00:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - ITA1 - V1.0',
        date: '2026-09-19',
        time: '15:00',
        expectedOutcome: 'lost',
        score: '1 - 1',
        providerEventId: '2482177'
    },
    {
        officialPickId: 'op_702488bba2dbdb6e0cd1d07eda24fd262cfaf15a',
        homeTeam: 'Cardiff City',
        awayTeam: 'Charlton Athletic',
        competition: 'ENG-Championship',
        market: 'Resultado final',
        selection: 'Visitante',
        odds: 4.20,
        stake: 0.75,
        amount: 75,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T11:30:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - ENG2 - v1.0',
        date: '2026-09-19',
        time: '13:30',
        expectedOutcome: 'lost',
        score: '3 - 1',
        providerEventId: '2501332'
    },
    {
        officialPickId: 'op_c4bd1d34082d46a732959434d79d4bd18dd9b9b0',
        homeTeam: 'Stoke City',
        awayTeam: 'Sheffield United',
        competition: 'ENG-Championship',
        market: 'Resultado final',
        selection: 'Visitante',
        odds: 2.90,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T11:30:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - ENG2 - v1.0',
        date: '2026-09-19',
        time: '13:30',
        expectedOutcome: 'lost',
        score: '2 - 1',
        providerEventId: '2501331'
    },
    {
        officialPickId: 'op_716e8bb705927106d71ec66b97b1c1c85fc354e2',
        homeTeam: 'Tottenham Hotspur',
        awayTeam: 'Aston Villa',
        competition: 'ENG-Premier League',
        market: 'Total de goles',
        selection: 'Menos de 3,5 goles',
        odds: 1.44,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T11:30:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - Premier League 02.5',
        date: '2026-09-19',
        time: '13:30',
        expectedOutcome: 'lost',
        score: '2 - 3',
        providerEventId: '2494037'
    },
    {
        officialPickId: 'op_9bcae2ce8e79db955d335e99788ee32e48c826d9',
        homeTeam: 'Newcastle United',
        awayTeam: 'Hull City',
        competition: 'ENG-Premier League',
        market: 'Total de goles',
        selection: 'Menos de 3,5 goles',
        odds: 1.53,
        stake: 1.5,
        amount: 150,
        bookmaker: 'Bet365',
        kickoffAt: '2026-09-19T12:00:00.000Z',
        publishedAt: '2026-09-19T13:06:00.000Z',
        systemId: 'MT - Premier League 02.5',
        date: '2026-09-19',
        time: '14:00',
        expectedOutcome: 'won',
        score: '2 - 1',
        providerEventId: '2494036'
    }
];

// Resoluciones de los 18 picks que estaban pendientes
const PENDING_18_RESOLUTIONS = {
    'op_7a26f508d10deb37d1872f5e6fdc8a844b8f06e0': { outcome: 'void', score: 'null - null', eventId: '2605681', reason: 'PST > 5 días (Bet365)' },
    'op_f9c2d9d28460670f6704f505d2cb0b881e9af074': { outcome: 'lost', score: '1 - 2', eventId: '2482172', reason: 'FT 1-2 (BTTS No)' },
    'op_79ea449af10beaa2f062486563af9ee6f8f55d74': { outcome: 'lost', score: '2 - 2', eventId: '2482168', reason: 'FT 2-2 (BTTS No)' },
    'op_64cbd67843a55b87e7c1a16b5618b0eb379852e1': { outcome: 'won', score: '0 - 0', eventId: '2494032', reason: 'FT 0-0 (U 3.5)' },
    'op_7dedb9318d837fde72129fbba816168979392b76': { outcome: 'lost', score: '4 - 1', eventId: '2501322', reason: 'FT 4-1 (1X2 Visitante)' },
    'op_ea875ba00bc0ed4e29c807f11a4ef48ebf2d9480': { outcome: 'lost', score: '2 - 3', eventId: '2494035', reason: 'FT 2-3 (U 3.5)' },
    'op_a7bffb296d1ad9d2b8c65588364072c0c54caccc': { outcome: 'lost', score: '2 - 2', eventId: '2494034', reason: 'FT 2-2 (U 3.5)' },
    'op_7b90c6258ffa95484875995d63ed52d098bfbb8c': { outcome: 'lost', score: '1 - 1', eventId: '2482171', reason: 'FT 1-1 (BTTS No)' },
    'op_9a77f1b63c614d0b6ce1f066e9dcf302041d224f': { outcome: 'lost', score: '1 - 0', eventId: '2501328', reason: 'FT 1-0 (1X2 Visitante)' },
    'op_b53f2e9e2ec01eb79a14e73d66fdfff2213b892d': { outcome: 'lost', score: '1 - 1', eventId: '2501325', reason: 'FT 1-1 (1X2 Visitante)' },
    'op_a19895e70785cd7c10a4885e0db47a0c891b94a2': { outcome: 'lost', score: '2 - 4', eventId: '2482175', reason: 'FT 2-4 (BTTS No)' },
    'op_e53b48dab5c5f41b1192d94fcc84f5dd4e7ae84a': { outcome: 'lost', score: '0 - 0', eventId: '2501319', reason: 'FT 0-0 (1X2 Visitante)' },
    'op_005562c0fa9c144c0a5f4b418a97d30061742d67': { outcome: 'lost', score: '2 - 1', eventId: '2501318', reason: 'FT 2-1 (1X2 Visitante)' },
    'op_2aa217e122f7048bbe85336c02eb0f7c6bac235a': { outcome: 'won', score: '1 - 2', eventId: '2570498', reason: 'FT 1-2 (1X2 Visitante)' },
    'op_195fa582ac74c681c76120967cd7b3725858a4a7': { outcome: 'lost', score: '1 - 1', eventId: '2501312', reason: 'FT 1-1 (1X2 Visitante)' },
    'op_a10dec124a502730688de9dbdbdf4701ef0c72a8': { outcome: 'lost', score: '3 - 1', eventId: '2501311', reason: 'FT 3-1 (1X2 Visitante)' },
    'op_0f8de443a4319b96630717449e66fb1b4466cb7c': { outcome: 'lost', score: '2 - 1', eventId: '2501309', reason: 'FT 2-1 (1X2 Visitante)' },
    'op_3b73825d46bec384945e11e7c9dca85f36d8e5c6': { outcome: 'lost', score: '1 - 1', eventId: '2501320', reason: 'FT 1-1 (1X2 Visitante)' }
};

async function main() {
    if (process.env.OPS_READ_ONLY_MODE === '1') {
        throw new Error('OPS_READ_ONLY_MODE: production repair script disabled');
    }
    console.log('='.repeat(75));
    console.log('P2.0 — PRODUCCIÓN: RECONCILIACIÓN + SETTLEMENT + CRON 01:00');
    console.log('='.repeat(75));

    const token = getAuthToken();

    // ─────────────────────────────────────────────────────────────────────────────
    // 0. BACKUP OBLIGATORIO Y RECONCILIACIÓN PRE-WRITE
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[PASO 0] Consultando estado actual de la banca...');
    const currentBets = await queryBankBets(token);
    const existingPickIds = new Set(currentBets.map(b => b.officialPickId).filter(Boolean));

    console.log(`  - TOTAL APUESTAS ACTUALES EN BANCA: ${currentBets.length}`);
    console.log(`  - UNIQUE OFFICIAL PICK IDS:         ${existingPickIds.size}`);

    const backupFile = path.resolve('moneytracking-dispatcher/data/backup-bank-72-p20.json');
    const manifestFile = path.resolve('moneytracking-dispatcher/data/rollback-manifest-p20.json');
    let missingPicksToCreate = [];

    if (currentBets.length === 72) {
        console.log('\nGenerando BACKUP de los 72 documentos originales...');
        fs.writeFileSync(backupFile, JSON.stringify(currentBets, null, 2), 'utf8');
        fs.writeFileSync(manifestFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            bankId: BANK_ID,
            totalRecords: 72,
            documentIds: currentBets.map(b => b.id)
        }, null, 2), 'utf8');
        console.log(`✓ Backup completado: 72 registros guardados.`);

        missingPicksToCreate = MISSING_9_PICKS.filter(p => !existingPickIds.has(p.officialPickId));
    } else if (currentBets.length === 81 && existingPickIds.size === 81) {
        console.log('✓ Los 9 picks oficiales ya fueron creados previamente de forma idempotente.');
        console.log('✓ Procediendo directamente a la liquidación de las 81 apuestas.');
    } else {
        throw new Error(`ABORTADO: Conteo inesperado en banca: ${currentBets.length} (esperado 72 o 81).`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. AÑADIR LOS 9 MISSING
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[PASO 2] Añadiendo los 9 picks oficiales faltantes a la banca...');
    let createdCount = 0;

    for (const p of missingPicksToCreate) {
        const betDoc = {
            schemaVersion: 1,
            bankId: BANK_ID,
            date: p.date,
            time: p.time,
            bookmaker: p.bookmaker,
            betMode: 'simple',
            title: `${p.homeTeam} vs ${p.awayTeam}`,
            market: p.market,
            selection: p.selection,
            displayMarket: p.market,
            displaySelection: p.selection,
            status: 'pending',
            category: 'Money Tips',
            odds: p.odds,
            amount: p.amount,
            stake: p.stake,
            officialPickId: p.officialPickId,
            officialPublishedAt: p.publishedAt,
            officialRecommendedStakePct: p.stake,
            copiedOdds: p.odds,
            isOfficialPickCopy: true,
            source: 'OFFICIAL_MONEY_TIPS',
            competition: p.competition,
            systemId: p.systemId,
            kickoffAt: p.kickoffAt,
            publishedAt: p.publishedAt,
            isBack: true,
            isLive: false,
            isFreebet: false,
            isEachWay: false,
            isHidden: false,
            comment: `Pick oficial Money Tips. Publicado: ${p.date}. Comprobante: https://app.pronosticosmoneytips.com/?pick=${p.officialPickId}`,
            selections: [{
                id: `official-${p.officialPickId}`,
                title: `${p.homeTeam} vs ${p.awayTeam}`,
                selection: p.selection,
                market: p.market,
                displayMarket: p.market,
                displaySelection: p.selection,
                sport: 'Fútbol',
                status: 'pending',
                category: 'Money Tips',
                competition: p.competition,
                odds: p.odds,
                isOpen: true
            }]
        };

        const createUrl = `${BASE_URL}/users/${OWNER_UID}/bets`;
        const res = await fetch(createUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: objToFirestoreFields(betDoc) })
        });

        if (!res.ok) {
            throw new Error(`Error creando pick ${p.officialPickId}: ${res.status} ${await res.text()}`);
        }
        createdCount++;
        console.log(`  ✓ Creado pick ${p.officialPickId} (${p.homeTeam} vs ${p.awayTeam})`);
    }

    // Verificación post-creación
    console.log('\nVerificando banca tras inserción...');
    const bankAfterAdd = await queryBankBets(token);
    const uniqueIdsAfterAdd = new Set(bankAfterAdd.map(b => b.officialPickId).filter(Boolean));

    console.log(`  - BANK TOTAL ACTUAL:          ${bankAfterAdd.length} (esperado 81)`);
    console.log(`  - UNIQUE OFFICIAL PICK IDS:    ${uniqueIdsAfterAdd.size} (esperado 81)`);
    console.log(`  - DUPLICATES:                  ${bankAfterAdd.length - uniqueIdsAfterAdd.size}`);

    if (bankAfterAdd.length !== 81 || uniqueIdsAfterAdd.size !== 81) {
        throw new Error(`ABORTADO: La banca no contiene exactamente 81 apuestas únicas tras inserción.`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. SETTLEMENT REAL DE LOS 81
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[PASO 3] Liquidando los 81 picks oficiales con TheSportsDB + Bet365...');
    
    // Cargar mapa de P14 para los picks ya resueltos
    const p14 = JSON.parse(fs.readFileSync('moneytracking-dispatcher/data/shadow-pipeline-report-p14.json', 'utf8'));
    const p14Map = new Map();
    for (const r of p14.results) {
        const k = `${r.candidate.homeTeam} vs ${r.candidate.awayTeam}`.toLowerCase();
        p14Map.set(k, r);
    }

    let wonCount = 0;
    let lostCount = 0;
    let voidCount = 0;
    let pendingCount = 0;
    let totalSettled = 0;

    const settledResults = [];

    for (const bet of bankAfterAdd) {
        let outcome = null;
        let reason = '';
        let score = '';
        let eventId = '';

        // 1. ¿Está en PENDING_18_RESOLUTIONS?
        if (PENDING_18_RESOLUTIONS[bet.officialPickId]) {
            const r = PENDING_18_RESOLUTIONS[bet.officialPickId];
            outcome = r.outcome;
            reason = r.reason;
            score = r.score;
            eventId = r.eventId;
        } else {
            // 2. ¿Es uno de los 9 missing?
            const m = MISSING_9_PICKS.find(p => p.officialPickId === bet.officialPickId);
            if (m) {
                outcome = m.expectedOutcome;
                reason = `TheSportsDB FT ${m.score}`;
                score = m.score;
                eventId = m.providerEventId;
            } else {
                // 3. Buscar en P14
                const k = (bet.title || '').toLowerCase();
                let p14Item = p14Map.get(k);
                if (!p14Item) {
                    for (const [key, val] of p14Map.entries()) {
                        if (k.includes(val.candidate.homeTeam.toLowerCase()) && k.includes(val.candidate.awayTeam.toLowerCase())) {
                            p14Item = val;
                            break;
                        }
                    }
                }

                if (p14Item && p14Item.result?.finalScore) {
                    score = p14Item.result.finalScore;
                    eventId = p14Item.result.matchedEvent?.idEvent || '';
                    const [hGStr, aGStr] = score.replace(/\s+/g, '').split('-');
                    const hG = Number(hGStr);
                    const aG = Number(aGStr);

                    const mkt = bet.market || bet.displayMarket || '';
                    const sel = bet.selection || bet.displaySelection || '';

                    if (mkt === 'Ambos equipos marcan') {
                        const btts = hG > 0 && aG > 0;
                        outcome = (sel === 'Sí' || sel === 'SI') ? (btts ? 'won' : 'lost') : (!btts ? 'won' : 'lost');
                        reason = `FT ${score} (BTTS ${sel})`;
                    } else if (mkt === 'Total de goles') {
                        const tot = hG + aG;
                        const isUnder = sel.includes('Menos') || sel.includes('U');
                        outcome = isUnder ? (tot < 3.5 ? 'won' : 'lost') : (tot > 3.5 ? 'won' : 'lost');
                        reason = `FT ${score} (${sel})`;
                    } else if (mkt === 'Resultado final') {
                        if (sel === 'Visitante') outcome = aG > hG ? 'won' : 'lost';
                        else if (sel === 'Local') outcome = hG > aG ? 'won' : 'lost';
                        else if (sel === 'Empate') outcome = hG === aG ? 'won' : 'lost';
                        reason = `FT ${score} (1X2 ${sel})`;
                    }
                }
            }
        }

        if (!outcome) {
            console.warn(`[WARN] Pick ${bet.officialPickId} (${bet.title}) no pudo ser resuelto.`);
            pendingCount++;
            continue;
        }

        if (outcome === 'won') wonCount++;
        else if (outcome === 'lost') lostCount++;
        else if (outcome === 'void') voidCount++;

        // Actualizar documento en Firestore
        const updateUrl = `https://firestore.googleapis.com/v1/${bet._name}?updateMask.fieldPaths=status&updateMask.fieldPaths=settlementOutcome&updateMask.fieldPaths=settlementReason&updateMask.fieldPaths=finalScore&updateMask.fieldPaths=providerEventId&updateMask.fieldPaths=settledAt`;
        const patchBody = {
            fields: {
                status: { stringValue: outcome },
                settlementOutcome: { stringValue: outcome },
                settlementReason: { stringValue: reason },
                finalScore: { stringValue: score },
                providerEventId: { stringValue: eventId },
                settledAt: { timestampValue: new Date().toISOString() }
            }
        };

        const patchRes = await fetch(updateUrl, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody)
        });

        if (!patchRes.ok) {
            throw new Error(`Error actualizando apuesta ${bet.id}: ${patchRes.status} ${await patchRes.text()}`);
        }

        totalSettled++;
        settledResults.push({ id: bet.id, officialPickId: bet.officialPickId, title: bet.title, outcome, score, reason });
    }

    console.log(`\n✓ Liquidación completada: ${totalSettled} apuestas actualizadas.`);
    console.log(`  - WON:                         ${wonCount} (esperado 32)`);
    console.log(`  - LOST:                        ${lostCount} (esperado 48)`);
    console.log(`  - VOID:                        ${voidCount} (esperado 1)`);
    console.log(`  - PENDING:                     ${pendingCount} (esperado 0)`);

    if (wonCount !== 32 || lostCount !== 48 || voidCount !== 1 || pendingCount !== 0) {
        throw new Error(`DISCREPANCIA DETECTADA: Resultados reales (W=${wonCount}, L=${lostCount}, V=${voidCount}) difieren del dry-run esperado.`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. VERIFICACIÓN POST-SETTLEMENT & P&L
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[PASO 4] Verificación de Paridad y P&L...');
    const finalBets = await queryBankBets(token);

    let totalStake = 0;
    let totalProfit = 0;

    for (const b of finalBets) {
        const amt = b.amount || 0;
        const odds = b.odds || 1;
        totalStake += amt;
        if (b.status === 'won') totalProfit += amt * (odds - 1);
        else if (b.status === 'lost') totalProfit -= amt;
    }

    const roi = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0;

    console.log(`  - TOTAL FINAL EN BANCA:        ${finalBets.length}`);
    console.log(`  - TOTAL APOSTADO:              ${totalStake.toFixed(2)} €`);
    console.log(`  - BENEFICIO NETO (P&L):        ${totalProfit.toFixed(2)} €`);
    console.log(`  - ROI:                         ${roi.toFixed(2)} %`);

    // Guardar reporte de ejecución P2.0
    const reportPath = path.resolve('moneytracking-dispatcher/data/p20-execution-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        bankId: BANK_ID,
        backupFile,
        manifestFile,
        preWriteBankCount: 72,
        missingPicksCreated: createdCount,
        duplicatesCreated: 0,
        finalBankCount: finalBets.length,
        won: wonCount,
        lost: lostCount,
        void: voidCount,
        pending: pendingCount,
        totalStake,
        totalProfit,
        roi,
        settledBets: settledResults
    }, null, 2), 'utf8');

    console.log(`\nReporte guardado en ${reportPath}`);
}

main().catch(err => {
    console.error('\n[ERROR CRÍTICO EN EJECUCIÓN P2.0]:', err.message);
    process.exit(1);
});
