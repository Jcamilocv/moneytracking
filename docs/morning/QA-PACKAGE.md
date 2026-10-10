# Morning 11/10/2026 — revisión independiente requerida

Estado para producción: **BLOCKED**. Preparación local terminada; no se ha desplegado, instalado secretos ni activado Morning. No se ha modificado, reiniciado o consultado T-5 productivo durante esta misión. La intervención manual anterior está cerrada (15/15).

Base exacta: `f8e54ff2447bc94962dc245d8aa6dea37d133935`, código desplegado tras la intervención del 10/10. No se incorpora la rama Premium pendiente (`4a733e1`/`b533637`), ni los cambios sin guardar de otros directorios. Ocho módulos de apoyo se tomaron del commit revisable Morning `19ca923`. Se contrasta además la identidad y el contrato de entrega con T5 `e17cdad`; ajustes locales descritos abajo.

## Cambios que debe revisar Vicky

| Área | Resultado propuesto |
|---|---|
| Lectura | Un GET a active-alarms, origen HTTPS fijo, redirecciones prohibidas. Máximo 200 elementos, 1 MB y 8 segundos para cabeceras y cuerpo. 108 completos se aceptan; 201, truncados, paginados o malformados se rechazan completos. |
| Horas | DateOfMatch sin zona se interpreta como UTC, según la comprobación autenticada del 10/10. Calendario y ventana se calculan en Madrid, incluidos DST. Solo 10:00–10:02; sin recuperación atrasada. |
| Entrada | Tres sistemas EARLY con tuplas observadas: ITA1 BTTS No, ENG2 visitante, Premier Under 3.5. Se exige InOddsRanges=true, sistema/competición/mercado/selección válidos, cuota válida, partido del día y margen de 60 segundos. CHA EUR sigue bloqueado por mercado no verificado; T5 y PAPER quedan excluidos. No se afirma que se hayan comprobado cuotas en una casa de apuestas. |
| Ingesta | POST limitado a una ruta y un secreto nuevo de Morning de alcance reducido, sin autorización de propietario. Todo el lote se valida antes de escribir. Hasta 50 candidatos aptos. Registro en la cola existente; la función intenta su entrega y deja el resto al dispatcher existente. Cero candidatos no escribe. |
| Idempotencia | Identidad deportiva independiente de proveedor y versión, idéntica al helper T5 comprometido e17cdad. Consulta acotada por día Madrid (máx. 201 documentos por colección, rechazo por encima de 200), reutilización de IDs históricos y cola vieja. Nada reescribe cuotas, stakes, evidencias o registros originales. |
| Entrega | Transacciones y outbox existentes: claim previo al envío, anclaje de canal/message_id. Rechazo confirmado 4xx con ok=false permite reintento 1/5/15 minutos antes del inicio. Timeout, 5xx, respuesta incoherente o pérdida del anclaje requieren revisión; no reenvío automático. Reserva de dispatcher vencida se recupera. Verificación de hora de nuevo antes de registrar/enviar. |
| Apagado | Marcador origin.kind=morning solo en entradas nuevas de Morning. Desactivar MORNING_PUBLISH_ENABLED pausa esas entradas antes de enviar; las entradas de UI/T5 quedan independientes. Pausadas no se reactivan automáticamente. |
| Premium | Aviso Telegram genérico idéntico, enlace únicamente a la portada. API de detalle/feed oculta completamente los eventos futuros a público, usuarios gratuitos, acceso vencido/revocado o token inválido. Detalle conocido y ausente producen el mismo 404. Reportar tampoco permite comprobar existencia. Cache privado/no-store y Vary Authorization. Histórico público por lista de campos; mercado, cuota, stake, source, evidencia y enlaces de eventos quedan fuera. Propietario y Premium activo mantienen el detalle. |
| VPS | Solo cinco módulos Node, sin Firebase, Telegram ni T5. Drop-in de la instancia scheduled existente, flock y sandbox heredados, timer existente solo 10:00 Madrid, Persistent=false. Preparado desactivado. Egress sigue deny-all y debe incluir únicamente las IP resueltas de los dos hosts aprobados y el DNS stub. No nuevos servicios, DB, dispatcher ni dependencias. |

Se añade un índice de officialPickQueue(status, leaseUntil) para recuperar reservas vencidas. El índice status/nextAttemptAt permanece intacto. La función admin dispone de 60 segundos; el presupuesto interno reserva tiempo para una entrega Telegram de 8 segundos. El cliente no reenvía un POST incierto.

## Evidencia local y límites

Resultados en `evidence/` (se eliminan únicamente espacios al final de líneas de salida): local-tests.tap, emulator-tests.tap, firestore-rules.tap, build.log, syntax-check.json y vps-runtime-files.txt. Datos ficticios exclusivamente. El emulador usa demo-morning-20261011 en 127.0.0.1:8080; la suite de reglas usa su proyecto ficticio histórico separado. Se simula la autenticación JWT en la suite API; comprobaciones de suscripción, handlers, consultas y transacciones son reales contra el emulador. Telegram y FutbolBrain son transportes simulados; no hay mensajes reales ni uso de credenciales.

Pruebas relevantes: 0/15/108/200/201 registros; cuerpo lento/excesivo; fallos de sesión; UTC y DST; filtros y duplicados; secret scope; tanda completa de 15 en Firestore y repetición sin envíos; carrera de tres transportes; preservación histórica; rechazos/reintentos; incertidumbre/caída tras envío; outbox T5 ya reclamado; lease vencida; pausa Morning independiente; hora cruzada durante la escritura; endpoints públicos y reportes; Premium vigente/vencido/revocado; histórico con 51 oportunidades futuras; reglas de acceso al ledger y rechazo de snapshots pendientes. Dos expectativas de pruebas antiguas se cambiaron porque exigían el partido/enlace específico públicamente; ahora se exige su ausencia.

Build superado; conserva el aviso previo de tamaño del bundle. Las reglas Firestore, código de frontend, workers T5, configuración T5 y Cloudflare no cambian. El cierre de dependencias VPS y las referencias T5 prueban compatibilidad de contrato y aislamiento del paquete; **no sustituyen una prueba independiente de regresión completa ni una validación de producción**.

No se asegura entrega exactamente una vez ante pérdida de una respuesta. La [API Telegram](https://core.telegram.org/bots/api#sendmessage) no documenta una clave de idempotencia para sendMessage; la estrategia elegida se detiene ante incertidumbre. Esto evita duplicación automática y conserva el caso para reconciliación humana.

## Reproducir sin producción

Node 22, Java 21, dependencias de package-lock.json y jar del emulador Firestore 1.22.0. Desde la raíz del paquete, con el puerto local 8080 libre:

```bash
FIRESTORE_EMULATOR_JAR=/ruta/cloud-firestore-emulator-v1.22.0.jar JAVA_BIN=/ruta/java scripts/verify-morning-local.sh
```

El script quita credenciales de su entorno de pruebas, se niega a reutilizar un puerto ocupado, inicia un emulador local propio, ejecuta pruebas/build y lo termina. Resultados nuevos en /tmp/morning-qa-local. No ejecutar publisher con configuración productiva ni habilitar variables en Vercel/VPS durante QA. Reproducir fallos de transporte mediante las pruebas; nunca usar un bot real.

## Bloqueos que deben resolverse antes de autorización

1. QA independiente de Vicky pendiente. Oficina debe coordinar revisión y devolver hallazgos con commit/archivo/línea y resultado de reproducción.
2. T5 productivo conserva su propio formatter público con partido/competición/enlace por pick. Cambiar Morning y Vercel no puede suprimir ese texto. Dirección ya recibió la solicitud de decisión: autorizar una corrección mínima y separada del formatter T5, o decidir cómo cumplir la política global sin modificar el T5 autorizado actualmente. No se ha ampliado el alcance por cuenta propia.
3. Después de QA/decisión: autorización expresa para deploy Vercel, índice, instalación de los cinco archivos VPS/drop-ins, secreto de ingesta nuevo (sin regenerar Telegram) y activación antes de 10:00 Madrid. Verificar allowlist de IP en Linux y sesión fuente vigente como preflight de la intervención aprobada; no se han consultado ni cambiado ahora.
4. La rama Premium pendiente no se despliega. Este paquete debe revisarse contra f8e54ff, especialmente compatibilidad de las nuevas restricciones API con el frontend actual. No se declara READY por resultados locales.

Procedimiento de despliegue y rollback: ROLLOUT-ROLLBACK.md. Identidad exacta del paquete y huellas: artefactos externos junto al informe de entrega.
