import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';
import { OFFICIAL_SOURCES, buildPublication } from './official-snapshot-data.js';

const MAX_PUBLIC_BETS = 5000;

const registryRef = (db) => db.collection('system').doc('officialSnapshots');

const getOwnerUid = () => {
    const ownerUid = process.env.OFFICIAL_SNAPSHOT_OWNER_UID;
    if (!ownerUid) throw new Error('Falta OFFICIAL_SNAPSHOT_OWNER_UID');
    return ownerUid;
};

const resolveOfficialBank = async (db, ownerUid, sourceId) => {
    const userRef = db.collection('users').doc(ownerUid);
    const bankSnapshot = await userRef.collection('banks').doc(sourceId).get();
    if (bankSnapshot.exists) return { ...bankSnapshot.data(), id: bankSnapshot.id };

    const balanceSnapshot = await userRef.collection('balances').doc(sourceId).get();
    if (!balanceSnapshot.exists) throw new Error(`No existe la fuente oficial ${sourceId}`);

    const balance = balanceSnapshot.data();
    const bankIds = Array.isArray(balance.bankIds) ? balance.bankIds.map(String) : [];
    const includedBanks = await Promise.all(bankIds.map((bankId) => userRef.collection('banks').doc(bankId).get()));
    const existingBanks = includedBanks.filter((bank) => bank.exists).map((bank) => bank.data());

    return {
        ...balance,
        id: balanceSnapshot.id,
        name: `[Balance] ${balance.name || 'Histórico público'}`,
        initialCapital: existingBanks.reduce((sum, bank) => sum + (Number(bank.initialCapital) || 0), 0),
        currency: existingBanks[0]?.currency || 'EUR',
        isBalance: true,
        bankIds
    };
};

const writeBets = async (db, shareId, bets) => {
    for (let offset = 0; offset < bets.length; offset += 400) {
        const batch = db.batch();
        bets.slice(offset, offset + 400).forEach((bet) => {
            batch.set(db.collection('publicShares').doc(shareId).collection('bets').doc(), bet);
        });
        await batch.commit();
    }
};

export const readOfficialSnapshotIds = async () => {
    const registry = await registryRef(getAdminDb()).get();
    const entries = registry.exists ? registry.data().entries || {} : {};
    return Object.fromEntries(Object.entries(entries)
        .filter(([, entry]) => typeof entry?.snapshotId === 'string')
        .map(([key, entry]) => [key, entry.snapshotId]));
};

export const refreshOfficialSnapshots = async () => {
    const db = getAdminDb();
    const ownerUid = getOwnerUid();
    const userRef = db.collection('users').doc(ownerUid);
    const [registrySnapshot, betsSnapshot] = await Promise.all([
        registryRef(db).get(),
        userRef.collection('bets').get()
    ]);
    const previousEntries = registrySnapshot.exists ? registrySnapshot.data().entries || {} : {};
    const allBets = betsSnapshot.docs.map((bet) => ({ ...bet.data(), id: bet.id }));
    const entries = { ...previousEntries };
    const result = {};

    for (const [key, sourceId] of Object.entries(OFFICIAL_SOURCES)) {
        const bank = await resolveOfficialBank(db, ownerUid, sourceId);
        const selectedBets = bank.isBalance
            ? allBets.filter((bet) => bank.bankIds.includes(String(bet.bankId)))
            : allBets.filter((bet) => String(bet.bankId) === bank.id);
        const publication = buildPublication(bank, selectedBets);

        if (publication.bets.length > MAX_PUBLIC_BETS) {
            throw new Error(`${key} supera el límite de ${MAX_PUBLIC_BETS} apuestas públicas`);
        }

        if (previousEntries[key]?.fingerprint === publication.fingerprint) {
            result[key] = { status: 'unchanged', snapshotId: previousEntries[key].snapshotId, betCount: publication.bets.length };
            continue;
        }

        const shareRef = db.collection('publicShares').doc();
        const initialBatch = db.batch();
        initialBatch.set(db.collection('shareOwners').doc(shareRef.id), {
            ownerUid,
            createdAt: FieldValue.serverTimestamp()
        });
        initialBatch.set(shareRef, {
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
            bank: publication.bank,
            betCount: publication.bets.length
        });
        await initialBatch.commit();
        await writeBets(db, shareRef.id, publication.bets);

        entries[key] = {
            snapshotId: shareRef.id,
            sourceId,
            fingerprint: publication.fingerprint,
            betCount: publication.bets.length,
            publishedAt: FieldValue.serverTimestamp()
        };
        result[key] = { status: 'published', snapshotId: shareRef.id, betCount: publication.bets.length };
    }

    await registryRef(db).set({
        schemaVersion: 1,
        entries,
        updatedAt: FieldValue.serverTimestamp()
    });

    return result;
};
