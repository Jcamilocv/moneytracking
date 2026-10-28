/* Approved validation/time/session from 2e9726f887d307909e62f56f06b3d1808ad04b91; local DOM adapter v1.1.0. No transport. */
(() => {
let latestScan=null;
  const SYSTEMS = Object.freeze({
    'MT - CHA EUR - V1.0': { mode: 'MORNING', market: 'Ambos equipos marcan', label: 'Morning (10:00 Madrid)' },
    'MT - ENG2 - v1.0': { mode: 'MORNING', market: 'Resultado final', label: 'Morning (10:00 Madrid)' },
    'MT - ITA1 - V1.0': { mode: 'MORNING', market: 'Ambos equipos marcan', label: 'Morning (10:00 Madrid)' },
    'MT - Premier League 02.5': { mode: 'MORNING', market: 'Total de goles', label: 'Morning (10:00 Madrid)' }
  });


  const MORNING_WINDOW_START_HOUR = 10;
  const MORNING_WINDOW_START_MINUTE = 0;
  const MORNING_WINDOW_END_MINUTE = 2; // Ventana activa 10:00:00 - 10:02:59
  const MORNING_WINDOW_CLOSE_MINUTE = 3; // Cierre a las 10:03:00


  const normalise = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const hash = (value) => {
    let result = 5381;
    for (const char of value) result = ((result << 5) + result) ^ char.charCodeAt(0);
    return (result >>> 0).toString(36);
  };


  const getMadridTimeParts = (date = new Date()) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Madrid',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    let hour = Number(get('hour'));
    if (hour === 24) hour = 0;
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour,
      minute: Number(get('minute')),
      second: Number(get('second')),
      dateKey: `${get('year')}-${get('month')}-${get('day')}`,
      timeString: `${String(hour).padStart(2, '0')}:${get('minute')}`
    };
  };

  const madridDateKey = (date) => getMadridTimeParts(date).dateKey;

  const isTodayMadrid = (kickoffDate, now = new Date()) => {
    return madridDateKey(kickoffDate) === madridDateKey(now);
  };

  const getMorningWindowStatus = (now = new Date()) => {
    const parts = getMadridTimeParts(now);
    const { hour, minute, timeString } = parts;

    // Antes de las 10:00 Madrid
    if (hour < MORNING_WINDOW_START_HOUR) {
      return {
        isOpen: false,
        status: 'BEFORE_WINDOW',
        badgeClass: 'badge-waiting',
        label: 'En espera (10:00)',
        message: `Ventana Morning cerrada hasta las 10:00 Madrid (Hora actual: ${timeString}).`,
        timeParts: parts
      };
    }

    // Ventana oficial activa: 10:00:00 a 10:02:59
    if (hour === MORNING_WINDOW_START_HOUR && minute <= MORNING_WINDOW_END_MINUTE) {
      return {
        isOpen: true,
        status: 'WINDOW_OPEN',
        badgeClass: 'badge-success',
        label: `🟢 Ventana 10:00 activa (cierre 10:03)`,
        message: `Ventana Morning ACTIVA (10:00 - 10:02 Madrid). Hora actual: ${timeString}.`,
        timeParts: parts
      };
    }

    // Cierre obligatorio a las 10:03:00 (o cualquier hora posterior)
    return {
      isOpen: false,
      status: 'CLOSED_AFTER_WINDOW',
      badgeClass: 'badge-closed',
      label: 'Cerrada (cierre 10:03)',
      message: `Ventana Morning CERRADA (cierre oficial 10:03 Madrid). Hora actual: ${timeString}. Publicación de picks atrasados bloqueada.`,
      timeParts: parts
    };
  };

  const isMorningWindowOpen = (now = new Date()) => getMorningWindowStatus(now).isOpen;

  const parseKickoff = (value) => {
    const cleaned = normalise(value);
    let year, month, day, hour = 0, minute = 0, second = 0;

    const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (iso) {
      [, year, month, day, hour, minute, second = 0] = iso;
    } else {
      const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      [, day, month, year, hour, minute] = match;
    }

    const naiveUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), 0);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Madrid',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    let guess = naiveUtc;
    for (let i = 0; i < 3; i++) {
      const formatted = formatter.formatToParts(new Date(guess));
      const getPart = (t) => formatted.find((p) => p.type === t)?.value;
      const fYear = Number(getPart('year'));
      const fMonth = Number(getPart('month'));
      const fDay = Number(getPart('day'));
      let fHour = Number(getPart('hour'));
      if (fHour === 24) fHour = 0;
      const fMinute = Number(getPart('minute'));
      const fSecond = Number(getPart('second'));

      const formattedAsUtc = Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, fSecond);
      const diff = formattedAsUtc - naiveUtc;
      if (diff === 0) break;
      guess -= diff;
    }

    const date = new Date(guess);
    if (Number.isNaN(date.getTime())) return null;
    const roundtrip = getMadridTimeParts(date);
    return roundtrip.year === Number(year) && roundtrip.month === Number(month) && roundtrip.day === Number(day)
      && roundtrip.hour === Number(hour) && roundtrip.minute === Number(minute) && roundtrip.second === Number(second) ? date : null;
  };

  const stablePickId = (system, cells) => `${system}:${hash(`${cells.join('|')}|${[...cells].reverse().join('|')}`)}`;

  const visibleMadridDay = (dateText, kickoffAt) => {
    const iso = normalise(dateText).match(/^(\d{4}-\d{2}-\d{2})T/);
    if (iso) return iso[1];
    const european = normalise(dateText).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (european) return `${european[3]}-${european[2]}-${european[1]}`;
    return madridDateKey(kickoffAt);
  };

  // =========================================================================
  // Detección de Estado de Sesión en FutbolBrain
  // =========================================================================

  const checkSessionStatus = () => {
    const path = (typeof location !== 'undefined' ? (location.pathname || '') : '').toLowerCase();
    // 1. Redirecciones a rutas de login o auth
    if (path.includes('/login') || path.includes('/signin') || path.includes('/auth')) {
      return { expired: true, reason: 'URL de autenticación detectada (' + path + ')' };
    }

    if (typeof document === 'undefined') return { expired: false };

    // 2. Presencia de campos de contraseña activos en pantalla
    const passwordInput = document.querySelector('input[type="password"]');
    if (passwordInput && passwordInput.offsetParent !== null) {
      return { expired: true, reason: 'Formulario de inicio de sesión visible en pantalla' };
    }

    // 3. Textos explícitos de sesión caducada o login requerido
    const bodyText = document.body ? document.body.innerText : '';
    if (
      bodyText.includes('Tu sesión ha expirado') ||
      bodyText.includes('Session expired') ||
      bodyText.includes('Please log in again') ||
      bodyText.includes('Inicia sesión para continuar') ||
      (bodyText.includes('Iniciar sesión') && path.includes('/login'))
    ) {
      return { expired: true, reason: 'Aviso de sesión expirada detectado en el sitio' };
    }

    return { expired: false };
  };

  // =========================================================================
  // Extracción de Filas y Candidatos Morning
  // =========================================================================

  const candidateFromFields = ({ dateText, competition, fixture, rawSelection, rawOdds, system }) => {
    if (!Object.hasOwn(SYSTEMS, system)) return null;
    const expected = system === 'MT - ENG2 - v1.0' ? 'Team 2 (FT)'
      : system === 'MT - Premier League 02.5' ? 'Under 3.5' : 'No';
    if (rawSelection !== expected) return null;
    if ([competition, fixture, rawSelection, rawOdds, system].some((value) => /…|\.\.\./.test(String(value || '')))) return null;
    const kickoffAt = parseKickoff(dateText);
    const teams = fixture.split(/\s+vs\s+/i).map(normalise);
    const odds = Number(String(rawOdds).replace(',', '.'));
    if (!kickoffAt || !isTodayMadrid(kickoffAt) || teams.length !== 2 || !teams[0] || !teams[1] || !Number.isFinite(odds) || odds < 1.01 || odds > 1000) return null;
    const madridDay = visibleMadridDay(dateText, kickoffAt);
    const identity = [madridDay, competition, teams[0], teams[1], rawSelection, system].map(normalise);
    const id = stablePickId(system, identity);
    return {
      id,
      system,
      rule: SYSTEMS[system],
      text: normalise([dateText, competition, fixture, rawSelection, rawOdds, system].join(' · ')),
      kickoffAt,
      payload: {
        event: {
          sourceEventId: `fb-own-${hash(identity.join('|'))}`,
          competition,
          homeTeam: teams[0],
          awayTeam: teams[1],
          kickoffAt: kickoffAt.toISOString()
        },
        system: { id: system },
        visiblePick: { market: SYSTEMS[system].market, selection: rawSelection, odds },
        source: { provider: 'futbolbrain-owner-browser', observedAt: new Date().toISOString() }
      }
    };
  };



let latestProvisional=[];let latestRowDiagnostics=[];
  // CEO structural checkpoint 22/10/2026. Extraction prototype, not proof of dataset coverage.
  // No flag, DOM attribute, UI count or repeated fingerprint can enable complete=true.
  const rendered = element => {
    if (!element || element.nodeType !== 1) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none'
        || ['hidden', 'collapse'].includes(style.visibility)) return false;
    }
    return true; // Scroll clipping is not display:none; inspect every mounted row.
  };
  const text = element => normalise(element?.innerText ?? element?.textContent);
  const all = element => [...element.querySelectorAll('*')];
  const children = (element, tag) => [...element.children].filter(node => node.tagName === tag);
  const sole = items => items.length === 1 ? items[0] : null;
  const truncated = value => /…|\.\.\./.test(value);
  const headingText = value => /^Picks\s+Activos(?:\s*\(\s*Hoy\s*\d+\s*\))?$/i.test(value);
  const canonical = value => normalise(value).toLowerCase();
  const HEADERS = ['fecha', 'liga', 'partido', 'mercado', 'cuota', 'sistema'];
  let sourceDiagnostics = { code: 'NOT_SCANNED', headingCount: 0, tableCount: 0 };
  const tableShape = outer => {
    const body = sole(children(outer, 'TBODY'));
    if (!body || outer.children.length !== 1 || body.children.length !== 2) return null;
    const frameRows = [...body.children];
    if (frameRows.some(row => row.tagName !== 'TR' || row.children.length !== 1 || row.children[0].tagName !== 'TD')) return null;
    const headerTable = sole([...frameRows[0].querySelectorAll('table')]);
    const dataTable = sole([...frameRows[1].querySelectorAll('table')]);
    if (!headerTable || !dataTable || !rendered(headerTable) || !rendered(dataTable)) return null;
    const head = sole(children(headerTable, 'THEAD')), dataBody = sole(children(dataTable, 'TBODY'));
    if (!head || !dataBody || head.children.length !== 1 || headerTable.children.length !== 1 || dataTable.children.length !== 1) return null;
    const headerRow = head.children[0], headers = [...headerRow.children];
    if (headerRow.tagName !== 'TR' || headers.length !== 8 || headers.some(cell => cell.tagName !== 'TH' || !rendered(cell))) return null;
    if (HEADERS.some((label, i) => canonical(text(headers[i])) !== label)) return null;
    if (headers.some(cell => !text(cell)) || new Set(headers.map(cell => canonical(text(cell)))).size !== 8) return null;
    const scroll = dataTable.parentElement;
    if (!scroll || scroll.tagName !== 'DIV' || scroll.style.maxHeight !== '30vh'
      || !['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY || getComputedStyle(scroll).overflow)) return null;
    if (scroll.parentElement !== frameRows[1].children[0] || headerTable.parentElement !== frameRows[0].children[0]) return null;
    return { outer, dataBody, scroll };
  };
  const locateSource = () => {
    const visible = all(document.body).filter(rendered);
    const headings = visible.filter(node => headingText(text(node)) && !all(node).some(child => rendered(child) && headingText(text(child))));
    sourceDiagnostics = { code: headings.length ? 'HEADER_AMBIGUOUS' : 'HEADER_MISSING', headingCount: headings.length, tableCount: 0 };
    if (headings.length !== 1) return null;
    sourceDiagnostics.code = 'TABLE_SHAPE_UNSUPPORTED';
    for (let scope = headings[0].parentElement; scope && !['BODY', 'HTML'].includes(scope.tagName); scope = scope.parentElement) {
      const tables = [...scope.querySelectorAll('table')].filter(rendered);
      const sources = tables.map(tableShape).filter(Boolean);
      sourceDiagnostics.tableCount = tables.length;
      if (!sources.length) continue;
      if (sources.length !== 1 || tables.length !== 3) { sourceDiagnostics.code = 'SOURCE_AMBIGUOUS'; return null; }
      // The pick scope cannot include the other dashboard section or a second visible heading.
      if (all(scope).some(node => rendered(node) && /^Tus\s+Sistemas\s+Activos$/i.test(text(node)))) { sourceDiagnostics.code = 'SOURCE_SCOPE_MIXED'; return null; }
      sourceDiagnostics.code = 'SOURCE_LOCATED';
      return { ...sources[0], scope };
    }
    return null;
  };
  const consistentDisplay = (display, full) => {
    if (!display || !full || truncated(full)) return false;
    if (!truncated(display)) return display === full;
    const prefix = display.replace(/(?:…|\.\.\.).*$/, '').trim();
    return prefix.length >= 2 && full.startsWith(prefix);
  };
  const plainCell = cell => {
    if (!rendered(cell) || all(cell).some(node => !rendered(node) || node.getAttribute('title') !== null)) return null;
    const value = text(cell);
    return value && !truncated(value) ? value : null;
  };
  const systemCell = cell => {
    if (!rendered(cell) || all(cell).some(node => !rendered(node))) return null;
    const titled = all(cell).filter(node => node.getAttribute('title') !== null);
    if (!titled.length) return plainCell(cell);
    const node = sole(titled);
    if (!node || text(cell) !== text(node)) return null;
    const value = normalise(node.getAttribute('title'));
    return consistentDisplay(text(node), value) ? value : null;
  };
  const fixtureCell = cell => {
    if (!rendered(cell) || all(cell).some(node => !rendered(node))) return null;
    const groups = all(cell).filter(node => node.children.length === 3 && /^vs$/i.test(text(node.children[1])));
    const group = sole(groups);
    if (!group || text(cell) !== text(group) || [...group.children].some(node => node.tagName !== 'SPAN' || node.children.length)) return null;
    const [home, marker, away] = [...group.children];
    if (marker.getAttribute('title') !== null) return null;
    const a = home.getAttribute('title'), b = away.getAttribute('title');
    if (a === null && b === null) {
      if ([text(home), text(away)].some(value => !value || truncated(value) || /\bvs\b/i.test(value))) return null;
      return `${text(home)} vs ${text(away)}`;
    }
    if (a === null || b === null || normalise(a) !== normalise(b) || truncated(normalise(a))) return null;
    // Real Tablero titles use "Local - Visitante" while the structural marker is "vs".
    // Accept only exact full names already present in the two unambiguous spans.
    if (![text(home), text(away)].some(value => !value || truncated(value) || /\bvs\b/i.test(value))
      && normalise(a) === `${text(home)} - ${text(away)}`) return `${text(home)} vs ${text(away)}`;
    const teams = normalise(a).split(/\s+vs\s+/i).map(normalise);
    if (teams.length !== 2 || !consistentDisplay(text(home), teams[0]) || !consistentDisplay(text(away), teams[1])) return null;
    return `${teams[0]} vs ${teams[1]}`;
  };
  // Calendar-only classification is diagnostic, never a fabricated kickoff or candidate.
  const calendarOnly = value => {
    const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, day, month, year] = match, date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
      ? `${year}-${month}-${day}` : null;
  };
  const readRow = row => {
    const cells = [...row.children];
    if (row.tagName !== 'TR' || !rendered(row) || cells.length !== 8 || cells.some(cell => cell.tagName !== 'TD'
      || cell.getAttribute('colspan') !== null || cell.getAttribute('rowspan') !== null || cell.querySelectorAll('table').length)) return { date: null, code: 'ROW_SHAPE_INVALID' };
    const dateText = plainCell(cells[0]), date = dateText ? parseKickoff(dateText) : null;
    if (!date) { const dayOnly = calendarOnly(dateText); return { date: null, dayOnly, code: dayOnly ? 'KICKOFF_MISSING' : 'DATE_UNREADABLE' }; }
    const competition = systemCell(cells[1]), fixture = fixtureCell(cells[2]), rawSelection = plainCell(cells[3]);
    const rawOdds = plainCell(cells[4]), system = systemCell(cells[5]);
    if ([competition, fixture, rawSelection, rawOdds, system].some(value => !value)) return { date, code: 'FIELD_INCOMPLETE_OR_AMBIGUOUS' };
    const odds = Number(rawOdds.replace(',', '.'));
    if (!/^\d+(?:[.,]\d+)?$/.test(rawOdds) || !Number.isFinite(odds) || odds < 1.01 || odds > 1000) return { date, code: 'ODDS_INVALID' };
    return { date, fields: { dateText, competition, fixture, rawSelection, rawOdds, system } };
  };
  const structuralSignals = scope => {
    const nodes = [scope, ...all(scope)].filter(rendered);
    const loading = nodes.some(node => node.getAttribute('aria-busy') === 'true' || node.getAttribute('role') === 'progressbar'
      || /skeleton|animate-pulse|loading/i.test(String(node.className || '')));
    const pagination = nodes.some(node => /pagination|paginator/i.test(String(node.className || ''))
      || ['BUTTON', 'A', 'NAV'].includes(node.tagName) && /siguiente|anterior|cargar m[aá]s|next|previous|load more|p[aá]gina/i.test(text(node)));
    const virtualization = nodes.some(node => /virtual|infinite|lazy[-_ ]?(?:load|list|row)/i.test(String(node.className || ''))
      || node.getAttribute('aria-rowcount') !== null || node.getAttribute('aria-rowindex') !== null
      || node.getAttribute('data-index') !== null || node.getAttribute('data-virtualized') !== null);
    return { loading, pagination, virtualization };
  };
  // Unrelated dashboard modules may have permanent/hidden skeletons. Scope loading
  // to the actual pick source; an unfinished main document is still blocking.
  const pageIsStillLoading = () => document.readyState !== 'complete';
  const visibleRows = () => {
    const scanNow = new Date(), startedAt = scanNow.toISOString(), day = madridDateKey(scanNow), rows = [], identities = new Set();
    latestProvisional = []; latestRowDiagnostics = [];
    let totalRows = 0, observedRows = 0, failedRows = 0, unreadableDateRows = 0, otherDateRows = 0, futureRows = 0, pastRows = 0, nonMorningRows = 0, duplicateRows = 0;
    sourceDiagnostics = { code: 'UNSUPPORTED_OR_EXPIRED', headingCount: 0, tableCount: 0 };
    const source = location.pathname === '/dashboard' && !checkSessionStatus().expired ? locateSource() : null;
    const signals = source ? structuralSignals(source.scope) : { loading: false, pagination: false, virtualization: false };
    const loading = navigator.onLine === false || pageIsStillLoading() || signals.loading
      || /Failed to fetch|Error al cargar|No se pudo cargar|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|sesión.*expir/i.test(String(document.body?.innerText || ''));
    const mountedRows = source?.dataBody.children.length ?? 0;
    if (source) for (const row of [...source.dataBody.children]) {
      if (observedRows >= 200) break;
      observedRows += 1;
      const record = readRow(row);
      const diagnosticDay = record.date ? madridDateKey(record.date) : record.dayOnly || null;
      const diagnostic = code => latestRowDiagnostics.push({ ordinal: observedRows, cohort: diagnosticDay ? diagnosticDay === day ? 'today' : diagnosticDay > day ? 'future' : 'past' : 'unknown', code });
      if (!record.date) {
        if (record.dayOnly === day) totalRows += 1;
        else if (record.dayOnly) { otherDateRows += 1; if (record.dayOnly > day) futureRows += 1; else pastRows += 1; }
        // A fully readable calendar date outside today is never a Morning candidate.
        // Do not fabricate a kickoff for it or require future providers to expose one.
        if (record.dayOnly && record.dayOnly !== day) { diagnostic(record.code); continue; }
        unreadableDateRows += 1; failedRows += 1; diagnostic(record.code); continue;
      }
      const today = isTodayMadrid(record.date, scanNow), recordDay = madridDateKey(record.date);
      const cohort = today ? 'today' : recordDay > day ? 'future' : 'past';
      if (today) totalRows += 1; else { otherDateRows += 1; if (cohort === 'future') futureRows += 1; else pastRows += 1; }
      if (!record.fields) { failedRows += 1; diagnostic(record.code); continue; }
      const f = record.fields;
      const identity = JSON.stringify([madridDateKey(record.date), f.competition, f.fixture, f.rawSelection, f.system]);
      if (identities.has(identity)) { failedRows += 1; duplicateRows += 1; diagnostic('DUPLICATE_ROW'); continue; }
      identities.add(identity);
      if (!Object.hasOwn(SYSTEMS, f.system)) { nonMorningRows += 1; diagnostic('NON_MORNING'); continue; }
      // Raw fields live only in this isolated-world scan, never in persistent telemetry.
      latestProvisional.push({ ordinal: observedRows, cohort, day: recordDay, kickoffAt: record.date.toISOString(), fields: { ...f } });
      if (!today) continue;
      const pick = candidateFromFields(f);
      if (!pick) { failedRows += 1; diagnostic('MORNING_FIELDS_INVALID'); continue; }
      rows.push(pick);
    }
    const unvisitedRows = Math.max(0, mountedRows - observedRows), readCapReached = unvisitedRows > 0;
    if (readCapReached) failedRows += 1;
    const mountedRowsAfter = source?.dataBody.children.length ?? 0;
    const snapshotChanged = mountedRows !== mountedRowsAfter || madridDateKey(new Date()) !== day;
    if (snapshotChanged) failedRows += 1;
    // Trial observations are useful without a provider certificate. No completeness inference is made.
    // expectedRows stays UNKNOWN: neither Hoy X nor observedRows is an independent total.
    latestScan = { schemaVersion: 4, source: 'dashboard', day, startedAt, completedAt: new Date().toISOString(), loading,
      sourceLocated: Boolean(source), totalRows, observedRows, otherDateRows, unreadableDateRows, expectedRows: null, failedRows,
      futureRows, pastRows, nonMorningRows, duplicateRows, mountedRows, unvisitedRows, readCapReached, snapshotChanged,
      sourceDiagnostics: { ...sourceDiagnostics },
      paginationDetected: signals.pagination, virtualizationDetected: signals.virtualization,
      coverage: 'UNPROVEN', coverageReason: 'SOURCE_EXHAUSTIVENESS_UNPROVEN', complete: false,
      candidateIds: rows.map(pick => pick.payload.event.sourceEventId) };
    for (const pick of rows) {
      pick.payload.source.observedAt = latestScan.completedAt;
      pick.payload.scan = { ...latestScan };
    }
    return rows;
  };

globalThis.MoneyTipsShadowReader=Object.freeze({SYSTEMS,parseKickoff,checkSessionStatus,getMorningWindowStatus,isMorningWindowOpen,isTodayMadrid,read:()=>{const rows=visibleRows();const result={rows,scan:latestScan,provisional:latestProvisional,rowDiagnostics:latestRowDiagnostics};latestProvisional=[];latestRowDiagnostics=[];return result;}});
})();
