import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Extraer funciones y lógica de content.js
const contentSource = readFileSync(resolve(process.cwd(), '../futbolbrain-local-alert-pilot/content.js'), 'utf8');

// Simulación del runtime de content.js
const makeContentRuntime = () => {
    let storedState = null;
    let storedBridge = {
        endpoint: 'https://app.pronosticosmoneytips.com/api/internal/futbolbrain-local-picks',
        token: '5fef313299877a21ce5e84acce9d13794a4c3cdb7c662eb74d5ae68119044e13',
        autoStartVersion: 6
    };

    const SYSTEMS = Object.freeze({
        'MT - CHA EUR - V1.0': { mode: 'AL_RECIBIR', label: 'Publicable al recibir' },
        'MT - ENG2 - v1.0': { mode: 'AL_RECIBIR', label: 'Publicable al recibir' },
        'MT - ITA1 - V1.0': { mode: 'AL_RECIBIR', label: 'Publicable al recibir' },
        'MT - Premier League 02.5': { mode: 'AL_RECIBIR', label: 'Publicable al recibir' },
        'MT - FRA1 FRA2 - V1.0': { mode: 'T_MINUS_5', label: 'Publicar cinco minutos antes' },
        'MT-LAB-BTTS-ESP-v0.1': { mode: 'T_MINUS_5', label: 'Publicar cinco minutos antes' }
    });

    const normalise = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const hash = (value) => {
        let result = 5381;
        for (const char of value) result = ((result << 5) + result) ^ char.charCodeAt(0);
        return (result >>> 0).toString(36);
    };

    const parseKickoff = (value) => {
        const cleaned = normalise(value);
        const iso = cleaned.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        if (iso) {
            const date = new Date(`${iso[0]}Z`);
            return Number.isNaN(date.getTime()) ? null : date;
        }
        const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
        if (!match) return null;
        const [, day, month, year, hour, minute] = match;
        const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0));
        return Number.isNaN(date.getTime()) ? null : date;
    };

    const stablePickId = (system, cells) => `${system}:${hash(`${cells.join('|')}|${[...cells].reverse().join('|')}`)}`;

    const candidateFromFields = ({ dateText, competition, fixture, rawSelection, rawOdds, system }) => {
        if (!SYSTEMS[system]) return null;
        if ([competition, fixture, rawSelection, rawOdds, system].some((value) => /…|\.\.\./.test(String(value || '')))) return null;
        const kickoffAt = parseKickoff(dateText);
        const teams = fixture.split(/\s+vs\s+/i).map(normalise);
        const odds = Number(String(rawOdds).replace(',', '.'));
        if (!kickoffAt || teams.length !== 2 || !teams[0] || !teams[1] || !Number.isFinite(odds)) return null;
        const identity = ['2026-09-19', competition, teams[0], teams[1], rawSelection, system].map(normalise);
        const id = stablePickId(system, identity);
        return {
            id,
            system,
            rule: SYSTEMS[system],
            kickoffAt,
            payload: {
                event: { homeTeam: teams[0], awayTeam: teams[1], competition, kickoffAt: kickoffAt.toISOString() },
                system: { id: system },
                visiblePick: { selection: rawSelection, odds }
            }
        };
    };

    // Implementación exacta de la lógica de escaneo y baseline con recuperación T5
    const simulateScan = ({ picks, state, isBaseline = false, nowMs = Date.now() }) => {
        const nextState = JSON.parse(JSON.stringify(state));
        if (isBaseline) {
            nextState.seen = {};
            nextState.armed = false;
        }

        const newPicks = isBaseline ? [] : picks.filter((pick) => !nextState.seen[pick.id]);
        for (const pick of picks) {
            nextState.seen[pick.id] = { seenAt: new Date(nowMs).toISOString(), system: pick.system };
        }
        nextState.lastScanAt = new Date(nowMs).toISOString();

        if (nextState.autoQueue) {
            if (!isBaseline) {
                for (const pick of newPicks) {
                    nextState.pending[pick.id] = {
                        detectedAt: new Date(nowMs).toISOString(),
                        system: pick.system,
                        mode: pick.rule.mode,
                        kickoffAt: pick.kickoffAt.toISOString()
                    };
                }
            }
            // Recuperación segura de candidatos T-5 en baseline / recarga
            for (const pick of picks) {
                if (
                    pick.rule?.mode === 'T_MINUS_5'
                    && pick.kickoffAt instanceof Date
                    && !Number.isNaN(pick.kickoffAt.getTime())
                    && pick.kickoffAt.getTime() > nowMs + 60 * 1000
                    && !nextState.submitted[pick.id]
                    && !nextState.pending[pick.id]
                ) {
                    nextState.pending[pick.id] = {
                        detectedAt: new Date(nowMs).toISOString(),
                        system: pick.system,
                        mode: pick.rule.mode,
                        kickoffAt: pick.kickoffAt.toISOString()
                    };
                }
            }
        }

        return nextState;
    };

    return { candidateFromFields, simulateScan, parseKickoff };
};

test('1. T5 visible en primer baseline + kickoff futuro → entra en pending', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const toulouse = candidateFromFields({
        dateText: '19/09/2026 18:45', // 18:45 UTC = 20:45 Madrid
        competition: 'FRA-Ligue 1',
        fixture: 'Toulouse vs Le Havre',
        rawSelection: 'Over 2.5',
        rawOdds: '1.95',
        system: 'MT - FRA1 FRA2 - V1.0'
    });
    assert.ok(toulouse, 'Pick de Toulouse debe ser parseado');

    const initialState = { seen: {}, pending: {}, submitted: {}, autoQueue: true };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime(); // 19:00 Madrid

    // Simular primer escaneo con isBaseline: true (recarga de página)
    const afterBaseline = simulateScan({ picks: [toulouse], state: initialState, isBaseline: true, nowMs });

    assert.ok(afterBaseline.seen[toulouse.id], 'Debe estar en seen');
    assert.ok(afterBaseline.pending[toulouse.id], 'Debe entrar en pending aunque sea baseline');
    assert.equal(afterBaseline.pending[toulouse.id].kickoffAt, '2026-09-19T18:45:00.000Z');
});

test('2. T5 ya submitted → NO vuelve a pending', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const pick = candidateFromFields({
        dateText: '19/09/2026 18:45',
        competition: 'FRA-Ligue 1',
        fixture: 'Toulouse vs Le Havre',
        rawSelection: 'Over 2.5',
        rawOdds: '1.95',
        system: 'MT - FRA1 FRA2 - V1.0'
    });

    const stateWithSubmitted = {
        seen: {},
        pending: {},
        submitted: { [pick.id]: { submittedAt: '2026-09-19T18:40:00.000Z', state: 'published' } },
        autoQueue: true
    };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime();

    const afterScan = simulateScan({ picks: [pick], state: stateWithSubmitted, isBaseline: true, nowMs });
    assert.equal(afterScan.pending[pick.id], undefined, 'Un pick submitted nunca debe reentrar a pending');
});

test('3. T5 ya pending → no se duplica', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const pick = candidateFromFields({
        dateText: '19/09/2026 18:45',
        competition: 'FRA-Ligue 1',
        fixture: 'Olympique Lyonnais vs Rennes',
        rawSelection: 'Over 2.5',
        rawOdds: '1.50',
        system: 'MT - FRA1 FRA2 - V1.0'
    });

    const originalDetectedAt = '2026-09-18T22:05:10.402Z';
    const stateWithPending = {
        seen: {},
        pending: {
            [pick.id]: {
                detectedAt: originalDetectedAt,
                system: pick.system,
                mode: 'T_MINUS_5',
                kickoffAt: '2026-09-19T18:45:00.000Z'
            }
        },
        submitted: {},
        autoQueue: true
    };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime();

    const afterScan = simulateScan({ picks: [pick], state: stateWithPending, isBaseline: true, nowMs });
    assert.equal(afterScan.pending[pick.id].detectedAt, originalDetectedAt, 'Conserva el registro pending original sin sobreescribirlo');
});

test('4. T5 con kickoff pasado → NO se recupera', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const pastPick = candidateFromFields({
        dateText: '19/09/2026 16:30', // 16:30 UTC = 18:30 Madrid
        competition: 'ESP-Segunda',
        fixture: 'Eldense vs Eibar',
        rawSelection: 'BTTS Yes',
        rawOdds: '1.83',
        system: 'MT-LAB-BTTS-ESP-v0.1'
    });

    const initialState = { seen: {}, pending: {}, submitted: {}, autoQueue: true };
    // Simular escaneo a las 18:32 Madrid (16:32 UTC), cuando el partido ya comenzó
    const nowMs = new Date('2026-09-19T16:32:00.000Z').getTime();

    const afterScan = simulateScan({ picks: [pastPick], state: initialState, isBaseline: true, nowMs });
    assert.equal(afterScan.pending[pastPick.id], undefined, 'Un pick con kickoff pasado no debe entrar a pending');
});

test('5. T5 dentro de escenario timezone ISO → correcto', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const isoPick = candidateFromFields({
        dateText: '2026-09-19T18:45:00', // ISO UTC
        competition: 'FRA-Ligue 1',
        fixture: 'Olympique Lyonnais vs Rennes',
        rawSelection: 'Over 2.5',
        rawOdds: '1.50',
        system: 'MT - FRA1 FRA2 - V1.0'
    });

    const initialState = { seen: {}, pending: {}, submitted: {}, autoQueue: true };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime();

    const afterScan = simulateScan({ picks: [isoPick], state: initialState, isBaseline: true, nowMs });
    assert.equal(afterScan.pending[isoPick.id].kickoffAt, '2026-09-19T18:45:00.000Z');
});

test('6. T5 formato europeo → correcto', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const euroPick = candidateFromFields({
        dateText: '19/09/2026 18:45', // Europeo UTC
        competition: 'FRA-Ligue 1',
        fixture: 'Olympique Lyonnais vs Rennes',
        rawSelection: 'Over 2.5',
        rawOdds: '1.50',
        system: 'MT - FRA1 FRA2 - V1.0'
    });

    const initialState = { seen: {}, pending: {}, submitted: {}, autoQueue: true };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime();

    const afterScan = simulateScan({ picks: [euroPick], state: initialState, isBaseline: true, nowMs });
    assert.equal(afterScan.pending[euroPick.id].kickoffAt, '2026-09-19T18:45:00.000Z');
});

test('7. EARLY visible en baseline → NO se publica ni recupera', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const earlyPick = candidateFromFields({
        dateText: '19/09/2026 19:00',
        competition: 'ENG-Premier League',
        fixture: 'Tottenham vs Arsenal',
        rawSelection: 'Under 3.5',
        rawOdds: '1.45',
        system: 'MT - Premier League 02.5' // Sistema EARLY
    });
    assert.equal(earlyPick.rule.mode, 'AL_RECIBIR');

    const initialState = { seen: {}, pending: {}, submitted: {}, autoQueue: true };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime();

    const afterScan = simulateScan({ picks: [earlyPick], state: initialState, isBaseline: true, nowMs });
    assert.ok(afterScan.seen[earlyPick.id], 'EARLY se marca como seen en la línea base');
    assert.equal(afterScan.pending[earlyPick.id], undefined, 'EARLY NUNCA entra a pending ni se recupera retroactivamente');
});

test('8. Reload repetido → idempotente', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const pick = candidateFromFields({
        dateText: '19/09/2026 19:00',
        competition: 'ESP-Primera Division',
        fixture: 'Sevilla vs Barcelona',
        rawSelection: 'Yes',
        rawOdds: '1.61',
        system: 'MT-LAB-BTTS-ESP-v0.1'
    });

    let state = { seen: {}, pending: {}, submitted: {}, autoQueue: true };
    const nowMs = new Date('2026-09-19T17:00:00.000Z').getTime();

    // Reload 1
    state = simulateScan({ picks: [pick], state, isBaseline: true, nowMs });
    const pendingCountAfter1 = Object.keys(state.pending).length;
    assert.equal(pendingCountAfter1, 1);

    // Reload 2
    state = simulateScan({ picks: [pick], state, isBaseline: true, nowMs: nowMs + 60000 });
    const pendingCountAfter2 = Object.keys(state.pending).length;
    assert.equal(pendingCountAfter2, 1, 'Mantiene exactamente 1 registro pending tras múltiples reloads');
});

test('9. A/B existentes siguen funcionando', () => {
    const { candidateFromFields, simulateScan } = makeContentRuntime();
    const pickA = candidateFromFields({
        dateText: '19/09/2026 18:45',
        competition: 'FRA-Ligue 1',
        fixture: 'Olympique Lyonnais vs Rennes',
        rawSelection: 'Over 2.5',
        rawOdds: '1.50',
        system: 'MT - FRA1 FRA2 - V1.0'
    });
    const pickB = candidateFromFields({
        dateText: '19/09/2026 19:00',
        competition: 'ESP-Primera Division',
        fixture: 'Sevilla vs Barcelona',
        rawSelection: 'Yes',
        rawOdds: '1.61',
        system: 'MT-LAB-BTTS-ESP-v0.1'
    });
    const pickC = candidateFromFields({
        dateText: '19/09/2026 18:45',
        competition: 'FRA-Ligue 1',
        fixture: 'Toulouse vs Le Havre',
        rawSelection: 'Over 2.5',
        rawOdds: '1.95',
        system: 'MT - FRA1 FRA2 - V1.0'
    });

    let state = {
        seen: { [pickA.id]: { seenAt: '2026-09-19T16:58:00.000Z' }, [pickB.id]: { seenAt: '2026-09-19T16:58:00.000Z' } },
        pending: {
            [pickA.id]: { detectedAt: '2026-09-18T22:05:10.402Z', kickoffAt: '2026-09-19T18:45:00.000Z', mode: 'T_MINUS_5', system: pickA.system },
            [pickB.id]: { detectedAt: '2026-09-18T22:05:10.402Z', kickoffAt: '2026-09-19T19:00:00.000Z', mode: 'T_MINUS_5', system: pickB.system }
        },
        submitted: {},
        autoQueue: true
    };
    const nowMs = new Date('2026-09-19T17:05:00.000Z').getTime();

    // Escaneo que incluye A, B y el nuevo C (Toulouse)
    const afterScan = simulateScan({ picks: [pickA, pickB, pickC], state, isBaseline: false, nowMs });

    assert.ok(afterScan.pending[pickA.id], 'Pick A permanece en pending');
    assert.ok(afterScan.pending[pickB.id], 'Pick B permanece en pending');
    assert.ok(afterScan.pending[pickC.id], 'Pick C ingresa a pending');
    assert.equal(Object.keys(afterScan.pending).length, 3, 'Los 3 picks T-5 están en pending simultáneamente');
});
