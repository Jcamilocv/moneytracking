import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatOfficialTelegramMessage } from '../api/_lib/telegram.js';
import { normalizeOfficialPickInput, semanticOfficialPickKey } from '../api/_lib/official-pick-data.js';
import { normalizeFutbolBrainOwnerCandidate, ingestFutbolBrainOwnerCandidate } from '../server/futbolbrain-local-ingest.js';
import { scheduledAtForOfficialPick, PUBLICATION_POLICIES } from '../server/official-pick-scheduling.js';

// Extraer parseKickoff directamente de content.js de la extensión
const contentSource = readFileSync(resolve(process.cwd(), '../futbolbrain-local-alert-pilot/content.js'), 'utf8');
const parseKickoffFn = new Function(`
  const normalise = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  ${contentSource.slice(contentSource.indexOf('const parseKickoff'), contentSource.indexOf('const isTodayLocal'))}
  return parseKickoff;
`)();

test('Regresión 1: ISO sin timezone "2026-09-19T16:30:00" -> 2026-09-19T14:30:00.000Z (16:30 Madrid CEST)', () => {
    const domIso = '2026-09-19T16:30:00';
    const kickoff = parseKickoffFn(domIso);
    assert.ok(kickoff instanceof Date, 'Debe devolver un Date válido');
    assert.equal(kickoff.toISOString(), '2026-09-19T14:30:00.000Z', 'Debe interpretarse canónicamente como Europe/Madrid (CEST UTC+2)');

    const madridStr = kickoff.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
    assert.equal(madridStr, '19/9/26, 16:30', 'En Europe/Madrid (CEST) debe representar las 16:30');
});

test('Regresión 2: Formato europeo "19/09/2026 16:30" -> 2026-09-19T14:30:00.000Z (16:30 Madrid CEST)', () => {
    const europeanStr = '19/09/2026 16:30';
    const kickoff = parseKickoffFn(europeanStr);
    assert.ok(kickoff instanceof Date, 'Debe devolver un Date válido');
    assert.equal(kickoff.toISOString(), '2026-09-19T14:30:00.000Z', 'Debe interpretarse canónicamente como Europe/Madrid (CEST UTC+2)');

    const madridStr = kickoff.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
    assert.equal(madridStr, '19/9/26, 16:30', 'En Europe/Madrid (CEST) debe representar las 16:30');
});

test('Regresión 2b: Equivalencia exacta entre ISO y Europeo (mismo timestamp UTC)', () => {
    const isoKickoff = parseKickoffFn('2026-09-19T16:30:00');
    const euroKickoff = parseKickoffFn('19/09/2026 16:30');
    assert.equal(isoKickoff.getTime(), euroKickoff.getTime(), 'Ambos formatos deben producir exactamente el mismo epoch');
    assert.equal(isoKickoff.toISOString(), euroKickoff.toISOString());
    assert.equal(isoKickoff.toISOString(), '2026-09-19T14:30:00.000Z');
});

test('Regresión 2c: Protección contra eliminación prematura de pending a las 15:06 CEST', () => {
    // Escenario del incidente real: a las 15:06:31 CEST (13:06:31 UTC), el partido es a las 16:30 CEST (14:30 UTC)
    const europeanStr = '19/09/2026 16:30';
    const kickoffAt = parseKickoffFn(europeanStr);
    const nowAtScan = new Date('2026-09-19T13:06:31.147Z'); // 15:06:31 CEST

    // Condición T-5 de content.js:
    // 1. if (pick.rule.mode === 'T_MINUS_5' && now < pick.kickoffAt.getTime() - 5 * 60 * 1000) continue;
    const windowStartMs = kickoffAt.getTime() - 5 * 60 * 1000; // 14:25 UTC = 16:25 CEST
    const isBeforeT5 = nowAtScan.getTime() < windowStartMs;
    assert.equal(isBeforeT5, true, 'A las 15:06 CEST debe seguir bloqueado esperando la ventana T-5 de las 16:25 CEST');

    // 2. Condición de expiración: if (pick.kickoffAt.getTime() <= now + 60 * 1000) delete state.pending[pick.id];
    const isExpired = kickoffAt.getTime() <= nowAtScan.getTime() + 60 * 1000;
    assert.equal(isExpired, false, 'Bajo NINGÚN concepto debe considerarse expirado a las 15:06 CEST ni borrarse de pending');
});

test('Regresión 3: Invierno CET (UTC+1)', () => {
    // 20:45 CET en enero es 19:45 UTC
    const winterIso = '2026-01-15T20:45:00';
    const kickoff = parseKickoffFn(winterIso);
    assert.equal(kickoff.toISOString(), '2026-01-15T19:45:00.000Z');

    const madridStr = kickoff.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
    assert.equal(madridStr, '15/1/26, 20:45', 'En invierno (CET) 19:45 UTC es 20:45 Madrid');

    const msg = formatOfficialTelegramMessage({
        id: 'op_winter',
        event: { homeTeam: 'Real Madrid', awayTeam: 'Valencia', competition: 'ESP-Primera Division', kickoffAt: kickoff.toISOString() },
        bet: { market: 'Resultado final', selection: '1', oddsAtPublication: 1.50 },
        source: { evidenceHash: 'fedcba0987654321' }
    });
    assert.match(msg, /Inicio: 15\/1\/26, 20:45/);
});

test('Regresión 4: Cambio de día UTC/Madrid', () => {
    // 00:30 CEST el 19 de septiembre en Madrid son las 22:30 UTC el 18 de septiembre
    const lateIso = '2026-09-19T00:30:00';
    const kickoff = parseKickoffFn(lateIso);
    assert.equal(kickoff.toISOString(), '2026-09-18T22:30:00.000Z');

    const madridDay = kickoff.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    assert.equal(madridDay, '2026-09-19', 'El día en Madrid debe ser el 19 de septiembre');

    const pick = {
        event: {
            sourceEventId: 'evt_day_change',
            competition: 'ESP-Primera Division',
            homeTeam: 'Sevilla',
            awayTeam: 'Betis',
            kickoffAt: kickoff.toISOString()
        },
        bet: { market: 'Ambos marcan', selection: 'Sí' },
        system: { id: 'MT - Premier League 02.5' }
    };
    const key = semanticOfficialPickKey(pick);
    assert.ok(key, 'Clave semántica generada correctamente');
});

test('Regresión 5: T5 con ISO sin timezone — kickoff real 20:45 Madrid genera envío exactamente a 20:40 Madrid, NO a 18:40', () => {
    // DOM entrega: "2026-09-18T20:45:00" para partido a las 20:45 Madrid
    const domIso = '2026-09-18T20:45:00';
    const kickoffAt = parseKickoffFn(domIso);
    assert.equal(kickoffAt.toISOString(), '2026-09-18T18:45:00.000Z');

    // Comprobar la condición exacta del temporizador T-5 de content.js:
    // if (pick.rule.mode === 'T_MINUS_5' && now < pick.kickoffAt.getTime() - 5 * 60 * 1000) continue;
    const windowStartMs = kickoffAt.getTime() - 5 * 60 * 1000;
    const windowStartDate = new Date(windowStartMs);

    assert.equal(windowStartDate.toISOString(), '2026-09-18T18:40:00.000Z');

    const triggerMadridTime = windowStartDate.toLocaleTimeString('es-ES', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    assert.equal(triggerMadridTime, '20:40', 'El temporizador debe dispararse exactamente a las 20:40 Madrid');
    assert.notEqual(triggerMadridTime, '18:40', 'Bajo NINGÚN concepto debe dispararse a las 18:40');

    // A las 20:39 (Madrid): still blocked
    const at2039 = new Date('2026-09-18T18:39:00.000Z');
    assert.equal(at2039.getTime() < windowStartMs, true, 'A las 20:39 todavía no se envía');

    // A las 20:40 (Madrid): unlocked
    const at2040 = new Date('2026-09-18T18:40:00.000Z');
    assert.equal(at2040.getTime() < windowStartMs, false, 'A las 20:40 se desbloquea para envío');
});

test('Regresión 6: EARLY permanece sin alteración (MT - ITA1 - V1.0 y MT - Premier League 02.5)', async () => {
    const earlyCandidate = {
        event: {
            sourceEventId: 'fb-own-early-ok',
            competition: 'ITA-Serie A',
            homeTeam: 'Monza',
            awayTeam: 'Sassuolo',
            kickoffAt: parseKickoffFn('2026-09-18T20:45:00').toISOString()
        },
        system: { id: 'MT - ITA1 - V1.0' },
        visiblePick: { selection: 'No', odds: '1.95' },
        source: { provider: 'futbolbrain-owner-browser', observedAt: '2026-09-18T08:00:00.000Z' }
    };

    const normalized = normalizeFutbolBrainOwnerCandidate(earlyCandidate, { now: new Date('2026-09-18T08:00:00.000Z') });
    assert.equal(normalized.publicationPolicy, PUBLICATION_POLICIES.IMMEDIATE);
    assert.equal(normalized.executionMode, 'EARLY');
    assert.equal(normalized.bet.market, 'Ambos equipos marcan');
    assert.equal(normalized.bet.selection, 'No');
    assert.equal(normalized.bet.recommendedStakePct, 0.75);
    assert.equal(normalized.event.kickoffAt.toISOString(), '2026-09-18T18:45:00.000Z');
});

test('Regresión 7: cleanDateWithMadridFallback y parseKickoffFn producen idéntico timestamp UTC', async () => {
    const { cleanDateWithMadridFallback } = await import('../api/_lib/timezone.js');
    const iso = '2026-09-19T16:30:00';
    const euro = '19/09/2026 16:30';

    const cleanIso = cleanDateWithMadridFallback(iso, 'kickoffAt');
    const parseIso = parseKickoffFn(iso);
    assert.equal(cleanIso.toISOString(), parseIso.toISOString());
    assert.equal(cleanIso.toISOString(), '2026-09-19T14:30:00.000Z');

    const cleanEuro = cleanDateWithMadridFallback(euro, 'kickoffAt');
    const parseEuro = parseKickoffFn(euro);
    assert.equal(cleanEuro.toISOString(), parseEuro.toISOString());
    assert.equal(cleanEuro.toISOString(), '2026-09-19T14:30:00.000Z');
});
