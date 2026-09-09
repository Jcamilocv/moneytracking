import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOfficialPickInput, publicPickIdFor } from '../api/lib/official-pick-data.js';
import { isPublicOfficialPickData, shouldNotifyTelegramForOfficialPick } from '../api/lib/official-picks.js';
import { formatOfficialTelegramMessage } from '../api/lib/telegram.js';
import { stakeRecommendationForOfficialPick } from '../server/money-tips-stake-policy.js';

const validPick = {
    event: {
        sourceEventId: 'test-event-001',
        competition: 'Liga de prueba',
        homeTeam: 'Equipo Local',
        awayTeam: 'Equipo Visitante',
        kickoffAt: '2026-08-30T18:00:00.000Z'
    },
    bet: { market: 'Más de 2.5 goles', selection: 'Over 2.5', oddsAtPublication: 1.85 },
    system: { id: 'MT-TEST', version: 'v1' },
    source: { provider: 'money-tips-owned', observedAt: '2026-08-30T17:45:00.000Z' }
};

test('un pick oficial normalizado tiene una identidad y evidencia deterministas', () => {
    const first = normalizeOfficialPickInput(validPick);
    const second = normalizeOfficialPickInput({ ...validPick, event: { ...validPick.event } });

    assert.equal(first.status, 'published');
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.equal(first.source.evidenceHash, second.source.evidenceHash);
    assert.match(publicPickIdFor(first), /^op_[a-f0-9]{40}$/);
    assert.equal(first.scheduledAt.toISOString(), '2026-08-30T17:55:00.000Z');
    assert.equal(first.publicationPolicy, 't_minus_5');
    assert.equal(first.bet.recommendedStakePct, 0);
    assert.equal(first.bet.policyVersion, '2026-27-forward-v1');
});

test('un cambio de hora de origen no crea otra identidad para el mismo pick del día', () => {
    const original = normalizeOfficialPickInput(validPick);
    const redrawn = normalizeOfficialPickInput({
        ...validPick,
        event: {
            ...validPick.event,
            sourceEventId: 'test-event-001-time-corrected',
            kickoffAt: '2026-08-30T19:00:00.000Z'
        }
    });

    assert.equal(original.semanticDuplicateKey, redrawn.semanticDuplicateKey);
    assert.equal(publicPickIdFor(original), publicPickIdFor(redrawn));
    assert.notEqual(original.source.evidenceHash, redrawn.source.evidenceHash);
});

test('la política de stake aplica el factor inicial de producción controlada', () => {
    assert.deepEqual(
        stakeRecommendationForOfficialPick({ systemId: 'MT - ENG2 - v1.0', oddsAtPublication: 1.3 }),
        { policyVersion: '2026-27-forward-v1', systemState: 'production_controlled', baseStakePct: 1.5, confidenceFactor: 0.75, recommendedStakePct: 1.125 }
    );
    assert.equal(stakeRecommendationForOfficialPick({ systemId: 'MT - ENG2 - v1.0', oddsAtPublication: 2.2 }).recommendedStakePct, 0.75);
    assert.equal(stakeRecommendationForOfficialPick({ systemId: 'MT - ENG2 - v1.0', oddsAtPublication: 3.2 }).recommendedStakePct, 0.375);
    assert.equal(stakeRecommendationForOfficialPick({ systemId: 'MT-UNKNOWN', oddsAtPublication: 2.2 }).recommendedStakePct, 0);
});

test('un sistema inmediato queda listo en el momento observado, no en T-5', () => {
    const immediate = normalizeOfficialPickInput({ ...validPick, publicationPolicy: 'immediate' });

    assert.equal(immediate.publicationPolicy, 'immediate');
    assert.equal(immediate.scheduledAt.toISOString(), '2026-08-30T17:45:00.000Z');
});

test('un pick oficial rechaza una política de publicación desconocida', () => {
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, publicationPolicy: 'later' }), /política/i);
});

test('un pick oficial rechaza una cuota o fecha inválida', () => {
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, bet: { ...validPick.bet, oddsAtPublication: 1 } }), /cuota/i);
    assert.throws(() => normalizeOfficialPickInput({ ...validPick, event: { ...validPick.event, kickoffAt: 'no-date' } }), /fecha/i);
});

test('los registros técnicos no aparecen en el feed público de picks', () => {
    assert.equal(isPublicOfficialPickData({ status: 'published', source: { provider: 'money-tips-owned' } }), true);
    assert.equal(isPublicOfficialPickData({ status: 'published', source: { provider: 'test-authorized' } }), false);
    assert.equal(isPublicOfficialPickData({ status: 'queued', source: { provider: 'money-tips-owned' } }), false);
    assert.equal(isPublicOfficialPickData({ status: 'withdrawn', source: { provider: 'money-tips-owned' } }), false);
});

test('un pick sintético nunca puede desencadenar una notificación de Telegram', () => {
    assert.equal(shouldNotifyTelegramForOfficialPick({ status: 'published', source: { provider: 'test-authorized' } }), false);
    assert.equal(shouldNotifyTelegramForOfficialPick({ status: 'published', source: { provider: 'money-tips-owned' } }), true);
});

test('el mensaje de Telegram muestra el comprobante como enlace corto y no revela mercado ni cuota', () => {
    const text = formatOfficialTelegramMessage({
        id: 'op_123',
        event: { homeTeam: 'Equipo <Local>', awayTeam: 'Visitante', competition: 'Liga & Copa', kickoffAt: '2026-09-08T19:00:00.000Z' },
        bet: { market: 'Más de 2,5 goles', selection: 'Over 2.5', oddsAtPublication: 1.85 },
        source: { evidenceHash: 'abcde12345ffedcba987654321' }
    });

    assert.match(text, /PICK OFICIAL/);
    assert.match(text, /<a href="https:\/\/app\.pronosticosmoneytips\.com\/\?pick=op_123">Ver pick y comprobante verificable<\/a>/);
    assert.match(text, /#ABCDE12345/);
    assert.doesNotMatch(text, /Más de 2,5|Over 2\.5|1\.85/);
    assert.match(text, /Equipo &lt;Local&gt;/);
});

test('un aviso retirado explica la duplicidad sin revelar el pick', () => {
    const text = formatOfficialTelegramMessage({
        id: 'op_123',
        status: 'withdrawn',
        event: { homeTeam: 'Norwich City', awayTeam: 'Birmingham City' },
        source: { evidenceHash: 'abcde12345ffedcba987654321' }
    });

    assert.match(text, /REGISTRO RETIRADO/);
    assert.match(text, /duplicidad/);
    assert.match(text, /Ver pick y comprobante verificable/);
    assert.doesNotMatch(text, /Más de 2,5|Over 2\.5|1\.85/);
});
