import test from 'node:test';
import assert from 'node:assert/strict';
import {
    hasValidPremiumPayAuthorization,
    premiumPayPlan,
    normalizePremiumPayPlan,
    statusIsPaid
} from '../server/premiumpay.js';

test('PremiumPay limits checkout creation to the two published plans', () => {
    assert.equal(normalizePremiumPayPlan(' ANNUAL '), 'annual');
    assert.equal(premiumPayPlan('monthly').amount, 29.9);
    assert.equal(premiumPayPlan('annual').amount, 289);
    assert.throws(() => normalizePremiumPayPlan('lifetime'));
});

test('PremiumPay callback authorization requires the exact API key', () => {
    assert.equal(hasValidPremiumPayAuthorization('Bearer test-key', 'test-key'), true);
    assert.equal(hasValidPremiumPayAuthorization('Bearer test-key-extra', 'test-key'), false);
    assert.equal(hasValidPremiumPayAuthorization('', 'test-key'), false);
});

test('PremiumPay only activates completed payment statuses', () => {
    assert.equal(statusIsPaid('ok'), true);
    assert.equal(statusIsPaid('completed'), true);
    assert.equal(statusIsPaid('pending'), false);
});
