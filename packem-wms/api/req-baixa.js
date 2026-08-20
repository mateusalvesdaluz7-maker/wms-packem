// Baixa idempotente de item da requisição no Base44.
// Ao concluir todos os itens, a requisição é finalizada automaticamente.
const APP_ID = process.env.BASE44_APP_ID || '69f21c3bf6750842cd0ab83c';
const BASE = 'https://app.base44.com/api/apps/' + APP_ID + '/entities/';
const MAX_BODY_BYTES = 16 * 1024;
const locks = new Map();

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }
function allowedOrigin(req) {
  const origin = clean(req.headers && req.headers.origin, 300);
  const configured = clean(process.env.WMS_ALLOWED_ORIGINS, 2000).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  const allowed = configured.length ? configured : ['https://wms-packem.vercel.app', 'http://localhost:8765', 'http://127.0.0.1:8765'];
  return !origin || allowed.indexOf(origin) >= 0 || /^https:\/\/wms-packem-[a-z0-9-]+\.vercel\.app$/i.test(origin) ? origin : '';
}
async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(function (resolve) { release = resolve; });
  locks.set(key, current);
  await previous;
  try { return await task(); }
  finally { release(); if (locks.get(key) === current) locks.delete(key); }
}

module.exports = async function handler(req, res) {
  const origin = allowedOrigin(req);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WMS-Request');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    if (!origin && req.headers && req.headers.origin) return res.status(403).end();
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!origin && req.headers && req.headers.origin) return res.status(403).json({ error: 'Origem não autorizada' });
  const declaredSize = Number(req.headers && req.headers['content-length']) || 0;
  if (declaredSize > MAX_BODY_BYTES) return res.status(413).json({ error: 'Dados enviados excedem o limite' });
  const apiKey = clean(process.env.BASE44_API_KEY, 1000);
  if (!apiKey) return res.status(500).json({ error: 'BASE44_API_KEY não configurada no servidor' });

  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return res.status(413).json({ error: 'Dados enviados excedem o limite' });
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body && typeof body === 'object' ? body : {};
  const itemId = clean(body.item_id, 120);
  const requestIdInput = clean(body.requisicao_id, 120);
  const operationId = clean(body.operation_id || (req.headers && req.headers['x-wms-request']), 100);
  const quantity = Number(body.kg);
  const unit = clean(body.un || 'kg', 12).toLowerCase();
  const address = clean(body.endereco, 80);
  const user = clean(body.usuario || 'WMS', 80);
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(itemId)) return res.status(400).json({ error: 'item_id inválido' });
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(operationId)) return res.status(400).json({ error: 'operation_id inválido' });
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000000) return res.status(400).json({ error: 'quantidade inválida' });
  if (!user) return res.status(400).json({ error: 'usuário obrigatório' });

  async function b44(method, path, payload) {
    const response = await fetch(BASE + path, { method, headers: { api_key: apiKey, 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
    const data = await response.json().catch(function () { return null; });
    if (!response.ok) {
      const error = new Error((data && (data.detail || data.error || data.message)) || ('HTTP ' + response.status));
      error.status = response.status; throw error;
    }
    return data;
  }

  try {
    const result = await withLock(itemId, async function () {
      const item = await b44('GET', 'ItemRequisicao/' + encodeURIComponent(itemId));
      if (!item || !item.id) { const error = new Error('Item não encontrado no Base44'); error.status = 404; throw error; }
      const marker = '[WMS-OP:' + operationId + ']';
      const notes = clean(item.obs_item, 12000);
      const requested = Number(item.quantidade) || 0;
      const previous = Number(item.quantidade_separada) || 0;
      if (notes.indexOf(marker) >= 0) return { ok: true, replayed: true, operation_id: operationId, item_id: itemId, quantidade_separada: previous, separado: !!item.separado, requisicao_status: null };

      const total = previous + quantity;
      const complete = requested > 0 ? total >= requested - 0.001 : true;
      const detail = marker + ' WMS: ' + quantity + unit + (address ? (' de ' + address) : '') + ' por ' + user;
      await b44('PUT', 'ItemRequisicao/' + encodeURIComponent(itemId), {
        quantidade_separada: total, separado: complete, entrega_parcial: !complete && total > 0,
        obs_item: notes ? (notes + ' | ' + detail) : detail
      });

      let requestStatus = null;
      const requestId = requestIdInput || clean(item.requisicao_id, 120);
      if (requestId) {
        const response = await b44('GET', 'ItemRequisicao?requisicao_id=' + encodeURIComponent(requestId) + '&limit=200');
        const siblings = Array.isArray(response) ? response : ((response && response.results) || []);
        const allComplete = siblings.length > 0 && siblings.every(function (x) { return x.id === itemId ? complete : !!x.separado; });
        const currentRequest = await b44('GET', 'Requisicao/' + encodeURIComponent(requestId));
        const history = Array.isArray(currentRequest && currentRequest.historico) ? currentRequest.historico.slice() : [];
        const now = new Date().toISOString();
        if (allComplete) {
          history.push({ ts: now, acao: 'Requisição Finalizada Automaticamente', usuario: user, detalhe: 'Todas as quantidades foram atendidas · ' + operationId });
          await b44('PUT', 'Requisicao/' + encodeURIComponent(requestId), {
            status: 'entregue',
            operador_logistica: (currentRequest && currentRequest.operador_logistica) || user,
            ts_fim_separacao: now,
            ts_entrega: now,
            historico: history
          });
          requestStatus = 'entregue';
        } else if (currentRequest && currentRequest.status === 'pendente') {
          history.push({ ts: now, acao: 'Separação Iniciada', usuario: user, detalhe: 'Via WMS · ' + operationId });
          await b44('PUT', 'Requisicao/' + encodeURIComponent(requestId), { status: 'em_separacao', operador_logistica: user, ts_inicio_separacao: now, historico: history });
          requestStatus = 'em_separacao';
        }
      }
      return { ok: true, replayed: false, operation_id: operationId, item_id: itemId, quantidade_separada: total, separado: complete, requisicao_status: requestStatus };
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/req-baixa] erro:', error && error.message);
    return res.status(error && error.status >= 400 && error.status < 600 ? error.status : 500).json({ error: (error && error.message) || 'Erro ao escrever no Base44' });
  }
};
module.exports._test = { clean, allowedOrigin, withLock };
