# Módulo de IA conversacional

## Estado
| Componente | Estado |
|---|---|
| Arquitectura, herramientas, conversaciones, KB versionada, consultas pendientes, fotos, asistente admin | ✅ Implementado y probado |
| Integración con la API real de DonWeb | ⏳ **Pendiente**: falta la documentación de la API (endpoint, modelo, formato y soporte de herramientas) y cargar la clave en el servidor |
| Pruebas del bucle de herramientas | ✅ Con un proveedor **falso** local (`test/fake-llm.js`), claramente identificado. No es IA |

Sin API configurada, TurnIA funciona en **modo simulado**: reglas + base de conocimiento aprobada, y lo indica en la interfaz ("Modo sin IA"). No se presenta como IA.

## Arquitectura
```
Chat público / Asistente del panel
        │  (nunca llaman a la API de IA desde el navegador)
        ▼
src/ai/routes.js        endpoints, tokens de conversación, rate limit, confirmaciones
src/ai/conversation.js  contexto persistente, prompt del sistema, bucle de herramientas, contingencias
src/ai/provider.js      AIProvider → OpenAICompatibleProvider | MockProvider (intercambiable)
src/ai/tools.js         herramientas internas con validación (cliente: consulta + PROPUESTAS; admin: solo lectura)
src/ai/knowledge.js     base de conocimiento con estados, versiones y aprobación
        ▼
Motor de reservas existente (engine.js / api.js): la IA no duplica lógica de reservas
```

### Proveedor
`AIProvider` define `sendMessage()`, `getModelInfo()`, `handleError()` y `normalizeResponse()`. La implementación actual (`OpenAICompatibleProvider`) usa el formato `/chat/completions` con `tools` y `tool_calls`. **Se ajustará a la documentación real de DonWeb**. Si la API no soporta herramientas: `AI_TOOL_MODE=none` (en ese caso responde sin ejecutar acciones). Para otro proveedor alcanza con agregar una clase con la misma interfaz.

### Herramientas (cliente)
Consultas: `get_business_info`, `list_services`, `get_service_details`, `estimate_quote`, `list_professionals`, `check_availability` (agenda real), `get_promotions`, `search_knowledge` (solo aprobado), `verify_client`, `get_client_history`, `get_my_appointments`, `save_client_preference`, `register_unanswered_question`.
Acciones (solo proponen): `propose_booking`, `propose_cancellation`, `propose_reschedule`.

**Ninguna acción se ejecuta por el modelo.** Las propuestas generan una tarjeta con resumen y un botón. Solo el clic del cliente llama a `POST /api/ai/conversations/:id/confirm`, que revalida en una transacción y registra auditoría. La confirmación es de un solo uso.

### Herramientas (panel, solo lectura)
`business_stats`, `appointments_list`, `occupancy`, `top_services`, `inactive_clients`, `waitlist_and_unconverted`, `free_slots`. Requiere el permiso de estadísticas.

## Seguridad
- La clave solo vive en `.env` del servidor (permiso 600, fuera de git). Nunca llega al navegador ni a los logs.
- Cada conversación tiene un token secreto: no se puede leer ni escribir la de otro.
- El historial de un cliente requiere verificación (sesión de cliente, o teléfono + código de turno). El lookup público por teléfono solo devuelve el nombre.
- Cancelar o reprogramar exige código + teléfono, y se audita cada intento (también los rechazados).
- El prompt del sistema marca los resultados de herramientas como datos, no instrucciones. Igual, el servidor decide: aunque el modelo sea manipulado, no puede saltear validaciones.
- Hay rate limit por conversación y usuario, y límite diario configurable.
- A la API solo se envían el contexto mínimo y los últimos 12 mensajes más un resumen compacto.

## Contingencias
Si la API falla por timeout, autenticación, 429, 5xx, respuesta malformada o modelo inexistente, se usa la respuesta por reglas con un aviso y el error queda en `ai_usage`. El formulario de reserva nunca depende de la IA, y el chat no modifica el estado del formulario.

## Activación (cuando DonWeb entregue la API)
1. Compartir la documentación (no la clave) para ajustar `provider.js` si el formato no es `/chat/completions`.
2. En el servidor: `nano /opt/turnia/.env` y completar `AI_API_URL`, `AI_API_KEY` y `AI_MODEL`.
3. `systemctl restart turnia`.
4. En Panel → Inteligencia artificial → Configuración y uso, verificar "Conectado".

## Pruebas
- `npm test`: flujo de reservas y concurrencia.
- `node test/fake-llm.js 4011` + servidor con `AI_API_URL=http://127.0.0.1:4011/v1/chat/completions AI_API_KEY=test-key AI_MODEL=fake-model` para probar el bucle de herramientas, la confirmación única y la caída de la API (mensaje con "caida").
