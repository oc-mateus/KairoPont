const ALLOWED_ORIGINS = new Set([
  'https://oc-mateus.github.io',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requestSecurity(req) {
  const origin = req.headers.get('origin');
  const originAllowed = origin === null || ALLOWED_ORIGINS.has(origin);
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  if (origin && originAllowed) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', ...extraHeaders },
  });
  let earlyResponse = null;
  if (!originAllowed) earlyResponse = reply({ error: 'Origem não permitida.' }, 403);
  else if (req.method === 'OPTIONS') earlyResponse = new Response(null, { status: 204, headers });
  else if (req.method !== 'POST') earlyResponse = reply({ error: 'Método não permitido.' }, 405, { Allow: 'POST, OPTIONS' });
  return { reply, earlyResponse };
}

// Count bytes while reading: Content-Length is optional and cannot be trusted.
export async function readJsonObject(req, allowedFields, maxBytes = 16384) {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Envie os dados em JSON.');
  }
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Informe os dados da solicitação.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'Solicitação muito grande.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'JSON inválido.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Informe um objeto JSON.');
  }
  if (Object.keys(input).some((key) => !allowedFields.includes(key))) {
    throw new HttpError(400, 'A solicitação contém campos não permitidos.');
  }
  return input;
}

export function stringField(input, name, maxLength, optional = false) {
  const value = input[name];
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new HttpError(400, `Campo inválido: ${name}.`);
  }
  return value.trim();
}

export function uuidField(input, name) {
  const value = stringField(input, name, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `Campo inválido: ${name}.`);
  }
  return value;
}

export async function enforceRateLimit(client, action, actorId, reply) {
  try {
    const { data, error } = await client.rpc('consume_edge_rate_limit', {
      p_action: action, p_actor_id: actorId,
    });
    if (error || typeof data?.allowed !== 'boolean') throw new Error('Rate limit unavailable');
    if (data.allowed) return null;
    if (!Number.isInteger(data.retry_after) || data.retry_after < 1) throw new Error('Invalid rate limit');
    return reply({ error: 'Limite de solicitações atingido. Aguarde antes de tentar novamente.', retry_after: data.retry_after },
      429, { 'Retry-After': String(data.retry_after) });
  } catch {
    // Never call a paid provider if the shared quota cannot be checked.
    return reply({ error: 'Serviço temporariamente indisponível. Tente novamente em instantes.' }, 503);
  }
}
