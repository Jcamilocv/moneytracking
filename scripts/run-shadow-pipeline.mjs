/**
 * @file Ejecución del Shadow Pipeline sobre los picks locales reales (P1.3).
 * Modo 100% DRY_RUN / SHADOW_MODE.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    TheSportsDbProvider,
    TheSportsDbShadowPipeline,
    SHADOW_PIPELINE_DECISIONS,
    SHADOW_FIXTURE_MATCH_STATUS,
    SHADOW_KICKOFF_STATUS
} from '../server/sports-data/index.js';

async function main() {
    console.log('='.repeat(75));
    console.log('P1.4 — HARDENING DEL MATCHING THESPORTSDB: EJECUCIÓN CON PICKS REALES');
    console.log('='.repeat(75));

    const dataFile = path.resolve('data/historical-picks.json');
    if (!fs.existsSync(dataFile)) {
        throw new Error(`Archivo no encontrado: ${dataFile}`);
    }

    const allPicks = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    console.log(`Picks locales disponibles: ${allPicks.length}`);

    const provider = new TheSportsDbProvider({
        maxRequests: 400,
        cacheTtlMs: 3600000,
        minIntervalMs: 2200
    });

    const pipeline = new TheSportsDbShadowPipeline({ provider, dryRun: true });

    // Seleccionar muestra representativa de picks reales (los mismos evaluados en P1.2)
    const selectedPicks = [];
    const countsPerComp = {};
    const MAX_PER_COMP = 15;
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

    console.log(`Picks reales procesados en Shadow Pipeline: ${selectedPicks.length}`);

    const detailedResults = [];
    let idx = 0;

    for (const pick of selectedPicks) {
        idx++;
        // Asignar mercado y selección estándar si el pick no los especificaba directamente
        const market = pick.market || 'Resultado final';
        const selection = pick.selection || 'Local';

        const candidate = {
            homeTeam: pick.homeTeam,
            awayTeam: pick.awayTeam,
            competitionCode: pick.competitionCode,
            kickoffAt: pick.originalKickoffUtc,
            market,
            selection,
            executionMode: pick.executionMode || 'PRODUCTION'
        };

        const res = await pipeline.processCandidate(candidate);

        detailedResults.push({
            index: idx,
            candidate,
            result: res
        });

        const statusLabel = res.status === SHADOW_FIXTURE_MATCH_STATUS.MATCHED
            ? `MATCHED (${res.eventId})`
            : res.status;
        const koLabel = res.kickoffStatus || 'N/A';
        const decLabel = res.publicationDecision || 'N/A';
        const settLabel = res.settlementResult?.status === 'SIMULATED'
            ? `SETTLED (${res.settlementResult.outcome})`
            : (res.settlementResult?.status === 'BLOCKED' ? `BLOCKED (${res.settlementResult.reason})` : 'PENDING');

        console.log(`[${String(idx).padStart(2)}/80] [${(pick.competitionCode || 'UNKNOWN').padEnd(7)}] ${pick.homeTeam} vs ${pick.awayTeam} -> ${statusLabel} | KO: ${koLabel} | Dec: ${decLabel} | Sett: ${settLabel}`);

        // Pacing (2000ms para respetar límites de TheSportsDB Free)
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const t = pipeline.getTelemetry();
    const matchRate = ((t.fixturesMatched / t.candidatesSeen) * 100).toFixed(1);
    const exactOrExplicable = t.kickoffReconciled + (t.kickoffExplicableTimezone || 0);
    const exactOrExplicableRate = t.fixturesMatched > 0
        ? ((exactOrExplicable / t.fixturesMatched) * 100).toFixed(1)
        : '0.0';
    const unexplainedMismatch = t.kickoffMismatch - (t.kickoffExplicableTimezone || 0);

    console.log('\n' + '='.repeat(75));
    console.log('TELEMETRÍA FINAL DEL SHADOW PIPELINE (P1.4)');
    console.log('='.repeat(75));
    console.log(`candidatesSeen:                 ${t.candidatesSeen}`);
    console.log(`fixturesMatched:                ${t.fixturesMatched} (${matchRate}%)`);
    console.log(`fixturesUncertain:              ${t.fixturesUncertain}`);
    console.log(`kickoffReconciled (Exact):      ${t.kickoffReconciled}`);
    console.log(`kickoffExplicableTimezone:      ${t.kickoffExplicableTimezone || 0}`);
    console.log(`total Kickoff Exact/Explicable: ${exactOrExplicable} (${exactOrExplicableRate}%)`);
    console.log(`kickoffMismatch (Unexplained):  ${unexplainedMismatch}`);
    console.log(`resultFound:                    ${t.resultFound}`);
    console.log(`settlementSimulated:            ${t.settlementSimulated}`);
    console.log(`settlementBlocked:              ${t.settlementBlocked}`);
    console.log(`falsePositives:                 ${t.falsePositives}`);
    console.log('='.repeat(75));

    console.log('\n' + '='.repeat(75));
    console.log('COMPARATIVA P1.3 vs P1.4:');
    console.log('='.repeat(75));
    console.log(`Métrica                  | P1.3    | P1.4    | Delta`);
    console.log(`-------------------------|---------|---------|-------`);
    console.log(`Candidatos evaluados     | 80      | ${t.candidatesSeen}      | 0`);
    console.log(`Fixtures Matched         | 53      | ${t.fixturesMatched}      | ${t.fixturesMatched - 53 >= 0 ? '+' : ''}${t.fixturesMatched - 53}`);
    console.log(`Match Rate               | 66.2%   | ${matchRate}%   | +${(matchRate - 66.2).toFixed(1)}%`);
    console.log(`Fixtures Uncertain       | 27      | ${t.fixturesUncertain}       | ${t.fixturesUncertain - 27}`);
    console.log(`Kickoff Exact/Explicable | 43      | ${exactOrExplicable}      | +${exactOrExplicable - 43}`);
    console.log(`Tasa Kickoff Exact/Expl. | 81.1%   | ${exactOrExplicableRate}%   | +${(exactOrExplicableRate - 81.1).toFixed(1)}%`);
    console.log(`False Positives          | 0       | ${t.falsePositives}       | 0`);
    console.log('='.repeat(75));

    // Guardar informe P1.4
    const reportPathP14 = path.resolve('data/shadow-pipeline-report-p14.json');
    fs.writeFileSync(reportPathP14, JSON.stringify({
        telemetry: {
            ...t,
            matchRate: `${matchRate}%`,
            exactOrExplicable,
            exactOrExplicableRate: `${exactOrExplicableRate}%`,
            unexplainedMismatch
        },
        results: detailedResults
    }, null, 2), 'utf8');
    console.log(`Informe P1.4 guardado en: ${reportPathP14}`);

    // Actualizar también shadow-pipeline-report.json
    const reportPath = path.resolve('data/shadow-pipeline-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        telemetry: {
            ...t,
            matchRate: `${matchRate}%`,
            exactOrExplicable,
            exactOrExplicableRate: `${exactOrExplicableRate}%`,
            unexplainedMismatch
        },
        results: detailedResults
    }, null, 2), 'utf8');
}

main().catch(err => {
    console.error('ERROR EN SHADOW PIPELINE:', err);
    process.exit(1);
});
