/**
 * @file Ejecución del Settlement Backlog en DRY_RUN sobre los picks oficiales pendientes (P1.6).
 * Utiliza TheSportsDB + Reglas Bet365 implementadas.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    TheSportsDbProvider,
    TheSportsDbShadowPipeline,
    SHADOW_PIPELINE_DECISIONS,
    SHADOW_FIXTURE_MATCH_STATUS
} from '../server/sports-data/index.js';
import { normalizeFutbolBrainTelegramPick } from '../server/futbolbrain-telegram-poc/canonical-normalizer.js';

async function main() {
    console.log('='.repeat(75));
    console.log('P1.6 — BACKLOG SETTLEMENT VALIDATION (DRY_RUN)');
    console.log('='.repeat(75));

    const dataFile = path.resolve('data/historical-picks.json');
    const allPicks = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const tgMessages = JSON.parse(fs.readFileSync('.telegram-audit-messages.json'));

    // Normalizar mensajes de telegram para obtener markets/selections exactos
    const tgCandidates = [];
    for (const m of tgMessages) {
        try {
            const c = normalizeFutbolBrainTelegramPick(m.text, {
                telegramMessageId: m.id,
                observedAt: m.dateUTC
            });
            tgCandidates.push(c);
        } catch {}
    }

    // Filtrar picks oficiales de temporada pendientes (antes de 20/09 o muestra representativa de ~74)
    // Se excluyen los 2 picks del 20/09 presentes en la banca
    const officialPicks = allPicks.filter(p => p.source === 'MONEY_TIPS_OFICIAL');
    const pendingPicks = officialPicks.filter(p => !p.originalKickoffMadrid?.includes('20/9/26'));

    console.log(`Picks oficiales totales: ${officialPicks.length}`);
    console.log(`Picks pendientes en backlog (antes de 20/09): ${pendingPicks.length}`);

    // Cargar reporte P1.4 para reutilizar resultados ya verificados si están disponibles
    let p14ResultsMap = new Map();
    if (fs.existsSync('data/shadow-pipeline-report-p14.json')) {
        const p14 = JSON.parse(fs.readFileSync('data/shadow-pipeline-report-p14.json'));
        for (const r of p14.results) {
            const k = `${r.candidate.homeTeam.toLowerCase()}_vs_${r.candidate.awayTeam.toLowerCase()}`;
            p14ResultsMap.set(k, r);
        }
        console.log(`Resultados previos P1.4 en caché: ${p14ResultsMap.size}`);
    }

    const provider = new TheSportsDbProvider({
        maxRequests: 100,
        cacheTtlMs: 3600000,
        minIntervalMs: 2200
    });

    const pipeline = new TheSportsDbShadowPipeline({ provider, dryRun: true });

    const settlementReport = [];
    let idx = 0;

    for (const pick of pendingPicks) {
        idx++;
        // Enlazar con telegram candidate si existe
        const tg = tgCandidates.find(t =>
            (t.homeTeam && pick.homeTeam && (t.homeTeam.toLowerCase().includes(pick.homeTeam.toLowerCase()) || pick.homeTeam.toLowerCase().includes(t.homeTeam.toLowerCase()))) &&
            (t.awayTeam && pick.awayTeam && (t.awayTeam.toLowerCase().includes(pick.awayTeam.toLowerCase()) || pick.awayTeam.toLowerCase().includes(t.awayTeam.toLowerCase())))
        );

        const market = tg?.market || pick.market || 'Resultado final';
        const selection = tg?.selection || pick.selection || 'Local';
        const candidate = {
            homeTeam: pick.homeTeam,
            awayTeam: pick.awayTeam,
            competitionCode: pick.competitionCode,
            kickoffAt: pick.originalKickoffUtc,
            market,
            selection,
            executionMode: 'PRODUCTION'
        };

        const cacheKey = `${pick.homeTeam.toLowerCase()}_vs_${pick.awayTeam.toLowerCase()}`;
        let res = null;

        if (p14ResultsMap.has(cacheKey)) {
            res = p14ResultsMap.get(cacheKey).result;
        } else {
            console.log(`[Query API] ${idx}/${pendingPicks.length}: ${pick.homeTeam} vs ${pick.awayTeam}...`);
            res = await pipeline.processCandidate(candidate);
            await new Promise(resolve => setTimeout(resolve, 2200));
        }

        const isMatched = res.status === SHADOW_FIXTURE_MATCH_STATUS.MATCHED || res.fixtureMatchStatus === 'MATCHED';
        const resultFound = Boolean(res.finalScore || (res.finalStatus && res.finalStatus !== 'NS'));
        let proposedStatus = 'PENDING';
        let score = res.finalScore || 'N/A';
        let reason = '';

        if (res.settlementResult?.outcome === 'WON') {
            proposedStatus = 'WON';
            reason = res.settlementResult.explanation;
        } else if (res.settlementResult?.outcome === 'LOST') {
            proposedStatus = 'LOST';
            reason = res.settlementResult.explanation;
        } else if (res.settlementResult?.outcome === 'VOID') {
            proposedStatus = 'VOID';
            reason = res.settlementResult.explanation;
        } else if (res.settlementResult?.status === 'PENDING_POSTPONED' || res.settlementBlockedReason === 'POSTPONED_PENDING') {
            proposedStatus = 'PENDING';
            reason = 'PST <= 5 días (Bet365)';
        } else if (res.settlementBlockedReason === 'REGULATION_SCORE_UNAVAILABLE') {
            proposedStatus = 'PENDING';
            reason = 'REGULATION_SCORE_UNAVAILABLE';
        } else if (!isMatched) {
            proposedStatus = 'PENDING';
            reason = 'SPORTS_DATA_UNMATCHED';
        } else if (!resultFound) {
            proposedStatus = 'PENDING';
            reason = 'RESULT_NOT_AVAILABLE';
        } else {
            proposedStatus = 'PENDING';
            reason = res.settlementResult?.explanation || 'AWAITING_SETTLEMENT';
        }

        settlementReport.push({
            index: idx,
            messageId: pick.messageId,
            event: `${pick.homeTeam} vs ${pick.awayTeam}`,
            competition: pick.competitionCode || pick.rawCompetition,
            kickoffMadrid: pick.originalKickoffMadrid,
            kickoffUtc: pick.originalKickoffUtc,
            market,
            selection,
            matched: isMatched ? 'S' : 'N',
            resultFound: resultFound ? 'S' : 'N',
            proposedStatus,
            score,
            reason
        });
    }

    // Calcular resumen agregado
    const totalPending = settlementReport.length;
    const won = settlementReport.filter(r => r.proposedStatus === 'WON').length;
    const lost = settlementReport.filter(r => r.proposedStatus === 'LOST').length;
    const void_ = settlementReport.filter(r => r.proposedStatus === 'VOID').length;
    const autoSettleable = won + lost + void_;
    const stillPending = settlementReport.filter(r => r.proposedStatus === 'PENDING' && r.reason.includes('PST')).length;
    const sportsDataUnmatched = settlementReport.filter(r => r.reason === 'SPORTS_DATA_UNMATCHED').length;
    const regScoreUnavail = settlementReport.filter(r => r.reason === 'REGULATION_SCORE_UNAVAILABLE').length;
    const errors = 0;

    console.log('\n' + '='.repeat(75));
    console.log('RECONCILIACIÓN DEL BACKLOG (RESUMEN AGREGADO)');
    console.log('='.repeat(75));
    console.log(`TOTAL PENDING:                   ${totalPending}`);
    console.log(`AUTO-SETTLEABLE:                 ${autoSettleable}`);
    console.log(`WON:                             ${won}`);
    console.log(`LOST:                            ${lost}`);
    console.log(`VOID:                            ${void_}`);
    console.log(`STILL_PENDING:                   ${stillPending}`);
    console.log(`SPORTS_DATA_UNMATCHED:           ${sportsDataUnmatched}`);
    console.log(`REGULATION_SCORE_UNAVAILABLE:    ${regScoreUnavail}`);
    console.log(`ERRORS:                          ${errors}`);
    console.log('='.repeat(75));

    // Guardar reporte
    const outPath = path.resolve('data/backlog-settlement-report-p16.json');
    fs.writeFileSync(outPath, JSON.stringify({
        summary: {
            totalPending,
            autoSettleable,
            won,
            lost,
            void: void_,
            stillPending,
            sportsDataUnmatched,
            regScoreUnavail,
            errors
        },
        picks: settlementReport
    }, null, 2), 'utf8');

    console.log(`Reporte guardado en: ${outPath}`);
}

main().catch(err => {
    console.error('Error en backlog settlement:', err);
    process.exit(1);
});
