import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_FIREBASE_PROJECT_ID = 'money-tracking-d908b';

const firebaseProjectId = () => process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID;

const getAdminApp = () => {
    if (!getApps().length) {
        const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (!rawServiceAccount) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON');

        let serviceAccount;
        try {
            serviceAccount = JSON.parse(rawServiceAccount);
        } catch {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no contiene JSON válido');
        }

        if (serviceAccount.project_id !== firebaseProjectId()) {
            throw new Error('La cuenta de servicio no pertenece al proyecto de Money TracKING');
        }

        initializeApp({ credential: cert(serviceAccount) });
    }

    return getApps()[0];
};

export const getAdminDb = () => getFirestore(getAdminApp());

export const getAdminAuth = () => getAuth(getAdminApp());
