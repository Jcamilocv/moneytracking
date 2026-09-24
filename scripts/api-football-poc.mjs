/**
 * @file api-football-poc.mjs
 * 
 * Script ejecutor de la PoC P1.0 contra API-Football.
 * 
 * MEDIDAS DE SEGURIDAD:
 * - 0 escrituras en Firestore
 * - 0 mutaciones en producción
 * - 0 publicaciones en Telegram
 * - La API key se lee de process.env.API_FOOTBALL_KEY o .env.local
 * - Nunca expone la API key en consola ni reportes
 * - Presupuesto estricto < 30 requests
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    ApiFootballProvider,
    discoverCompetitionRegistry,
    matchFutbolBrainFixture,
    getMatchStatusInfo,
    evaluatePickSettlement,
    areCurrentMarketsSettleableFromFinalScore,
    SETTLEMENT_OUTCOMES
} from '../server/sports-data/index.js';

// Cargar .env.local si existe
function loadEnvLocal() {
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
}

loadEnvLocal();

async function runPoC() {
    const apiKey = process.env.API_FOOTBALL_KEY?.trim() || null;
    const isKeyPresent = Boolean(apiKey && apiKey.length >= 8);

    if (!isKeyPresent) {
        console.log('API_KEY_PRESENT: NO');
        console.log('API_FOOTBALL_KEY no encontrada en .env.local.');
        console.log('Por favor, configure API_FOOTBALL_KEY en .env.local para proceder con las llamadas reales.');
        return { keyPresent: false };
    }

    console.log('API_KEY_PRESENT: YES');
    console.log('Iniciando PoC con presupuesto máximo de 28 requests...');

    // Instanciar provider con presupuesto máximo 28
    const provider = new ApiFootballProvider({
        apiKey,
        maxRequests: 28,
        silent: false
    });

    // ── PASO 1: DESCUBRIR LAS 12 COMPETICIONES (1 REQUEST) ──
    console.log('\n--- 1. Descubriendo registro de ligas (/leagues) ---');
    const discovery = await discoverCompetitionRegistry(provider);
    console.log(`Cobertura: ${discovery.coverageCount}/${discovery.total} competiciones identificadas.`);

    const registryMap = new Map();
    for (const item of discovery.registry) {
        registryMap.set(item.internalCode, item);
        console.log(`  [${item.internalCode}] ${item.canonicalName} -> ID: ${item.providerLeagueId || 'NOT_FOUND'} (${item.country}) Season: ${item.currentSeason || 'N/A'}`);
    }

    // ── PASO 2: CONSULTAR FIXTURES DE LAS COMPETICIONES ──
    console.log('\n--- 2. Consultando fixtures para validación de eventos ---');
    
    // Eventos objetivo de FutbolBrain para validación:
    const targetEvents = [
        {
            name: 'Atlético Madrid vs Real Madrid',
            homeTeam: 'Atlético Madrid',
            awayTeam: 'Real Madrid',
            compCode: 'ESP-PRE',
            date: '2026-09-20',
            kickoffAt: '2026-09-20T14:15:00.000Z'
        },
        {
            name: 'Ceuta vs Real Valladolid',
            homeTeam: 'Ceuta',
            awayTeam: 'Real Valladolid',
            compCode: 'ESP-SEG',
            date: '2026-09-20',
            kickoffAt: '2026-09-20T14:15:00.000Z'
        },
        {
            name: 'Bayer Leverkusen vs RB Leipzig',
            homeTeam: 'Bayer Leverkusen',
            awayTeam: 'RB Leipzig',
            compCode: 'GER-BUN',
            date: '2026-09-20',
            kickoffAt: '2026-09-20T13:30:00.000Z'
        },
        {
            name: 'Bournemouth vs Liverpool',
            homeTeam: 'Bournemouth',
            awayTeam: 'Liverpool',
            compCode: 'ENG-PRE',
            date: '2026-09-20',
            kickoffAt: '2026-09-20T13:00:00.000Z'
        }
    ];

    let freePlanSeasonRestricted = false;
    let freePlanSeasonError = null;

    // Probar si season 2026 está bloqueada por el plan gratuito
    try {
        console.log('  Probando consulta de temporada actual (2026) en La Liga...');
        await provider.getFixtures({
            league: 140,
            season: 2026,
            date: '2026-09-20'
        });
    } catch (err) {
        if (err.message.includes('Free plans do not have access to this season')) {
            freePlanSeasonRestricted = true;
            freePlanSeasonError = err.message;
            console.log(`  [RESTRICCIÓN PLAN GRATUITO CONFIRMADA]: ${err.message}`);
            console.log('  Para evaluar la estructura real de fixtures, kickoffs y resultados en la PoC, utilizaremos season: 2024 (permitida en plan gratuito).\n');
        } else {
            throw err;
        }
    }

    const seasonToUse = freePlanSeasonRestricted ? 2024 : 2026;
    const matchResults = [];
    const allFetchedFixtures = [];

    for (const target of targetEvents) {
        // Pausa de 2.5s para respetar el rate limit por minuto del plan gratuito (10 req/min)
        await new Promise(r => setTimeout(r, 2500));

        const comp = registryMap.get(target.compCode);
        if (!comp || !comp.providerLeagueId) {
            matchResults.push({
                target,
                match: { status: 'NOT_FOUND', reason: 'Liga no identificada en API-Football' }
            });
            continue;
        }

        console.log(`  Buscando evento "${target.name}" en [${comp.internalCode}] Liga ID ${comp.providerLeagueId} (season: ${seasonToUse})...`);

        let fixtures = [];
        try {
            // Consultar fixtures de la liga en la temporada permitida (sin 'last', que requiere plan de pago)
            fixtures = await provider.getFixtures({
                league: comp.providerLeagueId,
                season: seasonToUse
            });
        } catch (err) {
            console.log(`    Error al consultar fixtures de ${comp.internalCode}: ${err.message}`);
        }

        if (fixtures && fixtures.length > 0) {
            allFetchedFixtures.push(...fixtures);
            console.log(`    Recuperados ${fixtures.length} fixtures para ${comp.internalCode}.`);
        }

        const match = matchFutbolBrainFixture(target, fixtures || []);
        matchResults.push({ target, match, seasonUsed: seasonToUse });
        console.log(`    Resultado matching: ${match.status} (Found: ${match.apiFootballMatchFound}, Kickoff: ${match.kickoffMatch || 'N/A'}, Diff: ${match.differenceMinutes !== null ? match.differenceMinutes + 'm' : 'N/A'})`);
    }

    // ── PASO 3: VALIDAR ESTRUCTURA DE FIXTURES REALES ──
    console.log('\n--- 3. Verificando estructura de datos de Fixtures ---');
    const sampleFixture = allFetchedFixtures[0] || null;
    let fixtureDataSufficient = false;
    let providerKickoffFormat = 'ISO_8601_UTC';

    if (sampleFixture) {
        const f = sampleFixture.fixture || {};
        const l = sampleFixture.league || {};
        const t = sampleFixture.teams || {};
        const g = sampleFixture.goals || {};

        const hasRequiredFields = Boolean(
            f.id && f.date && f.timestamp !== undefined && f.status?.short &&
            l.id && l.name &&
            t.home?.id && t.home?.name && t.away?.id && t.away?.name &&
            g.home !== undefined && g.away !== undefined
        );

        fixtureDataSufficient = hasRequiredFields;
        providerKickoffFormat = typeof f.date === 'string' && f.date.includes('T') ? 'ISO_8601' : 'TIMESTAMP';
        console.log(`  Sample fixture ID: ${f.id}`);
        console.log(`  Date: ${f.date}, Timestamp: ${f.timestamp}, Timezone: ${f.timezone}`);
        console.log(`  Teams: ${t.home?.name} vs ${t.away?.name}`);
        console.log(`  Status: ${f.status?.short} (${f.status?.long})`);
        console.log(`  Goals: ${g.home} - ${g.away}`);
    }

    // ── PASO 4: EVALUACIÓN DE PARTIDOS FINALIZADOS Y SETTLEMENT ──
    console.log('\n--- 4. Evaluación de partidos finalizados y liquidación ---');
    const finishedFixtures = allFetchedFixtures.filter(f => f.fixture?.status?.short === 'FT').slice(0, 3);
    console.log(`  Fixtures finalizados (FT) encontrados para test: ${finishedFixtures.length}`);

    for (const ff of finishedFixtures) {
        const homeName = ff.teams?.home?.name;
        const awayName = ff.teams?.away?.name;
        const hg = ff.goals?.home ?? 0;
        const ag = ff.goals?.away ?? 0;

        console.log(`  Partido: ${homeName} ${hg} - ${ag} ${awayName} (FT)`);

        // Simular evaluación de los 3 mercados principales
        const bttsRes = evaluatePickSettlement({ market: 'Ambos equipos marcan', selection: 'Sí', homeGoals: hg, awayGoals: ag });
        const o25Res = evaluatePickSettlement({ market: 'Total de goles', selection: 'Más de 2,5 goles', homeGoals: hg, awayGoals: ag });
        const res1x2 = evaluatePickSettlement({ market: 'Resultado final', selection: 'Local', homeGoals: hg, awayGoals: ag });

        console.log(`    - BTTS Yes: ${bttsRes.outcome} (${bttsRes.explanation})`);
        console.log(`    - Over 2.5: ${o25Res.outcome} (${o25Res.explanation})`);
        console.log(`    - 1X2 Local: ${res1x2.outcome} (${res1x2.explanation})`);
    }

    const settleable = areCurrentMarketsSettleableFromFinalScore();

    // ── PASO 5: REPORTE DE RATE LIMIT FINAL ──
    const finalRateLimit = provider.getRateLimitStatus();
    console.log('\n--- 5. Consumo de cuota ---');
    console.log(`  Requests realizadas: ${finalRateLimit.requestsMade}`);
    console.log(`  Límite diario: ${finalRateLimit.dailyLimit || 'N/A'}`);
    console.log(`  Restante diario: ${finalRateLimit.dailyRemaining || 'N/A'}`);

    return {
        keyPresent: true,
        discovery,
        matchResults,
        fixtureDataSufficient,
        providerKickoffFormat,
        finishedTestedCount: finishedFixtures.length,
        settleable,
        finalRateLimit
    };
}

runPoC().then(res => {
    if (res?.keyPresent) {
        console.log('\n=== PoC Ejecutada con Éxito ===');
    }
}).catch(err => {
    console.error('Error durante la ejecución de la PoC:', err.message);
});
