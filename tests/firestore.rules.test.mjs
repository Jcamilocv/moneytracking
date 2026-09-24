import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'money-tracking-rules-test';
const ADMIN_UID = 'Rvp7qaQBC5RQwSKICRKnAb8vaI93';
let testEnvironment;

const validAppBonosState = () => ({
  schemaVersion: 1,
  legacyUserId: 'legacy-user-id',
  clientUpdatedAt: Date.now(),
  migratedAt: serverTimestamp(),
  payload: {
    profile: { displayName: 'Prueba', email: 'prueba@example.test' },
    subProfiles: {},
    activeProfileId: 'default',
  },
});

const validAdminCrm = () => ({
  schemaVersion: 1,
  clientUpdatedAt: Date.now(),
  updatedAt: serverTimestamp(),
  crmData: { leads: [] },
});

const validPublicShare = () => ({
  schemaVersion: 1,
  createdAt: serverTimestamp(),
  betCount: 1,
  bank: {
    id: 'bank-1',
    name: 'Histórico público',
    initialCapital: 1000,
    currency: 'EUR',
    isBalance: false,
    bankIds: [],
  },
});

const validPublicBet = () => ({
  id: 'private-bet-id',
  bankId: 'bank-1',
  date: '2026-08-26',
  time: '18:30',
  bookmaker: 'Casa',
  betMode: 'simple',
  title: 'Evento',
  selection: 'Selección',
  status: 'won',
  category: 'Value',
  odds: 2,
  amount: 10,
  stake: 1,
  isBack: true,
  isLive: false,
  isFreebet: false,
  cashout: '',
  isEachWay: false,
  tipster: '',
  bonus: '',
  commission: '',
  selections: [],
});

const grantPremiumWorkspace = async (userId) => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', userId, 'entitlements', 'subscription'), {
      status: 'active',
      accessUntil: Timestamp.fromMillis(Date.now() + (24 * 60 * 60 * 1000)),
    });
  });
};

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

test('el propietario puede crear y leer su estado AppBonos', async () => {
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  const stateRef = doc(db, 'users', 'user-a', 'appBonos', 'state');

  await assertSucceeds(setDoc(stateRef, validAppBonosState()));
  await assertSucceeds(getDoc(stateRef));
});

test('un usuario no puede leer el AppBonos de otro usuario', async () => {
  const ownerDb = testEnvironment.authenticatedContext('user-a').firestore();
  const strangerDb = testEnvironment.authenticatedContext('user-b').firestore();
  const ownerRef = doc(ownerDb, 'users', 'user-a', 'appBonos', 'state');
  const strangerRef = doc(strangerDb, 'users', 'user-a', 'appBonos', 'state');

  await assertSucceeds(setDoc(ownerRef, validAppBonosState()));
  await assertFails(getDoc(strangerRef));
});

test('un visitante anónimo no puede leer AppBonos', async () => {
  const ownerDb = testEnvironment.authenticatedContext('user-a').firestore();
  const anonymousDb = testEnvironment.unauthenticatedContext().firestore();

  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'user-a', 'appBonos', 'state'), validAppBonosState()));
  await assertFails(getDoc(doc(anonymousDb, 'users', 'user-a', 'appBonos', 'state')));
});

test('AppBonos rechaza documentos con campos no permitidos', async () => {
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  const invalidState = { ...validAppBonosState(), unexpected: true };

  await assertFails(setDoc(doc(db, 'users', 'user-a', 'appBonos', 'state'), invalidState));
});

test('solo el UID propietario puede leer y escribir el CRM', async () => {
  const adminDb = testEnvironment.authenticatedContext(ADMIN_UID).firestore();
  const otherDb = testEnvironment.authenticatedContext('not-admin').firestore();
  const adminRef = doc(adminDb, 'admin', 'appBonosCrm');
  const otherRef = doc(otherDb, 'admin', 'appBonosCrm');

  await assertSucceeds(setDoc(adminRef, validAdminCrm()));
  await assertSucceeds(getDoc(adminRef));
  await assertFails(getDoc(otherRef));
  await assertFails(setDoc(otherRef, validAdminCrm()));
});

test('ningún navegador puede leer o escribir el ledger de picks oficiales', async () => {
  const signedInDb = testEnvironment.authenticatedContext('user-a').firestore();
  const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
  const pickRef = doc(signedInDb, 'officialPicks', 'op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  await assertFails(setDoc(pickRef, { status: 'published' }));
  await assertFails(getDoc(doc(anonymousDb, 'officialPicks', 'op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')));
  await assertFails(setDoc(doc(signedInDb, 'officialPicks', 'op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'events', 'published'), { type: 'published' }));
});

test('las reglas existentes de MoneyTracking conservan el aislamiento por propietario', async () => {
  const ownerDb = testEnvironment.authenticatedContext('user-a').firestore();
  const strangerDb = testEnvironment.authenticatedContext('user-b').firestore();

  await grantPremiumWorkspace('user-a');

  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'user-a', 'banks', 'bank-1'), { name: 'Principal' }));
  await assertFails(getDoc(doc(strangerDb, 'users', 'user-a', 'banks', 'bank-1')));
  await assertFails(setDoc(doc(ownerDb, 'users', 'user-a', 'entitlements', 'limits'), { maxScansPerDay: 20 }));
});

test('una cuenta sin Premium no puede crear una banca gratuita', async () => {
  const db = testEnvironment.authenticatedContext('user-without-premium').firestore();

  await assertFails(setDoc(doc(db, 'users', 'user-without-premium', 'banks', 'bank-1'), { name: 'No permitido' }));
});

test('una cuenta expirada puede leer su histórico, pero no modificarlo ni ver el de otro usuario', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'expired-user', 'entitlements', 'subscription'), {
      status: 'expired', accessUntil: Timestamp.fromMillis(Date.now() - 1000),
    });
    await setDoc(doc(context.firestore(), 'users', 'expired-user', 'banks', 'bank-1'), { name: 'Histórico' });
  });
  const ownerDb = testEnvironment.authenticatedContext('expired-user').firestore();
  const strangerDb = testEnvironment.authenticatedContext('other-user').firestore();
  const bank = doc(ownerDb, 'users', 'expired-user', 'banks', 'bank-1');
  await assertSucceeds(getDoc(bank));
  await assertFails(setDoc(bank, { name: 'No permitido' }));
  await assertFails(getDoc(doc(strangerDb, 'users', 'expired-user', 'banks', 'bank-1')));
});

test('el propietario puede crear un snapshot saneado y un visitante anónimo puede leerlo', async () => {
  const ownerDb = testEnvironment.authenticatedContext('user-a').firestore();
  const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
  const shareId = 'public-share-123456';
  const batch = writeBatch(ownerDb);

  batch.set(doc(ownerDb, 'shareOwners', shareId), {
    ownerUid: 'user-a',
    createdAt: serverTimestamp(),
  });
  batch.set(doc(ownerDb, 'publicShares', shareId), validPublicShare());
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(collection(ownerDb, 'publicShares', shareId, 'bets')), validPublicBet()));

  await assertSucceeds(getDoc(doc(anonymousDb, 'publicShares', shareId)));
});

test('un usuario no puede publicar usando el registro de propiedad de otro', async () => {
  const ownerDb = testEnvironment.authenticatedContext('user-a').firestore();
  const strangerDb = testEnvironment.authenticatedContext('user-b').firestore();
  const shareId = 'public-share-owned';

  await assertSucceeds(setDoc(doc(ownerDb, 'shareOwners', shareId), {
    ownerUid: 'user-a',
    createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(strangerDb, 'publicShares', shareId), validPublicShare()));
});

test('los snapshots rechazan apuestas pendientes y campos privados', async () => {
  const ownerDb = testEnvironment.authenticatedContext('user-a').firestore();
  const shareId = 'public-share-sanitized';
  const initialBatch = writeBatch(ownerDb);
  initialBatch.set(doc(ownerDb, 'shareOwners', shareId), {
    ownerUid: 'user-a',
    createdAt: serverTimestamp(),
  });
  initialBatch.set(doc(ownerDb, 'publicShares', shareId), validPublicShare());
  await assertSucceeds(initialBatch.commit());

  await assertFails(setDoc(doc(collection(ownerDb, 'publicShares', shareId, 'bets')), {
    ...validPublicBet(),
    status: 'pending',
  }));
  await assertFails(setDoc(doc(collection(ownerDb, 'publicShares', shareId, 'bets')), {
    ...validPublicBet(),
    analysis: 'nota privada',
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS & REVENUE: PRUEBAS DE SEGURIDAD EN REGLAS DE FIRESTORE
// ─────────────────────────────────────────────────────────────────────────────

test('reglas: un cliente puede leer su propio entitlement pero NUNCA escribirlo', async () => {
  const ownerDb = testEnvironment.authenticatedContext('customer-123').firestore();
  const strangerDb = testEnvironment.authenticatedContext('stranger-456').firestore();
  const entitlementRef = doc(ownerDb, 'users', 'customer-123', 'entitlements', 'subscription');
  const strangerRef = doc(strangerDb, 'users', 'customer-123', 'entitlements', 'subscription');

  // Pre-cargar entitlement con permisos desactivados (como lo haría Admin SDK)
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'customer-123', 'entitlements', 'subscription'), {
      status: 'active',
      plan: 'monthly',
      accessUntil: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
      renewalMode: 'manual'
    });
  });

  // 1. El cliente puede leer su propio documento de suscripción
  await assertSucceeds(getDoc(entitlementRef));

  // 2. Otro cliente NO puede leerlo
  await assertFails(getDoc(strangerRef));

  // 3. El cliente NUNCA puede modificar o forzar su entitlement desde el navegador
  await assertFails(setDoc(entitlementRef, { status: 'active', plan: 'annual' }));
});

test('reglas: las 8 colecciones exclusivas de servidor son inaccesibles para cualquier navegador', async () => {
  const signedInDb = testEnvironment.authenticatedContext('user-hacker').firestore();
  const anonymousDb = testEnvironment.unauthenticatedContext().firestore();

  // 1. premiumPaymentOrders
  const orderRef = doc(signedInDb, 'premiumPaymentOrders', 'mt-order-fake');
  await assertFails(setDoc(orderRef, { status: 'paid' }));
  await assertFails(getDoc(orderRef));
  await assertFails(getDoc(doc(anonymousDb, 'premiumPaymentOrders', 'mt-order-fake')));

  // 2. systemEvents
  const eventRef = doc(signedInDb, 'systemEvents', 'evt-fake');
  await assertFails(setDoc(eventRef, { eventType: 'test' }));
  await assertFails(getDoc(eventRef));

  // 3. agentStates
  const agentRef = doc(signedInDb, 'agentStates', 'revenue-order-monitor');
  await assertFails(setDoc(agentRef, { status: 'idle' }));
  await assertFails(getDoc(agentRef));

  // 4. revenueIncidents
  const incidentRef = doc(signedInDb, 'revenueIncidents', 'inc-fake');
  await assertFails(setDoc(incidentRef, { status: 'open' }));
  await assertFails(getDoc(incidentRef));

  // 5. operationsIncidents (Data & Performance, etc.)
  const opsIncidentRef = doc(signedInDb, 'operationsIncidents', 'inc-ops-fake');
  await assertFails(setDoc(opsIncidentRef, { status: 'open' }));
  await assertFails(getDoc(opsIncidentRef));
  await assertFails(getDoc(doc(anonymousDb, 'operationsIncidents', 'inc-ops-fake')));

  // 6. officialPickAutoCopyQueue (cola durable)
  const autoCopyQueueRef = doc(signedInDb, 'officialPickAutoCopyQueue', 'op-fake-queue');
  await assertFails(setDoc(autoCopyQueueRef, { status: 'pending' }));
  await assertFails(getDoc(autoCopyQueueRef));
  await assertFails(getDoc(doc(anonymousDb, 'officialPickAutoCopyQueue', 'op-fake-queue')));

  // 7. officialPickPreflight (Picks & Risk v1)
  const preflightRef = doc(signedInDb, 'officialPickPreflight', 'pre-fake');
  await assertFails(setDoc(preflightRef, { status: 'awaiting_telegram_t5' }));
  await assertFails(getDoc(preflightRef));
  await assertFails(getDoc(doc(anonymousDb, 'officialPickPreflight', 'pre-fake')));

  // 8. paperPicks (Picks & Risk v1)
  const paperRef = doc(signedInDb, 'paperPicks', 'paper-fake');
  await assertFails(setDoc(paperRef, { isPaper: true }));
  await assertFails(getDoc(paperRef));
  await assertFails(getDoc(doc(anonymousDb, 'paperPicks', 'paper-fake')));
});
