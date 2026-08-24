# Límites de cuenta de Money TracKING

Todas las cuentas reciben estos límites por defecto:

- 5 bancas.
- 1.000 apuestas por banca.
- 10 escaneos de boletos por cada ventana de 24 horas.

La aplicación no ofrece compra, ampliación ni controles de autoservicio. Money Tips puede conceder manualmente límites superiores creando este documento desde Firebase Console:

```text
users/{uid}/entitlements/limits
```

Campos admitidos:

```json
{
  "maxBanks": 10,
  "maxBetsPerBank": 5000,
  "maxScansPerDay": 50
}
```

Los valores inferiores a los límites base se normalizan al valor base. Si el documento no existe, está incompleto o contiene valores no numéricos, se aplican los valores por defecto.

Las reglas de Firestore permiten al usuario leer sus límites, pero no modificarlos. Los administradores del proyecto pueden crear o editar el documento desde Firebase Console porque las operaciones administrativas no dependen de las reglas del cliente.

El endpoint de escaneo autentica la sesión de Firebase y reserva cada uso mediante una transacción de Firestore antes de llamar al modelo de IA. Esto evita superar el límite mediante varias pestañas o llamadas directas al endpoint.
