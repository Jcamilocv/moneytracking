// Development-only visual fixture. No App/Firebase import, credentials, or network writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import YieldEvolutionCard from '../src/components/YieldEvolutionCard.jsx';
import { aggregatePeriodYield, calculateYieldPercent } from '../src/lib/yield.js';
import '../src/index.css';
import './dashboard.css';

const formatCurrency = value => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

const deltas = Array.from({ length: 72 }, (_, index) => {
  const wave = Math.sin(index * 0.49) * 90;
  const shortDownturn = index >= 24 && index < 28 ? -200 : 0;
  const recovery = index >= 28 && index < 44 ? 25 : 0;
  return Math.round(115 + wave + shortDownturn + recovery);
});
let runningProfit = 0;
const detailedChart = deltas.map((delta, index) => ({
  name: String(index + 1),
  profit: (runningProfit += delta),
  fullLabel: `Pick ${index + 1}`,
}));
const weeklyChart = Array.from({ length: 18 }, (_, index) => ({
  name: `S${index + 1}`,
  fullLabel: `Semana ${index + 1}`,
  profit: detailedChart[Math.min(index * 4 + 3, detailedChart.length - 1)].profit,
}));
const weeklyBarChart = weeklyChart.map((week, index) => ({
  name: week.name,
  profit: index === 0 ? week.profit : week.profit - weeklyChart[index - 1].profit,
}));
const monthlyBarChart = Array.from({ length: 6 }, (_, index) => ({
  name: `M${index + 1}`,
  profit: weeklyBarChart.slice(index * 3, index * 3 + 3).reduce((sum, week) => sum + week.profit, 0),
}));
const sampleStake = 4000;
const settledResults = deltas.map((profit, index) => ({
  weekKey: `2026-W${String(Math.floor(index / 4) + 1).padStart(2, '0')}`,
  monthKey: `2026-${String(Math.floor(index / 12) + 1).padStart(2, '0')}`,
  profit,
  stake: sampleStake,
}));
const weeklyYieldChart = aggregatePeriodYield(settledResults, 'weekKey').map(point => ({...point, name: `S${Number(point.key.slice(-2))}`, fullLabel: `Semana ${point.key}`}));
const monthlyYieldChart = aggregatePeriodYield(settledResults, 'monthKey').map(point => ({...point, name: `M${Number(point.key.slice(-2))}`, fullLabel: `Mes ${point.key}`}));
const sampleYield = calculateYieldPercent(detailedChart.at(-1).profit, deltas.length * sampleStake);
const sampleProfit = detailedChart.at(-1).profit;
const sampleWon = deltas.filter(delta => delta > 0).length;
const sampleLost = deltas.length - sampleWon;
const sampleGrossWin = deltas.filter(delta => delta > 0).reduce((sum, delta) => sum + delta, 0);
const sampleGrossLoss = -deltas.filter(delta => delta < 0).reduce((sum, delta) => sum + delta, 0);

const metrics = [
  ['Picks', String(deltas.length), 'Total'],
  ['Ganados', String(sampleWon), '', 'accent'],
  ['U. APOSTADAS', `${((deltas.length * sampleStake) / 1000).toFixed(2)} u`],
  ['Beneficio/Día', formatCurrency(sampleProfit / deltas.length), '', 'accent'],
  ['Factor de Beneficio', sampleGrossLoss > 0 ? (sampleGrossWin / sampleGrossLoss).toFixed(2) : '—'],
  ['Tasa de Acierto', `${((sampleWon / deltas.length) * 100).toFixed(2)}%`],
  ['Perdidos', String(sampleLost), '', 'red'],
  ['U. GANADAS (NETO)', `${(sampleProfit / 1000).toFixed(2)} u`, '', 'accent'],
  ['Beneficio/Pick', formatCurrency(sampleProfit / deltas.length), '', 'accent'],
  ['Yield', `${sampleYield.toFixed(2)}%`, '', sampleYield >= 0 ? 'accent' : 'red'],
];

const tooltipStyle = {
  backgroundColor: 'rgba(17,22,33,.96)',
  border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 8,
  color: '#f1f5f9',
  fontSize: 12,
};
const axisStroke = '#64748b';
const gridStroke = 'rgba(255,255,255,.05)';

function DashboardHarness() {
  const [bank, setBank] = useState('Money Tips 25/26');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [chartMode, setChartMode] = useState('detailed');
  const [temporalMode, setTemporalMode] = useState('weekly');
  return (
    <div className="harness-shell">
      <aside className="harness-sidebar" aria-label="Navegación de muestra">
        <div className="harness-brand">Money<span>TracKING</span></div>
        <div className="harness-nav">▦ <span>Panel de Control</span></div>
      </aside>
      <main className="harness-main">
        <header className="harness-topbar">
          <div className="harness-title">Panel de Control</div>
          <select className="harness-select" aria-label="Seleccionar banca" value={bank} onChange={event => setBank(event.target.value)}>
            <option>Money Tips 25/26</option>
            <option>Banca personal</option>
          </select>
        </header>
        <div className="harness-content">
          <div className="harness-review-label">Vista de revisión · datos ficticios · sin conexión a Firebase</div>
          <div className="harness-section-head">
            <h2>Rendimiento General</h2>
            <button type="button" className="harness-button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>☷ Filtros Avanzados {filtersOpen ? '⌃' : '⌄'}</button>
          </div>
          {filtersOpen && <div className="harness-filters" aria-label="Filtros avanzados de muestra">
            <label>Desde fecha<input type="date" defaultValue="2026-01-01" /></label>
            <label>Hasta fecha<input type="date" defaultValue="2026-10-04" /></label>
            <label>Cuota mínima<input type="number" defaultValue="1.4" step="0.01" /></label>
            <label>Estrategia<select defaultValue="Todas"><option>Todas</option><option>Machine Learning</option></select></label>
            <label>Deporte<select defaultValue="Fútbol"><option>Fútbol</option></select></label>
          </div>}

          <div className="dashboard-analytics-layout">
            <section className="dashboard-analytics-hero" aria-label="Beneficio total">
              <div className="dashboard-analytics-hero-label">Beneficio Total ({bank})</div>
              <div className="dashboard-analytics-total">{formatCurrency(detailedChart.at(-1).profit)}</div>
            </section>

            <section className="dashboard-analytics-kpis" aria-label="Indicadores de rendimiento">
              {metrics.map(([label, value, sub, tone]) => <div className="harness-kpi" key={label}>
                <div className="harness-kpi-label" title={label}>{label}</div>
                <div><div className={`harness-kpi-value ${tone ? `harness-${tone}` : ''}`}>{value}</div>{sub && <div className="harness-muted" style={{fontSize: 9}}>{sub}</div>}</div>
              </div>)}
            </section>

            <div className="dashboard-analytics-charts">
              <section className="dashboard-analytics-profit" aria-label="Evolución del beneficio">
                <div className="harness-chart-head">
                  <h3>Evolución del Beneficio</h3>
                  <div className="harness-chart-controls" role="group" aria-label="Periodo de evolución">
                    <button type="button" aria-pressed={chartMode === 'detailed'} onClick={() => setChartMode('detailed')}>Picks</button>
                    <button type="button" aria-pressed={chartMode === 'weekly'} onClick={() => setChartMode('weekly')}>Semanas</button>
                  </div>
                </div>
                <div className="harness-chart-body">
                  <ResponsiveContainer width="100%" height="100%">
                    {chartMode === 'detailed' ? <AreaChart data={detailedChart} margin={{top: 8,right: 10,bottom: 0,left: 0}}>
                      <defs><linearGradient id="harnessProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#5EE6B1" stopOpacity={0.4}/><stop offset="95%" stopColor="#5EE6B1" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false}/>
                      <XAxis dataKey="name" stroke={axisStroke} tick={{fontSize: 10,fill:axisStroke}} tickLine={false} axisLine={false}/>
                      <YAxis stroke={axisStroke} tick={{fontSize: 10,fill:axisStroke}} tickLine={false} axisLine={false}/>
                      <Tooltip contentStyle={tooltipStyle} formatter={value => [formatCurrency(value), 'Beneficio']} labelFormatter={label => `Pick ${label}`}/>
                      <Area type="monotone" dataKey="profit" stroke="#5EE6B1" strokeWidth={3} fill="url(#harnessProfit)"/>
                    </AreaChart> : <LineChart data={weeklyChart} margin={{top: 8,right: 10,bottom: 0,left: 0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false}/>
                      <XAxis dataKey="name" stroke={axisStroke} tick={{fontSize: 10,fill:axisStroke}} tickLine={false} axisLine={false}/>
                      <YAxis stroke={axisStroke} tick={{fontSize: 10,fill:axisStroke}} tickLine={false} axisLine={false}/>
                      <Tooltip contentStyle={tooltipStyle} formatter={value => [formatCurrency(value), 'Beneficio']} labelFormatter={label => `Semana ${label.slice(1)}`}/>
                      <Line type="linear" dataKey="profit" stroke="#5EE6B1" strokeWidth={3} dot={{r:3,fill:'#5EE6B1'}} activeDot={{r:6}}/>
                    </LineChart>}
                  </ResponsiveContainer>
                </div>
              </section>

              <div className="dashboard-analytics-lower">
                <section className="dashboard-analytics-temporal" aria-label="Rendimiento temporal">
                  <div className="harness-chart-head">
                    <h3>Rendimiento Temporal</h3>
                    <div className="harness-chart-controls" role="group" aria-label="Periodo temporal">
                      <button type="button" aria-pressed={temporalMode === 'weekly'} onClick={() => setTemporalMode('weekly')}>Semana</button>
                      <button type="button" aria-pressed={temporalMode === 'monthly'} onClick={() => setTemporalMode('monthly')}>Mes</button>
                    </div>
                  </div>
                  <div className="harness-chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={temporalMode === 'weekly' ? weeklyBarChart : monthlyBarChart} margin={{top:8,right:8,bottom:0,left:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false}/>
                        <XAxis dataKey="name" stroke={axisStroke} tick={{fontSize:10,fill:axisStroke}} tickLine={false} axisLine={false}/>
                        <YAxis stroke={axisStroke} tick={{fontSize:10,fill:axisStroke}} tickLine={false} axisLine={false}/>
                        <Tooltip contentStyle={tooltipStyle} formatter={value => [formatCurrency(value), 'Beneficio']}/>
                        <Bar dataKey="profit" radius={[4,4,0,0]}>{(temporalMode === 'weekly' ? weeklyBarChart : monthlyBarChart).map((entry,index) => <Cell key={index} fill={entry.profit >= 0 ? '#5EE6B1' : '#FF5A5F'}/>)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <YieldEvolutionCard data={temporalMode === 'weekly' ? weeklyYieldChart : monthlyYieldChart} period={temporalMode} theme="dark" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<DashboardHarness />);

export default DashboardHarness;
