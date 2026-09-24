/**
 * Error lanzado cuando se intenta invocar una operación de mutación o escritura en Telegram.
 */
export class ReadOnlyViolationError extends Error {
    constructor(operation) {
        super(`READ_ONLY_VIOLATION: Operación de mutación '${operation}' prohibida en worker pasivo de Telegram`);
        this.name = 'ReadOnlyViolationError';
        this.operation = operation;
    }
}

/**
 * Lista exhaustiva de métodos de mutación / escritura en MTProto / GramJS
 * que están estrictamente prohibidos para el worker de escucha de FutbolBrain.
 */
export const FORBIDDEN_MUTATING_METHODS = Object.freeze([
    'sendMessage',
    'sendMedia',
    'sendFile',
    'editMessage',
    'deleteMessages',
    'deleteChatUser',
    'forwardMessages',
    'sendReaction',
    'pinChatMessage',
    'unpinChatMessage',
    'joinChannel',
    'leaveChannel',
    'editAdmin',
    'editTitle',
    'editPhoto',
    'setChatDescription'
]);

/**
 * Envuelve un cliente MTProto en un Proxy de seguridad que intercepta y bloquea
 * cualquier método que intente enviar mensajes, editar, borrar o unirse a canales.
 */
export const createReadOnlyClientProxy = (client) => {
    if (!client) return client;

    return new Proxy(client, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && FORBIDDEN_MUTATING_METHODS.includes(prop)) {
                return () => {
                    throw new ReadOnlyViolationError(prop);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
};
