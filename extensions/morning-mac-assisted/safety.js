/* Pure browser safety rules for Morning assisted Mac mode. No secrets, network or storage. */
(() => {
  const madridDay = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);

  const isFutureKickoff = (kickoff, now = new Date()) => {
    const kTime = typeof kickoff === 'string' ? Date.parse(kickoff) : kickoff instanceof Date ? kickoff.getTime() : Number(kickoff);
    return Number.isFinite(kTime) && kTime > now.getTime() + 60_000;
  };

  const isTodayMadrid = (kickoff, now = new Date()) => {
    const kDate = typeof kickoff === 'string' || typeof kickoff === 'number' ? new Date(kickoff) : kickoff;
    if (!(kDate instanceof Date) || Number.isNaN(kDate.getTime())) return false;
    return madridDay(kDate) === madridDay(now);
  };

  const isCleanOdds = (value) => {
    const odds = Number(value);
    return Number.isFinite(odds) && odds >= 1.01 && odds <= 1000;
  };

  const classify = response => {
    if (!response || response.uncertain) return 'uncertain';
    if (!response.ok) return response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain';
    const r = response.result || {};
    if (r.ok === true) {
      if (r.state === 'already_published' || r.created === false || r.deliveryState === 'duplicate') return 'duplicate';
      if (r.created === true || r.state === 'published' || r.state === 'queued') return 'confirmed';
      return 'confirmed';
    }
    return 'uncertain';
  };

  const formatPayload = (candidate, observedAt = new Date().toISOString()) => {
    if (!candidate?.event || !candidate?.system || !candidate?.visiblePick) {
      throw new Error('INVALID_CANDIDATE_STRUCTURE');
    }
    return {
      event: {
        sourceEventId: String(candidate.event.sourceEventId || '').trim(),
        competition: String(candidate.event.competition || '').trim(),
        homeTeam: String(candidate.event.homeTeam || '').trim(),
        awayTeam: String(candidate.event.awayTeam || '').trim(),
        kickoffAt: typeof candidate.event.kickoffAt === 'string' ? candidate.event.kickoffAt : new Date(candidate.event.kickoffAt).toISOString()
      },
      system: {
        id: String(candidate.system.id || '').trim()
      },
      visiblePick: {
        selection: String(candidate.visiblePick.selection || '').trim(),
        odds: Number(Number(candidate.visiblePick.odds).toFixed(2))
      },
      source: {
        provider: 'futbolbrain-owner-browser',
        observedAt
      }
    };
  };

  const api = Object.freeze({
    madridDay,
    isFutureKickoff,
    isTodayMadrid,
    isCleanOdds,
    classify,
    formatPayload
  });

  globalThis.MoneyTipsMorningSafety = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
