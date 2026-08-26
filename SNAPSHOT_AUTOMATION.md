# Actualización automática de históricos públicos

## Qué hace

Cada día a las 04:17 UTC, Vercel puede revisar las cuatro fuentes oficiales de Money TracKING. Si el contenido saneado ha cambiado, publica un nuevo snapshot inmutable y actualiza el registro interno de la versión vigente. Si no ha cambiado, no escribe nada en Firestore.

La web principal consulta `GET /api/official-snapshots` y conserva como respaldo los cuatro enlaces ya publicados si el servicio no está disponible.

## Activación segura

1. En Google Cloud Console, crear una cuenta de servicio dedicada, por ejemplo `moneytracking-snapshots`.
2. Otorgarle únicamente el rol `Cloud Datastore User` en el proyecto `money-tracking-d908b`.
3. Crear una clave JSON para esa cuenta, copiar el JSON completo y guardarlo en Vercel como variable sensible `FIREBASE_SERVICE_ACCOUNT_JSON` **solo en Production**.
4. Añadir en Vercel, también solo en Production:
   - `OFFICIAL_SNAPSHOT_OWNER_UID`: el UID de la cuenta propietaria de los históricos.
   - `CRON_SECRET`: valor aleatorio largo.
   - `SNAPSHOT_AUTOMATION_ENABLED`: `true`.
5. Desplegar Money TracKING y llamar una vez al endpoint de cron con la cabecera `Authorization: Bearer <CRON_SECRET>` para una primera publicación controlada.

No usar una contraseña de Google/Firebase ni una API key de cliente para este proceso. La clave de la cuenta de servicio no debe llegar al navegador, al repositorio ni a la web principal.

## Operación

- El cron queda programado una vez al día y no hace nada mientras `SNAPSHOT_AUTOMATION_ENABLED` no sea `true`.
- Los snapshots previos no se modifican ni se eliminan automáticamente.
- El proceso rechaza publicar más de 5.000 apuestas por histórico para mantener compatibilidad con el esquema público actual.
- Ante un error, el registro vigente no se sustituye: la web continúa mostrando el último histórico válido.
