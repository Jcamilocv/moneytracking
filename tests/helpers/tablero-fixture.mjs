// Synthetic DOM subset built from the CEO's sanitized tree, NOT provider HTML or browser QA.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
export const root = new URL('../../extensions/morning-mac-assisted/', import.meta.url);
export const code = name => readFileSync(new URL(name, root), 'utf8');
export const fixed = Date.parse('2026-07-15T08:01:00Z');
export const systems = [
  ['MT - CHA EUR - V1.0', 'EUR-Champions-League', 'No'],
  ['MT - ENG2 - v1.0', 'ENG-Championship', 'Team 2 (FT)'],
  ['MT - ITA1 - V1.0', 'ITA-Serie A', 'No'],
  ['MT - Premier League 02.5', 'ENG-Premier League', 'Under 3.5']
];
export class Element {
  constructor(tag, value = '', attrs = {}) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.own = value; this.attrs = { ...attrs };
    this.children = []; this.parentElement = null; this.hidden = !!attrs.hidden;
    this.style = { display: 'block', visibility: 'visible', overflowY: 'visible', maxHeight: '' };
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  get textContent() { return [this.own, ...this.children.map(node => node.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this.own = String(value); this.children = []; }
  get innerText() { return this.textContent; }
  get className() { return this.attrs.class || ''; }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? String(this.attrs[name]) : null; }
  querySelectorAll(selector) {
    const matches = node => selector.split(',').some(item => {
      item = item.trim(); if (item === '*') return true;
      if (item === 'input[type="password"]') return node.tagName === 'INPUT' && node.attrs.type === 'password';
      return node.tagName === item.toUpperCase();
    });
    const result = []; const walk = node => { for (const child of node.children) { if (matches(child)) result.push(child); walk(child); } };
    walk(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener() {}
}
export const e = (tag, value = '', attrs = {}, ...nodes) => { const node = new Element(tag, value, attrs); node.append(...nodes); return node; };
export function row(i = 0, changes = {}) {
  const [id, league, selection] = systems[i % 4];
  const record = { i, date: '15/07/2026 21:00', league, selection, odds: '2.40', system: id, ...changes };
  const home = `SYNTHETIC_HOME_${record.i}`, away = `SYNTHETIC_AWAY_${record.i}`;
  const match = `${home} vs ${away}`;
  const fixture = e('div', '', {}, e('span', home, { title: match }), e('span', 'vs'), e('span', away, { title: match }));
  const cells = [e('td', record.date), e('td', record.league), e('td', '', {}, fixture), e('td', record.selection),
    e('td', record.odds), e('td', '', {}, e('div', record.system, { title: record.system })), e('td', '55.00%'), e('td')];
  return e('tr', '', { class: 'tw-table tw-w-full tw-table-fixed' }, ...cells);
}
export function fixture(options = {}) {
  const rows = options.rows || systems.map((_, i) => row(i));
  const body = e('body'), headerRow = e('tr', '', {}, ...['Fecha', 'Liga', 'Partido', 'Mercado', 'Cuota', 'Sistema', 'Probabilidad del Pick', 'Advertencia'].map(label => e('th', label)));
  const header = e('table', '', {}, e('thead', '', {}, headerRow));
  const dataBody = e('tbody', '', { class: 'tw-text-text' }, ...rows), table = e('table', '', {}, dataBody);
  const scroll = e('div', '', { class: 'tw-overflow-auto tw-h-full' }, table); scroll.style.maxHeight = '30vh'; scroll.style.overflowY = 'auto';
  const outer = e('table', '', { class: 'tw-w-full tw-min-w-[480px]' }, e('tbody', '', {}, e('tr', '', {}, e('td', '', {}, header)), e('tr', '', {}, e('td', '', {}, scroll))));
  const heading = e('h2', `Picks Activos (Hoy ${options.hoy ?? 999})`), section = e('section', '', {}, heading, outer);
  body.append(section, e('section', '', {}, e('h2', 'Tus Sistemas Activos'), e('table', '', {}, e('tbody', '', {}, e('tr', '', {}, e('td', 'UNRELATED_SYNTHETIC'))))));
  if (options.hiddenUnder) outer.attrs.hideUnder = options.hiddenUnder;
  if (options.loading) section.append(e('div', '', { class: 'skeleton' }));
  const document = { body, readyState: 'complete', createElement: tag => e(tag), querySelectorAll: selector => body.querySelectorAll(selector),
    querySelector: selector => body.querySelector(selector), addEventListener() {} };
  return { body, section, heading, outer, headerRow, header, dataBody, table, scroll, document };
}
let sequence = 0;
export function realm(options = {}) {
  const dom = fixture(options), clock = { now: options.now ?? fixed }, timers = [], storage = options.storage || {}, operations = [], tripwire = [];
  class DateFixed extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const location = { pathname: options.path || '/dashboard' };
  const chrome = { runtime: { lastError: null, sendMessage() { tripwire.push('sendMessage'); throw Error('FORBIDDEN'); } }, storage: { local: {
    get(keys, callback) { operations.push({ op: 'get', keys }); if (options.failStorage) chrome.runtime.lastError = { message: 'synthetic' }; callback(Object.fromEntries(keys.map(key => [key, storage[key]]))); chrome.runtime.lastError = null; },
    set(value, callback) { operations.push({ op: 'set', keys: Object.keys(value) }); if (options.failStorage) chrome.runtime.lastError = { message: 'synthetic' }; else Object.assign(storage, structuredClone(value)); callback(); chrome.runtime.lastError = null; },
    getKeys(callback) { callback(Object.keys(storage)); }
  } } };
  const forbidden = name => () => { tripwire.push(name); throw Error('FORBIDDEN'); };
  const context = vm.createContext({ Date: DateFixed, Intl, TextEncoder, crypto: { randomUUID: () => `synthetic-document-${++sequence}`, subtle: webcrypto.subtle }, location, chrome,
    document: dom.document, navigator: { onLine: options.online !== false },
    getComputedStyle: node => ({ ...node.style, display: node.attrs.hideUnder && (options.width ?? 1400) < node.attrs.hideUnder ? 'none' : node.style.display }),
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval() {}, window: { addEventListener() {} },
    fetch: forbidden('fetch'), XMLHttpRequest: forbidden('XMLHttpRequest'), WebSocket: forbidden('WebSocket'), EventSource: forbidden('EventSource'), Notification: forbidden('Notification') });
  for (const file of ['safety.js', 'rules.js', 'reader-core.js']) vm.runInContext(code(file), context);
  return { ...dom, context, clock, storage, operations, tripwire, timers, location,
    read: () => context.MoneyTipsShadowReader.read(), observe: () => vm.runInContext(code('observer.js'), context),
    async settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); await context.MoneyTipsShadowTableroObservation.flush().catch(() => {}); },
    metadata: () => context.MoneyTipsShadowTableroObservation.metadata() };
}
export const plain = value => JSON.parse(JSON.stringify(value));
