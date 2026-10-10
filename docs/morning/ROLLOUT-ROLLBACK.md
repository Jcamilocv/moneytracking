# Procedimiento preparado — no ejecutado

Objetivo de horario: domingo 11/10/2026 10:00 Europe/Madrid = 08:00 UTC. Si la aprobación, QA o preflight no están terminados antes de esa ventana, mantener SHADOW y escalar; no ejecutar tarde ni recuperar candidatos del 10/10.

## Condiciones previas

QA independiente favorable sobre el commit exacto; Dirección resuelve el formatter público T5 y aprueba expresamente cambios de producción enumerados. Confirmar que no hay otro deploy/restart concurrente. No tocar la credencial Telegram ya operativa ni desplegar 0702a93/ramas pendientes como parte de Morning.

## Despliegue propuesto tras autorización

1. Registrar deployment Vercel y hashes de código/drop-ins existentes. Conservar una copia protegida del runtime Morning que se reemplazará y sus drop-ins, excluyendo secretos y ficheros de estado. Mantener timer Morning detenido mientras se prepara, sin detener T5.
2. Crear un secreto de ingesta específico mediante entrada protegida/en memoria. Instalarlo en Vercel MORNING_PUBLISH_SECRET y en /var/lib/moneytips-morning/publish-secret (nobody:nogroup 0600, padre 0700). No ponerlo en argv, chat, Git, reportes, historial ni logs. No reutilizar ADMIN o Telegram. Mantener MORNING_PUBLISH_ENABLED=false en Vercel y en la instancia Morning.
3. Instalar exclusivamente el índice nuevo de officialPickQueue(status, leaseUntil) del archivo revisado; comprobar READY antes de activar recuperación. No desplegar reglas/otros índices/funciones por una orden genérica. No cambiar datos históricos para reparar índices.
4. Desplegar en Vercel solamente el commit aprobado basado en f8e54ff. Mantener código de Cloudflare y configuración T5. Verificar sin enviar Telegram: GET público con ID conocido futuro => mismo 404 que ausente, feed sin futuras, caché privado/no-store, Premium activo/owner autorizado conserva detalles; ingesta Morning desactivada =>503 y secreto Morning no autoriza otros modos admin. No crear picks de prueba en producción.
5. Instalar SOLO los cinco archivos listados en evidence/vps-runtime-files.txt en el runtime Morning existente, con código root y sin secretos embebidos. Conservar package.json de modo ES module. Instalar scheduled-publish.conf únicamente para la instancia @scheduled y timer-10-only.conf para el timer existente. El smoke sigue siendo el entry SHADOW existente. No crear un nuevo servicio/timer/worker.
6. Generar el drop-in de red con scripts/morning-egress-config.mjs desde un entorno de confianza en el VPS. Revisar dos hosts y direcciones IPv4/IPv6 resueltas; conservar IPAddressDeny=any, DNS stub127.0.0.53 y otras restricciones. Aplicar solo a @scheduled. No abrir egress general; fallo DNS/IP cambiante aborta el preflight y exige revisión, no degradación del sandbox.
7. Validar units con systemd-analyze verify/calendar (próxima ejecución exacta 10:00 Madrid, Persistent=false), permisos de sesión/clave/estado y compatibilidad Node. Preflight fuente: una sola lectura autorizada acotada o la comprobación existente, respetando intervalo de30min; sin envío, sin arranque publisher y sin reutilizar esa instantánea como lote futuro. Si falla sesión o lectura completa, mantener SHADOW y escalar. No intentar login/renovación silenciosa.
8. Registrar y auditar que T5 conserva hashes, ActiveState, PID/arranque y timer anteriores. Eso es inspección solamente; cero restart T5.
9. Solo con los pasos aprobados/pasados: poner MORNING_PUBLISH_ENABLED=true en Vercel (requiere deployment de configuración del mismo commit), instalar enable-after-approval.conf y recargar/rearmar el timer Morning para su próxima ejecución. No arrancar manualmente @scheduled antes/tarde. Confirmar ambos switches y la próxima hora. Tras10:00, revisar el log agregado y los anclajes reales. No declarar entrega por una simple respuesta HTTP.

## Rollback operativo seguro

Desactivar timer Morning y retirar30-approved-enable.conf. Mantener la nueva protección Premium y el outbox del deployment web, poner MORNING_PUBLISH_ENABLED=false en Vercel y activar la misma versión de código con ese valor. La ingesta rechaza nuevas tandas y el dispatcher pausa entradas nuevas origin.kind=morning antes del envío; no se reactivan automáticamente. Entradas previamente existentes de UI/T5 quedan sujetas a su flujo propio. Un envío ya iniciado requiere reconciliar su anclaje; nunca reenviarlo a ciegas.

Restaurar archivos/drop-ins previos del runtime Morning a SHADOW usando la copia de código protegida. Mantener timer desactivado hasta una decisión; no restaurar automáticamente ventanas13/16. Conservar estados, registros, anclajes y logs para auditoría. No borrar picks, revertir cuotas o alterar stakes. El índice aditivo puede permanecer; no borrar un índice utilizado por una consulta activa.

**No promover f8e54ff desnudo como rollback web:** volvería a revelar oportunidades futuras y a usar la identidad/entrega anteriores. Si falla el nuevo deployment completo, congelar Morning y mantener las rutas públicas de picks cerradas mediante una revisión de protección mínima, aprobada aparte y conservando outbox/identidad. Preparar ese cambio específico según el fallo real y verificarlo antes de promocionar. No recurrir a la rama Premium pendiente ni modificar T5 para recuperar Morning.
