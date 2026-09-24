/**
 * @file Validación histórica ampliada de TheSportsDB (P1.2)
 * Evalúa entre 50 y 100 picks históricos reales de Money Tips contra TheSportsDB Free API.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    TheSportsDbProvider,
    THESPORTSDB_COMPETITIONS,
    matchTheSportsDbEvent,
    getTheSportsDbStatusInfo,
    BET365_RULES
} from '../server/sports-data/index.js';

async function main() {
    console.log('='.repeat(75));
    console.log('P1.2 — VALIDACIÓN HISTÓRICA AMPLIADA THESPORTSDB');
    console.log('='.repeat(75));

    // Cargar picks históricos
    const dataFile = path.resolve('data/historical-picks.json');
    if (!fs.existsSync(dataFile)) {
        throw new Error(`No se encontró el archivo de picks históricos: ${dataFile}`);
    }

    const allPicks = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    console.log(`Picks históricos disponibles: ${allPicks.length}`);

    // Selección balanceada entre 50 y 100 picks (objetivo ~70-80)
    const selectedPicks = [];
    const countsPerComp = {};
    const MAX_PER_COMP = 15;

    // Priorizar ligas con menos picks para tener máxima representatividad
    const compPriority = ['TUR-SUP', 'GER-BUN', 'EUR-EUL', 'FRA-LG1', 'EUR-CHL', 'ESP-SEG', 'ESP-PRE', 'ENG-PRE', 'ENG-CHA', 'ITA-SRA'];

    for (const comp of compPriority) {
        const matching = allPicks.filter(p => p.competitionCode === comp);
        for (const p of matching) {
            countsPerComp[comp] = (countsPerComp[comp] || 0) + 1;
            if (countsPerComp[comp] <= MAX_PER_COMP) {
                selectedPicks.push(p);
            }
        }
    }

    console.log(`Picks seleccionados para la prueba: ${selectedPicks.length}`);
    console.log('Distribución de muestra seleccionada:');
    for (const [c, count] of Object.entries(countsPerComp)) {
        console.log(`  - ${c}: ${Math.min(count, MAX_PER_COMP)} picks`);
    }

    const provider = new TheSportsDbProvider({
        maxRequests: 150, // Budget suficiente para los picks
        cacheTtlMs: 3600000
    });

    console.log(`\n[Config] Provider: ${provider.name}`);
    console.log(`[Config] API Key: ${provider.apiKey ? (provider.apiKey === '123' ? '123 (Development / Free Config)' : 'Custom Key') : 'None'}`);

    const results = [];
    let falsePositives = 0;
    let aliasesUsed = 0;
    const compMetrics = {};

    for (const comp of THESPORTSDB_COMPETITIONS) {
        compMetrics[comp.internalCode] = {
            code: comp.internalCode,
            name: comp.canonicalName,
            tested: 0,
            found: 0,
            notFound: 0,
            exactKickoff: 0,
            kickoffMismatch: 0,
            resultsAvailable: 0
        };
    }

    // Procesar cada pick
    let index = 0;
    for (const pick of selectedPicks) {
        index++;
        const cCode = pick.competitionCode || 'UNKNOWN';
        if (compMetrics[cCode]) compMetrics[cCode].tested++;

        const query = `${pick.homeTeam} vs ${pick.awayTeam}`;
        process.stdout.write(`[${index}/${selectedPicks.length}] [${cCode}] ${pick.homeTeam} vs ${pick.awayTeam}... `);

        try {
            const events = await provider.searchEvents(query);
            const matchResult = matchTheSportsDbEvent({
                competitionCode: pick.competitionCode,
                homeTeam: pick.homeTeam,
                awayTeam: pick.awayTeam,
                kickoffAt: pick.originalKickoffUtc
            }, events);

            if (matchResult.theSportsDbMatchFound) {
                const f = matchResult.event;
                const statusInfo = getTheSportsDbStatusInfo(f.status);

                // Auditoría de falso positivo: ¿los equipos coinciden realmente?
                const homeMatchesReal = matchResult.providerHome.toLowerCase().includes(pick.homeTeam.toLowerCase()) ||
                    pick.homeTeam.toLowerCase().includes(matchResult.providerHome.toLowerCase()) ||
                    matchResult.matchConfidence === 'ALIAS' || matchResult.matchConfidence === 'NORMALIZED';
                const awayMatchesReal = matchResult.providerAway.toLowerCase().includes(pick.awayTeam.toLowerCase()) ||
                    pick.awayTeam.toLowerCase().includes(matchResult.providerAway.toLowerCase()) ||
                    matchResult.matchConfidence === 'ALIAS' || matchResult.matchConfidence === 'NORMALIZED';

                if (!homeMatchesReal || !awayMatchesReal) {
                    falsePositives++;
                }

                if (matchResult.matchConfidence === 'ALIAS') {
                    aliasesUsed++;
                }

                const hasResult = f.homeScore !== null && f.awayScore !== null;
                const isExactKickoff = matchResult.kickoffMatch === 'KICKOFF_RECONCILED' && matchResult.differenceMinutes === 0;

                if (compMetrics[cCode]) {
                    compMetrics[cCode].found++;
                    if (isExactKickoff) compMetrics[cCode].exactKickoff++;
                    else if (matchResult.kickoffMatch === 'KICKOFF_MISMATCH') compMetrics[cCode].kickoffMismatch++;
                    if (hasResult) compMetrics[cCode].resultsAvailable++;
                }

                const entry = {
                    index,
                    moneyTipsCompetition: cCode,
                    home: pick.homeTeam,
                    away: pick.awayTeam,
                    kickoffOriginal: pick.originalKickoffUtc || pick.originalKickoffMadrid,
                    theSportsDbEventFound: true,
                    idEvent: f.idEvent,
                    providerCompetition: f.leagueName,
                    providerHome: f.homeTeam,
                    providerAway: f.awayTeam,
                    providerKickoff: f.kickoffAt,
                    differenceMinutes: matchResult.differenceMinutes,
                    kickoffStatus: matchResult.kickoffMatch,
                    matchConfidence: matchResult.matchConfidence,
                    finalStatus: f.status,
                    statusMeaning: statusInfo.meaning,
                    regulationScoreSafe: statusInfo.regulationScoreSafe,
                    finalScore: hasResult ? `${f.homeScore} - ${f.awayScore}` : null,
                    notes: isExactKickoff ? 'OK' : `Diff: ${matchResult.differenceMinutes}m`
                };

                results.push(entry);
                console.log(`FOUND (id: ${f.idEvent}, diff: ${matchResult.differenceMinutes}m, status: ${f.status}, score: ${entry.finalScore || 'N/A'})`);
            } else {
                if (compMetrics[cCode]) compMetrics[cCode].notFound++;

                const entry = {
                    index,
                    moneyTipsCompetition: cCode,
                    home: pick.homeTeam,
                    away: pick.awayTeam,
                    kickoffOriginal: pick.originalKickoffUtc || pick.originalKickoffMadrid,
                    theSportsDbEventFound: false,
                    idEvent: null,
                    providerCompetition: null,
                    providerHome: null,
                    providerAway: null,
                    providerKickoff: null,
                    differenceMinutes: null,
                    kickoffStatus: 'NOT_FOUND',
                    matchConfidence: 'NO_MATCH',
                    finalStatus: null,
                    statusMeaning: null,
                    regulationScoreSafe: null,
                    finalScore: null,
                    notes: 'No matching event found in TheSportsDB'
                };

                results.push(entry);
                console.log('NOT FOUND');
            }
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
        }

        // Pacing a 2000ms para respetar el límite de 30 req/min del plan gratuito
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cálculo de Métricas Globales
    // ─────────────────────────────────────────────────────────────────────────
    const totalTested = results.length;
    const totalFound = results.filter(r => r.theSportsDbEventFound).length;
    const totalNotFound = results.filter(r => !r.theSportsDbEventFound).length;
    const exactKickoffCount = results.filter(r => r.kickoffStatus === 'KICKOFF_RECONCILED' && r.differenceMinutes === 0).length;
    const kickoffMismatchCount = results.filter(r => r.theSportsDbEventFound && r.differenceMinutes !== 0 && r.differenceMinutes !== null).length;
    const resultsAvailableCount = results.filter(r => r.finalScore !== null).length;

    const foundPct = ((totalFound / totalTested) * 100).toFixed(1);
    const notFoundPct = ((totalNotFound / totalTested) * 100).toFixed(1);
    const exactKickoffPct = totalFound > 0 ? ((exactKickoffCount / totalFound) * 100).toFixed(1) : '0.0';
    const kickoffMismatchPct = totalFound > 0 ? ((kickoffMismatchCount / totalFound) * 100).toFixed(1) : '0.0';
    const resultsAvailablePct = totalFound > 0 ? ((resultsAvailableCount / totalFound) * 100).toFixed(1) : '0.0';

    console.log('\n' + '='.repeat(75));
    console.log('RESUMEN DE MÉTRICAS GLOBALES (P1.2)');
    console.log('='.repeat(75));
    console.log(`TOTAL PICKS TESTED:       ${totalTested}`);
    console.log(`FOUND %:                  ${foundPct}% (${totalFound}/${totalTested})`);
    console.log(`NOT FOUND %:              ${notFoundPct}% (${totalNotFound}/${totalTested})`);
    console.log(`EXACT KICKOFF %:          ${exactKickoffPct}% (${exactKickoffCount}/${totalFound})`);
    console.log(`KICKOFF MISMATCH %:       ${kickoffMismatchPct}% (${kickoffMismatchCount}/${totalFound})`);
    console.log(`FALSE POSITIVE COUNT:     ${falsePositives}`);
    console.log(`TEAM ALIASES REQUIRED:    ${aliasesUsed}`);
    console.log(`RESULTS AVAILABLE %:      ${resultsAvailablePct}% (${resultsAvailableCount}/${totalFound})`);

    console.log('\n' + '-'.repeat(75));
    console.log('COBERTURA POR COMPETICIÓN (12 COMPETICIONES CANÓNICAS)');
    console.log('-'.repeat(75));
    console.log('Código   | Competición               | Test | Found | Match % | Exact KO | Results');
    console.log('-'.repeat(75));

    for (const comp of THESPORTSDB_COMPETITIONS) {
        const m = compMetrics[comp.internalCode];
        const matchRate = m.tested > 0 ? ((m.found / m.tested) * 100).toFixed(0) + '%' : 'N/A*';
        const exactKoRate = m.found > 0 ? ((m.exactKickoff / m.found) * 100).toFixed(0) + '%' : 'N/A';
        const resRate = m.found > 0 ? ((m.resultsAvailable / m.found) * 100).toFixed(0) + '%' : 'N/A';

        console.log(
            `${m.code.padEnd(8)} | ${m.name.padEnd(25)} | ${String(m.tested).padStart(4)} | ${String(m.found).padStart(5)} | ${matchRate.padStart(7)} | ${exactKoRate.padStart(8)} | ${resRate.padStart(7)}`
        );
    }
    console.log('* Competiciones sin picks en el histórico reciente de Telegram se indican expresamente.');

    // Guardar informe completo en JSON
    const reportPath = path.resolve('data/amplified-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        summary: {
            totalTested,
            totalFound,
            totalNotFound,
            foundPct: Number(foundPct),
            notFoundPct: Number(notFoundPct),
            exactKickoffCount,
            exactKickoffPct: Number(exactKickoffPct),
            kickoffMismatchCount,
            kickoffMismatchPct: Number(kickoffMismatchPct),
            falsePositives,
            aliasesUsed,
            resultsAvailableCount,
            resultsAvailablePct: Number(resultsAvailablePct)
        },
        competitions: compMetrics,
        picks: results
    }, null, 2), 'utf8');

    console.log(`\nInforme completo guardado en: ${reportPath}`);
    console.log('='.repeat(75));
}

main().catch(err => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
});
