import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const FIREBASE_PROJECT_ID = 'money-tracking-d908b';

export const getAdminDb = () => {
    if (!getApps().length) {
        const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (!rawServiceAccount) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON');

        let serviceAccount;
        try {
            serviceAccount = JSON.parse(rawServiceAccount);
        } catch {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no contiene JSON válido');
        }

        if (serviceAccount.project_id !== FIREBASE_PROJECT_ID) {
            throw new Error('La cuenta de servicio no pertenece al proyecto de Money TracKING');
        }

        initializeApp({ credential: cert(serviceAccount) });
    }

    return getFirestore();
};
