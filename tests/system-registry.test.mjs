import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SYSTEM_REGISTRY,
    SYSTEM_EXECUTION_MODES,
    SYSTEM_TIERS,
    getSystemDefinition,
    isApprovedSystem,
    getSystemExecutionMode,
    isEarlyPublicationSystem,
    isT5System,
    isPaperSystem,
    mapSystemSelection,
    calculateRegistryStake
} from '../server/system-registry.js';

test('System Registry defines exactly the 9 approved systems from the master Excel', () => {
    const keys = Object.keys(SYSTEM_REGISTRY);
    assert.equal(keys.length, 9);

    const early = keys.filter((k) => SYSTEM_REGISTRY[k].executionMode === SYSTEM_EXECUTION_MODES.EARLY);
    const t5 = keys.filter((k) => SYSTEM_REGISTRY[k].executionMode === SYSTEM_EXECUTION_MODES.T5);
    const paper = keys.filter((k) => SYSTEM_REGISTRY[k].executionMode === SYSTEM_EXECUTION_MODES.PAPER);

    assert.equal(early.length, 4, 'Must have exactly 4 EARLY systems');
    assert.equal(t5.length, 2, 'Must have exactly 2 T5 systems');
    assert.equal(paper.length, 3, 'Must have exactly 3 PAPER systems');

    assert.deepEqual(early.sort(), [
        'MT - CHA EUR - V1.0',
        'MT - ENG2 - v1.0',
        'MT - ITA1 - V1.0',
        'MT - Premier League 02.5'
    ].sort());

    assert.deepEqual(t5.sort(), [
        'MT - FRA1 FRA2 - V1.0',
        'MT-LAB-BTTS-ESP-v0.1'
    ].sort());

    assert.deepEqual(paper.sort(), [
        'MT - GER1 - v1.1',
        'MT - POR1 - v1.0',
        'MT - TUR1 - V1.0'
    ].sort());
});

test('EARLY systems have correct configuration', () => {
    for (const id of ['MT - CHA EUR - V1.0', 'MT - ENG2 - v1.0', 'MT - ITA1 - V1.0', 'MT - Premier League 02.5']) {
        const def = getSystemDefinition(id);
        assert.ok(def, `System ${id} must exist`);
        assert.equal(def.executionMode, SYSTEM_EXECUTION_MODES.EARLY);
        assert.equal(def.requiresT5, false);
        assert.equal(def.tier, SYSTEM_TIERS.PUBLICAR_CONTROLADO);
        assert.equal(def.stakePolicy.factor, 0.75);
        assert.ok(isEarlyPublicationSystem(id));
        assert.equal(isT5System(id), false);
        assert.equal(isPaperSystem(id), false);
    }
});

test('T5 systems have requiresT5 = true and factor 0.75', () => {
    for (const id of ['MT - FRA1 FRA2 - V1.0', 'MT-LAB-BTTS-ESP-v0.1']) {
        const def = getSystemDefinition(id);
        assert.ok(def, `System ${id} must exist`);
        assert.equal(def.executionMode, SYSTEM_EXECUTION_MODES.T5);
        assert.equal(def.requiresT5, true);
        assert.equal(def.tier, SYSTEM_TIERS.PUBLICAR_CONTROLADO);
        assert.equal(def.stakePolicy.factor, 0.75);
        assert.ok(isT5System(id));
        assert.equal(isEarlyPublicationSystem(id), false);
        assert.equal(isPaperSystem(id), false);
    }
});

test('PAPER systems have factor 0.0 and OBSERVACION_PAPER tier', () => {
    for (const id of ['MT - POR1 - v1.0', 'MT - GER1 - v1.1', 'MT - TUR1 - V1.0']) {
        const def = getSystemDefinition(id);
        assert.ok(def, `System ${id} must exist`);
        assert.equal(def.executionMode, SYSTEM_EXECUTION_MODES.PAPER);
        assert.equal(def.tier, SYSTEM_TIERS.OBSERVACION_PAPER);
        assert.equal(def.stakePolicy.factor, 0.0);
        assert.ok(isPaperSystem(id));
        assert.equal(isEarlyPublicationSystem(id), false);
        assert.equal(isT5System(id), false);
    }
});

test('mapSystemSelection maps raw selections correctly', () => {
    assert.equal(mapSystemSelection('MT - ENG2 - v1.0', 'Team 2 (FT)'), 'Visitante');
    assert.equal(mapSystemSelection('MT - ENG2 - v1.0', '2'), 'Visitante');
    assert.equal(mapSystemSelection('MT - CHA EUR - V1.0', 'No'), 'No');
    assert.equal(mapSystemSelection('MT - FRA1 FRA2 - V1.0', 'Over 2.5'), 'Más de 2,5 goles');
    assert.equal(mapSystemSelection('MT-LAB-BTTS-ESP-v0.1', 'Yes'), 'Sí');
    assert.equal(mapSystemSelection('MT - POR1 - v1.0', 'Team 1 (FT)'), 'Local');
    assert.equal(mapSystemSelection('MT - UNKNOWN', 'Yes'), null);
});

test('calculateRegistryStake computes correct stakes based on odds and confidence factor', () => {
    // Controlled system: factor 0.75
    const controlledLow = calculateRegistryStake({ systemId: 'MT - ENG2 - v1.0', odds: 1.35 });
    assert.equal(controlledLow.baseStakePct, 1.5);
    assert.equal(controlledLow.confidenceFactor, 0.75);
    assert.equal(controlledLow.recommendedStakePct, 1.125);

    const controlledMid = calculateRegistryStake({ systemId: 'MT - ENG2 - v1.0', odds: 2.10 });
    assert.equal(controlledMid.baseStakePct, 1.0);
    assert.equal(controlledMid.confidenceFactor, 0.75);
    assert.equal(controlledMid.recommendedStakePct, 0.75);

    const controlledHigh = calculateRegistryStake({ systemId: 'MT - ENG2 - v1.0', odds: 3.50 });
    assert.equal(controlledHigh.baseStakePct, 0.5);
    assert.equal(controlledHigh.confidenceFactor, 0.75);
    assert.equal(controlledHigh.recommendedStakePct, 0.375);

    // Paper system: factor 0.0 -> stake 0%
    const paper = calculateRegistryStake({ systemId: 'MT - GER1 - v1.1', odds: 1.85 });
    assert.equal(paper.confidenceFactor, 0.0);
    assert.equal(paper.recommendedStakePct, 0.0);

    // Unapproved system throws
    assert.throws(() => calculateRegistryStake({ systemId: 'MT - FAKE', odds: 2.0 }), /desconocido/i);
});
