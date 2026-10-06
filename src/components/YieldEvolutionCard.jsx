import React from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const formatYield = value => `${Number(value).toFixed(2)}%`;

export default function YieldEvolutionCard({ data, period, theme }) {
    const isDark = theme === 'dark';
    const accent = isDark ? '#5EE6B1' : '#2563EB';
    const muted = isDark ? '#64748b' : '#94a3b8';
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    return (
        <div className="dashboard-analytics-yield bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-5 flex flex-col relative shadow-sm transition-colors w-full" aria-label="Evolución del Yield">
            <div className="flex justify-between items-center mb-4 gap-3">
                <h4 className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider">Evolución del Yield</h4>
                <span className="text-[10px] text-[var(--text-muted)]">Por {period === 'monthly' ? 'mes' : 'semana'}</span>
            </div>
            <div className="min-h-0 flex-1">
                {!data?.length ? (
                    <p className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">Aún no hay apuestas resueltas.</p>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false}/>
                            <XAxis dataKey="name" stroke={muted} tick={{fontSize:10, fill:muted}} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
                            <YAxis domain={[min => Math.min(min, 0), max => Math.max(max, 0)]} stroke={muted} tick={{fontSize:10, fill:muted}} tickLine={false} axisLine={false} tickFormatter={value => `${Number(value).toFixed(1)}%`} width={48}/>
                            <ReferenceLine y={0} stroke={muted} strokeOpacity={0.6} strokeDasharray="3 3"/>
                            <Tooltip
                                contentStyle={{backgroundColor: isDark ? 'rgba(17,22,33,0.95)' : 'rgba(255,255,255,0.95)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderRadius:8, fontSize:12}}
                                itemStyle={{color:accent, fontWeight:'bold', fontSize:12}}
                                labelStyle={{color:isDark ? '#F1F5F9' : '#0F172A', fontSize:10, fontWeight:'bold'}}
                                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ''}
                                formatter={value => [formatYield(value), 'Yield']}
                            />
                            <Line type="monotone" dataKey="yield" stroke={accent} strokeWidth={2.5} dot={false} activeDot={{r:5, fill:accent}}/>
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
