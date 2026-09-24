/**
 * @file TheSportsDB Free PoC - Script de validación en vivo
 * Ejecuta comprobaciones reales contra TheSportsDB Free API (key '3'):
 * 1. Verificación de catálogo de las 12 competiciones Money Tips
 * 2. Búsqueda y reconciliación de 6 eventos reales observados
 * 3. Lookup de evento por idEvent y obtención de marcador/estado
 * 4. Demostración de liquidación bajo reglas Bet365 para los 7 mercados Money Tips
 */

import {
    TheSportsDbProvider,
    THESPORTSDB_COMPETITIONS,
    discoverTheSportsDbRegistry,
    normalizeTheSportsDbEvent,
    matchTheSportsDbEvent,
    getTheSportsDbStatusInfo,
    evaluatePickSettlement
} from '../server/sports-data/index.js';

const TARGET_EVENTS = [
    {
        competitionCode: 'ESP-PRE',
        homeTeam: 'Atlético Madrid',
        awayTeam: 'Real Madrid',
        expectedKickoffUtc: '2026-09-20T14:15:00.000Z',
        notes: 'Derbi madrileño 20/09'
    },
    {
        competitionCode: 'ESP-SEG',
        homeTeam: 'Ceuta',
        awayTeam: 'Real Valladolid',
        expectedKickoffUtc: '2026-09-20T14:15:00.000Z',
        notes: 'LaLiga Hypermotion 20/09'
    },
    {
        competitionCode: 'GER-BUN',
        homeTeam: 'Bayer Leverkusen',
        awayTeam: 'RB Leipzig',
        expectedKickoffUtc: '2026-09-20T13:30:00.000Z',
        notes: 'Bundesliga 20/09'
    },
    {
        competitionCode: 'ENG-PRE',
        homeTeam: 'Bournemouth',
        awayTeam: 'Liverpool',
        expectedKickoffUtc: '2026-09-20T13:00:00.000Z',
        notes: 'Premier League 20/09'
    },
    {
        competitionCode: 'FRA-LG1',
        homeTeam: 'Toulouse',
        awayTeam: 'Le Havre',
        expectedKickoffUtc: '2026-09-19T18:45:00.000Z',
        notes: 'Ligue 1 19/09'
    },
    {
        competitionCode: 'FRA-LG1',
        homeTeam: 'Lyon',
        awayTeam: 'Rennes',
        expectedKickoffUtc: '2026-09-19T18:45:00.000Z',
        notes: 'Ligue 1 19/09 (alias Lyon -> Olympique Lyonnais)'
    }
];

async function main() {
    console.log('='.repeat(70));
    console.log('P1.1 — THESPORTSDB FREE POC: LIVE VALIDATION');
    console.log('='.repeat(70));

    const provider = new TheSportsDbProvider({
        maxRequests: 30, // Guard para la PoC
        cacheTtlMs: 300000
    });

    console.log(`[Config] Provider: ${provider.name}`);
    console.log(`[Config] API Key: ${provider.apiKey ? (provider.apiKey === '3' ? '3 (Free Tier Default)' : 'Custom Key') : 'None'}`);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Catálogo de 12 Competiciones
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n' + '-'.repeat(70));
    console.log('1. CATÁLOGO DE 12 COMPETICIONES MONEY TIPS');
    console.log('-'.repeat(70));

    console.log(`Competiciones mapeadas: ${THESPORTSDB_COMPETITIONS.length}/12`);
    for (const comp of THESPORTSDB_COMPETITIONS) {
        console.log(`  - [${comp.internalCode}] ${comp.canonicalName.padEnd(25)} -> idLeague: ${comp.theSportsDbId} (${comp.country})`);
    }

    // Comprobación de lookup de liga para verificar conectividad
    try {
        console.log('\n[Conectividad] Verificando lookup de liga La Liga (4335)...');
        const leagueDetail = await provider.getLeagueDetails('4335');
        const leagueObj = leagueDetail?.leagues?.[0] || leagueDetail;
        if (leagueObj) {
            console.log(`  ✔ Conectividad OK: ${leagueObj.strLeague} (${leagueObj.strCountry})`);
        } else {
            console.log('  ⚠ No se pudo obtener detalle de liga 4335.');
        }
    } catch (err) {
        console.error('  ✖ Error de conectividad al consultar liga:', err.message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Búsqueda y Reconciliación de los 6 Eventos Objetivo
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n' + '-'.repeat(70));
    console.log('2. BÚSQUEDA Y RECONCILIACIÓN DE 6 EVENTOS OBJETIVO');
    console.log('-'.repeat(70));

    const matchedResults = [];

    for (const target of TARGET_EVENTS) {
        console.log(`\nBuscando: ${target.homeTeam} vs ${target.awayTeam} [${target.competitionCode}] (${target.notes})`);
        
        try {
            const query = `${target.homeTeam} vs ${target.awayTeam}`;
            const events = await provider.searchEvents(query);

            console.log(`  Resultados brutos encontrados: ${events?.length || 0}`);

            const matchResult = matchTheSportsDbEvent({
                competitionCode: target.competitionCode,
                homeTeam: target.homeTeam,
                awayTeam: target.awayTeam,
                kickoffAt: target.expectedKickoffUtc
            }, events);

            console.log(`  Estado de match: ${matchResult.status}`);

            if (matchResult.theSportsDbMatchFound) {
                const f = matchResult.event;
                const statusInfo = getTheSportsDbStatusInfo(f.status);

                console.log(`  ✔ Evento ID: ${f.idEvent}`);
                console.log(`  ✔ Nombre: ${f.name}`);
                console.log(`  ✔ Kickoff TheSportsDB (UTC): ${f.kickoffAt}`);
                console.log(`  ✔ Kickoff FutbolBrain (UTC):  ${target.expectedKickoffUtc}`);
                console.log(`  ✔ Diferencia: ${matchResult.differenceMinutes} minutos`);
                console.log(`  ✔ Confianza match: ${matchResult.matchConfidence}`);
                console.log(`  ✔ Estado: ${f.status} (${statusInfo.meaning} - ${statusInfo.category})`);
                console.log(`  ✔ Marcador: ${f.homeScore !== null ? `${f.homeScore} - ${f.awayScore}` : 'Sin marcador'}`);
                console.log(`  ✔ Bet365 Policy: ${statusInfo.bet365Policy}`);

                matchedResults.push({
                    target,
                    fixture: f,
                    statusInfo,
                    matchResult
                });
            } else {
                console.log(`  ✖ Match fallido: ${matchResult.status}`);
            }
        } catch (err) {
            console.error(`  ✖ Error buscando evento: ${err.message}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Demostración de Liquidación Bet365 para Mercados Money Tips
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n' + '-'.repeat(70));
    console.log('3. DEMOSTRACIÓN DE LIQUIDACIÓN BET365 (MERCADOS MONEY TIPS)');
    console.log('-'.repeat(70));

    // Seleccionamos el derbi madrileño (Atlético vs Real Madrid) como caso de estudio
    const atletiReal = matchedResults.find(m => m.target.homeTeam.includes('Atlético'));
    if (atletiReal && atletiReal.fixture.homeScore !== null) {
        const { homeScore, awayScore } = atletiReal.fixture;
        console.log(`\nCaso de Estudio: ${atletiReal.fixture.name}`);
        console.log(`Marcador Final Oficial: ${atletiReal.fixture.homeTeam} ${homeScore} - ${awayScore} ${atletiReal.fixture.awayTeam}`);

        const testPicks = [
            { market: 'Resultado final', selection: 'Local', desc: '1X2 Local' },
            { market: 'Resultado final', selection: 'Empate', desc: '1X2 Empate' },
            { market: 'Resultado final', selection: 'Visitante', desc: '1X2 Visitante' },
            { market: 'Ambos equipos marcan', selection: 'Sí', desc: 'BTTS Sí' },
            { market: 'Ambos equipos marcan', selection: 'No', desc: 'BTTS No' },
            { market: 'Total de goles', selection: 'Más de 2,5 goles', desc: 'Over 2.5' },
            { market: 'Total de goles', selection: 'Menos de 2,5 goles', desc: 'Under 2.5' },
            { market: 'Doble oportunidad', selection: '1X', desc: '1X' },
            { market: 'Doble oportunidad', selection: 'X2', desc: 'X2' }
        ];

        for (const p of testPicks) {
            const evalResult = evaluatePickSettlement({
                market: p.market,
                selection: p.selection,
                homeGoals: homeScore,
                awayGoals: awayScore
            });
            console.log(`  - [${p.desc.padEnd(15)}] Selección: ${p.selection.padEnd(18)} -> ${evalResult.outcome.padEnd(8)} (Explicación: ${evalResult.explanation})`);
        }
    } else {
        console.log('  No se pudo realizar demo de liquidación sobre Atlético vs Real Madrid.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Resumen de Métricas de la PoC
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n' + '-'.repeat(70));
    console.log('4. RESUMEN DE MÉTRICAS');
    console.log('-'.repeat(70));
    const stats = provider.getStats();
    console.log(`Total Requests realizadas: ${stats.totalRequests}`);
    console.log(`Cache Hits:                ${stats.cacheHits}`);
    console.log(`Cache Misses:              ${stats.cacheMisses}`);
    console.log(`Rate Limit Hits (429):     ${stats.rateLimitHits}`);
    console.log(`Eventos objetivo reconciliados: ${matchedResults.filter(m => m.matchResult.kickoffMatch === 'KICKOFF_RECONCILED').length}/${TARGET_EVENTS.length}`);
    console.log('='.repeat(70));
}

main().catch(err => {
    console.error('FATAL ERROR EN POC:', err);
    process.exit(1);
});
