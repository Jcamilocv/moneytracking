# Morning Shadow — preparación local

`createMorningShadowApp()` conecta el proveedor de sesión de archivo, el cliente GET de FutbolBrain, el adaptador y el scheduler de 10:00, 13:00 y 16:00 Europe/Madrid. Construir el objeto no inicia el scheduler ni hace peticiones. Esta fase no instala unidades, cron ni credenciales en el VPS.

## Bootstrap autorizado de la sesión

El propietario debe iniciar sesión manualmente en FutbolBrain con su cuenta legítima y entregar una sesión autorizada por un canal seguro al operador. No se automatizan login, CAPTCHA ni Cloudflare. El operador debe crear un directorio privado (`0700`) y un archivo JSON privado (`0600`) propiedad del usuario de servicio. El archivo queda fuera del repositorio y contiene únicamente `origin`, `cookieHeader` y `expiresAt`. `origin` debe ser `https://application.futbolbrain.com`; `expiresAt` será `null` si Chrome no ofrece una caducidad explícita. No incluir el contenido en comandos registrados, tickets, logs o chats.

La unidad VPS fuerza `MORNING_MODE=SHADOW`; `run-shadow.mjs` rechaza cualquier otro modo antes de leer la fuente. No necesita credenciales de Firestore, Telegram ni Money Tips. El proveedor vuelve a leer el archivo en cada ejecución y verifica propietario, permisos, tamaño, origen y caducidad. Las cookies de sesión tienen `expiresAt: null`; no se inventa su caducidad. Si expira, falta o el GET devuelve 401/403, redirección o HTML, el flujo falla cerrado y requiere nuevo bootstrap manual.

## Observación y límites

El scheduler está implementado pero permanece inactivo. Al activarlo en una fase aprobada hará tres lecturas diarias; no hay polling continuo ni Playwright. El estado local conserva snapshots sanitizados, hashes, cambios de cuota/hora y nombres de campos desconocidos, nunca sus valores. Los formatos Morning de 1X2 y totales, el timezone real de `DateOfMatch` y la semántica de modificaciones de cuota siguen pendientes de un mensaje real. Los formatos no observados se rechazan.

## Instalación persistente Shadow

La release se obtiene con `git archive` del commit revisado, incluyendo solo la clausura de imports validada por `scripts/morning-shadow-runtime.mjs`, `package.json` y las unidades de `deploy/morning`. Esta clausura utiliza exclusivamente Node y módulos puros; no incluye Firebase, Telegram, publisher, queue, PAPER ni banca. No se instala `node_modules`. No se toca la instalación T-5.

La unidad template usa el usuario existente `nobody`, directorio privado `/var/lib/moneytips-morning`, lock `flock`, archivos de estado 0600 y sistema de archivos protegido. Un drop-in limita la red al resolver local y las direcciones resueltas de FutbolBrain. Si esas direcciones cambian, la lectura falla cerrada hasta revisar la lista; no se amplía automáticamente.

El timer dispara `moneytips-morning-shadow@scheduled.service` a las 10:00, 13:00 y 16:00 Europe/Madrid. `Persistent=false` evita catch-up tras reboot. La entrada admite solo los primeros tres minutos de cada ventana y registra su claim antes del GET; no repite una ventana fallida. Ambas instancias, smoke y scheduled, comparten el lock. No hay retry ni polling.

El smoke inicial se ejecuta una sola vez mediante `moneytips-morning-shadow@smoke.service`. Solo después de PASS se habilita el timer. Deshabilitar y detener el timer detiene nuevas ventanas; el servicio oneshot no tiene capacidad de activar producción.

Cada ejecución genera un registro con agregados y razones controladas. `runs.jsonl` y su única rotación quedan acotados a aproximadamente 2 MB. El estado conserva hasta 100 observaciones históricas. Para CHA/EUR se conserva evidencia técnica de mercado sin equipos, cuotas ni identificadores de partidos; ese sistema permanece rechazado hasta revisar su primer formato real. Europe/Madrid sigue siendo una hipótesis operativa para `DateOfMatch` sin offset.

Deuda: Old invalid credential remains in remote history.
