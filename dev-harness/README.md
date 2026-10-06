# Dashboard visual harness (solo desarrollo)

Abre `http://127.0.0.1:5173/dev-harness/dashboard.html` tras iniciar el servidor local de Vite (o usa el puerto que Vite indique si 5173 está ocupado).

Esta página usa datos sintéticos calculados para el visor y reproduce la jerarquía visual del Dashboard para revisión de diseño. Importa el CSS raíz y el componente Yield reales de la integración basada en `821be90`; su barra lateral de muestra mide los mismos 256 px que la real. No importa `src/App.jsx`, no inicializa Firebase y no lee ni escribe datos reales. La compilación normal (`npm run build`) solo incluye `index.html`; este harness no forma parte de `dist`.

El selector Semana/Mes de Rendimiento temporal actualiza también Evolución del Yield. Los controles de banca, filtros y gráficas funcionan únicamente sobre la maqueta. No validan la lógica de producción ni sus permisos. La navegación simplificada de esta página no sustituye a la navegación real de Money TracKING.
