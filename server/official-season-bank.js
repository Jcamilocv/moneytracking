import { getAdminDb } from '../api/_lib/firebase-admin.js';

export const OFFICIAL_BANK_CONFIG = {
    COLLECTION: 'systemConfiguration',
    DOCUMENT: 'officialSeasonBank',
    DEFAULT_BANK_NAME: 'Money Tips 26/27'
};

/**
 * Obtiene el UID del propietario de los históricos y bancas oficiales.
 */
export const getOfficialOwnerUid = () => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    if (!ownerUid) throw new Error('Falta variable de entorno OFFICIAL_SNAPSHOT_OWNER_UID');
    return ownerUid;
};

/**
 * Resuelve la configuración canónica de la banca oficial de temporada.
 *
 * Prioridades:
 * 1. Documento en Firestore: systemConfiguration/officialSeasonBank { bankId, bankName }
 * 2. Variable de entorno: CURRENT_OFFICIAL_BANK_ID y CURRENT_OFFICIAL_BANK_NAME
 * 3. Descubrimiento automático: busca en users/{ownerUid}/banks una banca con nombre coincidente
 */
export const resolveCurrentOfficialSeasonBank = async ({
    db = getAdminDb(),
    ownerUid = getOfficialOwnerUid()
} = {}) => {
    // 1. Intentar leer configuración central en Firestore
    try {
        const configDoc = await db.collection(OFFICIAL_BANK_CONFIG.COLLECTION)
            .doc(OFFICIAL_BANK_CONFIG.DOCUMENT)
            .get();

        if (configDoc.exists) {
            const data = configDoc.data();
            if (data?.bankId && typeof data.bankId === 'string') {
                const bankSnapshot = await db.collection('users').doc(ownerUid)
                    .collection('banks').doc(data.bankId).get();

                if (bankSnapshot.exists) {
                    return {
                        id: bankSnapshot.id,
                        name: data.bankName || bankSnapshot.data().name,
                        initialCapital: Number(bankSnapshot.data().initialCapital) || 1000,
                        currency: bankSnapshot.data().currency || 'EUR',
                        source: 'firestore_config'
                    };
                }
            }
        }
    } catch (err) {
        console.warn('No se pudo leer la configuración de temporada en Firestore:', err.message);
    }

    // 2. Variable de entorno canónica
    const envBankId = process.env.CURRENT_OFFICIAL_BANK_ID;
    const expectedName = process.env.CURRENT_OFFICIAL_BANK_NAME || OFFICIAL_BANK_CONFIG.DEFAULT_BANK_NAME;

    if (envBankId) {
        const bankSnapshot = await db.collection('users').doc(ownerUid)
            .collection('banks').doc(envBankId).get();

        if (bankSnapshot.exists) {
            return {
                id: bankSnapshot.id,
                name: bankSnapshot.data().name || expectedName,
                initialCapital: Number(bankSnapshot.data().initialCapital) || 1000,
                currency: bankSnapshot.data().currency || 'EUR',
                source: 'env_var'
            };
        }
    }

    // 3. Descubrimiento automático por nombre en users/{ownerUid}/banks
    const banksSnapshot = await db.collection('users').doc(ownerUid)
        .collection('banks')
        .get();

    const normalizedExpected = expectedName.trim().toLowerCase();
    const matchingDoc = banksSnapshot.docs.find((docSnapshot) => {
        const name = String(docSnapshot.data().name || '').trim().toLowerCase();
        return name === normalizedExpected;
    });

    if (matchingDoc) {
        return {
            id: matchingDoc.id,
            name: matchingDoc.data().name,
            initialCapital: Number(matchingDoc.data().initialCapital) || 1000,
            currency: matchingDoc.data().currency || 'EUR',
            source: 'auto_discovered_by_name'
        };
    }

    throw new Error(`No se pudo resolver la banca oficial de temporada '${expectedName}' para el usuario ${ownerUid}.`);
};
