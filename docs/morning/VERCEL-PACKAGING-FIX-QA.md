# Corrección de empaquetado Vercel — nueva QA necesaria

Base exacta: bed595036f17459907f8583a857b27cb571aec8f, previamente aprobada por Vicky.

El intento preparado de producción dpl_E5t1MgKP2xA6NJmGsvuBpQAWqjJM falló con exceeded_serverless_functions_per_deployment: 14 funciones frente al máximo 12 del plan existente. Build completado; nunca se promovió al dominio.

Esta corrección renombra únicamente los dos módulos nuevos a api/lib/_timezone.js y api/lib/_telegram-delivery.js, y actualiza tres importaciones de runtime y una de prueba. Ambos módulos mantienen contenido byte a byte. No cambia lógica, cuotas, stakes, sistemas, privacidad, identidad deportiva, permisos, cola, rutas reales o cron. Los otros siete auxiliares heredados permanecen como antes; no se realiza una reorganización general.

Verificación LOCAL de esta versión: 92/92 pruebas + 5/5 interoperabilidad real entre el Morning corregido y T-5 aprobado, build Vite PASS, build real de Vercel PASS con 12 funciones y dependencias auxiliares incluidas en las funciones que las importan. El build local usa metadatos existentes y un archivo ignorado con solo MORNING_PUBLISH_ENABLED=false; no solicita pull de secretos ni se despliega. Ver docs/morning/packaging-evidence/.

La QA anterior no se atribuye a esta nueva revisión. Revisión independiente de Vicky y decisión de Dirección pendientes. No promover sin resolver este bloqueo.

Estado productivo al parar: T-5 tiene solo el formatter aprobado ede40b7, activo y escuchando tras recarga autorizada; credencial intacta. Índice officialPickQueue(status,leaseUntil) READY, anterior conservado. Secreto dedicado de Morning instalado mediante tubería privada en Vercel y VPS nobody:nogroup 0600. MORNING_PUBLISH_ENABLED=false. Morning conserva su runtime/timer SHADOW; no se instalaron drop-ins PUBLISH ni se inició el publisher. El dominio permanece en dpl_6gYSQQn8oEbmtJ9U5sCfLAg9usd9/f8e54ff. La protección API Morning todavía no está desplegada: no declarar privacidad global PASS.

Tras nueva aprobación exacta: retomar desde despliegue Vercel desactivado, comprobar privacidad/comunicación, instalar solo la misma clausura de cinco módulos VPS y drop-ins revisados, ejecutar preflight, habilitar ambas banderas antes de 10:00 Madrid si todo pasa. Ver ROLLOUT-ROLLBACK.md. Si se pierde la ventana, SHADOW sin catchup. No rollback público inseguro ni mensajes de prueba. Copia Morning a banca sigue manual.
