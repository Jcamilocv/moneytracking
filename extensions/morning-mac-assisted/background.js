/* Money Tips Morning — Modo Asistido Mac (MV3 Service Worker) */
importScripts('safety.js', 'rules.js', 'scan-policy.js');

const Safety = globalThis.MoneyTipsMorningSafety;
const Policy = globalThis.MoneyTipsTableroPolicy;
const Rules = globalThis.MoneyTipsShadowRules;

const CONFIG_KEY = 'moneyTipsMorningMacConfigV1';
const CLAIMS_KEY = 'moneyTipsMorningMacClaimsV1';
const HEALTH_KEY = 'moneyTipsMorningMacHealthV1';

const DEFAULT_ENDPOINT = 'https://app.pronosticosmoneytips.com/api/internal/futbolbrain-local-picks';

const getStorage = key => new Promise((resolve, reject) => {
  chrome.storage.local.get([key], v => {
    if (chrome.runtime.lastError) reject(new Error('STORAGE_UNAVAILABLE'));
    else resolve(v[key]);
  });
});

const putStorage = value => new Promise((resolve, reject) => {
  chrome.storage.local.set(value, () => {
    if (chrome.runtime.lastError) reject(new Error('STORAGE_UNAVAILABLE'));
    else resolve();
  });
});

const getConfig = async () => {
  const c = await getStorage(CONFIG_KEY);
  return {
    endpoint: c?.endpoint || DEFAULT_ENDPOINT,
    token: typeof c?.token === 'string' ? c.token.trim() : '',
    armed: c?.armed === true,
    autoSubmit: c?.autoSubmit === true
  };
};

const isConfigured = config => {
  return typeof config?.endpoint === 'string' && config.endpoint.startsWith('http')
    && typeof config?.token === 'string' && config.token.length >= 16;
};

const claimKeyFor = (candidate) => {
  const day = Safety.madridDay(new Date());
  const id = candidate?.event?.sourceEventId || candidate?.id || 'unknown';
  return `${day}::${id}`;
};

let inFlightQueue = Promise.resolve();
const sequential = fn => {
  const next = inFlightQueue.then(fn);
  inFlightQueue = next.catch(() => {});
  return next;
};

const handleSubmit = async (candidate) => {
  return sequential(async () => {
    const config = await getConfig();
    if (!config.armed) {
      return { ok: false, status: 403, error: 'SUBMISSION_DISARMED', state: 'disarmed' };
    }
    if (!isConfigured(config)) {
      return { ok: false, status: 412, error: 'CONFIG_MISSING_OR_INVALID', state: 'not_configured' };
    }

    const now = new Date();
    // Validate system
    const systemId = candidate?.system?.id;
    if (!Rules.systems[systemId]) {
      return { ok: false, status: 422, error: 'UNAPPROVED_SYSTEM', state: 'rejected' };
    }

    // Validate kickoff
    const kickoff = candidate?.event?.kickoffAt;
    if (!Safety.isFutureKickoff(kickoff, now)) {
      return { ok: false, status: 422, error: 'KICKOFF_NOT_FUTURE', state: 'rejected' };
    }
    if (!Safety.isTodayMadrid(kickoff, now)) {
      return { ok: false, status: 422, error: 'KICKOFF_NOT_TODAY', state: 'rejected' };
    }

    // Validate odds
    if (!Safety.isCleanOdds(candidate?.visiblePick?.odds)) {
      return { ok: false, status: 422, error: 'ODDS_INVALID', state: 'rejected' };
    }

    // Check existing claims (idempotency)
    const key = claimKeyFor(candidate);
    const claims = (await getStorage(CLAIMS_KEY)) || {};
    const existing = claims[key];

    if (existing && ['confirmed', 'duplicate'].includes(existing.status)) {
      return { ok: true, status: 200, state: existing.status, duplicate: true, cached: true };
    }
    if (existing && existing.status === 'in_flight') {
      const ageMs = now.getTime() - Date.parse(existing.startedAt || 0);
      if (ageMs < 15_000) {
        return { ok: false, status: 429, error: 'ALREADY_IN_FLIGHT', state: 'in_flight' };
      }
    }

    // Claim-before-I/O
    claims[key] = {
      candidateId: candidate?.event?.sourceEventId,
      status: 'in_flight',
      startedAt: now.toISOString(),
      system: systemId
    };
    await putStorage({ [CLAIMS_KEY]: claims });

    // Format normalized payload
    let payload;
    try {
      payload = Safety.formatPayload(candidate, now.toISOString());
    } catch (err) {
      claims[key] = { ...claims[key], status: 'rejected', error: err.message };
      await putStorage({ [CLAIMS_KEY]: claims });
      return { ok: false, status: 400, error: err.message, state: 'rejected' };
    }

    // Issue network call with bounded timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;

    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const body = await res.json().catch(() => ({}));
      response = {
        ok: res.ok,
        status: res.status,
        uncertain: res.status >= 500,
        result: body
      };
    } catch (netErr) {
      response = {
        ok: false,
        status: 0,
        uncertain: true,
        error: netErr.name === 'AbortError' ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR'
      };
    } finally {
      clearTimeout(timer);
    }

    const classifiedStatus = Safety.classify(response);
    claims[key] = {
      ...claims[key],
      status: classifiedStatus,
      completedAt: new Date().toISOString(),
      response
    };
    await putStorage({ [CLAIMS_KEY]: claims });

    // If delivery is uncertain, pause auto-submission immediately for operator safety
    if (classifiedStatus === 'uncertain') {
      await putStorage({ [CONFIG_KEY]: { ...config, armed: false } });
    }

    return {
      ok: response.ok,
      status: response.status,
      state: classifiedStatus,
      result: response.result || null,
      error: response.error || null
    };
  });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'morning-mac-status') {
    getConfig().then(config => {
      sendResponse({ ok: true, config, configured: isConfigured(config) });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'morning-mac-pause') {
    getConfig().then(async config => {
      await putStorage({ [CONFIG_KEY]: { ...config, armed: false } });
      sendResponse({ ok: true, armed: false });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'morning-mac-arm') {
    getConfig().then(async config => {
      if (!isConfigured(config)) {
        return sendResponse({ ok: false, error: 'CONFIG_INCOMPLETE' });
      }
      await putStorage({ [CONFIG_KEY]: { ...config, armed: true } });
      sendResponse({ ok: true, armed: true });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'morning-mac-submit') {
    handleSubmit(message.candidate, sender).then(sendResponse).catch(err => {
      sendResponse({ ok: false, status: 500, error: err.message, state: 'uncertain' });
    });
    return true;
  }

  if (message?.type === 'morning-mac-health') {
    putStorage({ [HEALTH_KEY]: { ...message.health, updatedAt: new Date().toISOString() } })
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'morning-mac-get-claims') {
    getStorage(CLAIMS_KEY).then(claims => {
      sendResponse({ ok: true, claims: claims || {} });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
