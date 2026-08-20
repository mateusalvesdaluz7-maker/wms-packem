'use strict';

const MAX_BODY_BYTES = 16 * 1024;
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 90;
const buckets = new Map();

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function requestIp(req) {
  return text((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress, 100);
}

function rateLimited(req) {
  const now = Date.now();
  const key = requestIp(req) || 'unknown';
  const current = buckets.get(key);
  if (!current || now - current.started >= WINDOW_MS) {
    buckets.set(key, { started: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS;
}

function allowedOrigin(req) {
  const origin = text(req.headers.origin, 500);
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname.toLowerCase(); } catch (_) { return false; }
  const configured = text(process.env.WMS_ALLOWED_ORIGINS, 2000)
    .split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (configured.length) return configured.includes(origin.toLowerCase());
  return host === 'wms-packem.vercel.app' || /^wms-packem-[a-z0-9-]+\.vercel\.app$/i.test(host) || host === 'localhost' || host === '127.0.0.1';
}

function parseBody(req) {
  const declared = Number(req.headers['content-length']) || 0;
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error('Dados enviados excedem o limite'), { status: 413 });
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) throw Object.assign(new Error('Dados enviados excedem o limite'), { status: 413 });
    try { return JSON.parse(req.body); } catch (_) { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function validate(body, headerId) {
  const operationId = text(body.operation_id || headerId, 100);
  const action = text(body.action, 20).toLowerCase();
  const source = text(body.source_space_id, 100).toUpperCase();
  const label = text(body.label, 120).toUpperCase();
  const product = text(body.product, 120).toUpperCase();
  const unit = text(body.unit || 'KG', 10).toUpperCase();
  const actor = text(body.actor, 120);
  const reference = text(body.reference, 160);
  const quantity = Number(body.quantity);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(operationId)) throw Object.assign(new Error('operation_id inválido'), { status: 400 });
  if (action !== 'saida') throw Object.assign(new Error('Apenas saída transacional está habilitada'), { status: 400 });
  if (!source || !label || !product || !actor) throw Object.assign(new Error('Origem, etiqueta, produto e operador são obrigatórios'), { status: 400 });
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000000) throw Object.assign(new Error('Quantidade inválida'), { status: 400 });
  if (!/^(KG|MT|M|UN)$/.test(unit)) throw Object.assign(new Error('Unidade inválida'), { status: 400 });
  return { operation_id: operationId, action, source_space_id: source, destination_space_id: null, label, product, quantity, unit, actor, reference };
}

async function rpc(payload) {
  const url = text(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY, 1000);
  if (!url || !key) throw Object.assign(new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurada'), { status: 500 });
  const response = await fetch(url + '/rest/v1/rpc/wms_stock_operation', {
    method: 'POST',
    headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ payload })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data && (data.message || data.hint || data.details)) || 'Falha na operação de estoque');
    error.status = response.status >= 400 && response.status < 500 ? 409 : 502;
    throw error;
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WMS-Request');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido' });
  if (!allowedOrigin(req)) return res.status(403).json({ ok: false, error: 'Origem não autorizada' });
  if (rateLimited(req)) return res.status(429).json({ ok: false, error: 'Muitas operações. Aguarde um instante.' });
  try {
    const payload = validate(parseBody(req), req.headers['x-wms-request']);
    const result = await rpc(payload);
    return res.status(200).json(result && typeof result === 'object' ? result : { ok: true, result });
  } catch (error) {
    const status = Number(error && error.status) || 500;
    if (status >= 500) console.error('[stock-operation]', error);
    return res.status(status).json({ ok: false, error: text(error && error.message || 'Erro interno', 300) });
  }
};

module.exports._test = { validate, allowedOrigin, parseBody };
