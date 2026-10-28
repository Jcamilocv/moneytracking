/* Explicit mounted-DOM contract. This never certifies provider exhaustiveness. */
(() => {
  const day = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const bounded = n => Number.isInteger(n) && n >= 0 && n <= 200;
  const fresh = (s, now = new Date()) => Boolean(s?.schemaVersion === 2 && s.source === 'dashboard'
    && s.coverage === 'MOUNTED_DOM_ONLY' && s.sourceExhaustive === false && s.complete === false && s.expectedRows === null
    && s.rowsReconciled === true && s.sourceLocated === true && s.loading === false && s.sessionExpired === false
    && s.failedRows === 0 && s.duplicateRows === 0 && s.unreadableDateRows === 0 && s.unvisitedRows === 0
    && s.paginationDetected === false && s.virtualizationDetected === false && s.snapshotChanged === false && s.readCapReached === false
    && bounded(s.mountedRows) && s.mountedRows === s.observedRows && bounded(s.totalRows) && bounded(s.futureRows) && bounded(s.pastRows)
    && s.totalRows + s.futureRows + s.pastRows === s.observedRows && s.day === day(now)
    && s.refreshDay === day(now) && Number.isFinite(Date.parse(s.documentLoadedAt))
    && new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date(s.documentLoadedAt)) !== '00'
    && Date.parse(s.documentLoadedAt) <= Date.parse(s.startedAt)
    && day(new Date(s.documentLoadedAt)) === day(now)
    && Number.isFinite(Date.parse(s.startedAt)) && Number.isFinite(Date.parse(s.completedAt))
    && Date.parse(s.startedAt) <= Date.parse(s.completedAt) && Date.parse(s.completedAt) <= now.getTime()
    && now.getTime() - Date.parse(s.startedAt) <= 60000
    && Array.isArray(s.candidateIds) && new Set(s.candidateIds).size === s.candidateIds.length
    && s.candidateIds.length <= s.totalRows && s.candidateIds.every(id => typeof id === 'string' && /^fb-own-[a-z0-9]{1,64}$/.test(id)));
  const fromReading = (reading, refresh, sessionExpired, documentLoadedAt) => {
    const scan = { ...reading.scan, schemaVersion: 2, coverage: 'MOUNTED_DOM_ONLY', sourceExhaustive: false,
      complete: false, expectedRows: null, sessionExpired: sessionExpired === true,
      refreshDay: refresh?.day || null, documentLoadedAt, rowsReconciled: false };
    scan.rowsReconciled = scan.sourceLocated === true && scan.failedRows === 0 && scan.loading === false
      && scan.mountedRows === scan.observedRows && scan.unvisitedRows === 0
      && scan.totalRows + scan.futureRows + scan.pastRows === scan.observedRows;
    return scan;
  };
  globalThis.MoneyTipsTableroPolicy = Object.freeze({ day, fresh, fromReading });
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.MoneyTipsTableroPolicy;
})();
