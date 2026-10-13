import { morningSlotKey } from './one-shot.js';

// A production switch is insufficient for a one-day run: its deployment is
// immutable and can outlive both the VPS and an operator's follow-up task.
// This date is non-secret operational configuration, and missing/expired
// configuration fails closed for Morning only.
export const morningActivationOpen = (now = new Date(), { enabled = process.env.MORNING_PUBLISH_ENABLED,
    day = process.env.MORNING_PUBLISH_DAY, slot } = {}) => {
    const current = morningSlotKey(now);
    return enabled === 'true' && /^\d{4}-\d{2}-\d{2}$/.test(day || '')
        && current === `${day}T10:00 Europe/Madrid` && (slot === undefined || slot === current);
};

// Keep the existing bounded Telegram request inside the permitted window.
export const morningDeliveryOpen = (now, slot) => morningActivationOpen(now, { slot })
    && morningActivationOpen(new Date(now.getTime() + 8_000), { slot });
