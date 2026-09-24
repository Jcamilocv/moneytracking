import assert from 'node:assert/strict';
import test from 'node:test';
import {
    semanticOfficialPickKey,
    preflightKeyForEvent,
    publicPickIdFor
} from '../api/_lib/official-pick-data.js';
import { pickForAudience } from '../api/_lib/official-picks.js';
import {
    SYSTEM_REGISTRY,
    SYSTEM_EXECUTION_MODES
} from '../server/system-registry.js';
import {
    normalizeFutbolBrainOwnerCandidate,
    ingestFutbolBrainOwnerCandidate,
    FUTBOLBRAIN_OWNER_BROWSER_PROVIDER
} from '../server/futbolbrain-local-ingest.js';
import {
    parseFutbolBrainTelegramText,
    ingestFutbolBrainTelegramPick,
    isFutbolBrainTelegramIntakeEnabled,
    TELEGRAM_INTAKE_PROVIDER
} from '../server/futbolbrain-telegram-intake.js';
import {
    registerOfficialPickPreflight,
    markPreflightConfirmed
} from '../server/official-pick-preflight.js';
import { checkPreflightExpectations } from '../server/check-preflight-expectations.js';
import {
    registerOperationsIncident,
    OPERATIONS_SEVERITIES,
    OPERATIONS_INCIDENT_TYPES
} from '../server/operations-incidents.js';
import { DEPARTMENTS } from '../api/_lib/system-events.js';

// In-memory mock DB helper
const createMockDb = () => {
    const store = new Map(); // collectionPath -> Map(docId -> data)

    const getCol = (colName) => {
        if (!store.has(colName)) store.set(colName, new Map());
        return store.get(colName);
    };

    return {
        _store: store,
        collection: (colName) => ({
            doc: (docId) => ({
                id: docId,
                get: async () => {
                    const col = getCol(colName);
                    const data = col.get(docId);
                    return {
                        exists: Boolean(data),
                        id: docId,
                        data: () => data
                    };
                },
                set: async (data, options = {}) => {
                    const col = getCol(colName);
                    if (options.merge && col.has(docId)) {
                        col.set(docId, { ...col.get(docId), ...data });
                    } else {
                        col.set(docId, data);
                    }
                },
                update: async (data) => {
                    const col = getCol(colName);
                    col.set(docId, { ...(col.get(docId) || {}), ...data });
                },
                collection: (subColName) => ({
                    doc: (subDocId) => ({
                        id: subDocId,
                        get: async () => {
                            const fullPath = `${colName}/${docId}/${subColName}`;
                            const subCol = getCol(fullPath);
                            const data = subCol.get(subDocId);
                            return { exists: Boolean(data), id: subDocId, data: () => data };
                        },
                        set: async (data) => {
                            const fullPath = `${colName}/${docId}/${subColName}`;
                            getCol(fullPath).set(subDocId, data);
                        }
                    }),
                    get: async () => {
                        const fullPath = `${colName}/${docId}/${subColName}`;
                        const subCol = getCol(fullPath);
                        return {
                            docs: Array.from(subCol.entries()).map(([id, data]) => ({
                                id,
                                data: () => data
                            }))
                        };
                    }
                })
            }),
            where: (field, op, val) => {
                const makeQuery = (filters = []) => {
                    const currentFilters = [...filters, { field, op, val }];
                    return {
                        where: (f2, o2, v2) => makeQuery([...currentFilters, { field: f2, op: o2, val: v2 }]),
                        limit: () => makeQuery(currentFilters),
                        get: async () => {
                            const col = getCol(colName);
                            const docs = [];
                            for (const [id, d] of col.entries()) {
                                let match = true;
                                for (const filt of currentFilters) {
                                    const valInDoc = filt.field.includes('.')
                                        ? filt.field.split('.').reduce((acc, k) => acc?.[k], d)
                                        : d[filt.field];
                                    if (filt.op === '==' && valInDoc !== filt.val) match = false;
                                    if (filt.op === '<=') {
                                        const docDate = (valInDoc?.toDate ? valInDoc.toDate() : new Date(valInDoc)).getTime();
                                        const filtDate = (filt.val?.toDate ? filt.val.toDate() : new Date(filt.val)).getTime();
                                        if (docDate > filtDate) match = false;
                                    }
                                }
                                if (match) {
                                    docs.push({
                                        id,
                                        data: () => d,
                                        ref: {
                                            update: async (up) => col.set(id, { ...d, ...up })
                                        }
                                    });
                                }
                            }
                            return { docs, size: docs.length };
                        }
                    };
                };
                return makeQuery();
            }
        }),
        runTransaction: async (fn) => {
            const tx = {
                get: async (ref) => ref.get(),
                set: async (ref, data, opt) => ref.set(data, opt)
            };
            return await fn(tx);
        }
    };
};

test('Requirement 7: Chrome and Telegram produce identical source-agnostic officialPickKey', () => {
    const chromePick = {
        event: {
            kickoffAt: new Date('2026-09-20T19:00:00.000Z'),
            competition: 'ENG-Championship',
            homeTeam: 'Norwich City',
            awayTeam: 'Birmingham City'
        },
        bet: {
            market: 'Resultado final',
            selection: 'Visitante'
        },
        system: {
            id: 'MT - ENG2 - v1.0',
            version: 'v1'
        },
        source: {
            provider: 'futbolbrain-owner-browser'
        }
    };

    const telegramPick = {
        event: {
            kickoffAt: new Date('2026-09-20T19:00:00.000Z'),
            competition: 'ENG-Championship',
            homeTeam: 'Norwich City',
            awayTeam: 'Birmingham City'
        },
        bet: {
            market: 'Resultado final',
            selection: 'Visitante'
        },
        system: {
            id: 'MT - ENG2 - v1.0',
            version: 'v1'
        },
        source: {
            provider: 'telegram-futbolbrain-bot'
        }
    };

    const keyFromChrome = semanticOfficialPickKey(chromePick);
    const keyFromTelegram = semanticOfficialPickKey(telegramPick);

    assert.equal(keyFromChrome, keyFromTelegram, 'Clave determinista debe ser 100% idéntica entre fuentes');
    assert.equal(publicPickIdFor({ idempotencyKey: keyFromChrome }), publicPickIdFor({ idempotencyKey: keyFromTelegram }));
});

import {
    T5_TRANSPORT_STATUS,
    TELEGRAM_T5_MIGRATION
} from '../server/system-registry.js';

test('T-5 Architecture status flags are properly configured for canonical production and deferred Telegram migration', () => {
    assert.equal(T5_TRANSPORT_STATUS, 'LEGACY_CHROME_PRODUCTION');
    assert.equal(TELEGRAM_T5_MIGRATION, 'DEFERRED');
});

test('Requirement 3 (Canonical Production): T-5 candidate from Chrome is queued directly in officialPickQueue under legacy production policy', async () => {
    const mockDb = createMockDb();
    const now = new Date('2026-09-20T10:00:00.000Z');
    const kickoffAt = new Date('2026-09-20T18:00:00.000Z');

    const chromeT5Input = {
        event: {
            sourceEventId: 'fb-fra-123',
            competition: 'FRA-Ligue 1',
            homeTeam: 'Lyon',
            awayTeam: 'Marseille',
            kickoffAt: kickoffAt.toISOString()
        },
        system: { id: 'MT - FRA1 FRA2 - V1.0' },
        visiblePick: { selection: 'Over 2.5', odds: 1.85 },
        source: { provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER, observedAt: now.toISOString() }
    };

    let queuedCandidate = null;
    const mockQueuePick = async (candidate) => {
        queuedCandidate = candidate;
        return {
            created: true,
            state: 'queued',
            queueId: 'q_t5_fra_test',
            pick: null
        };
    };

    // 1. En producción canónica (LEGACY_CHROME_PRODUCTION), la extensión Chrome encola el pick para t_minus_5
    const result = await ingestFutbolBrainOwnerCandidate(chromeT5Input, {
        db: mockDb,
        now,
        queuePick: mockQueuePick
    });

    assert.equal(result.ok, true);
    assert.equal(result.executionMode, SYSTEM_EXECUTION_MODES.T5);
    assert.equal(result.state, 'queued');
    assert.equal(result.queueId, 'q_t5_fra_test');
    assert.equal(result.publicationPolicy, 't_minus_5');
    assert.ok(queuedCandidate, 'El candidato debe haber sido encolado en officialPickQueue');
    assert.equal(queuedCandidate.publicationPolicy, 't_minus_5');

    // 2. En modo experimental diferido (experimentalPreflight: true), crea preflight para futura integración de Telegram
    const preflightResult = await ingestFutbolBrainOwnerCandidate(chromeT5Input, {
        db: mockDb,
        now,
        experimentalPreflight: true
    });
    assert.equal(preflightResult.ok, true);
    assert.equal(preflightResult.executionMode, SYSTEM_EXECUTION_MODES.T5);
    assert.equal(preflightResult.state, 'preflight_registered');
    assert.ok(preflightResult.preflightId.startsWith('pre_'));

    const preflightDoc = mockDb._store.get('officialPickPreflight')?.get(preflightResult.preflightId);
    assert.ok(preflightDoc, 'Debe persistirse en officialPickPreflight en modo diferido');
    assert.equal(preflightDoc.status, 'awaiting_telegram_t5');
    assert.equal(preflightDoc.systemId, 'MT - FRA1 FRA2 - V1.0');
});

test('Requirement 5: T-5 without Telegram confirmation expires at kickoff - 2 min, NEVER publishes, raises action_required incident in Ops', async () => {
    const mockDb = createMockDb();
    const now = new Date('2026-09-20T17:58:30.000Z'); // Pasado el cutoff de kickoff - 2 min (17:58:00)
    const kickoffAt = new Date('2026-09-20T18:00:00.000Z');

    // Pre-insert preflight
    const preflightId = 'pre_test_fra_missed';
    const expectedEnd = new Date(kickoffAt.getTime() - 2 * 60 * 1000); // 17:58:00
    mockDb._store.set('officialPickPreflight', new Map([
        [preflightId, {
            preflightId,
            status: 'awaiting_telegram_t5',
            event: { homeTeam: 'Lyon', awayTeam: 'Marseille', kickoffAt: kickoffAt.toISOString() },
            system: { id: 'MT - FRA1 FRA2 - V1.0' },
            expectedT5Window: {
                start: new Date(kickoffAt.getTime() - 7 * 60 * 1000).toISOString(),
                end: expectedEnd.toISOString()
            }
        }]
    ]));

    let opsAlertSent = false;
    let opsAlertMessage = '';
    const mockNotifyOps = async ({ text }) => {
        opsAlertSent = true;
        opsAlertMessage = text;
    };

    const auditResult = await checkPreflightExpectations({
        db: mockDb,
        now,
        notifyOps: mockNotifyOps
    });

    assert.equal(auditResult.missed, 1);
    assert.equal(auditResult.results[0].preflightId, preflightId);
    assert.equal(auditResult.results[0].action, 'marked_missed_expired_and_reported');

    // 1. Preflight marcado como missed_expired
    const updatedPreflight = mockDb._store.get('officialPickPreflight').get(preflightId);
    assert.equal(updatedPreflight.status, 'missed_expired');

    // 2. REGLA INVIOLABLE: NUNCA publicado en officialPicks
    const officialPicksCol = mockDb._store.get('officialPicks');
    assert.equal(officialPicksCol?.size || 0, 0, 'Nunca se debe publicar tras expirar T-5');

    // 3. Incidencia registrada en operationsIncidents con department: picks_risk
    const incidents = mockDb._store.get('operationsIncidents');
    assert.ok(incidents && incidents.size > 0, 'Debe registrarse incidencia en operationsIncidents');
    const incident = Array.from(incidents.values())[0];
    assert.equal(incident.department, DEPARTMENTS.PICKS_RISK);
    assert.equal(incident.severity, OPERATIONS_SEVERITIES.ACTION_REQUIRED);
    assert.equal(incident.incidentType, OPERATIONS_INCIDENT_TYPES.T5_TELEGRAM_MISSED);

    // 4. Money Tips Ops recibió alerta
    assert.equal(opsAlertSent, true, 'Ops debe recibir notificación de excepción');
    assert.ok(opsAlertMessage.includes('INCIDENCIA OPERATIVA'));
});

test('Requirement 6: PAPER systems are recorded in paperPicks with stake 0%, zero public dissemination, zero bank impact', async () => {
    const mockDb = createMockDb();
    const now = new Date('2026-09-20T10:00:00.000Z');
    const kickoffAt = new Date('2026-09-20T19:00:00.000Z');

    const paperInput = {
        event: {
            sourceEventId: 'fb-por-999',
            competition: 'POR-Primeira Liga',
            homeTeam: 'Benfica',
            awayTeam: 'Porto',
            kickoffAt: kickoffAt.toISOString()
        },
        system: { id: 'MT - POR1 - v1.0' },
        visiblePick: { selection: 'Team 1 (FT)', odds: 2.10 },
        source: { provider: FUTBOLBRAIN_OWNER_BROWSER_PROVIDER, observedAt: now.toISOString() }
    };

    const result = await ingestFutbolBrainOwnerCandidate(paperInput, { db: mockDb, now });

    assert.equal(result.ok, true);
    assert.equal(result.executionMode, SYSTEM_EXECUTION_MODES.PAPER);
    assert.equal(result.state, 'paper_recorded');

    // 1. Verificado en paperPicks con stake 0
    const paperDoc = mockDb._store.get('paperPicks')?.get(result.paperPickId);
    assert.ok(paperDoc, 'Debe persistirse en paperPicks');
    assert.equal(paperDoc.isPaper, true);
    assert.equal(paperDoc.stake, 0);
    assert.equal(paperDoc.bet.recommendedStakePct, 0);

    // 2. officialPicks NUNCA recibe el pick paper
    assert.equal(mockDb._store.get('officialPicks')?.size || 0, 0);

    // 3. officialPickAutoCopyQueue NUNCA recibe el pick paper
    assert.equal(mockDb._store.get('officialPickAutoCopyQueue')?.size || 0, 0);
});

test('Requirement 8: Money Tips Ops receives ONLY exceptions (critical, action_required, warning); routine activity is excluded', async () => {
    const mockDb = createMockDb();
    let notifyCallCount = 0;
    const mockNotify = async () => { notifyCallCount += 1; };

    // 1. INFO severity should NOT notify Ops
    await registerOperationsIncident({
        department: DEPARTMENTS.PICKS_RISK,
        incidentType: 'ROUTINE_SCAN',
        severity: OPERATIONS_SEVERITIES.INFO,
        reason: 'Routine scan completed normally',
        db: mockDb,
        notify: mockNotify
    });
    assert.equal(notifyCallCount, 0, 'INFO severity must NEVER trigger Ops notification');

    // 2. WARNING triggers Ops
    await registerOperationsIncident({
        department: DEPARTMENTS.PICKS_RISK,
        incidentType: 'STAKE_ANOMALY',
        severity: OPERATIONS_SEVERITIES.WARNING,
        reason: 'Stake anomaly warning',
        db: mockDb,
        notify: mockNotify
    });
    assert.equal(notifyCallCount, 1, 'WARNING must trigger Ops notification');

    // 3. ACTION_REQUIRED triggers Ops
    await registerOperationsIncident({
        department: DEPARTMENTS.PICKS_RISK,
        incidentType: OPERATIONS_INCIDENT_TYPES.T5_TELEGRAM_MISSED,
        severity: OPERATIONS_SEVERITIES.ACTION_REQUIRED,
        reason: 'T5 telegram pick missed',
        db: mockDb,
        notify: mockNotify
    });
    assert.equal(notifyCallCount, 2, 'ACTION_REQUIRED must trigger Ops notification');

    // 4. CRITICAL triggers Ops
    await registerOperationsIncident({
        department: DEPARTMENTS.PICKS_RISK,
        incidentType: 'TELEGRAM_DISPATCH_FAILURE',
        severity: OPERATIONS_SEVERITIES.CRITICAL,
        reason: 'Critical telegram dispatch failure',
        db: mockDb,
        notify: mockNotify
    });
    assert.equal(notifyCallCount, 3, 'CRITICAL must trigger Ops notification');
});

test('Requirement 9: Deep link permanent privacy: non-Premium NEVER sees market, selection, system, even after match/settlement', () => {
    const rawPick = {
        id: 'op_test12345678901234567890123456789012345678',
        status: 'published',
        event: {
            competition: 'ENG-Championship',
            homeTeam: 'Norwich City',
            awayTeam: 'Birmingham City',
            kickoffAt: '2026-09-01T18:00:00.000Z' // Pasado hace días
        },
        bet: {
            market: 'Resultado final',
            selection: 'Visitante',
            oddsAtPublication: 2.10,
            recommendedStakePct: 0.75,
            baseStakePct: 1.0,
            confidenceFactor: 0.75
        },
        system: {
            id: 'MT - ENG2 - v1.0',
            version: 'v1'
        },
        publicationPolicy: 'immediate'
    };

    const now = new Date('2026-09-15T12:00:00.000Z'); // Mucho después del partido

    // 1. Vista Premium: tiene todos los detalles
    const premiumView = pickForAudience(rawPick, { canViewActiveDetails: true, now });
    assert.equal(premiumView.isLocked, false);
    assert.equal(premiumView.isPublicSummary, false);
    assert.equal(premiumView.bet.market, 'Resultado final');
    assert.equal(premiumView.bet.selection, 'Visitante');
    assert.equal(premiumView.system.id, 'MT - ENG2 - v1.0');
    assert.equal(premiumView.bet.recommendedStakePct, 0.75);

    // 2. Vista No Premium: PRIVACIDAD PERMANENTE
    const publicView = pickForAudience(rawPick, { canViewActiveDetails: false, now });
    assert.equal(publicView.isPublicSummary, true);
    assert.equal(publicView.bet.market, null, 'Mercado debe ser null para no-Premium');
    assert.equal(publicView.bet.selection, null, 'Selección debe ser null para no-Premium');
    assert.equal(publicView.system.id, null, 'Sistema debe ser null para no-Premium');
    assert.equal(publicView.system.version, null);
    assert.equal(publicView.publicationPolicy, null, 'Regla interna / publicationPolicy debe ser null');
    assert.equal(publicView.bet.recommendedStakePct, null);
    // POLÍTICA PERMANENTE: la cuota registrada NUNCA es visible para no-Premium (antes, durante o tras kickoff/settlement)
    assert.equal(publicView.bet.oddsAtPublication, null, 'Cuota debe ser null permanentemente para no-Premium');
});

test('Requirement 10: Telegram text parser extracts system, teams, market, selection and odds from FutbolBrain alert', () => {
    const rawTelegramText = `⚽ ACTIVE PICK ⚽
Sistema: MT - FRA1 FRA2 - V1.0
Partido: Lyon vs Marseille
Liga: FRA-Ligue 1
Mercado: Total de goles
Selección: Over 2.5
Cuota: 1.85
Hora: 2026-09-20 20:45`;

    const parsed = parseFutbolBrainTelegramText(rawTelegramText);
    assert.ok(parsed, 'Debe parsear correctamente el texto de Telegram');
    assert.equal(parsed.systemId, 'MT - FRA1 FRA2 - V1.0');
    assert.equal(parsed.homeTeam, 'Lyon');
    assert.equal(parsed.awayTeam, 'Marseille');
    assert.equal(parsed.market, 'Total de goles');
    assert.equal(parsed.rawSelection, 'Over 2.5');
    assert.equal(parsed.odds, 1.85);
});

test('Requirement 11: Telegram inbound intake is feature-flagged (WAITING FOR REAL GROUP TEST)', () => {
    // Por seguridad, con la variable apagada (default), el intake no procesa
    const prevEnv = process.env.FUTBOLBRAIN_TELEGRAM_INTAKE_ENABLED;
    try {
        delete process.env.FUTBOLBRAIN_TELEGRAM_INTAKE_ENABLED;
        assert.equal(isFutbolBrainTelegramIntakeEnabled(), false, 'Debe estar desactivado por defecto');
    } finally {
        if (prevEnv !== undefined) process.env.FUTBOLBRAIN_TELEGRAM_INTAKE_ENABLED = prevEnv;
    }
});

test('Requirement 2: EARLY pick already published -> Telegram arrives later at T-5 -> correlates without duplicating, records CLV audit', async () => {
    const mockDb = createMockDb();
    const kickoffAt = new Date('2026-09-20T20:00:00.000Z');
    const now = new Date('2026-09-20T19:55:00.000Z'); // T-5 min

    // Pick publicado a primera hora (EARLY)
    const earlyPickPayload = {
        event: {
            competition: 'ENG-Championship',
            homeTeam: 'Norwich City',
            awayTeam: 'Birmingham City',
            kickoffAt
        },
        bet: {
            market: 'Resultado final',
            selection: 'Visitante',
            oddsAtPublication: 2.10
        },
        system: {
            id: 'MT - ENG2 - v1.0',
            version: 'v1'
        }
    };
    const semanticKey = semanticOfficialPickKey(earlyPickPayload);
    const officialPickId = `op_${semanticKey.slice(0, 40)}`;

    mockDb._store.set('officialPicks', new Map([
        [officialPickId, {
            id: officialPickId,
            status: 'published',
            event: earlyPickPayload.event,
            bet: earlyPickPayload.bet,
            system: earlyPickPayload.system
        }]
    ]));

    // Mensaje Telegram llega a las 19:55 con cuota movida a 2.25
    const parsed = {
        systemId: 'MT - ENG2 - v1.0',
        homeTeam: 'Norwich City',
        awayTeam: 'Birmingham City',
        competition: 'ENG-Championship',
        rawSelection: 'Team 2 (FT)',
        odds: 2.25
    };

    const intakeResult = await ingestFutbolBrainTelegramPick({
        parsed,
        kickoffAt,
        telegramMessageId: 'tg_msg_998877',
        db: mockDb,
        now
    });

    assert.equal(intakeResult.ok, true);
    assert.equal(intakeResult.action, 'correlated_early');
    assert.equal(intakeResult.duplicate, true);
    assert.equal(intakeResult.officialPickId, officialPickId);

    // 1. Verificar correlación y auditoría CLV en el documento existente
    const pickDoc = mockDb._store.get('officialPicks').get(officialPickId);
    assert.ok(pickDoc.telegramT5Correlation, 'Debe contener telegramT5Correlation');
    assert.equal(pickDoc.telegramT5Correlation.earlyOdds, 2.10);
    assert.equal(pickDoc.telegramT5Correlation.oddsAtT5, 2.25);
    assert.equal(pickDoc.telegramT5Correlation.oddsDiff, 0.15);

    // 2. NO se debe haber creado ninguna tarea adicional de auto-copia
    assert.equal(mockDb._store.get('officialPickAutoCopyQueue')?.size || 0, 0);
});
