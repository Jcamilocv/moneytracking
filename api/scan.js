import { createVerify } from 'node:crypto';

const FIREBASE_PROJECT_ID = 'money-tracking-d908b';
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64_LENGTH = 8_000_000;
const DEFAULT_MAX_SCANS_PER_DAY = 10;
const SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;

let cachedCerts = null;
let certsExpireAt = 0;

const decodeBase64UrlJson = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

const getFirebaseCerts = async () => {
    if (cachedCerts && Date.now() < certsExpireAt) return cachedCerts;

    const response = await fetch(FIREBASE_CERTS_URL);
    if (!response.ok) throw new Error('No se pudieron cargar los certificados de Firebase');

    cachedCerts = await response.json();
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 300);
    certsExpireAt = Date.now() + (maxAge * 1000);
    return cachedCerts;
};

const verifyFirebaseToken = async (token) => {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Token inválido');

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeBase64UrlJson(encodedHeader);
    const payload = decodeBase64UrlJson(encodedPayload);
    const certs = await getFirebaseCerts();
    const certificate = certs[header.kid];
    const now = Math.floor(Date.now() / 1000);

    if (header.alg !== 'RS256' || !certificate) throw new Error('Firma no reconocida');
    if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== FIREBASE_ISSUER) throw new Error('Emisor no válido');
    if (!payload.sub || payload.sub.length > 128 || payload.exp <= now || payload.iat > now) throw new Error('Token caducado');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    if (!verifier.verify(certificate, Buffer.from(encodedSignature, 'base64url'))) throw new Error('Firma inválida');

    return payload;
};

const firestoreRequest = async (path, token, options = {}) => {
    const response = await fetch(`${FIRESTORE_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    if (response.status === 404) return null;
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.error?.message || 'Error consultando Firestore');
        error.status = response.status;
        error.code = data.error?.status;
        throw error;
    }
    return data;
};

const integerField = (document, fieldName, fallback = 0) => {
    const value = Number(document?.fields?.[fieldName]?.integerValue);
    return Number.isFinite(value) ? value : fallback;
};

const consumeScanQuota = async (token, userId) => {
    const encodedUserId = encodeURIComponent(userId);
    const usagePath = `/documents/users/${encodedUserId}/preferences/usageLimits`;

    for (let attempt = 0; attempt < 3; attempt++) {
        const [usageDocument, entitlementDocument] = await Promise.all([
            firestoreRequest(usagePath, token),
            firestoreRequest(`/documents/users/${encodedUserId}/entitlements/limits`, token)
        ]);

        const configuredLimit = integerField(entitlementDocument, 'maxScansPerDay', DEFAULT_MAX_SCANS_PER_DAY);
        const maxScans = Math.max(DEFAULT_MAX_SCANS_PER_DAY, configuredLimit);
        const currentCount = integerField(usageDocument, 'scanCount', 0);
        const windowStartedAt = usageDocument?.fields?.windowStartedAt?.timestampValue;
        const windowIsActive = windowStartedAt && (Date.now() - new Date(windowStartedAt).getTime()) < SCAN_WINDOW_MS;

        if (windowIsActive && currentCount >= maxScans) {
            const error = new Error(`Has alcanzado el límite de ${maxScans} escaneos en 24 horas.`);
            error.status = 429;
            throw error;
        }

        const nextCount = windowIsActive ? currentCount + 1 : 1;
        const fields = { scanCount: { integerValue: String(nextCount) } };
        const query = new URLSearchParams();
        query.append('updateMask.fieldPaths', 'scanCount');

        if (!windowIsActive) {
            fields.windowStartedAt = { timestampValue: new Date().toISOString() };
            query.append('updateMask.fieldPaths', 'windowStartedAt');
        }

        if (usageDocument?.updateTime) {
            query.set('currentDocument.updateTime', usageDocument.updateTime);
        } else {
            query.set('currentDocument.exists', 'false');
        }

        try {
            await firestoreRequest(`${usagePath}?${query.toString()}`, token, {
                method: 'PATCH',
                body: JSON.stringify({ fields })
            });
            return { scanCount: nextCount, maxScans };
        } catch (error) {
            const isConflict = [409, 412].includes(error.status)
                || ['ABORTED', 'FAILED_PRECONDITION'].includes(error.code);
            if (!isConflict || attempt === 2) throw error;
        }
    }

    throw new Error('No se pudo reservar el escaneo');
};

export default async function handler(req, res) {
    // Solo permitimos peticiones POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const authorization = req.headers.authorization || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Debes iniciar sesión' });

    let authenticatedUser;
    try {
        authenticatedUser = await verifyFirebaseToken(idToken);
    } catch (error) {
        console.error('Token de Firebase rechazado:', error.message);
        return res.status(401).json({ error: 'Sesión no válida o caducada' });
    }

    const { imageBase64, mimeType } = req.body || {};
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        return res.status(400).json({ error: 'Formato de imagen no permitido' });
    }
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0 || imageBase64.length > MAX_BASE64_LENGTH) {
        return res.status(413).json({ error: 'La imagen está vacía o supera el tamaño permitido' });
    }

    let usage;
    try {
        usage = await consumeScanQuota(idToken, authenticatedUser.sub);
    } catch (error) {
        console.error('Límite de escaneos rechazado:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'No se pudo validar el límite de escaneos' });
    }
    
    // Aquí Vercel inyectará tu clave secreta
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Falta la API Key en el servidor' });
    }

    const prompt = `Analiza esta captura de pantalla de un boleto de apuestas deportivas. Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON válido, sin texto adicional y sin formato markdown (no uses \`\`\`json).
    Además, genera un campo "mensaje_ia" con un mensaje conversacional, directo y amable (como un asistente). Si lograste extraer todo bien, dile al usuario que todo está listo. Si notas que falta algo, menciónalo educadamente y pídele que lo rellene a mano.
    
    Estructura del JSON:
    {
      "equipo": "Nombre del equipo o selección",
      "cuota": "Número decimal (ejemplo: 1.85)",
      "mercado": "Tipo de apuesta (ejemplo: Ganador, Más de 2.5 goles)",
      "importe": "Cantidad apostada (ejemplo: 10.50)",
      "fecha": "Fecha del evento en formato YYYY-MM-DD (ejemplo: 2026-07-04). Si no se ve, devuelve vacio.",
      "hora": "Hora del evento en formato HH:MM (ejemplo: 20:45). Si no se ve, devuelve vacio.",
      "mensaje_ia": "Mensaje personalizado explicando qué has encontrado y si falta algo."
    }`;

    try {
        const payload = {
            contents: [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } }
                ]
            }]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (!response.ok) {
            console.error("Error de Gemini:", result);
            return res.status(500).json({ error: 'Error comunicando con la IA' });
        }

        let responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) return res.status(500).json({ error: 'La IA no devolvió datos' });

        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const datosExtraidos = JSON.parse(responseText);

        // Devolvemos los datos limpios a tu frontend
        return res.status(200).json({ ...datosExtraidos, usage });

    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ error: 'Error procesando la imagen' });
    }
}
