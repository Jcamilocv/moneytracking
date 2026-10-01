export const assertNoMorningShadowMutation = () => {
    if (process.env.MORNING_MODE === 'SHADOW') throw new Error('MORNING_SHADOW_MUTATION_BLOCKED');
};
