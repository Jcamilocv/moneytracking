import test from 'node:test';
import assert from 'node:assert/strict';
import { getMadridDateTime } from '../api/cron/settle-official-picks.js';

test('DST-Safe Settlement: Verificación Verano (CEST UTC+2)', () => {
    // En verano (ej. Julio), 23:00 UTC corresponde exactamente a las 01:00 CEST en Madrid
    const summer23Utc = new Date('2026-07-15T23:00:00.000Z');
    const dtSummer23 = getMadridDateTime(summer23Utc);
    assert.equal(dtSummer23.hour, '01', 'A las 23:00 UTC en CEST, en Madrid debe ser estrictamente las 01:00');
    assert.equal(dtSummer23.dateStr, '2026-07-16', 'La fecha Madrid avanza al día siguiente');

    // En verano a las 00:00 UTC, en Madrid son las 02:00 CEST -> Debe ser ignorado por el scheduler
    const summer00Utc = new Date('2026-07-16T00:00:00.000Z');
    const dtSummer00 = getMadridDateTime(summer00Utc);
    assert.equal(dtSummer00.hour, '02', 'A las 00:00 UTC en CEST, en Madrid son las 02:00 (debe saltarse)');
    assert.notEqual(dtSummer00.hour, '01');
});

test('DST-Safe Settlement: Verificación Invierno (CET UTC+1)', () => {
    // En invierno (ej. Enero), 23:00 UTC corresponde a las 00:00 CET en Madrid -> Debe ser ignorado por el scheduler
    const winter23Utc = new Date('2026-01-15T23:00:00.000Z');
    const dtWinter23 = getMadridDateTime(winter23Utc);
    assert.equal(dtWinter23.hour, '00', 'A las 23:00 UTC en CET, en Madrid son las 00:00 (debe saltarse)');
    assert.notEqual(dtWinter23.hour, '01');

    // En invierno a las 00:00 UTC, en Madrid son las 01:00 CET -> Debe ejecutarse
    const winter00Utc = new Date('2026-01-16T00:00:00.000Z');
    const dtWinter00 = getMadridDateTime(winter00Utc);
    assert.equal(dtWinter00.hour, '01', 'A las 00:00 UTC en CET, en Madrid debe ser estrictamente las 01:00');
    assert.equal(dtWinter00.dateStr, '2026-01-16');
});

test('DST-Safe Settlement: Prevención de Doble Ejecución (Double Run Prevention)', async () => {
    // Simular el mecanismo de lock por fecha Madrid
    const simulatedLocks = new Map();
    const madridDate = '2026-09-22';

    const executeWithLock = (dateStr, hour) => {
        if (hour !== '01') {
            return { executed: false, skipped: true, reason: 'NOT_01_HOUR' };
        }
        if (simulatedLocks.has(dateStr)) {
            return { executed: false, skipped: true, doubleRunPrevented: true, reason: 'ALREADY_COMPLETED' };
        }
        simulatedLocks.set(dateStr, { status: 'completed', completedAt: new Date().toISOString() });
        return { executed: true, skipped: false };
    };

    // 1. Primera ejecución a las 01:00 Madrid -> Ejecuta y guarda lock
    const run1 = executeWithLock(madridDate, '01');
    assert.equal(run1.executed, true);
    assert.equal(run1.skipped, false);

    // 2. Segunda llamada a las 01:00 Madrid (reintento o cron duplicado) -> Bloqueada por lock
    const run2 = executeWithLock(madridDate, '01');
    assert.equal(run2.executed, false);
    assert.equal(run2.skipped, true);
    assert.equal(run2.doubleRunPrevented, true);

    // 3. Llamada en otra hora (ej. 02:00) -> Bloqueada por hora
    const run3 = executeWithLock(madridDate, '02');
    assert.equal(run3.executed, false);
    assert.equal(run3.skipped, true);
    assert.equal(run3.reason, 'NOT_01_HOUR');
});
