import assert from 'node:assert/strict';
import test from 'node:test';
import {
    pickForAudience,
    sanitizeOfficialPickSettlement,
    sanitizeOfficialPickEventForAudience
} from '../api/_lib/official-picks.js';
import {
    sanitizePublicBet,
    buildPublication
} from '../api/_lib/official-snapshot-data.js';

const mockPick = {
    id: 'op_secret_1234567890abcdef',
    status: 'published',
    event: {
        competition: 'LaLiga EA Sports',
        homeTeam: 'Real Madrid',
        awayTeam: 'Barcelona',
        kickoffAt: '2026-09-20T19:00:00.000Z'
    },
    bet: {
        market: 'Más de 2.5 goles',
        selection: 'Más de 2.5',
        oddsAtPublication: 1.85,
        recommendedStakePct: 2.5,
        baseStakePct: 2.0,
        confidenceFactor: 1.25
    },
    system: {
        id: 'MT - FRA1 FRA2 - V1.0',
        version: 'v1.0'
    },
    publicationPolicy: 't_minus_5',
    publishedAt: '2026-09-20T18:55:00.000Z',
    source: {
        evidenceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        provider: 'futbolbrain-local-ingest'
    },
    settlement: {
        status: 'won',
        regularTimeScore: { home: 3, away: 1 },
        reason: 'Pronóstico acertado: Más de 2.5 goles cumplido con 4 goles en tiempo reglamentario.',
        resultEvidence: { matchUrl: 'https://example.com/match/123' },
        settledAt: '2026-09-20T21:00:00.000Z'
    }
};

test('GATE 1: Usuario público/anónimo NUNCA recibe mercado, selección ni cuota antes de kickoff', () => {
    const publicView = pickForAudience(mockPick, {
        canViewActiveDetails: false,
        now: new Date('2026-09-20T18:56:00.000Z') // Antes de kickoff
    });

    // Verificación negativa absoluta de confidencialidad
    assert.equal(publicView.bet.market, null, 'market debe ser null para público');
    assert.equal(publicView.bet.selection, null, 'selection debe ser null para público');
    assert.equal(publicView.bet.oddsAtPublication, null, 'oddsAtPublication debe ser null para público');
    assert.equal(publicView.bet.recommendedStakePct, null, 'recommendedStakePct debe ser null para público');
    assert.equal(publicView.bet.baseStakePct, null, 'baseStakePct debe ser null para público');
    assert.equal(publicView.bet.confidenceFactor, null, 'confidenceFactor debe ser null para público');
    assert.equal(publicView.system.id, null, 'system.id debe ser null para público');
    assert.equal(publicView.system.version, null, 'system.version debe ser null para público');
    assert.equal(publicView.publicationPolicy, null, 'publicationPolicy no debe ser visible al público');
    assert.equal(publicView.isLocked, true, 'isLocked debe ser true');
    assert.equal(publicView.isPublicSummary, true, 'isPublicSummary debe ser true');

    // Prueba pública permitida conservada
    assert.equal(publicView.event.homeTeam, 'Real Madrid');
    assert.equal(publicView.event.awayTeam, 'Barcelona');
    assert.equal(publicView.event.competition, 'LaLiga EA Sports');
    assert.equal(publicView.event.kickoffAt, '2026-09-20T19:00:00.000Z');
    assert.equal(publicView.publishedAt, '2026-09-20T18:55:00.000Z');
    assert.equal(publicView.source.evidenceHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // Comprobación anti-fuga en serialización JSON
    const serialized = JSON.stringify(publicView);
    assert.ok(!serialized.includes('Más de 2.5'), 'No debe contener la selección');
    assert.ok(!serialized.includes('1.85'), 'No debe contener la cuota');
    assert.ok(!serialized.includes('MT - FRA1'), 'No debe contener el sistema');
});

test('GATE 2: Usuario público/anónimo NUNCA recibe mercado, selección ni cuota DURANTE el partido', () => {
    const inPlayView = pickForAudience(mockPick, {
        canViewActiveDetails: false,
        now: new Date('2026-09-20T19:45:00.000Z') // Durante el partido
    });

    assert.equal(inPlayView.bet.market, null);
    assert.equal(inPlayView.bet.selection, null);
    assert.equal(inPlayView.bet.oddsAtPublication, null);
    assert.equal(inPlayView.system.id, null);
    assert.equal(inPlayView.isLocked, true);
    assert.equal(inPlayView.isPublicSummary, true);
});

test('GATE 3: POST-MATCH PRIVACY — Usuario público NUNCA recibe mercado, selección ni cuota DESPUÉS del partido ni tras resolución', () => {
    const postMatchView = pickForAudience(mockPick, {
        canViewActiveDetails: false,
        now: new Date('2026-09-21T10:00:00.000Z') // Días después de finalizado y resuelto
    });

    // Confidencialidad permanente post-match
    assert.equal(postMatchView.bet.market, null, 'market debe seguir siendo null post-match');
    assert.equal(postMatchView.bet.selection, null, 'selection debe seguir siendo null post-match');
    assert.equal(postMatchView.bet.oddsAtPublication, null, 'oddsAtPublication debe seguir siendo null post-match');
    assert.equal(postMatchView.system.id, null, 'system.id debe seguir siendo null post-match');
    assert.equal(postMatchView.isLocked, true);
    assert.equal(postMatchView.isPublicSummary, true);

    // Settlement sanitizado: solo status, regularTimeScore y settledAt, NUNCA reason ni resultEvidence
    assert.deepEqual(postMatchView.settlement, {
        status: 'won',
        regularTimeScore: { home: 3, away: 1 },
        settledAt: '2026-09-20T21:00:00.000Z'
    });
    assert.equal(postMatchView.settlement.reason, undefined, 'settlement.reason no debe exponerse');
    assert.equal(postMatchView.settlement.resultEvidence, undefined, 'settlement.resultEvidence no debe exponerse');

    // Comprobación anti-fuga en serialización completa del pick post-match
    const serialized = JSON.stringify(postMatchView);
    assert.ok(!serialized.includes('Más de 2.5'), 'Post-match no debe contener la selección');
    assert.ok(!serialized.includes('1.85'), 'Post-match no debe contener la cuota');
    assert.ok(!serialized.includes('MT - FRA1'), 'Post-match no debe contener el sistema');
    assert.ok(!serialized.includes('Pronóstico acertado'), 'Post-match no debe contener el motivo que revele la apuesta');
});

test('GATE 4: Sanitización de eventos históricos para audiencia pública', () => {
    const publishedEvent = {
        id: 'ev_pub_1',
        type: 'published',
        evidenceHash: 'hash_123',
        rawPayload: { secret: 'do-not-leak' },
        createdAt: '2026-09-20T18:55:00.000Z'
    };
    const sanitizedPub = sanitizeOfficialPickEventForAudience(publishedEvent, { canViewActiveDetails: false });
    assert.equal(sanitizedPub.evidenceHash, 'hash_123');
    assert.equal(sanitizedPub.rawPayload, undefined);

    const settledEvent = {
        id: 'ev_set_1',
        type: 'settled',
        status: 'won',
        regularTimeScore: { home: 3, away: 1 },
        reason: 'Ganada: Más de 2.5 goles',
        evidence: { matchId: 999 },
        createdAt: '2026-09-20T21:00:00.000Z'
    };
    const sanitizedSettled = sanitizeOfficialPickEventForAudience(settledEvent, { canViewActiveDetails: false });
    assert.equal(sanitizedSettled.status, 'won');
    assert.deepEqual(sanitizedSettled.regularTimeScore, { home: 3, away: 1 });
    assert.equal(sanitizedSettled.reason, undefined, 'El evento público no debe contener reason');
    assert.equal(sanitizedSettled.evidence, undefined, 'El evento público no debe contener evidence');
});

test('GATE 5: SNAPSHOTS & BALANCE PÚBLICOS — Copias oficiales en bancas públicas quedan blindadas', () => {
    const officialCopyBet = {
        id: 'bet_copy_1',
        bankId: 'bank_public_season',
        date: '2026-09-20',
        time: '19:00',
        title: 'Real Madrid vs Barcelona',
        selection: 'Más de 2.5 goles',
        odds: 1.85,
        stake: 2.5,
        amount: 25,
        status: 'won',
        isOfficialPickCopy: true,
        officialPickId: 'op_secret_1234567890abcdef',
        selections: [
            {
                id: 'sel_1',
                title: 'Real Madrid vs Barcelona',
                selection: 'Más de 2.5 goles',
                odds: 1.85,
                status: 'won'
            }
        ]
    };

    const regularBet = {
        id: 'bet_regular_2',
        bankId: 'bank_public_season',
        date: '2026-09-20',
        time: '20:00',
        title: 'Arsenal vs Chelsea',
        selection: 'Arsenal gana',
        odds: 2.10,
        stake: 1.0,
        amount: 10,
        status: 'won'
    };

    const bank = { id: 'bank_public_season', name: 'Banca Oficial 2026', initialCapital: 1000, currency: 'EUR' };
    const publication = buildPublication(bank, [officialCopyBet, regularBet]);

    const publishedCopy = publication.bets.find((b) => b.id === 'bet_copy_1');
    assert.ok(publishedCopy, 'La apuesta copiada debe estar en el snapshot');
    assert.equal(publishedCopy.selection, '[Contenido Premium]', 'Selección debe estar redactada como [Contenido Premium]');
    assert.equal(publishedCopy.odds, 0, 'Cuota debe estar redactada a 0');
    assert.equal(publishedCopy.stake, 0, 'Stake debe estar redactado a 0');
    assert.equal(publishedCopy.bookmaker, 'Money Tips');
    assert.equal(publishedCopy.selections[0].selection, '[Contenido Premium]');
    assert.equal(publishedCopy.selections[0].odds, 0);

    // Apuesta regular no oficial conserva sus datos normales
    const publishedRegular = publication.bets.find((b) => b.id === 'bet_regular_2');
    assert.equal(publishedRegular.selection, 'Arsenal gana');
    assert.equal(publishedRegular.odds, 2.10);

    // Comprobación anti-fuga en serialización del snapshot completo
    const serializedSnapshot = JSON.stringify(publication);
    assert.ok(!serializedSnapshot.includes('Más de 2.5 goles'), 'El snapshot público no debe contener la selección oficial');
    assert.ok(!serializedSnapshot.includes('1.85'), 'El snapshot público no debe contener la cuota oficial');
});

test('GATE 6: Usuario PREMIUM autenticado recibe todos los detalles y puede añadir a su banca', () => {
    const premiumView = pickForAudience(mockPick, {
        canViewActiveDetails: true,
        now: new Date('2026-09-20T18:56:00.000Z')
    });

    assert.equal(premiumView.isLocked, false);
    assert.equal(premiumView.isPublicSummary, false);
    assert.equal(premiumView.bet.market, 'Más de 2.5 goles');
    assert.equal(premiumView.bet.selection, 'Más de 2.5');
    assert.equal(premiumView.bet.oddsAtPublication, 1.85);
    assert.equal(premiumView.bet.recommendedStakePct, 2.5);
    assert.equal(premiumView.system.id, 'MT - FRA1 FRA2 - V1.0');
    assert.equal(premiumView.publicationPolicy, 't_minus_5');
});

test('GATE 7: Pick retirado (withdrawn) permanece completamente redactado para audiencia pública', () => {
    const withdrawnPick = {
        ...mockPick,
        status: 'withdrawn'
    };
    const publicWithdrawn = pickForAudience(withdrawnPick, { canViewActiveDetails: false });
    assert.equal(publicWithdrawn.isLocked, true);
    assert.equal(publicWithdrawn.isWithdrawn, true);
    assert.equal(publicWithdrawn.bet.market, null);
    assert.equal(publicWithdrawn.bet.selection, null);
    assert.equal(publicWithdrawn.bet.oddsAtPublication, null);
    assert.equal(publicWithdrawn.system.id, null);
    assert.equal(publicWithdrawn.publicationPolicy, null);
});
