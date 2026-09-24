/**
 * Redactor de secretos para logs, auditorías y trazas operacionales de Telegram MTProto.
 * 
 * Previene la exposición accidental de:
 * - TELEGRAM_STRING_SESSION (long base64 session tokens)
 * - TELEGRAM_API_HASH (32 hex characters)
 * - Números de teléfono
 * - Códigos OTP / SMS / Telegram verification codes
 */

const STRING_SESSION_REGEX = /1[A-Za-z0-9+/=_-]{50,}/g;
const API_HASH_REGEX = /\b[a-f0-9]{32}\b/gi;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const OTP_REGEX = /(?:code|código|otp|password|contraseña)[:\s=]+(\d{5,6})\b/gi;

/**
 * Redacta cadenas que contengan credenciales o tokens de sesión de Telegram.
 */
export const redactSecretString = (str = '') => {
    if (typeof str !== 'string') return str;

    return str
        .replace(STRING_SESSION_REGEX, '[REDACTED_TELEGRAM_STRING_SESSION]')
        .replace(API_HASH_REGEX, '[REDACTED_TELEGRAM_API_HASH]')
        .replace(OTP_REGEX, (match, code) => match.replace(code, '[REDACTED_OTP]'));
};

/**
 * Redacta recursivamente objetos o estructuras de datos antes de enviar a log o consola.
 */
export const redactSecrets = (data, { knownSecrets = [] } = {}) => {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
        let result = redactSecretString(data);
        for (const secret of knownSecrets) {
            if (secret && typeof secret === 'string' && secret.length >= 4) {
                result = result.replaceAll(secret, '[REDACTED_SECRET]');
            }
        }
        return result;
    }

    if (Array.isArray(data)) {
        return data.map(item => redactSecrets(item, { knownSecrets }));
    }

    if (typeof data === 'object') {
        const redacted = {};
        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            if (
                lowerKey.includes('session') ||
                lowerKey.includes('hash') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('password') ||
                lowerKey.includes('token') ||
                lowerKey.includes('otp')
            ) {
                redacted[key] = '[REDACTED_CREDENTIAL]';
            } else {
                redacted[key] = redactSecrets(value, { knownSecrets });
            }
        }
        return redacted;
    }

    return data;
};
