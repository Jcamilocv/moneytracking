import { createFileMorningSessionProvider } from './session-provider.js';
import { createMorningSourceClient } from './source-client.js';
import { createLocalShadowState } from './shadow-state.js';
import { createMorningShadowRunner, assertMorningShadow } from './shadow-runner.js';
import { createMorningShadowScheduler } from './schedule.js';

export const createMorningShadowApp = ({
    sessionPath = process.env.MORNING_SESSION_FILE,
    statePath = process.env.MORNING_SHADOW_STATE_FILE,
    baseUrl = 'https://application.futbolbrain.com/',
    transport,
    sportsDataProvider = null,
    onError = (code) => console.error('Morning Shadow:', code)
} = {}) => {
    assertMorningShadow(process.env.MORNING_MODE);
    if (new URL(baseUrl).origin !== 'https://application.futbolbrain.com') {
        throw new Error('MORNING_SOURCE_ORIGIN_NOT_APPROVED');
    }
    const sessionProvider = createFileMorningSessionProvider({ path: sessionPath,
        origin: new URL(baseUrl).origin });
    const sourceClient = createMorningSourceClient({ baseUrl, sessionProvider, transport });
    const stateStore = createLocalShadowState(statePath);
    const runner = createMorningShadowRunner({ sourceClient, stateStore, sportsDataProvider });
    return {
        runner,
        scheduler: createMorningShadowScheduler({ run: () => runner.run(), onError })
    };
};
