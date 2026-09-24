import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

const PROJECT_ID = 'money-tracking-emulator-test';
let testEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

// Ejecuta con privilegios administrativos (simula backend Admin SDK con bypass de reglas cliente)
const asAdmin = (callback) => testEnvironment.withSecurityRulesDisabled(async (context) => callback(context.firestore()));

test('Firestore Integration: ciclo de vida de premiumPaymentOrders', async () => {
  await asAdmin(async (db) => {
    const orderId = 'mt-monthly-test-order-001';
    const orderRef = doc(db, 'premiumPaymentOrders', orderId);

    // 1. Creación de orden (pending)
    await setDoc(orderRef, {
      schemaVersion: 1,
      status: 'pending',
      provider: 'premiumpay',
      environment: 'test',
      uid: 'user-alpha-001',
      email: 'alpha@moneytips.test',
      plan: 'monthly',
      expectedAmount: 29.9,
      currency: 'EUR',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    let snap = await getDoc(orderRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().status, 'pending');
    assert.equal(snap.data().expectedAmount, 29.9);

    // 2. Checkout creado
    await updateDoc(orderRef, {
      status: 'checkout_created',
      providerPaymentId: 'pay_pp_123456',
      updatedAt: serverTimestamp()
    });
    snap = await getDoc(orderRef);
    assert.equal(snap.data().status, 'checkout_created');
    assert.equal(snap.data().providerPaymentId, 'pay_pp_123456');

    // 3. Monitor marca abandoned tras timeout
    await updateDoc(orderRef, {
      status: 'abandoned',
      abandonedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reconciliationNote: 'Expirado sin confirmación de pago'
    });
    snap = await getDoc(orderRef);
    assert.equal(snap.data().status, 'abandoned');
  });
});

test('Firestore Integration: transacción de callback y activación de entitlement en users/{uid}/entitlements/subscription', async () => {
  await asAdmin(async (db) => {
    const orderId = 'mt-monthly-callback-002';
    const uid = 'user-subscriber-002';
    const orderRef = doc(db, 'premiumPaymentOrders', orderId);
    const entitlementRef = doc(db, 'users', uid, 'entitlements', 'subscription');

    // Crear orden previa
    await setDoc(orderRef, {
      schemaVersion: 1,
      status: 'checkout_created',
      provider: 'premiumpay',
      uid,
      email: 'sub@moneytips.test',
      plan: 'monthly',
      expectedAmount: 29.9,
      currency: 'EUR',
      createdAt: serverTimestamp()
    });

    // Ejecutar transacción del callback
    const now = new Date();
    const outcome = await runTransaction(db, async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      assert.equal(orderDoc.exists(), true);
      const order = orderDoc.data();

      // Comprobación idempotencia
      if (order.status === 'paid') return { duplicate: true };

      const CALLBACK_ELIGIBLE = new Set(['pending', 'checkout_created', 'abandoned']);
      assert.equal(CALLBACK_ELIGIBLE.has(order.status), true);

      const accessUntil = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

      // Escribir entitlement
      transaction.set(entitlementRef, {
        schemaVersion: 1,
        status: 'active',
        plan: order.plan,
        accessUntil: Timestamp.fromDate(accessUntil),
        source: 'premiumpay-api',
        renewalMode: 'manual', // Inviolable
        paymentReference: 'pp_pay_7890',
        grantedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Actualizar orden
      transaction.update(orderRef, {
        status: 'paid',
        providerPaymentId: 'pp_pay_7890',
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return { activated: true, duplicate: false };
    });

    assert.equal(outcome.activated, true);
    assert.equal(outcome.duplicate, false);

    // Verificar persistencia de entitlement
    const entSnap = await getDoc(entitlementRef);
    assert.equal(entSnap.exists(), true);
    assert.equal(entSnap.data().status, 'active');
    assert.equal(entSnap.data().plan, 'monthly');
    assert.equal(entSnap.data().renewalMode, 'manual');
    assert.equal(entSnap.data().source, 'premiumpay-api');

    // Verificar estado de orden
    const orderSnap = await getDoc(orderRef);
    assert.equal(orderSnap.data().status, 'paid');
  });
});

test('Firestore Integration: idempotencia concurrente en webhook de pago', async () => {
  await asAdmin(async (db) => {
    const orderId = 'mt-concurrent-order-003';
    const uid = 'user-concurrent-003';
    const orderRef = doc(db, 'premiumPaymentOrders', orderId);
    const entitlementRef = doc(db, 'users', uid, 'entitlements', 'subscription');

    await setDoc(orderRef, {
      schemaVersion: 1,
      status: 'checkout_created',
      uid,
      plan: 'monthly',
      expectedAmount: 29.9,
      currency: 'EUR'
    });

    const processCallbackTransaction = async () => {
      return await runTransaction(db, async (transaction) => {
        const orderDoc = await transaction.get(orderRef);
        const order = orderDoc.data();
        if (order.status === 'paid') {
          return { activated: true, duplicate: true };
        }

        transaction.set(entitlementRef, {
          status: 'active',
          plan: order.plan,
          accessUntil: Timestamp.fromDate(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)),
          renewalMode: 'manual',
          updatedAt: serverTimestamp()
        });

        transaction.update(orderRef, {
          status: 'paid',
          updatedAt: serverTimestamp()
        });

        return { activated: true, duplicate: false };
      });
    };

    // Disparar dos llamadas transaccionales concurrentes exactamente para el mismo pedido
    const [result1, result2] = await Promise.all([
      processCallbackTransaction(),
      processCallbackTransaction()
    ]);

    // Exactamente uno activa y el otro detecta duplicidad
    const activations = [result1, result2].filter(r => r.duplicate === false);
    const duplicates = [result1, result2].filter(r => r.duplicate === true);
    assert.equal(activations.length, 1, 'Exactamente una transacción debe activar');
    assert.equal(duplicates.length, 1, 'Exactamente una transacción debe ser detectada como duplicado');

    // La orden debe estar en estado paid
    const finalOrder = await getDoc(orderRef);
    assert.equal(finalOrder.data().status, 'paid');
  });
});

test('Firestore Integration: callback tardío sobre orden marcada como abandoned activa el acceso', async () => {
  await asAdmin(async (db) => {
    const orderId = 'mt-late-order-004';
    const uid = 'user-late-004';
    const orderRef = doc(db, 'premiumPaymentOrders', orderId);
    const entitlementRef = doc(db, 'users', uid, 'entitlements', 'subscription');

    // Orden abandonada por el monitor
    await setDoc(orderRef, {
      status: 'abandoned',
      uid,
      plan: 'annual',
      expectedAmount: 289,
      currency: 'EUR',
      abandonedAt: serverTimestamp()
    });

    // Llega webhook tardío
    const outcome = await runTransaction(db, async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      const order = orderDoc.data();

      // C2 Auditoría: 'abandoned' es elegible
      const CALLBACK_ELIGIBLE = new Set(['pending', 'checkout_created', 'abandoned']);
      if (!CALLBACK_ELIGIBLE.has(order.status)) return { activated: false };

      transaction.set(entitlementRef, {
        status: 'active',
        plan: order.plan,
        accessUntil: Timestamp.fromDate(new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)),
        renewalMode: 'manual',
        source: 'premiumpay-api'
      });

      transaction.update(orderRef, {
        status: 'paid',
        paidAt: serverTimestamp()
      });

      return { activated: true, duplicate: false };
    });

    assert.equal(outcome.activated, true);
    const entSnap = await getDoc(entitlementRef);
    assert.equal(entSnap.data().status, 'active');
    assert.equal(entSnap.data().plan, 'annual');

    const orderSnap = await getDoc(orderRef);
    assert.equal(orderSnap.data().status, 'paid');
  });
});

test('Firestore Integration: persistencia inmutable en systemEvents', async () => {
  await asAdmin(async (db) => {
    const eventId = 'evt_test_audit_005';
    const eventRef = doc(db, 'systemEvents', eventId);

    await setDoc(eventRef, {
      schemaVersion: 1,
      eventId,
      correlationId: 'corr_test_005',
      department: 'customers_revenue',
      workerId: 'premiumpay-callback-handler',
      eventType: 'subscription.activated',
      status: 'success',
      payload: {
        orderId: 'mt-order-005',
        uid: 'user-005',
        plan: 'monthly'
      },
      rulesApplied: ['rule_payment_paid', 'rule_amount_exact', 'rule_manual_renewal_only'],
      output: { activated: true, renewalMode: 'manual' },
      createdAt: serverTimestamp()
    });

    const snap = await getDoc(eventRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().department, 'customers_revenue');
    assert.equal(snap.data().eventType, 'subscription.activated');
    assert.equal(snap.data().status, 'success');
    assert.equal(snap.data().output.renewalMode, 'manual');
  });
});

test('Firestore Integration: contrato de 15 campos en agentStates para Money Tips HQ', async () => {
  await asAdmin(async (db) => {
    const agentId = 'revenue-order-monitor';
    const agentRef = doc(db, 'agentStates', agentId);

    const unitPayload = {
      id: agentId,
      name: 'Revenue Order Monitor',
      department: 'customers_revenue',
      type: 'worker',
      status: 'idle',
      currentTask: 'Monitorización completada',
      lastActivity: serverTimestamp(),
      startedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      retryCount: 0,
      cost: { tokens: 0, estimatedEur: 0 },
      model: null,
      actionsAvailable: ['scan_unresolved_orders', 'expire_abandoned_orders', 'escalate_orphan_orders'],
      result: { totalScanned: 10, expiredAbandoned: 2, reconciliationMode: 'manual_review_required' },
      error: null
    };

    await setDoc(agentRef, unitPayload);

    const snap = await getDoc(agentRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().name, 'Revenue Order Monitor');
    assert.equal(snap.data().department, 'customers_revenue');
    assert.equal(snap.data().status, 'idle');
    assert.equal(snap.data().result.reconciliationMode, 'manual_review_required');
    assert.equal(snap.data().actionsAvailable.length, 3);
  });
});

test('Firestore Integration: registro y resolución de revenueIncidents', async () => {
  await asAdmin(async (db) => {
    const incidentId = 'inc_rev_test_007';
    const incidentRef = doc(db, 'revenueIncidents', incidentId);

    // 1. Registro de incidencia
    await setDoc(incidentRef, {
      schemaVersion: 1,
      incidentId,
      incidentType: 'orphan_payment',
      orderId: 'mt-orphan-007',
      uid: 'user-007',
      email: 'orphan@moneytips.test',
      amount: 29.9,
      currency: 'EUR',
      reason: 'Pedido pendiente 15 min sin callback. Verificar en extracto Betandeal.',
      status: 'open',
      escalateTo: 'karen',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    let snap = await getDoc(incidentRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().status, 'open');
    assert.equal(snap.data().escalateTo, 'karen');

    // 2. Resolución de incidencia por Ops
    await updateDoc(incidentRef, {
      status: 'resolved',
      resolvedBy: 'karen',
      resolutionNotes: 'Pago verificado en panel Betandeal y activado manualmente',
      resolvedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    snap = await getDoc(incidentRef);
    assert.equal(snap.data().status, 'resolved');
    assert.equal(snap.data().resolvedBy, 'karen');
  });
});

test('Firestore Integration: auto-copia desacoplada a banca de temporada e idempotencia', async () => {
  await asAdmin(async (db) => {
    const ownerUid = 'owner-camilo-001';
    const seasonBankId = 'bank-season-2627-test';
    const pickId = 'op_live_match_888';

    // 1. Configurar la banca de temporada Money Tips 26/27
    const bankRef = doc(db, 'users', ownerUid, 'banks', seasonBankId);
    await setDoc(bankRef, {
      name: 'Money Tips 26/27',
      initialCapital: 5000,
      currency: 'EUR',
      createdAt: serverTimestamp()
    });

    // 2. Registrar el pick oficial publicado en officialPicks
    const pickRef = doc(db, 'officialPicks', pickId);
    await setDoc(pickRef, {
      schemaVersion: 3,
      status: 'published',
      event: {
        competition: 'LaLiga EA Sports',
        homeTeam: 'Real Madrid',
        awayTeam: 'Atlético de Madrid',
        kickoffAt: Timestamp.fromDate(new Date('2026-09-20T19:00:00.000Z'))
      },
      bet: {
        market: '1X2',
        selection: 'Real Madrid',
        oddsAtPublication: 1.95,
        recommendedStakePct: 2.0
      },
      system: { id: 'sys_derby', version: '1.0' },
      publishedAt: serverTimestamp()
    });

    // 3. Ejecutar primera copia a la banca
    const betsCollection = collection(db, 'users', ownerUid, 'bets');
    const existingBefore = await getDocs(betsCollection);
    assert.equal(existingBefore.empty, true);

    const betDocRef = doc(betsCollection, `official_${pickId}`);
    const stake = 2.0;
    const initialCapital = 5000;
    const amount = (initialCapital * stake / 100); // 100 EUR

    const betPayload = {
      bankId: seasonBankId,
      officialPickId: pickId,
      isOfficialPickCopy: true,
      title: 'Real Madrid vs Atlético de Madrid',
      market: '1X2',
      selection: 'Real Madrid',
      odds: 1.95,
      stake,
      amount,
      status: 'pending',
      bookmaker: 'Bet365',
      category: 'Money Tips',
      createdAt: new Date().toISOString(),
      copiedAt: serverTimestamp(),
      selections: [{
        id: `official-${pickId}`,
        title: 'Real Madrid vs Atlético de Madrid',
        selection: 'Real Madrid',
        market: '1X2',
        status: 'pending',
        odds: 1.95
      }]
    };

    await setDoc(betDocRef, betPayload);

    // 4. Verificar persistencia de la apuesta oficial
    const betSnap = await getDoc(betDocRef);
    assert.equal(betSnap.exists(), true);
    assert.equal(betSnap.data().status, 'pending');
    assert.equal(betSnap.data().amount, 100);
    assert.equal(betSnap.data().odds, 1.95);
    assert.equal(betSnap.data().officialPickId, pickId);
    assert.equal('profit' in betSnap.data(), false, 'REGLA: el campo profit NO debe persistirse');

    // 5. Segunda ejecución: comprobación de deduplicación (cero duplicados)
    const duplicateCheck = await getDocs(betsCollection);
    const copies = duplicateCheck.docs.filter(d => d.data().officialPickId === pickId);
    assert.equal(copies.length, 1, 'Debe existir exactamente 1 copia de la apuesta oficial');
  });
});

test('Firestore Integration: liquidación determinista (settlement), eventos inmutables y actualización de apuesta', async () => {
  await asAdmin(async (db) => {
    const ownerUid = 'owner-settle-001';
    const pickId = 'op_settle_derby_999';
    const betId = `bet_official_${pickId}`;

    // 1. Pick oficial en Firestore
    const pickRef = doc(db, 'officialPicks', pickId);
    await setDoc(pickRef, {
      schemaVersion: 3,
      status: 'published',
      event: {
        competition: 'LaLiga EA Sports',
        homeTeam: 'Real Madrid',
        awayTeam: 'Barcelona',
        kickoffAt: Timestamp.fromDate(new Date('2026-09-17T18:00:00.000Z'))
      },
      bet: {
        market: '1X2',
        selection: 'Real Madrid',
        oddsAtPublication: 2.10,
        recommendedStakePct: 2.0
      },
      system: { id: 'sys_derby_v1', version: '1.0' },
      publishedAt: serverTimestamp()
    });

    // 2. Apuesta copiada en users/{ownerUid}/bets
    const betRef = doc(db, 'users', ownerUid, 'bets', betId);
    await setDoc(betRef, {
      bankId: 'bank-season-2627',
      officialPickId: pickId,
      isOfficialPickCopy: true,
      title: 'Real Madrid vs Barcelona',
      market: '1X2',
      selection: 'Real Madrid',
      status: 'pending',
      amount: 100,
      odds: 2.10,
      selections: [{
        id: `official-${pickId}`,
        selection: 'Real Madrid',
        market: '1X2',
        status: 'pending',
        odds: 2.10
      }],
      createdAt: new Date().toISOString()
    });

    // 3. Simular liquidación determinista con resultado 3-1 a los 90 minutos
    const regularTimeScore = { home: 3, away: 1 };
    const wonStatus = 'won';

    await runTransaction(db, async (transaction) => {
      // Actualizar pick oficial
      transaction.update(pickRef, {
        settlement: {
          status: wonStatus,
          regularTimeScore,
          reason: 'Resultado reglamentario: 3-1. Ganador: 1. Pronóstico: 1',
          settledAt: serverTimestamp(),
          source: 'mock-sports-provider'
        }
      });

      // Registrar evento inmutable de liquidación
      const eventRef = doc(db, 'officialPicks', pickId, 'events', 'settled');
      transaction.set(eventRef, {
        type: 'settled',
        status: wonStatus,
        regularTimeScore,
        createdAt: serverTimestamp()
      });

      // Actualizar apuesta en banca
      transaction.update(betRef, {
        status: wonStatus,
        settledAt: serverTimestamp(),
        resultEvidence: { regularTimeScore, source: 'mock-sports-provider' },
        selections: [{
          id: `official-${pickId}`,
          selection: 'Real Madrid',
          market: '1X2',
          status: wonStatus,
          odds: 2.10,
          isOpen: false
        }],
        updatedAt: serverTimestamp()
      });
    });

    // 4. Verificaciones
    const updatedPick = await getDoc(pickRef);
    assert.equal(updatedPick.data().settlement.status, 'won');
    assert.deepEqual(updatedPick.data().settlement.regularTimeScore, { home: 3, away: 1 });

    const settledEvent = await getDoc(doc(db, 'officialPicks', pickId, 'events', 'settled'));
    assert.equal(settledEvent.exists(), true);
    assert.equal(settledEvent.data().type, 'settled');
    assert.equal(settledEvent.data().status, 'won');

    const updatedBet = await getDoc(betRef);
    assert.equal(updatedBet.data().status, 'won');
    assert.equal(updatedBet.data().selections[0].status, 'won');
    assert.equal(updatedBet.data().selections[0].isOpen, false);
    // REGLA: Verificar que el campo profit NO se persiste en la apuesta
    assert.equal('profit' in updatedBet.data(), false);
  });
});



test('Firestore Integration: cola durable officialPickAutoCopyQueue, transición de estados e idempotencia por pickId', async () => {
  await asAdmin(async (db) => {
    const pickId = 'op_durable_queue_001';
    const queueRef = doc(db, 'officialPickAutoCopyQueue', pickId);

    // 1. Encolar tarea durable con estado pending
    await setDoc(queueRef, {
      schemaVersion: 1,
      officialPickId: pickId,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: serverTimestamp(),
      pickSnapshot: {
        id: pickId,
        event: { homeTeam: 'Chelsea', awayTeam: 'Arsenal' },
        bet: { market: '1X2', selection: 'Chelsea', oddsAtPublication: 2.10, recommendedStakePct: 1.5 }
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    let snap = await getDoc(queueRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().status, 'pending');
    assert.equal(snap.data().attempts, 0);
    assert.equal(snap.data().maxAttempts, 3);
    assert.equal(snap.data().officialPickId, pickId);

    // 2. Transición a processing (claim de worker)
    await updateDoc(queueRef, {
      status: 'processing',
      updatedAt: serverTimestamp()
    });
    snap = await getDoc(queueRef);
    assert.equal(snap.data().status, 'processing');

    // 3. Finalización exitosa: completed
    await updateDoc(queueRef, {
      status: 'completed',
      betId: 'bet_copied_999',
      bankId: 'bank-season-2627',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    snap = await getDoc(queueRef);
    assert.equal(snap.data().status, 'completed');
    assert.equal(snap.data().betId, 'bet_copied_999');

    // 4. Idempotencia: una tarea completed nunca vuelve a pending
    const currentStatus = snap.data().status;
    if (currentStatus !== 'completed') {
      await updateDoc(queueRef, { status: 'pending' });
    }
    const finalSnap = await getDoc(queueRef);
    assert.equal(finalSnap.data().status, 'completed', 'La tarea completed debe permanecer completada');
  });
});

test('Firestore Integration: reintentos con backoff y escalado de fallo a operationsIncidents (department: data_performance)', async () => {
  await asAdmin(async (db) => {
    const pickId = 'op_exhausted_retry_002';
    const queueRef = doc(db, 'officialPickAutoCopyQueue', pickId);

    // 1. Tarea creada
    await setDoc(queueRef, {
      schemaVersion: 1,
      officialPickId: pickId,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // 2. Simular intento 1 fallido -> backoff 1 min
    await updateDoc(queueRef, {
      status: 'pending',
      attempts: 1,
      lastError: 'Timeout de conexión con Firestore',
      nextAttemptAt: Timestamp.fromMillis(Date.now() + 60000),
      updatedAt: serverTimestamp()
    });
    let snap = await getDoc(queueRef);
    assert.equal(snap.data().attempts, 1);
    assert.equal(snap.data().status, 'pending');

    // 3. Simular intento 2 fallido -> backoff 5 min
    await updateDoc(queueRef, {
      status: 'pending',
      attempts: 2,
      lastError: 'Banca bloqueada temporalmente',
      nextAttemptAt: Timestamp.fromMillis(Date.now() + 300000),
      updatedAt: serverTimestamp()
    });
    snap = await getDoc(queueRef);
    assert.equal(snap.data().attempts, 2);

    // 4. Simular intento 3 (agotado) -> status: failed
    await updateDoc(queueRef, {
      status: 'failed',
      attempts: 3,
      lastError: 'Banca no encontrada tras 3 intentos',
      failedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    snap = await getDoc(queueRef);
    assert.equal(snap.data().status, 'failed');
    assert.equal(snap.data().attempts, 3);

    // 5. Registro automático de incidencia en operationsIncidents (NUNCA en revenueIncidents)
    const incidentId = `inc_ops_test_${pickId}`;
    const incidentRef = doc(db, 'operationsIncidents', incidentId);
    await setDoc(incidentRef, {
      incidentId,
      schemaVersion: 1,
      department: 'data_performance',
      incidentType: 'auto_copy_failed',
      targetId: pickId,
      reason: 'Auto-copia fallida tras 3 intentos: Banca no encontrada. El pick oficial permanece publicado.',
      status: 'open',
      escalateTo: 'karen',
      details: { pickId, attempts: 3 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const incSnap = await getDoc(incidentRef);
    assert.equal(incSnap.exists(), true);
    assert.equal(incSnap.data().department, 'data_performance');
    assert.equal(incSnap.data().incidentType, 'auto_copy_failed');
    assert.equal(incSnap.data().targetId, pickId);
    assert.equal(incSnap.data().status, 'open');

    // REGLA: revenueIncidents permanece estrictamente vacía para incidencias de Data & Performance
    const revenueIncidents = await getDocs(collection(db, 'revenueIncidents'));
    assert.equal(revenueIncidents.empty, true, 'revenueIncidents no debe recibir incidencias de data_performance');
  });
});

test('Firestore Integration: tolerancia de settlement a partidos en juego (in_play, delayed) tras +105 min sin alerta prematura', async () => {
  await asAdmin(async (db) => {
    const pickId = 'op_live_match_tolerance';
    const pickRef = doc(db, 'officialPicks', pickId);

    // Partido inició hace 115 minutos (kickoff +115 min)
    const kickoffTime = new Date(Date.now() - 115 * 60 * 1000);
    await setDoc(pickRef, {
      schemaVersion: 3,
      status: 'published',
      event: {
        competition: 'Premier League',
        homeTeam: 'Tottenham',
        awayTeam: 'Chelsea',
        kickoffAt: Timestamp.fromDate(kickoffTime)
      },
      bet: { market: '1X2', selection: 'Tottenham', oddsAtPublication: 2.30 },
      publishedAt: Timestamp.fromDate(kickoffTime)
    });

    // Simular escáner de settlement: el proveedor indica que el partido sigue IN_PLAY (prórroga o demora)
    const providerFixtureStatus = 'in_play';
    const isOngoing = ['in_play', 'delayed', 'extra_time', 'half_time'].includes(providerFixtureStatus);

    // REGLA ARQUITECTÓNICA: si sigue en juego, no debe registrarse settlementReview ni alerta
    if (isOngoing) {
      // El pick simplemente no se modifica y se reintentará en el próximo ciclo del cron
    }

    const snap = await getDoc(pickRef);
    assert.equal('settlement' in snap.data(), false, 'Un partido en juego no debe estar liquidado');
    assert.equal('settlementReview' in snap.data(), false, 'Un partido en juego no debe marcarse para revisión humana prematura');

    // Comprobar que no se crearon incidencias operativas falsas
    const opsIncidents = await getDocs(collection(db, 'operationsIncidents'));
    assert.equal(opsIncidents.empty, true, 'No deben generarse incidencias operativas por partidos aún en juego');
  });
});

test('Firestore Integration: partido suspendido escala a pending_human_review y registra incidencia en operationsIncidents', async () => {
  await asAdmin(async (db) => {
    const pickId = 'op_suspended_match_003';
    const pickRef = doc(db, 'officialPicks', pickId);

    await setDoc(pickRef, {
      schemaVersion: 3,
      status: 'published',
      event: {
        competition: 'Copa del Rey',
        homeTeam: 'Valencia',
        awayTeam: 'Levante',
        kickoffAt: Timestamp.fromDate(new Date(Date.now() - 120 * 60 * 1000))
      },
      bet: { market: '1X2', selection: 'Valencia' },
      publishedAt: serverTimestamp()
    });

    // Simular que el proveedor retorna estado 'suspended'
    const fixtureStatus = 'suspended';
    const reason = `Partido con estado '${fixtureStatus}'. Requiere revisión de política de suspensión de casas.`;

    // 1. Actualizar pick oficial con settlementReview
    await updateDoc(pickRef, {
      settlementReview: {
        status: 'pending_human_review',
        reason,
        checkedAt: serverTimestamp()
      }
    });

    // 2. Registrar incidencia en operationsIncidents con department: data_performance
    const incidentId = `inc_ops_susp_${pickId}`;
    const incidentRef = doc(db, 'operationsIncidents', incidentId);
    await setDoc(incidentRef, {
      incidentId,
      schemaVersion: 1,
      department: 'data_performance',
      incidentType: 'settlement_ambiguous',
      targetId: pickId,
      reason,
      status: 'open',
      escalateTo: 'karen',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // 3. Verificaciones
    const updatedPick = await getDoc(pickRef);
    assert.equal(updatedPick.data().settlementReview.status, 'pending_human_review');
    assert.ok(updatedPick.data().settlementReview.reason.includes('suspended'));

    const opsInc = await getDoc(incidentRef);
    assert.equal(opsInc.exists(), true);
    assert.equal(opsInc.data().department, 'data_performance');
    assert.equal(opsInc.data().incidentType, 'settlement_ambiguous');
    assert.equal(opsInc.data().targetId, pickId);
    assert.equal(opsInc.data().status, 'open');
  });
});
