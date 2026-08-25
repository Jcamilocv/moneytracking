import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

if (process.env.RUN_FIRESTORE_LIVE_TESTS !== '1') {
  throw new Error('Set RUN_FIRESTORE_LIVE_TESTS=1 para ejecutar contra producción.');
}

const firebaseConfig = {
  apiKey: 'AIzaSyDdhFhK2leqXczuBU-inLBLi9PfMt7NbkY',
  authDomain: 'money-tracking-d908b.firebaseapp.com',
  projectId: 'money-tracking-d908b',
  storageBucket: 'money-tracking-d908b.firebasestorage.app',
  messagingSenderId: '776084225241',
  appId: '1:776084225241:web:f50c611da487a29a2112c8',
};

const runId = randomUUID();
const email = `moneytips-firestore-${runId}@example.com`;
const password = `Mt-${randomUUID()}-9!`;
const userApp = initializeApp(firebaseConfig, `rules-user-${runId}`);
const anonymousApp = initializeApp(firebaseConfig, `rules-anonymous-${runId}`);
const auth = getAuth(userApp);
const db = getFirestore(userApp);
const anonymousDb = getFirestore(anonymousApp);
let createdUser;
let stateRef;

const validState = {
  schemaVersion: 1,
  legacyUserId: `live-smoke-${runId}`,
  clientUpdatedAt: Date.now(),
  migratedAt: serverTimestamp(),
  payload: {
    profile: { displayName: 'Prueba temporal' },
    subProfiles: {},
    activeProfileId: 'default',
  },
};

async function expectPermissionDenied(operation, label) {
  try {
    await operation();
    assert.fail(`${label}: la operación debía ser rechazada.`);
  } catch (error) {
    assert.equal(error?.code, 'permission-denied', `${label}: error inesperado ${error?.code}`);
  }
}

try {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  createdUser = credential.user;
  stateRef = doc(db, 'users', createdUser.uid, 'appBonos', 'state');

  await expectPermissionDenied(
    () => setDoc(stateRef, { ...validState, unexpected: true }),
    'Documento AppBonos con campos extra',
  );

  await setDoc(stateRef, validState);
  const ownSnapshot = await getDoc(stateRef);
  assert.equal(ownSnapshot.exists(), true, 'El usuario debe leer su propio estado AppBonos.');

  await expectPermissionDenied(
    () => getDoc(doc(anonymousDb, 'users', createdUser.uid, 'appBonos', 'state')),
    'Lectura anónima de AppBonos',
  );
  await expectPermissionDenied(
    () => getDoc(doc(db, 'users', 'Rvp7qaQBC5RQwSKICRKnAb8vaI93', 'appBonos', 'state')),
    'Lectura del AppBonos de otro usuario',
  );
  await expectPermissionDenied(
    () => setDoc(doc(db, 'admin', 'appBonosCrm'), {
      schemaVersion: 1,
      clientUpdatedAt: Date.now(),
      updatedAt: serverTimestamp(),
      crmData: { leads: [] },
    }),
    'Escritura del CRM por un usuario no administrador',
  );

  console.log('PASS: reglas AppBonos/CRM verificadas con una cuenta temporal.');
} finally {
  if (stateRef) {
    try {
      await deleteDoc(stateRef);
    } catch (error) {
      console.warn(`No se pudo borrar el documento temporal: ${error?.code ?? error}`);
    }
  }
  if (createdUser) {
    try {
      await deleteUser(createdUser);
    } catch (error) {
      console.warn(`No se pudo borrar la cuenta temporal: ${error?.code ?? error}`);
    }
  }
  await Promise.all([deleteApp(userApp), deleteApp(anonymousApp)]);
}
