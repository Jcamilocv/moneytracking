/* Money Tips Morning — Modo Asistido Mac Content Script */
(() => {
  const Reader = globalThis.MoneyTipsShadowReader;
  const Policy = globalThis.MoneyTipsTableroPolicy;
  const Safety = globalThis.MoneyTipsMorningSafety;

  const documentLoadedAt = new Date(performance.timeOrigin).toISOString();
  let busy = false;
  let panel = null;

  const sendMsg = message => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error('WORKER_UNAVAILABLE'));
      else resolve(response);
    });
  });

  const getOrCreatePanel = () => {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'moneytips-morning-mac-widget';
    panel.style.cssText = [
      'position: fixed',
      'right: 20px',
      'bottom: 20px',
      'z-index: 2147483647',
      'background: #0f172a',
      'color: #f8fafc',
      'border: 1px solid #38bdf8',
      'border-radius: 12px',
      'box-shadow: 0 10px 25px rgba(0,0,0,0.5)',
      'padding: 14px 18px',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 13px',
      'line-height: 1.5',
      'max-width: 360px'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 600; border-bottom: 1px solid #334155; padding-bottom: 6px;';
    header.innerHTML = '<span style="color:#38bdf8;">☀️ Money Tips Morning</span><span id="mt-mac-badge" style="font-size:11px; padding:2px 6px; border-radius:4px; background:#334155;">Iniciando</span>';

    const info = document.createElement('div');
    info.id = 'mt-mac-info';
    info.style.cssText = 'font-size: 12px; color: #94a3b8; margin-bottom: 10px;';

    const actions = document.createElement('div');
    actions.id = 'mt-mac-actions';
    actions.style.cssText = 'display: flex; gap: 8px;';

    const pauseBtn = document.createElement('button');
    pauseBtn.id = 'mt-mac-toggle-btn';
    pauseBtn.textContent = 'Pausar envío';
    pauseBtn.style.cssText = 'flex: 1; background: #e02424; color: white; border: none; padding: 6px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-weight: 500;';
    pauseBtn.addEventListener('click', async () => {
      const status = await sendMsg({ type: 'morning-mac-status' }).catch(() => null);
      if (status?.config?.armed) {
        await sendMsg({ type: 'morning-mac-pause' }).catch(() => {});
      } else {
        await sendMsg({ type: 'morning-mac-arm' }).catch(() => {});
      }
      runCycle();
    });

    actions.append(pauseBtn);
    panel.append(header, info, actions);
    document.body.append(panel);
    return panel;
  };

  const updateUI = (stateText, badgeColor, scan, candidateCount, armed) => {
    getOrCreatePanel();
    const badge = document.getElementById('mt-mac-badge');
    const info = document.getElementById('mt-mac-info');
    const btn = document.getElementById('mt-mac-toggle-btn');

    if (badge) {
      badge.textContent = armed ? 'ARMADO' : 'DESARMADO';
      badge.style.background = armed ? '#059669' : '#475569';
    }

    if (btn) {
      btn.textContent = armed ? 'Pausar envío' : 'Armar envío';
      btn.style.background = armed ? '#dc2626' : '#2563eb';
    }

    if (info) {
      info.innerHTML = `
        <div><strong>Estado:</strong> ${stateText}</div>
        <div><strong>Tablero hoy:</strong> ${scan?.totalRows ?? '?'} filas (${scan?.mountedRows ?? '?'} montadas)</div>
        <div><strong>Morning válidos:</strong> <span style="color:#38bdf8;font-weight:600;">${candidateCount}</span></div>
        <div style="font-size:11px; margin-top:4px; color:#64748b;">Asistido Mac · Sin lock 10:00 · T-5 intacto</div>
      `;
    }
  };

  const runCycle = async () => {
    if (busy) return;
    busy = true;

    try {
      if (!Reader) return;
      const session = Reader.checkSessionStatus();
      if (session.expired) {
        updateUI('Sesión caducada (requiere login)', '#e02424', null, 0, false, false);
        return;
      }

      const reading = Reader.read();
      const statusRes = await sendMsg({ type: 'morning-mac-status' }).catch(() => null);
      const config = statusRes?.config || { armed: false };
      const isReady = statusRes?.configured === true;

      // Validate provisional items against shadow rules
      for (const item of reading.provisional) {
        const f = item.fields;
        const rule = globalThis.MoneyTipsShadowRules?.systems[f.system];
        const league = globalThis.MoneyTipsShadowRules?.leagues[f.competition] || f.competition;
        if (!rule?.allowedLeagues.includes(league) || !Object.hasOwn(rule.selections, f.rawSelection)) {
          reading.scan.failedRows++;
        }
      }

      const scan = Policy.fromReading(reading, { day: Safety.madridDay() }, session.expired, documentLoadedAt);
      const isFresh = Policy.fresh(scan);
      const candidates = reading.rows || [];

      // Send telemetry
      await sendMsg({
        type: 'morning-mac-health',
        health: {
          sessionExpired: session.expired,
          rowsMounted: scan.mountedRows,
          todayRows: scan.totalRows,
          candidateCount: candidates.length,
          fresh: isFresh
        }
      }).catch(() => {});

      let stateDesc = isFresh ? 'Lectura OK / Reconciliada' : 'Examinando Tablero...';
      if (!isReady) stateDesc = 'Pendiente configuración (Token)';

      updateUI(stateDesc, '#059669', scan, candidates.length, config.armed, config.autoSubmit);

      // If armed, process candidate submissions
      if (config.armed && isReady && isFresh && candidates.length > 0) {
        for (const row of candidates) {
          const kickoff = Date.parse(row.payload?.event?.kickoffAt);
          if (!Number.isFinite(kickoff) || kickoff <= Date.now() + 60_000) continue;

          // Check if still armed before each submission
          const liveStatus = await sendMsg({ type: 'morning-mac-status' }).catch(() => null);
          if (!liveStatus?.config?.armed) break;

          const submitRes = await sendMsg({
            type: 'morning-mac-submit',
            candidate: row.payload
          }).catch(err => ({ ok: false, error: err.message, state: 'uncertain' }));

          if (submitRes?.state === 'uncertain') {
            updateUI('PAUSADO: Entrega incierta (revisar)', '#e02424', scan, candidates.length, false, false);
            break;
          }
        }
      }
    } catch (err) {
      updateUI(`Error de lectura: ${err.message}`, '#e02424', null, 0, false, false);
    } finally {
      busy = false;
    }
  };

  if (document.readyState === 'complete') runCycle();
  else window.addEventListener('load', runCycle, { once: true });

  setInterval(runCycle, 6000);
})();
