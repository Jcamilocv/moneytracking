const CONFIG_KEY = 'moneyTipsMorningMacConfigV1';
const CLAIMS_KEY = 'moneyTipsMorningMacClaimsV1';
const DEFAULT_ENDPOINT = 'https://app.pronosticosmoneytips.com/api/internal/futbolbrain-local-picks';

const endpointInput = document.getElementById('endpoint');
const tokenInput = document.getElementById('token');
const armedInput = document.getElementById('armed');
const autoSubmitInput = document.getElementById('autoSubmit');
const statusMsg = document.getElementById('status-msg');
const claimsView = document.getElementById('claims-view');
const form = document.getElementById('config-form');

chrome.storage.local.get([CONFIG_KEY, CLAIMS_KEY], data => {
  const c = data[CONFIG_KEY] || {};
  endpointInput.value = c.endpoint || DEFAULT_ENDPOINT;
  tokenInput.value = c.token || '';
  armedInput.checked = c.armed === true;
  autoSubmitInput.checked = c.autoSubmit === true;

  const claims = data[CLAIMS_KEY] || {};
  claimsView.textContent = Object.keys(claims).length > 0
    ? JSON.stringify(claims, null, 2)
    : 'No hay envíos registrados hoy en este navegador.';
});

form.addEventListener('submit', e => {
  e.preventDefault();
  const endpoint = endpointInput.value.trim();
  const token = tokenInput.value.trim();
  const armed = armedInput.checked;
  const autoSubmit = autoSubmitInput.checked;

  if (!endpoint) {
    statusMsg.className = 'status-msg status-error';
    statusMsg.textContent = 'El endpoint es obligatorio.';
    return;
  }

  chrome.storage.local.set({
    [CONFIG_KEY]: { endpoint, token, armed, autoSubmit }
  }, () => {
    if (chrome.runtime.lastError) {
      statusMsg.className = 'status-msg status-error';
      statusMsg.textContent = 'Error al guardar en storage local.';
    } else {
      statusMsg.className = 'status-msg status-success';
      statusMsg.textContent = 'Configuración guardada correctamente.';
      setTimeout(() => { statusMsg.textContent = ''; }, 3000);
    }
  });
});
