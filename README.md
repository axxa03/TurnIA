# TurnIA

**Reservas inteligentes para peluquerías y centros de manicuría.**

TurnIA convierte consultas en reservas: el cliente entra a la página pública del local (link para compartir por WhatsApp o redes), responde un asistente guiado, recibe **presupuesto y duración estimados**, ve **horarios reales disponibles** y confirma su turno sin crear cuenta. El comercio gestiona agenda, profesionales, horarios, ausencias, servicios, señas, lista de espera, promociones, opiniones y estadísticas desde un panel.

> El asistente es **inteligente basado en reglas y datos del comercio** (preguntas guiadas, lógica propia e historial). No es una IA generativa. Opcionalmente se puede conectar una API de IA (por ejemplo la de DonWeb) como respaldo de bajo consumo: ver [Asistente e IA opcional](#asistente-e-ia-opcional).

## Demo

| | |
|---|---|
| Página pública | `http://dwday-1252350.online/` |
| Panel | `http://dwday-1252350.online/admin` |
| Propietario | `admin@turnia.demo` |
| Encargado | `encargado@turnia.demo` |
| Empleada (Camila) | `camila@turnia.demo` |
| Contraseña demo | `demo1234` (configurable con `DEMO_ADMIN_PASSWORD`) |

Todos los datos (comercio "Studio Aurora", clientes, turnos y opiniones) son **ficticios** y están marcados como demo.

### Recorrido sugerido para el jurado
1. Entrar a la página pública → **Reservar**.
2. Ingresar nombre y teléfono (probá `1100000001` para ver un cliente recurrente).
3. Elegir **Ambos** → por ejemplo *Tintura completa* + *Semipermanente*.
4. Responder las preguntas dinámicas → ver presupuesto, duración y promedio real.
5. Elegir franja y profesional (o *Recomendación TurnIA*) → ver horarios **simultáneos** y **consecutivos**.
6. Confirmar → se obtiene un código y link para gestionar el turno (cancelar, pedir cambio, opinar).
7. Entrar a `/admin` → Dashboard y Agenda (vista día/semana/mes) → abrir el turno creado.
8. Cambiar estado, reprogramar, registrar seña, finalizar con duración real.
9. Profesionales → perfil, servicios habilitados, horarios, descansos y licencias (con detección de turnos afectados y alternativas).

## Funcionalidades

**Cliente**
- Página pública personalizable: nombre, logo, descripción, servicios por categoría, precios/rangos, profesionales, promociones, opiniones aprobadas, contacto y condiciones.
- Reserva sin cuenta; el teléfono identifica al cliente y recupera su historial. Registro opcional (email + contraseña) para acceder a promociones.
- Asistente guiado: datos → peluquería/manicuría/ambos → servicios → preguntas dinámicas por servicio (largo, grosor, densidad, color, químicos, última tintura, referencias; estado de uñas, producto anterior, retiro, largo, forma, diseño, cantidad de uñas decoradas/reparaciones) → estimación → preferencias (fecha, franja, flexibilidad, urgencia, evento) → profesional (específico, cualquiera o recomendación) → horarios reales → resumen con condiciones → confirmación automática.
- Advertencias para trabajos químicos complejos y sugerencia de evaluación ante alteraciones en uñas (sin diagnósticos médicos).
- Lista de espera cuando no hay disponibilidad.
- "Mi turno": consultar, cancelar (con política en/fuera de término), pedir reprogramación y dejar opinión con fotos y autorización de publicación.
- Chat de consultas (precios, duraciones, horarios, promos, profesionales, próximos turnos).

**Motor de disponibilidad**
- Considera horarios por día (incluye horario cortado), servicios habilitados, duración estimada según respuestas, preparación y limpieza, capacidad simultánea por profesional, descansos fijos y variables, comidas, vacaciones, licencias, bloqueos, días no laborables, reservas existentes, anticipación mínima por servicio y horizonte máximo.
- Reservas combinadas: opciones **simultáneas** (dos profesionales en paralelo) y **consecutivas**. Un profesional puede hacer varios servicios en la misma reserva.
- **Validación en backend** dentro de una transacción `BEGIN IMMEDIATE` de SQLite: dos intentos simultáneos sobre el mismo hueco → uno confirma y el otro recibe `409`.

**Panel**
- Dashboard: turnos de hoy y próximos, ocupación y huecos libres por profesional, consultas sin convertir, solicitudes de cambio, cancelaciones/inasistencias, clientes nuevos y recurrentes, ingresos estimados, señas pendientes, oportunidades de recuperar ventas, notificaciones internas.
- Agenda día/semana/mes, filtros por profesional/servicio/estado, alta manual, cambio de estado (7 estados), reprogramación revalidada, cancelación, bloqueos, historial de cambios y **detección de conflictos**.
- Profesionales: perfil, foto, especialidades, servicios habilitados o "todos", horarios, descansos, comidas, ausencias, capacidad y duración real promedio. Si una ausencia afecta turnos confirmados, se listan con alternativas; **nunca se modifican automáticamente**.
- Servicios: categoría, precio fijo o rango, duración inicial, tiempo adicional, preparación/limpieza, profesionales, requisitos, anticipación, seña y política de cancelación.
- Aprendizaje de duraciones: al finalizar se registra la duración real; se promedian trabajos similares (mismo servicio + atributos relevantes) y se muestra con cantidad de registros. No reemplaza la duración configurada.
- Solicitudes: priorización por cercanía de evento, urgencia, antigüedad y flexibilidad; búsqueda de huecos; **intercambio sugerido** de turnos con flujo proponer → contactar → aceptar/rechazar → revalidación transaccional.
- Señas, pagos y devoluciones registrados manualmente (sin pasarela). Inasistencias contabilizadas, con exigencia de seña o bloqueo configurables.
- Clientes: contacto, historial, servicios, profesionales, preferencias, cancelaciones, inasistencias, comentarios y fotos.
- Promociones: % o importe, por servicio, profesional, día, público (nuevos, recurrentes, inactivos), vigencia y límite de usos. Se aplican automáticamente.
- Recordatorios: mensajes listos para copiar o abrir en WhatsApp (`wa.me`), anticipación configurable, avisos de cambios y cancelaciones.
- Opiniones: privadas hasta revisión; aprobar/rechazar/publicar; fotos solo con autorización.
- Estadísticas con aviso explícito de datos demo.
- Usuarios y permisos: propietario (todo), encargado (módulos habilitados), empleado (su agenda).

## Instalación local

Requisitos: **Node.js 22.13 o superior**. No hay dependencias npm: usa `node:sqlite` y `node:http`.

```bash
cp .env.example .env
npm start
```
Abrir `http://localhost:3000` y `http://localhost:3000/admin`. La base se crea en `data/turnia.db` con datos demo la primera vez. Para reiniciar la demo, borrá la carpeta `data/`.

Prueba rápida: `npm test` (con el servidor corriendo) ejecuta un flujo de reserva y el test de doble reserva simultánea.

## IA conversacional

Chat público integrado a la reserva y asistente de gestión en el panel. La IA usa **herramientas internas** del backend: consulta servicios, precios, agenda real, promociones, conocimiento aprobado e historial verificado. Prepara reservas, cancelaciones y reprogramaciones, que **solo se ejecutan cuando el cliente toca Confirmar** y el servidor revalida todo en una transacción. Incluye consultas sin respuesta derivadas al equipo, respuestas que vuelven al chat, conocimiento versionado con aprobación del propietario, fotos para evaluación profesional (sin análisis automático) y turnos de diagnóstico de 15 min configurables.

**Estado:** la integración con la API real de DonWeb queda **pendiente** de su documentación. Mientras tanto corre en **modo simulado** (reglas + conocimiento aprobado), identificado como tal en la interfaz. Detalles en [docs/IA.md](docs/IA.md).

La clave **nunca va en el código**. Se configura solo en el `.env` del servidor (`AI_API_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT`, `AI_TOOL_MODE`).

## Deploy

Ver [docs/DEPLOY.md](docs/DEPLOY.md). Resumen para un Cloud Server DonWeb con Ubuntu:
```bash
git clone <repo> /opt/turnia && bash /opt/turnia/deploy/setup.sh dwday-1252350.online
```

## Documentación
- [Arquitectura](docs/ARQUITECTURA.md)
- [Reglas de negocio](docs/REGLAS.md)
- [Deploy](docs/DEPLOY.md)
- [IA conversacional](docs/IA.md)

## Limitaciones conocidas
- Puntos y recompensas por visitas: funcionalidad futura.
- Señas y pagos se registran manualmente; no hay pasarela.
- Recordatorios por WhatsApp son mensajes para copiar o abrir con `wa.me`; no hay envío automático.
- Fotos de opiniones se guardan comprimidas en la base (máx. 3 por opinión).
- La búsqueda de horarios usa intervalos de 15 minutos y muestra hasta 8 opciones por día.
- Un único comercio por instalación.
