/**
 * @file Catálogo técnico y mapeo de estados de partido (status.short) de API-Football.
 * 
 * Basado en la especificación oficial de API-Football v3:
 * https://www.api-football.com/documentation-v3#operation/get-fixtures
 */

export const API_FOOTBALL_STATUS_CATEGORIES = {
    SCHEDULED: 'SCHEDULED',
    IN_PLAY: 'IN_PLAY',
    FINISHED: 'FINISHED',
    POSTPONED: 'POSTPONED',
    CANCELLED: 'CANCELLED',
    ABANDONED: 'ABANDONED',
    TECHNICAL: 'TECHNICAL'
};

export const API_FOOTBALL_STATUSES = {
    // ── PROGRAMADOS ──
    TBD: {
        short: 'TBD',
        long: 'Time To Be Defined',
        category: API_FOOTBALL_STATUS_CATEGORIES.SCHEDULED,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        description: 'Hora y fecha aún por definir por la organización.'
    },
    NS: {
        short: 'NS',
        long: 'Not Started',
        category: API_FOOTBALL_STATUS_CATEGORIES.SCHEDULED,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        description: 'Partido programado, aún no iniciado.'
    },

    // ── EN JUEGO ──
    '1H': {
        short: '1H',
        long: 'First Half, Kick Off',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'Primera parte en curso.'
    },
    HT: {
        short: 'HT',
        long: 'Halftime',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'Descanso.'
    },
    '2H': {
        short: '2H',
        long: 'Second Half, 2nd Half Started',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'Segunda parte en curso.'
    },
    ET: {
        short: 'ET',
        long: 'Extra Time',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'Prórroga en curso.'
    },
    BT: {
        short: 'BT',
        long: 'Break Time',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'Pausa antes de prórroga o penaltis.'
    },
    P: {
        short: 'P',
        long: 'Penalty In Progress',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'Tanda de penaltis en curso.'
    },
    SUSP: {
        short: 'SUSP',
        long: 'Match Suspended',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        ceoDecisionRequired: 'Política de espera o anulación si el partido se suspende temporalmente.'
    },
    INT: {
        short: 'INT',
        long: 'Match Interrupted',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        ceoDecisionRequired: 'Política de reanudación si se interrumpe el partido.'
    },
    LIVE: {
        short: 'LIVE',
        long: 'In Play',
        category: API_FOOTBALL_STATUS_CATEGORIES.IN_PLAY,
        isSettleable: false,
        isInPlay: true,
        isFinished: false,
        description: 'En directo.'
    },

    // ── FINALIZADOS (LIQUIDABLES) ──
    FT: {
        short: 'FT',
        long: 'Match Finished',
        category: API_FOOTBALL_STATUS_CATEGORIES.FINISHED,
        isSettleable: true,
        isInPlay: false,
        isFinished: true,
        description: 'Partido finalizado en tiempo reglamentario (90 min + descuento).'
    },
    AET: {
        short: 'AET',
        long: 'Match Finished After Extra Time',
        category: API_FOOTBALL_STATUS_CATEGORIES.FINISHED,
        isSettleable: true,
        isInPlay: false,
        isFinished: true,
        description: 'Finalizado tras prórroga (120 min). Nota: mercados estándar de 90 min usan regularTimeScore.'
    },
    PEN: {
        short: 'PEN',
        long: 'Match Finished After Penalty',
        category: API_FOOTBALL_STATUS_CATEGORIES.FINISHED,
        isSettleable: true,
        isInPlay: false,
        isFinished: true,
        description: 'Finalizado tras penaltis.'
    },

    // ── INCIDENCIAS / NO JUGADOS (REQUIEREN REGLA DE NEGOCIO) ──
    PST: {
        short: 'PST',
        long: 'Match Postponed',
        category: API_FOOTBALL_STATUS_CATEGORIES.POSTPONED,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        ceoDecisionRequired: '¿Cuánto tiempo se mantiene el pick antes de marcar VOID (ej. 24h, 48h o indefinido)?'
    },
    CANC: {
        short: 'CANC',
        long: 'Match Cancelled',
        category: API_FOOTBALL_STATUS_CATEGORIES.CANCELLED,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        ceoDecisionRequired: '¿Se marca inmediatamente como VOID / anulado con devolución de stake?'
    },
    ABD: {
        short: 'ABD',
        long: 'Match Abandoned',
        category: API_FOOTBALL_STATUS_CATEGORIES.ABANDONED,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        ceoDecisionRequired: 'Si se abandona el partido, ¿se anula la apuesta o se valida según minutos jugados?'
    },
    AWD: {
        short: 'AWD',
        long: 'Technical Loss',
        category: API_FOOTBALL_STATUS_CATEGORIES.TECHNICAL,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        ceoDecisionRequired: '¿Se respeta el resultado administrativo oficial o se anula la apuesta?'
    },
    WO: {
        short: 'WO',
        long: 'WalkOver',
        category: API_FOOTBALL_STATUS_CATEGORIES.TECHNICAL,
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        ceoDecisionRequired: 'Política de liquidación en incomparecencia (WalkOver).'
    }
};

/**
 * Consulta y clasifica el status devuelto por API-Football.
 */
export function getMatchStatusInfo(statusShort = '') {
    const key = String(statusShort || '').trim().toUpperCase();
    return API_FOOTBALL_STATUSES[key] || {
        short: key || 'UNKNOWN',
        long: 'Unknown Status',
        category: 'UNKNOWN',
        isSettleable: false,
        isInPlay: false,
        isFinished: false,
        ceoDecisionRequired: 'Estado no reconocido en catálogo API-Football'
    };
}
