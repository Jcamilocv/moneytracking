/**
 * @file Normalización y emparejamiento de nombres de equipos deportivos.
 * 
 * Satisface:
 * - Normalización de acentos, case, puntuación y espacios.
 * - Eliminación de sufijos/prefijos de clubes (FC, CF, SAD, AFC, etc.).
 * - Diccionario de alias conocidos observados entre FutbolBrain y API-Football.
 * - Si no hay match inequívoco, clasifica como FIXTURE_MATCH_UNCERTAIN (sin umbrales arbitrarios).
 */

const COMMON_CLUB_TOKENS = new Set([
    'fc', 'cf', 'afc', 'sc', 'cd', 'ud', 'sd', 'sad', 'rb', 'ca',
    'rcd', 'sv', 'vfl', 'tsv', 'bsc', 'ac', 'as', 'us', 'de', 'el',
    'la', 'las', 'los', '04', '09', '1899', '1909'
]);

const KNOWN_ALIASES = {
    // Inglaterra
    'man city': 'manchester city',
    'manchester city': 'man city',
    'man united': 'manchester united',
    'man utd': 'manchester united',
    'manchester united': 'man united',
    'afc bournemouth': 'bournemouth',
    'bournemouth': 'afc bournemouth',
    'brighton hove albion': 'brighton and hove albion',
    'brighton and hove albion': 'brighton hove albion',
    'brighton': 'brighton and hove albion',
    'nottm forest': 'nottingham forest',
    'nottingham forest': 'nottm forest',
    'wolves': 'wolverhampton',
    'wolverhampton wanderers': 'wolverhampton',
    'leeds': 'leeds united',
    'leeds united': 'leeds',
    'coventry': 'coventry city',
    'coventry city': 'coventry',
    'swansea': 'swansea city',
    'swansea city': 'swansea',
    'derby': 'derby county',
    'derby county': 'derby',
    'lincoln': 'lincoln city',
    'lincoln city': 'lincoln',

    // España
    'atletico madrid': 'atletico de madrid',
    'atletico de madrid': 'atletico madrid',
    'ceuta': 'ad ceuta fc',
    'ad ceuta fc': 'ceuta',
    'valladolid': 'real valladolid',
    'real valladolid': 'valladolid',
    'alaves': 'deportivo alaves',
    'deportivo alaves': 'alaves',
    'athletic bilbao': 'athletic club',
    'athletic club': 'athletic bilbao',
    'celta de vigo': 'celta vigo',
    'celta vigo': 'celta de vigo',
    'rayo vallecano': 'rayo',
    'rayo': 'rayo vallecano',

    // Italia
    'milan': 'ac milan',
    'ac milan': 'milan',
    'inter': 'inter milan',
    'inter milan': 'inter',
    'roma': 'as roma',
    'as roma': 'roma',
    'lazio': 'ss lazio',
    'ss lazio': 'lazio',
    'napoli': 'ssc napoli',
    'ssc napoli': 'napoli',

    // Alemania
    'bayer leverkusen': 'bayer 04 leverkusen',
    'bayer 04 leverkusen': 'bayer leverkusen',
    'leverkusen': 'bayer leverkusen',
    'rb leipzig': 'rasenballsport leipzig',
    'rasenballsport leipzig': 'rb leipzig',
    'leipzig': 'rb leipzig',

    // Francia
    'lyon': 'olympique lyonnais',
    'olympique lyonnais': 'lyon',
    'marseille': 'olympique de marseille',
    'olympique de marseille': 'marseille',
    'psg': 'paris saint germain',
    'paris saint germain': 'psg',

    // Portugal & Turquía
    'sporting cp': 'sporting lisbon',
    'sporting lisbon': 'sporting cp',
    'besiktas': 'besiktas jk',
    'besiktas jk': 'besiktas',
    'galatasaray': 'galatasaray sk',
    'galatasaray sk': 'galatasaray',
    'goztepe': 'goztepe sk',
    'goztepe sk': 'goztepe',
    'rizespor': 'caykur rizespor',
    'caykur rizespor': 'rizespor'
};

/**
 * Normaliza una cadena eliminando acentos, puntuación y espacios redundantes.
 */
export function sanitizeTeamName(raw = '') {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normaliza eliminando además los tokens genéricos de clubes ('fc', 'cf', etc.).
 */
export function getStrippedTokensName(raw = '') {
    const sanitized = sanitizeTeamName(raw);
    const tokens = sanitized.split(' ').filter(t => t && !COMMON_CLUB_TOKENS.has(t));
    return tokens.join(' ').trim();
}

export const MATCH_CONFIDENCE = {
    EXACT: 'EXACT',
    NORMALIZED: 'NORMALIZED',
    ALIAS: 'ALIAS',
    UNCERTAIN: 'FIXTURE_MATCH_UNCERTAIN',
    NO_MATCH: 'NO_MATCH'
};

/**
 * Compara dos nombres de equipo y evalúa si existe coincidencia inequívoca.
 * 
 * @param {string} nameA
 * @param {string} nameB
 * @returns {{ matched: boolean, confidence: string, cleanA: string, cleanB: string }}
 */
export function matchTeamNames(nameA = '', nameB = '') {
    const cleanA = sanitizeTeamName(nameA);
    const cleanB = sanitizeTeamName(nameB);

    if (!cleanA || !cleanB) {
        return { matched: false, confidence: MATCH_CONFIDENCE.NO_MATCH, cleanA, cleanB };
    }

    // 1. Coincidencia exacta tras sanitizado (case/acentos)
    if (cleanA === cleanB) {
        return { matched: true, confidence: MATCH_CONFIDENCE.EXACT, cleanA, cleanB };
    }

    // 2. Coincidencia vía diccionario de alias conocidos
    if (KNOWN_ALIASES[cleanA] === cleanB || KNOWN_ALIASES[cleanB] === cleanA) {
        return { matched: true, confidence: MATCH_CONFIDENCE.ALIAS, cleanA, cleanB };
    }

    // 3. Coincidencia tras eliminar sufijos genéricos de club (FC, CF, SAD, etc.)
    const strippedA = getStrippedTokensName(nameA);
    const strippedB = getStrippedTokensName(nameB);

    if (strippedA && strippedB && strippedA === strippedB) {
        return { matched: true, confidence: MATCH_CONFIDENCE.NORMALIZED, cleanA, cleanB };
    }

    // 4. Si uno contiene al otro como palabra completa (ej: "Atlético Madrid" vs "Atlético de Madrid")
    if (strippedA && strippedB) {
        if (strippedA.startsWith(strippedB) || strippedB.startsWith(strippedA) ||
            strippedA.includes(strippedB) || strippedB.includes(strippedA)) {
            // Verificar que no sea demasiado corto para evitar falsos positivos
            const minLen = Math.min(strippedA.length, strippedB.length);
            if (minLen >= 4) {
                return { matched: true, confidence: MATCH_CONFIDENCE.NORMALIZED, cleanA, cleanB };
            }
        }
    }

    return { matched: false, confidence: MATCH_CONFIDENCE.UNCERTAIN, cleanA, cleanB };
}

export const CANONICAL_SEARCH_NAMES = {
    // Francia
    'olympique lyonnais': 'Lyon',
    'olympique de marseille': 'Marseille',
    'olympique marseille': 'Marseille',

    // España
    'athletic club': 'Athletic Bilbao',
    'sd eibar': 'Eibar',
    'celta de vigo': 'Celta Vigo',
    'ad ceuta fc': 'Ceuta',
    'real valladolid': 'Valladolid',
    'deportivo alaves': 'Deportivo Alaves',
    'atletico de madrid': 'Atletico Madrid',

    // Inglaterra
    'brighton hove albion': 'Brighton and Hove Albion',
    'brighton and hove albion': 'Brighton and Hove Albion',
    'brighton': 'Brighton and Hove Albion',
    'afc bournemouth': 'Bournemouth',
    'manchester united': 'Manchester United',
    'man united': 'Manchester United',
    'man utd': 'Manchester United',
    'manchester city': 'Manchester City',
    'man city': 'Manchester City',
    'nottm forest': 'Nottm Forest',
    'nottingham forest': 'Nottm Forest',
    'wolverhampton': 'Wolves',
    'wolverhampton wanderers': 'Wolves',
    'coventry city': 'Coventry',
    'leeds united': 'Leeds',
    'derby county': 'Derby',
    'lincoln city': 'Lincoln',
    'swansea city': 'Swansea',

    // Italia
    'milan': 'AC Milan',
    'ac milan': 'AC Milan',
    'inter': 'Inter Milan',
    'inter milan': 'Inter Milan',
    'internazionale': 'Inter Milan',

    // Turquía
    'besiktas jk': 'Besiktas',
    'besiktas': 'Besiktas',
    'beşiktaş': 'Besiktas',
    'galatasaray sk': 'Galatasaray',
    'goztepe sk': 'Goztepe',
    'caykur rizespor': 'Rizespor',

    // Europa
    'omonia nicosia': 'Omonia Nicosia'
};

/**
 * Obtiene el nombre canónico de búsqueda para TheSportsDB.
 * 
 * @param {string} raw 
 * @returns {string}
 */
export function getCanonicalSearchName(raw = '') {
    const sanitized = sanitizeTeamName(raw);
    if (!sanitized) return '';

    if (CANONICAL_SEARCH_NAMES[sanitized]) {
        return CANONICAL_SEARCH_NAMES[sanitized];
    }

    // Probar tras eliminar prefijos/sufijos de clubes
    const stripped = getStrippedTokensName(raw);
    if (stripped && CANONICAL_SEARCH_NAMES[stripped]) {
        return CANONICAL_SEARCH_NAMES[stripped];
    }

    // Capitalizar palabras del nombre stripped
    if (stripped) {
        return stripped.split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    return sanitized.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Construye una consulta de búsqueda canónica determinista para TheSportsDB.
 * 
 * @param {string} home 
 * @param {string} away 
 * @returns {string}
 */
export function buildCanonicalSearchQuery(home = '', away = '') {
    const canHome = getCanonicalSearchName(home);
    const canAway = getCanonicalSearchName(away);
    return `${canHome} vs ${canAway}`;
}

/**
 * Infiere la temporada europea (ej. "2026-2027") a partir de una fecha de kickoff.
 * 
 * @param {string|Date} kickoff 
 * @returns {string|null}
 */
export function inferSeason(kickoff) {
    if (!kickoff) return null;
    const d = kickoff instanceof Date ? kickoff : new Date(kickoff);
    if (Number.isNaN(d.getTime())) return null;

    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1; // 1-12

    // Las temporadas europeas de fútbol inician típicamente en julio/agosto (mes >= 7)
    if (month >= 7) {
        return `${year}-${year + 1}`;
    } else {
        return `${year - 1}-${year}`;
    }
}
