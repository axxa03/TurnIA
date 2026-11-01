// Capa de abstracción del proveedor de IA (AIProvider).
// Implementaciones:
//  - OpenAICompatibleProvider: endpoint estilo /chat/completions con function calling.
//    Se configura por variables de entorno; la clave NUNCA está en el código ni llega al navegador.
//  - MockProvider: proveedor SIMULADO, claramente identificado, para operar sin API configurada.
// Para cambiar de proveedor basta con agregar otra clase con la misma interfaz.
const { run } = require('../db');
const T = require('../time');

class AIError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; } // kind: timeout|auth|rate_limit|unavailable|malformed|model|config
}

class AIProvider {
  get name() { return 'base'; }
  get isReal() { return false; }
  get supportsTools() { return false; }
  async sendMessage(/* { messages, tools, maxTokens } */) { throw new AIError('config', 'No implementado'); }
  getModelInfo() { return { provider: this.name }; }
  handleError(status, body) {
    if (status === 401 || status === 403) return new AIError('auth', 'Error de autenticación con el proveedor de IA');
    if (status === 429) return new AIError('rate_limit', 'Límite de solicitudes del proveedor alcanzado');
    if (status === 404) return new AIError('model', 'Endpoint o modelo no disponible');
    if (status >= 500) return new AIError('unavailable', 'Proveedor de IA no disponible');
    return new AIError('unavailable', `Error del proveedor (${status}) ${String(body || '').slice(0, 120)}`);
  }
}

class OpenAICompatibleProvider extends AIProvider {
  constructor() {
    super();
    this.url = process.env.AI_API_URL;
    this.key = process.env.AI_API_KEY;
    this.model = process.env.AI_MODEL;
    this.timeout = Number(process.env.AI_TIMEOUT || 20000);
    this.toolMode = (process.env.AI_TOOL_MODE || 'native').toLowerCase(); // native | none
  }
  get name() { return 'openai-compatible'; }
  get isReal() { return true; }
  get supportsTools() { return this.toolMode === 'native'; }
  getModelInfo() { return { provider: this.name, model: this.model || '(sin definir)', tools: this.supportsTools, endpoint_host: safeHost(this.url) }; }

  async sendMessage({ messages, tools, maxTokens = 400, temperature = 0.3 }) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), this.timeout);
    const body = { model: this.model, messages, max_tokens: maxTokens, temperature };
    if (tools?.length && this.supportsTools) { body.tools = tools.map(t => ({ type: 'function', function: t })); body.tool_choice = 'auto'; }
    let res;
    try {
      res = await fetch(this.url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` }, body: JSON.stringify(body) });
    } catch (e) {
      throw new AIError(e.name === 'AbortError' ? 'timeout' : 'unavailable', e.name === 'AbortError' ? 'La IA tardó demasiado en responder' : 'No se pudo conectar con el proveedor de IA');
    } finally { clearTimeout(to); }
    if (!res.ok) throw this.handleError(res.status, await res.text().catch(() => ''));
    let j; try { j = await res.json(); } catch { throw new AIError('malformed', 'Respuesta inválida del proveedor'); }
    return this.normalizeResponse(j);
  }
  // Devuelve { text, toolCalls:[{id,name,args}], usage }
  normalizeResponse(j) {
    const msg = j?.choices?.[0]?.message;
    if (!msg) throw new AIError('malformed', 'Respuesta sin contenido');
    const toolCalls = (msg.tool_calls || []).map(c => {
      let args = {}; try { args = JSON.parse(c.function?.arguments || '{}'); } catch { args = {}; }
      return { id: c.id, name: c.function?.name, args };
    }).filter(c => c.name);
    return { text: (msg.content || '').trim(), toolCalls, raw: msg, usage: j.usage?.total_tokens || 0 };
  }
}

// Proveedor SIMULADO: no es IA. Se usa cuando no hay API configurada o falla.
class MockProvider extends AIProvider {
  get name() { return 'simulado (sin IA)'; }
  getModelInfo() { return { provider: this.name, model: 'reglas + base de conocimiento', tools: false }; }
}

const safeHost = u => { try { return new URL(u).host; } catch { return null; } };

function getProvider() {
  if (process.env.AI_API_URL && process.env.AI_API_KEY && process.env.AI_MODEL) return new OpenAICompatibleProvider();
  return new MockProvider();
}

function logUsage(kind, provider, ok, error, tokens, ms) {
  try { run('INSERT INTO ai_usage(day,kind,provider,ok,error,tokens,ms,created_at) VALUES(?,?,?,?,?,?,?,?)', T.today(), kind, provider, ok ? 1 : 0, error || null, tokens || 0, ms || 0, T.nowLocal()); } catch { }
}

module.exports = { getProvider, AIError, AIProvider, OpenAICompatibleProvider, MockProvider, logUsage };
