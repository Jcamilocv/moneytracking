import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const yieldCard = readFileSync(new URL('../src/components/YieldEvolutionCard.jsx', import.meta.url), 'utf8');

test('el Dashboard integra hero, diez KPI y dos gráficos secundarios', () => {
    const dashboard = app.split("{activeTab === 'dashboard' && activeBankData && (")[1]?.split("{activeTab === 'bets' && (")[0];
    assert.ok(dashboard);
    assert.match(dashboard, /dashboard-analytics-hero/);
    assert.match(dashboard, /dashboard-analytics-profit/);
    assert.match(dashboard, /dashboard-analytics-temporal/);
    assert.match(dashboard, /<YieldEvolutionCard /);
    assert.equal((dashboard.match(/<StatCard /g) || []).length, 10);
});

test('la evolución del Yield conserva la precisión acordada', () => {
    assert.match(yieldCard, /tickFormatter=\{value => `\$\{Number\(value\)\.toFixed\(1\)\}%`\}/);
    assert.match(yieldCard, /const formatYield = value => `\$\{Number\(value\)\.toFixed\(2\)\}%`/);
});

test('el shell usa el ancho disponible sin quitar la navegación vigente', () => {
    assert.match(css, /#root\s*\{[^}]*width:\s*100%/);
    assert.doesNotMatch(css, /width:\s*1126px/);
    assert.match(app, /max-w-\[2000px\]/);
    for (const label of ['Mis Apuestas', 'Picks Money Tips', 'Publicar pick', 'Balances', 'Configuración', 'Personalización']) {
        assert.ok(app.includes(label), `${label} debe seguir en la app`);
    }
});
