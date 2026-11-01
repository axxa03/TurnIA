# Reglas de negocio

## Estimación
- Duración = duración inicial + tiempo adicional + suma de los ajustes de cada respuesta (por ejemplo, cabello largo +30 min, retiro de kapping +25 min, 5 min por uña decorada).
- Precio = rango base + ajustes por respuesta.
- El bloque reservado en agenda = preparación + duración + limpieza.
- Servicios marcados como "química compleja" muestran siempre la advertencia de evaluación presencial.

## Aprendizaje de duraciones
- Al finalizar un turno se registra la duración real de cada servicio.
- Se calcula el promedio de trabajos **similares**: mismo servicio y mismos atributos relevantes (largo, densidad, químicos, producto previo, largo de uñas, cantidad decoradas). Si no hay suficientes, se usa el promedio general del servicio.
- Hacen falta al menos N registros (configurable, por defecto 3). Si no, se informa "sin historial suficiente".
- Se muestra con la cantidad de registros. **Nunca reemplaza la duración configurada**: el administrador decide si la ajusta.

## Disponibilidad
Un bloque es válido si:
1. Cae completo dentro de una franja laboral del profesional ese día de la semana.
2. No se superpone con descansos o comidas (fijos o de esa fecha).
3. No hay ausencias del profesional o del local (vacaciones, licencia, bloqueo, no laborable) que lo cubran.
4. La cantidad máxima de turnos superpuestos del profesional es menor a su capacidad simultánea.
5. El profesional tiene habilitados todos los servicios del grupo (o "todos los servicios").
6. Respeta la anticipación mínima de cada servicio y el horizonte máximo de reservas.

Reserva combinada (peluquería + manicuría):
- **Simultánea**: los dos grupos empiezan a la misma hora con profesionales distintos.
- **Consecutiva**: el segundo grupo empieza al terminar el primero (puede ser el mismo profesional si hace ambos).
- *Recomendación TurnIA*: entre los profesionales libres elige el de menor carga ese día.

La confirmación recalcula duración y precio en el servidor y revalida todo dentro de una transacción exclusiva.

## Estados
`pendiente` (de confirmación) · `confirmada` · `en_curso` · `finalizada` · `cancelada` · `reprogramacion` (solicitada) · `no_asistio`.
Las reservas web se confirman automáticamente salvo que el cliente supere el umbral de inasistencias (queda pendiente con seña).

## Cancelaciones y señas
- Cada servicio define horas de cancelación sin penalización, condiciones fuera de término y seña.
- En término con seña pagada → `pendiente_devolucion`. Fuera de término → `seña_retenida`.
- Señas, pagos y devoluciones se registran manualmente (sin pasarela) y quedan en el historial.

## Inasistencias
- Se cuentan por cliente.
- Al llegar a *X* (configurable) se exige una seña del 30% y el turno queda pendiente.
- Al llegar a *Y* se bloquea la reserva online (el local puede reservar manualmente).

## Ausencias que afectan turnos
Al cargar una ausencia se listan los turnos activos afectados con alternativas (otros horarios u otros profesionales). TurnIA **no modifica reservas confirmadas automáticamente**: el administrador contacta al cliente y aplica la alternativa aceptada, revalidada en el servidor.

## Lista de espera
Prioridad = urgencia (×20) + flexibilidad (×5) + cercanía del evento (hasta +40) + antigüedad (hasta +20) + acepta alternativas (+5).

## Intercambio de turnos
1. TurnIA detecta turnos de otros clientes que, movidos a otro hueco libre, liberan lugar para una solicitud.
2. El administrador revisa y registra "proponer y contactar".
3. Registra aceptación o rechazo.
4. Si se acepta, en una sola transacción se revalidan ambos movimientos, se mueve el turno, se crea el nuevo y se registra el historial. Si algo dejó de estar libre, no se aplica nada.

## Promociones
Se aplica automáticamente la de mayor descuento vigente que corresponda por fecha, día, servicio, profesional, público (nuevos, recurrentes con 2 o más visitas, inactivos con más de 60 días) y límite de usos. Por defecto requieren cliente registrado.

## Opiniones
Privadas hasta revisión. Solo se publican las aprobadas y marcadas para publicar. Las fotos solo se muestran si el cliente las autorizó expresamente.
