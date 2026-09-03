# Money Tips Pick Ledger — arquitectura propuesta

**Estado:** diseño; no implementado ni desplegado.

## Decisión de cumplimiento

No se automatizará la lectura ni la republicación de picks de FutbolBrain/Futbolpractice mientras no exista autorización escrita del proveedor o una API/webhook autorizado. Sus términos publicados reservan el contenido para uso personal, no comercial y prohíben compartir la información recibida con terceros.

El sistema se construirá para recibir únicamente una de estas fuentes:

1. una API o webhook que el proveedor haya autorizado por escrito;
2. un feed o proveedor de datos con licencia para distribución;
3. un modelo/dataset propio de Money Tips.

La fuente será sustituible. La parte pública de Money TracKING no debe conocer credenciales ni sesiones del proveedor.

## Objetivo

Publicar un pick oficial según una política explícita, con una prueba verificable de cuándo y con qué datos se publicó; notificar a los usuarios y permitirles añadirlo con un clic a una de sus bancas.

### Políticas de publicación

1. `t_minus_5`: para sistemas cuya cuota de entrada debe comprobarse cerca del inicio. El candidato se publica cinco minutos antes del partido.
2. `immediate`: para sistemas sin un requisito de cuota. El candidato se publica en cuanto llega desde una fuente autorizada, siempre antes del inicio del partido.

La política se conserva en el registro oficial y nunca se deduce a posteriori a partir del resultado.

## Separación de responsabilidades

```text
Fuente autorizada
       |
       v
Ingestor aislado -> candidatePicks (privado)
       |                 |
       |                 +-> evidencia: hash + observación UTC + versión de sistema
       v
Planificador T-5 -> validación final -> Official Pick Ledger (servidor)
                                               |
                     +-------------------------+--------------------------+
                     |                                                    |
                     v                                                    v
              Bot de Telegram                                    Web push / PWA
                     |                                                    |
                     +--------------------> ficha del pick <-------------+
                                                       |
                                                       v
                                         copia individual a users/{uid}/bets
```

## Publicación autónoma y a prueba de fallos

1. El ingestor observa la fuente autorizada y crea un `candidatePick`; nunca publica directamente.
2. Cada candidato incluye el inicio en UTC, mercado, selección, cuota fuente, probabilidad, `systemId`, `systemVersion`, hora observada y un hash SHA-256 de la evidencia normalizada.
3. El planificador calcula `scheduledAt = kickoffAt - 5 minutos` para `t_minus_5`; para `immediate`, el candidato queda listo en su hora de observación.
4. En `scheduledAt` o al recibir un candidato `immediate`, el publicador aplica la validación disponible para la fuente autorizada. Si falta, cambia, llega tarde o el monitor ha fallado, **no publica**.
5. La escritura del pick oficial es transaccional e idempotente mediante la clave `eventId + market + selection + systemVersion`. Una repetición nunca crea un segundo pick.
6. Solo tras confirmar la escritura, se envían las notificaciones. Si el envío falla, se reintenta sin modificar el registro oficial.
7. Las correcciones, anulaciones y resultados son eventos nuevos que enlazan al pick original; no se reescribe el registro publicado.

## Modelo de datos propuesto

### `officialPicks/{officialPickId}`

Documento escrito exclusivamente por Admin SDK en servidor:

```json
{
  "schemaVersion": 1,
  "status": "published",
  "idempotencyKey": "event-market-selection-system-version",
  "event": {
    "sourceEventId": "...",
    "competition": "...",
    "homeTeam": "...",
    "awayTeam": "...",
    "kickoffAt": "timestamp UTC"
  },
  "bet": {
    "market": "...",
    "selection": "...",
    "oddsAtPublication": 0,
    "stakeUnits": 1
  },
  "system": { "id": "...", "version": "..." },
  "source": {
    "provider": "approved-provider",
    "observedAt": "timestamp UTC",
    "evidenceHash": "sha256..."
  },
  "publishedAt": "server timestamp",
  "scheduledAt": "timestamp UTC",
  "publisherRunId": "..."
}
```

### `officialPicks/{officialPickId}/events/{eventId}`

Ledger de auditoría append-only: `published`, `notificationSent`, `correction`, `void`, `settled`. Cada evento incorpora `createdAt` de servidor y su hash encadenado con el evento anterior.

### `users/{uid}/bets/{betId}`

La copia que crea cada usuario mantiene sus campos actuales e incorpora:

```json
{
  "officialPickId": "...",
  "officialPublishedAt": "timestamp UTC",
  "copiedAt": "server timestamp",
  "copiedOdds": 0
}
```

La cuota de la copia es la cuota que el usuario introduzca/obtenga al apostar; no altera la cuota original publicada.

## Reglas de seguridad

- `officialPicks` y su subcolección de eventos: lectura pública o autenticada según la interfaz; **create/update/delete de cliente siempre denegados**.
- Solo una función con Firebase Admin SDK puede crear el ledger, publicar, corregir o liquidar.
- La copia de pick sigue las reglas actuales: cada usuario solo escribe dentro de `users/{uid}`.
- Los secretos viven en el entorno del servidor correspondiente. Nunca en navegador, repositorio, Firebase client config ni Vercel si pertenecen al navegador persistente de una fuente externa.
- Registro de auditoría sin datos de sesión, cookies, contraseñas ni tokens del proveedor.

## Operación técnica

- **Ingestor:** worker persistente fuera de Vercel si la fuente lo requiere, con cuenta de servicio y secretos cifrados. No se inicia hasta recibir permiso escrito de la fuente.
- **Planificador/publicador:** función Vercel + Firestore Admin SDK. Vercel Pro permite ejecuciones por minuto, pero no garantiza una precisión de segundos ni reintenta cron fallidos; por eso se usa bloqueo distribuido, idempotencia y un worker que dispara el publicador por HTTP para el requisito T-5.
- **Cola:** tareas duraderas con reintento y dead-letter queue para `publish`, `notifyTelegram`, `notifyWebPush` y `settle`.
- **Telegram propio:** bot de Money Tips con token de servidor. Mensaje con enlace profundo a la ficha del pick; el bot no recibe ni necesita credenciales de FutbolBrain.
- **Web push:** permiso por usuario en la PWA. Es un segundo canal; Telegram sigue siendo el canal principal al inicio.
- **Observabilidad:** alerta privada al propietario solo para `skipped`, fallo de verificación, fallo de publicación o desfase superior a 60 segundos. No exige aprobar picks.

## Fases de implantación

### Fase 0 — permiso y fuente

Obtener del proveedor una confirmación escrita de API/webhook o autorización de automatización y distribución. Sin esto se puede avanzar únicamente con fuente propia o de un proveedor licenciado.

### Fase 1 — ledger, cola y ficha pública

Crear `officialPicks`, una cola privada con políticas `t_minus_5` e `immediate`, sus reglas de solo servidor, vista pública de prueba y acción “Añadir a mi banca”. Pruebas con picks sintéticos, sin notificar a usuarios.

### Fase 2 — shadow mode

Durante dos jornadas, el publicador registra internamente qué habría hecho a T-5 sin difundir nada. Se miden puntualidad, duplicados, cambios de cuota y fallos.

### Fase 3 — Telegram y PWA

Activar envío al canal/bot propio y las notificaciones web. La publicación queda primero confirmada en Firestore y luego notificada.

### Fase 4 — automatización de fuente autorizada

Con la autorización de la fuente, conectar el ingestor y activar el modo automático. Mantener interruptor global `autoPublishingEnabled` y lista explícita de sistemas permitidos.

## Criterios de salida a producción

- 100% de las publicaciones de shadow mode dentro de 5 minutos +/- 60 segundos.
- Cero duplicados y cero picks tardíos publicados.
- La página pública muestra `publishedAt` de servidor, datos del pick y hash de evidencia.
- Un usuario de prueba puede copiar un pick sin editar el documento oficial.
- Simulación verificada de fallo de fuente, repetición de tarea y fallo de Telegram.
- Autorización documental de la fuente archivada antes de activar la integración.

## Qué podemos construir ya

Sin esperar a FutbolBrain, se puede implementar Fase 1 y probar todo con una fuente propia controlada. La única pieza que queda bloqueada es la ingestión automática de datos de FutbolBrain.

## Implementación local de Fase 1

La primera parte ya está construida localmente, sin publicar ni crear documentos reales:

- `api/admin/official-picks` crea un pick únicamente con `FIREBASE_SERVICE_ACCOUNT_JSON` y `OFFICIAL_PICKS_ADMIN_SECRET` presentes en el entorno de servidor.
- `api/official-picks` sirve la lista y los comprobantes públicos saneados; la aplicación cliente no accede directamente al ledger.
- La pantalla **Picks Money Tips** permite copiar un pick en la banca individual seleccionada con stake inicial del 1% y enlaza su comprobante.
- Las reglas de Firestore deniegan toda lectura y escritura de navegador en `officialPicks`; Firebase Admin SDK queda como único escritor.

Antes de un despliegue se deberán generar el secreto de administrador en Vercel Production, publicar las reglas y hacer una prueba con un pick sintético. No se añadirá ninguna credencial de proveedor externo.
