import { parseMadridDateTimeToUTC } from '../../api/_lib/timezone.js';
import { madridDayKey } from '../canonical-candidate-validation.js';

export const MORNING_HOURS_MADRID = Object.freeze([10, 13, 16]);

export const nextMorningRun = (now = new Date()) => {
    const day = madridDayKey(now);
    for (let offset = 0; offset < 3; offset++) {
        const date = new Date(`${day}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + offset);
        const key = date.toISOString().slice(0, 10);
        for (const hour of MORNING_HOURS_MADRID) {
            const instant = new Date(parseMadridDateTimeToUTC(`${key} ${String(hour).padStart(2, '0')}:00:00`));
            if (instant > now) return instant;
        }
    }
    throw new Error('MORNING_SCHEDULE_UNAVAILABLE');
};

// Dormant until explicitly started by a reviewed local shadow entry point.
// Exactly one timer is held; each wake schedules the next Madrid slot.
export const createMorningShadowScheduler = ({ run, clock = () => new Date(),
    setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} }) => {
    let timer = null;
    let active = false;
    const arm = () => {
        if (!active) return;
        const delay = Math.max(0, nextMorningRun(clock()).getTime() - clock().getTime());
        timer = setTimer(async () => {
            timer = null;
            try { await run(); } catch (error) { onError(error?.code || 'MORNING_RUN_FAILED'); }
            arm();
        }, delay);
    };
    return {
        start() { if (!active) { active = true; arm(); } },
        stop() { active = false; if (timer !== null) clearTimer(timer); timer = null; }
    };
};
