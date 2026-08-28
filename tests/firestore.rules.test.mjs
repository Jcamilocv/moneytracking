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

  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'user-a', 'banks', 'bank-1'), { name: 'Principal' }));
  await assertFails(getDoc(doc(strangerDb, 'users', 'user-a', 'banks', 'bank-1')));
  await assertFails(setDoc(doc(ownerDb, 'users', 'user-a', 'entitlements', 'limits'), { maxScansPerDay: 20 }));
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
