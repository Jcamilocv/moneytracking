import { createHash } from 'node:crypto';

export const OFFICIAL_SOURCES = {
    global: 'fvEukLKhTCAhPMr0Ltb3',
    t2526: 'tJl2mmFKuDg4PLBBA6Kx',
    t2425: 'gpAuTBhXfUafErkLAwEg',
    t2324: '235TEdWK4baHQgcbAGi6'
};

export const FALLBACK_SNAPSHOT_IDS = {
    global: 'mt_h_8h3DjKp7MxQ2vN6cZaR4',
    t2526: 'mt_2526_Bp9mQ4xL7dRt2VwK',
    t2425: 'mt_2425_Cf6nY8sH3jUa5PeM',
    t2324: 'mt_2324_Gk2rT9vB4zXq7NdS'
};

const getBetStatus = (bet = {}) => (typeof bet.status === 'string' && bet.status
    ? bet.status
    : bet.selections?.[0]?.status || 'pending');

const numberOrZero = (value) => Number(value) || 0;

export const sanitizePublicBank = (bank = {}) => ({
    id: String(bank.id || ''),
    name: String(bank.name || 'Histórico público'),
    initialCapital: numberOrZero(bank.initialCapital),
    currency: String(bank.currency || 'EUR'),
    isBalance: Boolean(bank.isBalance),
    bankIds: Array.isArray(bank.bankIds) ? bank.bankIds.map(String) : []
});

export const sanitizePublicBet = (bet = {}) => ({
    id: String(bet.id || ''),
    bankId: String(bet.bankId || ''),
    date: String(bet.date || ''),
    time: String(bet.time || '00:00'),
    bookmaker: String(bet.bookmaker || ''),
    betMode: String(bet.betMode || 'simple'),
    title: String(bet.title || ''),
    selection: String(bet.selection || ''),
    status: String(getBetStatus(bet)),
    category: String(bet.category || ''),
    odds: numberOrZero(bet.odds),
    amount: numberOrZero(bet.amount),
    stake: numberOrZero(bet.stake),
    isBack: bet.isBack !== false,
    isLive: Boolean(bet.isLive),
    isFreebet: Boolean(bet.isFreebet),
    cashout: String(bet.cashout || ''),
    isEachWay: Boolean(bet.isEachWay),
    tipster: String(bet.tipster || ''),
    bonus: String(bet.bonus || ''),
    commission: String(bet.commission || ''),
    selections: (Array.isArray(bet.selections) ? bet.selections : []).map((selection) => ({
        id: String(selection.id || ''),
        title: String(selection.title || ''),
        selection: String(selection.selection || ''),
        sport: String(selection.sport || ''),
        status: String(selection.status || getBetStatus(bet)),
        category: String(selection.category || ''),
        odds: numberOrZero(selection.odds)
    }))
});

export const buildPublication = (bank, bets) => {
    const publicBank = sanitizePublicBank(bank);
    const publicBets = bets
        .filter((bet) => getBetStatus(bet) !== 'pending')
        .map(sanitizePublicBet)
        .sort((a, b) => a.id.localeCompare(b.id));
    const fingerprint = createHash('sha256')
        .update(JSON.stringify({ bank: publicBank, bets: publicBets }))
        .digest('hex');

    return { bank: publicBank, bets: publicBets, fingerprint };
};
