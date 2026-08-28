import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOfficialPickReports } from '../api/lib/official-pick-reports.js';

test('las incidencias públicas agregan categorías sin exponer el usuario que reporta', () => {
    const summary = summarizeOfficialPickReports([
        { pickId: 'op_test', reporterUid: 'private-user-a', category: 'result_incorrect', status: 'open' },
        { pickId: 'op_test', reporterUid: 'private-user-b', category: 'result_incorrect', status: 'open' },
        { pickId: 'op_test', reporterUid: 'private-user-c', category: 'odds_mismatch', status: 'resolved', decision: 'confirmed', message: 'Cuota verificada.', resolvedAt: '2026-08-28T12:00:00.000Z' }
    ]);

    assert.deepEqual(summary, {
        totalReports: 3,
        openReports: 2,
        status: 'under_review',
        categoryCounts: { result_incorrect: 2, odds_mismatch: 1 },
        resolution: { decision: 'confirmed', message: 'Cuota verificada.', resolvedAt: '2026-08-28T12:00:00.000Z' }
    });
    assert.equal(JSON.stringify(summary).includes('private-user'), false);
});

test('una revisión cerrada conserva su resolución pública', () => {
    const summary = summarizeOfficialPickReports([
        { pickId: 'op_test', category: 'event_postponed', status: 'resolved', decision: 'correction_published', message: 'Partido aplazado; pick anulado.', resolvedAt: '2026-08-28T12:00:00.000Z' }
    ]);

    assert.equal(summary.status, 'correction_published');
    assert.equal(summary.openReports, 0);
    assert.equal(summary.resolution.message, 'Partido aplazado; pick anulado.');
});
