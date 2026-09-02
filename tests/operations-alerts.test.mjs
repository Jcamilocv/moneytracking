import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingOperationsChannel } from '../server/operations-alerts.js';

test('identifica solo el canal privado operativo por tipo y título', () => {
    const channel = matchingOperationsChannel([
        { message: { chat: { id: 1, type: 'private', title: 'Money Tips Ops' } } },
        { channel_post: { chat: { id: 2, type: 'channel', title: 'Otro canal' } } },
        { channel_post: { chat: { id: 3, type: 'channel', title: 'Money Tips Ops' } } }
    ]);

    assert.deepEqual(channel, { id: 3, type: 'channel', title: 'Money Tips Ops' });
});

test('no acepta actualizaciones de canales con título diferente', () => {
    assert.equal(matchingOperationsChannel([
        { channel_post: { chat: { id: 3, type: 'channel', title: 'Money Tips Público' } } }
    ]), null);
});

test('reconoce los metadatos de un canal reenviado al bot sin usar el contenido', () => {
    const channel = matchingOperationsChannel([{
        message: {
            text: 'contenido que no debe usarse',
            forward_origin: { chat: { id: 4, type: 'channel', title: 'Money Tips Ops' } }
        }
    }]);

    assert.deepEqual(channel, { id: 4, type: 'channel', title: 'Money Tips Ops' });
});
