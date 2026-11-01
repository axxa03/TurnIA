# Arquitectura

```
Navegador (cliente / panel)          Servidor Node.js (sin dependencias)          SQLite
public/index.html + public.js  ──►  server.js  (estáticos + router /api)  ──►  data/turnia.db
public/admin.html + admin.js         src/api.js      endpoints y validaciones      (WAL, transacciones)
public/common.js, app.css            src/engine.js   estimación + disponibilidad
                                     src/assistant.js reglas + KB + IA opcional
                                     src/auth.js     scrypt + tokens HMAC + permisos
                                     src/seed.js     datos demo ficticios
                                     src/time.js     zona America/Argentina/Buenos_Aires
```

- **Sin build ni dependencias npm**: se despliega copiando la carpeta. Requiere Node ≥ 22.13 (`node:sqlite`).
- **Persistencia**: SQLite en archivo (`DB_PATH`). Los datos sobreviven reinicios.
- **Horario**: todas las fechas se guardan como hora local de Buenos Aires (`YYYY-MM-DD HH:MM`). Argentina no tiene horario de verano.
- **Concurrencia**: Node procesa cada request de forma sincrónica sobre SQLite y la confirmación se hace en `BEGIN IMMEDIATE ... COMMIT`, revalidando todos los ítems antes de insertar. No puede haber dos reservas confirmadas sobre el mismo hueco.
- **Seguridad**: contraseñas con `scrypt` y salt; sesiones con tokens firmados HMAC-SHA256 (`SESSION_SECRET`), expiración de 12 h; permisos por módulo en cada endpoint; validaciones en backend; secretos solo en `.env` (excluido de git). En producción el proceso escucha en `127.0.0.1` detrás de Nginx.

## Modelo de datos (principal)
- `services` (precio min/max, duración, extra, preparación, limpieza, anticipación, seña, política de cancelación, preguntas dinámicas JSON)
- `professionals`, `professional_services`, `schedules`, `breaks` (fijos por día o por fecha), `absences` (vacaciones, licencias, bloqueos, no laborable; del profesional o de todo el local)
- `clients` (teléfono único), `appointments` (estado, señas, descuento, cancelación), `appointment_items` (servicio, profesional, bloque con preparación/limpieza, respuestas, duración estimada y real, firma de similitud), `appointment_history`, `payments`
- `requests` (lista de espera), `swaps` (intercambios sugeridos), `promotions`, `reviews`, `knowledge`, `notifications`, `users`, `settings`

## Endpoints
- Públicos `/api/public/*`: `info`, `lookup`, `register`, `login`, `me`, `estimate`, `availability`, `book`, `request`, `appointment/:code` (+ `cancel`, `reschedule`, `review`), `assistant`.
- Panel `/api/admin/*` (Bearer token + permiso por módulo): `dashboard`, `appointments` (+ `status`, `reschedule`, `payment`, `notes`), `availability`, `conflicts`, `absences`, `professionals`, `services`, `clients`, `requests` (+ `options`, `book`), `swaps`, `promotions`, `reviews`, `reminders`, `stats`, `knowledge`, `ai`, `settings`, `users`.
