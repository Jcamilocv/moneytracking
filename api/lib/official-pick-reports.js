import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { getAdminDb } from './firebase-admin.js';

export const OFFICIAL_PICK_REPORT_CATEGORIES = {
    result_incorrect: 'Resultado corregido incorrectamente',
    market_void: 'Mercado anulado o liquidado de forma distinta',
    event_postponed: 'Partido aplazado o suspendido',
    odds_mismatch: 'Cuota publicada no coincide'
};

export const OFFICIAL_PICK_REVIEW_DECISIONS = {
    confirmed: 'Resultado confirmado tras revisión',
    correction_published: 'Corrección publicada en el historial'
};

const validPickId = (pickId) => typeof pickId === 'string' && /^op_[a-f0-9]{40}$/.test(pickId);
const validCategory = (category) => Object.hasOwn(OFFICIAL_PICK_REPORT_CATEGORIES, category);
const validDecision = (decision) => Object.hasOwn(OFFICIAL_PICK_REVIEW_DECISIONS, decision);

const reportIdFor = (pickId, uid) => `or_${createHash('sha256').update(`${pickId}:${uid}`).digest('hex').slice(0, 40)}`;

const toPlainValue = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(toPlainValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlainValue(item)]));
    return value;
};

export const summarizeOfficialPickReports = (reports = []) => {
    const categoryCounts = {};
    let openReports = 0;
    let latestResolution = null;

    for (const report of reports) {
        categoryCounts[report.category] = (categoryCounts[report.category] || 0) + 1;
        if (report.status === 'open') openReports += 1;
        if (report.resolvedAt && (!latestResolution || new Date(report.resolvedAt) > new Date(latestResolution.resolvedAt))) {
            latestResolution = {
                decision: report.decision,
                message: report.message || '',
                resolvedAt: report.resolvedAt
            };
        }
    }

    return {
        totalReports: reports.length,
        openReports,
        status: openReports > 0 ? 'under_review' : (latestResolution ? latestResolution.decision : 'clear'),
        categoryCounts,
        resolution: latestResolution
    };
};

export const attachOfficialPickReviewSummaries = async (picks = []) => {
    if (!picks.length) return picks;
    const db = getAdminDb();
    const ids = picks.map((pick) => pick.id);
    const reports = [];

    for (let index = 0; index < ids.length; index += 30) {
        const group = ids.slice(index, index + 30);
        const snapshot = await db.collection('officialPickReports').where('pickId', 'in', group).get();
        reports.push(...snapshot.docs.map((document) => toPlainValue(document.data())));
    }

    const reportsByPick = reports.reduce((result, report) => {
        (result[report.pickId] ||= []).push(report);
        return result;
    }, {});

    return picks.map((pick) => ({ ...pick, review: summarizeOfficialPickReports(reportsByPick[pick.id] || []) }));
};

export const submitOfficialPickReport = async ({ pickId, reporterUid, category }) => {
    if (!validPickId(pickId)) throw new Error('El identificador del pick no es válido.');
    if (!reporterUid) throw new Error('Debes iniciar sesión para reportar una incidencia.');
    if (!validCategory(category)) throw new Error('Selecciona una incidencia válida.');

    const db = getAdminDb();
    const pickRef = db.collection('officialPicks').doc(pickId);
    const reportRef = db.collection('officialPickReports').doc(reportIdFor(pickId, reporterUid));
    let created = false;

    await db.runTransaction(async (transaction) => {
        const [pick, existingReport] = await Promise.all([transaction.get(pickRef), transaction.get(reportRef)]);
        if (!pick.exists || pick.data().status !== 'published') throw new Error('El pick oficial no existe o no es público.');
        if (existingReport.exists) return;

        created = true;
        transaction.set(reportRef, {
            pickId,
            reporterUid,
            category,
            status: 'open',
            createdAt: FieldValue.serverTimestamp()
        });
    });

    const [summary] = await attachOfficialPickReviewSummaries([{ id: pickId }]);
    return { created, review: summary.review };
};

export const listOfficialPickReportsForAdmin = async (pickId) => {
    const db = getAdminDb();
    const query = pickId
        ? db.collection('officialPickReports').where('pickId', '==', pickId)
        : db.collection('officialPickReports').where('status', '==', 'open');
    const snapshot = await query.get();
    return snapshot.docs
        .map((document) => ({ id: document.id, ...toPlainValue(document.data()) }))
        .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
};

export const resolveOfficialPickReports = async ({ pickId, decision, message = '' }) => {
    if (!validPickId(pickId)) throw new Error('El identificador del pick no es válido.');
    if (!validDecision(decision)) throw new Error('La decisión de revisión no es válida.');
    const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 240) : '';
    const db = getAdminDb();
    const pickRef = db.collection('officialPicks').doc(pickId);
    const reportsSnapshot = await db.collection('officialPickReports').where('pickId', '==', pickId).where('status', '==', 'open').get();
    if (reportsSnapshot.empty) throw new Error('No hay incidencias abiertas para este pick.');

    const batch = db.batch();
    reportsSnapshot.docs.forEach((report) => {
        batch.update(report.ref, {
            status: 'resolved',
            decision,
            message: cleanMessage,
            resolvedAt: FieldValue.serverTimestamp()
        });
    });
    batch.set(pickRef.collection('events').doc(`review_${Date.now()}`), {
        type: decision,
        reportCount: reportsSnapshot.size,
        message: cleanMessage,
        createdAt: FieldValue.serverTimestamp()
    });
    await batch.commit();

    const [summary] = await attachOfficialPickReviewSummaries([{ id: pickId }]);
    return { resolvedReports: reportsSnapshot.size, review: summary.review };
};
