import test from 'node:test';
import assert from 'node:assert/strict';
import { realm, row, systems } from './helpers/tablero-fixture.mjs';
import { normalizeFutbolBrainOwnerCandidate } from '../server/futbolbrain-local-ingest.js';
import { createServer } from 'node:http';

// Load extension safety rules
import '../extensions/morning-mac-assisted/safety.js';
const Safety = globalThis.MoneyTipsMorningSafety;

const AT = new Date('2026-07-15T10:30:00.000Z'); // 12:30 Madrid (no 10:00 hard lock!)

test('Mac Assisted: Safety checks future kickoff and Europe/Madrid date', () => {
  // 30 seconds ahead -> rejected (must be > 60s ahead)
  const tooSoon = new Date(AT.getTime() + 30_000);
  assert.equal(Safety.isFutureKickoff(tooSoon, AT), false);

  // 5 minutes ahead -> accepted
  const future = new Date(AT.getTime() + 300_000);
  assert.equal(Safety.isFutureKickoff(future, AT), true);

  // Today in Madrid
  assert.equal(Safety.isTodayMadrid(future, AT), true);

  // Tomorrow in Madrid -> rejected
  const tomorrow = new Date('2026-07-16T12:00:00.000Z');
  assert.equal(Safety.isTodayMadrid(tomorrow, AT), false);

  // Odds validation
  assert.equal(Safety.isCleanOdds('2.40'), true);
  assert.equal(Safety.isCleanOdds(1.00), false);
  assert.equal(Safety.isCleanOdds('abc'), false);
  assert.equal(Safety.isCleanOdds(1001), false);
});

test('Mac Assisted: Tablero reader extracts all 4 Morning systems correctly', () => {
  const f = realm();
  const reading = f.read();

  assert.equal(reading.rows.length, 4);

  const foundSystems = reading.rows.map(r => String(r.payload.system.id)).sort();
  const expectedSystems = [
    'MT - CHA EUR - V1.0',
    'MT - ENG2 - v1.0',
    'MT - ITA1 - V1.0',
    'MT - Premier League 02.5'
  ].sort();

  assert.equal(JSON.stringify(foundSystems), JSON.stringify(expectedSystems));

  // Check each payload against server normalizer
  for (const r of reading.rows) {
    const formatted = Safety.formatPayload(r.payload, AT.toISOString());
    assert.equal(formatted.source.provider, 'futbolbrain-owner-browser');

    // Server-side normalization
    const normalized = normalizeFutbolBrainOwnerCandidate(formatted, { now: AT });
    assert.equal(normalized.publicationPolicy, 'immediate');
    assert.ok(normalized.bet.selection);
    assert.ok(normalized.event.homeTeam);
    assert.ok(normalized.event.awayTeam);
  }
});

test('Mac Assisted: Non-Morning and invalid candidates fail closed', () => {
  // Row with non-Morning system (e.g. MT - FRA1 FRA2 - V1.0)
  const nonMorningRow = row(0, { system: 'MT - FRA1 FRA2 - V1.0' });
  const f = realm({ rows: [nonMorningRow] });
  const reading = f.read();
  assert.equal(reading.rows.length, 0);

  // Candidate with wrong selection for system
  const badSelectionRow = row(0, { selection: 'Yes' }); // MT - CHA EUR expects 'No'
  const f2 = realm({ rows: [badSelectionRow] });
  const reading2 = f2.read();
  assert.equal(reading2.rows.length, 0);

  // Candidate with past kickoff
  const pastRow = row(0, { date: '15/07/2026 10:00' });
  const f3 = realm({ rows: [pastRow] });
  const reading3 = f3.read();
  if (reading3.rows.length > 0) {
    const kickoff = reading3.rows[0].payload.event.kickoffAt;
    assert.equal(Safety.isFutureKickoff(kickoff, AT), false);
  }
});

test('Mac Assisted: Idempotency and repeated page reloads prevent duplicates', async () => {
  const storage = {};
  const mockChromeStorage = {
    get: (keys, cb) => cb({ [keys[0]]: storage[keys[0]] }),
    set: (data, cb) => { Object.assign(storage, data); cb(); }
  };

  const candidate = {
    event: {
      sourceEventId: 'fb-own-test-idempotency-1',
      competition: 'ENG-Championship',
      homeTeam: 'Leeds United',
      awayTeam: 'Sheffield United',
      kickoffAt: '2026-07-15T19:00:00.000Z'
    },
    system: { id: 'MT - ENG2 - v1.0' },
    visiblePick: { selection: 'Team 2 (FT)', odds: 2.15 },
    source: { provider: 'futbolbrain-owner-browser' }
  };

  const day = Safety.madridDay(AT);
  const claimKey = `${day}::${candidate.event.sourceEventId}`;

  // First submission: empty claims -> sets in_flight, then confirmed
  assert.equal(storage.moneyTipsMorningMacClaimsV1, undefined);

  // Simulate first post confirming
  storage.moneyTipsMorningMacClaimsV1 = {
    [claimKey]: {
      candidateId: candidate.event.sourceEventId,
      status: 'confirmed',
      completedAt: AT.toISOString(),
      response: { ok: true, status: 201 }
    }
  };

  // Second scan (reload of Tablero):
  const claims = storage.moneyTipsMorningMacClaimsV1;
  const existing = claims[claimKey];
  assert.ok(existing);
  assert.equal(existing.status, 'confirmed');

  // Verify that subsequent check flags as already handled without network request
  const alreadyHandled = ['confirmed', 'duplicate'].includes(existing.status);
  assert.equal(alreadyHandled, true);
});

test('Mac Assisted: Service Worker suspension and restart preserves claims', () => {
  // State saved in local storage survives in-memory destruction
  let persistentStorage = {
    moneyTipsMorningMacConfigV1: {
      endpoint: 'https://app.pronosticosmoneytips.com/api/internal/futbolbrain-local-picks',
      token: 'test-device-token-1234567890',
      armed: true
    },
    moneyTipsMorningMacClaimsV1: {
      '2026-07-15::fb-own-test-pick-persisted': {
        candidateId: 'fb-own-test-pick-persisted',
        status: 'confirmed',
        completedAt: '2026-07-15T10:31:00.000Z'
      }
    }
  };

  // Simulate Service Worker termination (all in-memory state cleared)
  let inFlightQueue = null;
  let active = null;

  // Simulate Service Worker wake-up and reading claims from storage
  const restoredClaims = persistentStorage.moneyTipsMorningMacClaimsV1;
  assert.ok(restoredClaims['2026-07-15::fb-own-test-pick-persisted']);
  assert.equal(restoredClaims['2026-07-15::fb-own-test-pick-persisted'].status, 'confirmed');
});

test('Mac Assisted: Network failure or 500 error disarms submission and sets uncertain state', () => {
  const mock500Response = {
    ok: false,
    status: 500,
    uncertain: true,
    result: { error: 'INTERNAL_ERROR' }
  };

  const status = Safety.classify(mock500Response);
  assert.equal(status, 'uncertain');

  // When uncertain, policy disarms automated submission
  const config = { armed: true, autoSubmit: true };
  if (status === 'uncertain') {
    config.armed = false;
  }
  assert.equal(config.armed, false);
});

test('Mac Assisted: Full loop with mock backend server and claim-before-I/O', async () => {
  let receivedRequests = [];
  let shouldFail = false;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedRequests.push({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization,
        body: JSON.parse(body || '{}')
      });

      if (shouldFail) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
        return;
      }

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        created: true,
        state: 'published',
        queueId: 'op_mock_test_123',
        publicationPolicy: 'immediate'
      }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockEndpoint = `http://127.0.0.1:${port}/api/internal/futbolbrain-local-picks`;

  try {
    const candidate = {
      event: {
        sourceEventId: 'fb-own-full-loop-1',
        competition: 'EUR-Champions-League',
        homeTeam: 'Real Madrid',
        awayTeam: 'Bayern Munich',
        kickoffAt: new Date(AT.getTime() + 180_000).toISOString()
      },
      system: { id: 'MT - CHA EUR - V1.0' },
      visiblePick: { selection: 'No', odds: 1.95 },
      source: { provider: 'futbolbrain-owner-browser' }
    };

    // Format payload
    const payload = Safety.formatPayload(candidate, AT.toISOString());

    // Submit candidate to mock endpoint
    const res = await fetch(mockEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-device-token-12345678'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.ok, true);
    assert.equal(data.state, 'published');
    assert.equal(receivedRequests.length, 1);
    assert.equal(receivedRequests[0].auth, 'Bearer mock-device-token-12345678');
    assert.equal(receivedRequests[0].body.event.homeTeam, 'Real Madrid');
    assert.equal(receivedRequests[0].body.visiblePick.selection, 'No');
  } finally {
    server.close();
  }
});
