export const PUBLICATION_POLICIES = Object.freeze({
    IMMEDIATE: 'immediate',
    T_MINUS_5: 't_minus_5'
});

const cleanDate = (value, field) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${field} no es una fecha válida`);
    return date;
};

export const normalizePublicationPolicy = (value) => {
    if (!value || value === PUBLICATION_POLICIES.T_MINUS_5) return PUBLICATION_POLICIES.T_MINUS_5;
    if (value === PUBLICATION_POLICIES.IMMEDIATE) return PUBLICATION_POLICIES.IMMEDIATE;
    throw new Error('La política de publicación no es válida');
};

export const scheduledAtForOfficialPick = ({ policy, kickoffAt, observedAt }) => {
    const normalizedPolicy = normalizePublicationPolicy(policy);
    const safeKickoffAt = cleanDate(kickoffAt, 'event.kickoffAt');
    const safeObservedAt = cleanDate(observedAt, 'source.observedAt');

    if (normalizedPolicy === PUBLICATION_POLICIES.IMMEDIATE) return safeObservedAt;
    return new Date(safeKickoffAt.getTime() - (5 * 60 * 1000));
};
