import { readFile, writeFile, rename, stat, appendFile } from 'node:fs/promises';

const madridParts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export const morningSlotKey = (now) => {
    const parts = Object.fromEntries(madridParts.formatToParts(now).map(({ type, value }) => [type, value]));
    if (![10, 13, 16].includes(Number(parts.hour)) || Number(parts.minute) > 2) return null;
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00 Europe/Madrid`;
};

// Claim before reading: a crash or auth failure never retries a scheduled slot.
export const claimMorningSlot = async (path, slot) => {
    let slots = [];
    try {
        const data = JSON.parse(await readFile(path, 'utf8'));
        if (!Array.isArray(data.slots) || data.slots.some((entry) => typeof entry !== 'string')) {
            throw new Error('SHADOW_SLOT_STATE_INVALID');
        }
        slots = data.slots;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (slots.includes(slot)) return false;
    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, JSON.stringify({ slots: [...slots, slot].slice(-100) }), { mode: 0o600 });
    await rename(temporary, path);
    return true;
};

export const appendBoundedMorningLog = async (path, record) => {
    let size = 0;
    try { size = (await stat(path)).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const line = JSON.stringify(record) + '\n';
    if (size + Buffer.byteLength(line) > 1_000_000) {
        await rename(path, `${path}.previous`);
    }
    await appendFile(path, line, { mode: 0o600 });
};
