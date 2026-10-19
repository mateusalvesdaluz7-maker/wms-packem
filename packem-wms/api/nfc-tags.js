'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(crypto.pbkdf2);
const fail = (status, message) => Object.assign(new Error(message), { status });
// Seven-byte tags observed in the iPhone pilot: NXP (04) and Feiju (53).
const UID = /^(04|53)[A-F0-9]{12}$/;
const ITEM = /^[A-Za-z0-9._/-]{1,32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const buckets = new Map();

function parse(req) {
  if (Number(req.headers['content-length']) > 4096) throw fail(413, 'Dados excedem o limite.');
  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 4096) throw fail(413, 'Dados excedem o limite.');
    try { body = JSON.parse(body); } catch (_) { throw fail(400, 'JSON inválido.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 4096) throw fail(400, 'Dados inválidos.');
  if (!['lookup', 'bind', 'list', 'unbind'].includes(body.action)) throw fail(400, 'Ação NFC inválida.');
  if (body.action !== 'list' && (typeof body.uid !== 'string' || !UID.test(body.uid))) throw fail(400, 'UID NFC de sete bytes inválido.');
  if (['bind', 'unbind'].includes(body.action) && (typeof body.item !== 'string' || !ITEM.test(body.item))) throw fail(400, 'Embalagem inválida.');
  if (body.action === 'unbind' && (typeof body.bindingId !== 'string' || !UUID.test(body.bindingId))) throw fail(400, 'Consulte o vínculo novamente antes de desvincular.');
  if (body.action === 'list' && (typeof body.search !== 'string' || body.search !== '' && !ITEM.test(body.search) || !Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset > 100000)) throw fail(400, 'Busca ou página de tags inválida.');
  const auth = body.auth;
  if (!auth || typeof auth.u !== 'string' || !auth.u.trim() || auth.u.length > 120 || typeof auth.p !== 'string' || !auth.p || auth.p.length > 1000) throw fail(401, 'Entre novamente no WMS para usar o leitor NFC.');
  return body;
}

async function passwordMatches(stored, password) {
  if (typeof stored !== 'string') return false;
  const equal = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!stored.startsWith('pbkdf2$')) return equal(Buffer.from(stored), Buffer.from(password));
  const parts = stored.split('$'), iterations = Number(parts[1]);
  if (parts.length !== 4 || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 || !/^[a-f0-9]{32}$/i.test(parts[2]) || !/^[a-f0-9]{64}$/i.test(parts[3])) return false;
  return equal(await derive(password, Buffer.from(parts[2], 'hex'), iterations, 32, 'sha256'), Buffer.from(parts[3], 'hex'));
}

function mayBind(role) {
  const parts = String(role || '').split('|'), base = parts[0];
  if (base === 'admin') return true;
  const views = parts.find(value => value.startsWith('v='));
  if (views) return views.slice(2).split(',').includes('v-labels');
  return ['operador', 'recepcao'].includes(base);
}

function makeHandler(options = {}) {
  const fetcher = options.fetcher || fetch;
  const getEnv = options.env || (() => process.env);
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
    try {
      const env = getEnv(), origin = req.headers.origin;
      const allowed = ['https://wms-packem.vercel.app', 'https://wms-packem-git-fork-testemateus458-alt-cod-e27b10-vercelcomdrop.vercel.app'];
      if (env.WMS_ALLOWED_ORIGINS) allowed.push(...env.WMS_ALLOWED_ORIGINS.split(',').map(value => value.trim()));
      if (origin && !allowed.includes(origin) && !(env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) throw fail(403, 'Origem não autorizada.');
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0], now = Date.now();
      if (buckets.size > 2000) for (const [key, value] of buckets) if (now - value.at > 60000) buckets.delete(key);
      if (buckets.size >= 2000 && !buckets.has(ip)) throw fail(429, 'Aguarde antes de tentar novamente.');
      let bucket = buckets.get(ip);
      if (!bucket || now - bucket.at > 60000) { bucket = { at: now, count: 0 }; buckets.set(ip, bucket); }
      if (++bucket.count > 180) throw fail(429, 'Muitas leituras. Aguarde um instante.');
      const body = parse(req);
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw fail(503, 'Cadastro NFC pendente: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor.');
      const base = new URL(env.SUPABASE_URL);
      if (base.protocol !== 'https:') throw fail(503, 'Configuração NFC inválida no servidor.');
      async function db(path, method = 'GET', payload) {
        const response = await fetcher(base.origin + '/rest/v1/' + path, {
          method,
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' },
          body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(8000)
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (['42P01', 'PGRST202', 'PGRST205'].includes(data?.code)) throw fail(503, 'Cadastro NFC pendente: aplique a migração wms_nfc_tags no banco.');
          if (data?.code === 'NFC01') throw fail(409, 'O vínculo mudou. Atualize a lista e consulte a tag novamente.');
          if (data?.code === 'NFC02') throw fail(409, 'Pause a contagem ou cancele o cadastro em andamento antes de desvincular.');
          if (data?.code === '42501') throw fail(403, 'Seu usuário não tem permissão para desvincular tags.');
          if (['23505', 'P0001'].includes(data?.code)) throw fail(409, 'Tag ou embalagem já vinculada, ou embalagem ainda não sincronizada. Confira o cadastro.');
          throw fail(502, 'O banco não confirmou a operação NFC. Confira antes de repetir.');
        }
        return data;
      }
      // Mesma credencial do login WMS, mantida só em memória pelo cliente. A chave
      // service_role nunca sai do servidor e não assina tokens com uma chave pública.
      const query = new URLSearchParams({ select: 'u,p,role,active', u: 'eq.' + body.auth.u, active: 'eq.true', limit: '1' });
      const users = await db('usuarios?' + query);
      const user = Array.isArray(users) ? users[0] : null;
      if (!user || user.active !== true || !(await passwordMatches(user.p, body.auth.p))) throw fail(401, 'Sessão NFC não autorizada. Entre novamente no WMS.');
      if (['list', 'unbind'].includes(body.action)) {
        if (!mayBind(user.role)) throw fail(403, 'Seu usuário não tem acesso ao cadastro de etiquetas.');
        if (body.action === 'list') {
          const query = new URLSearchParams({ select: 'uid,item,binding_id,created_at,by_user', order: 'created_at.desc,uid.asc', limit: '21', offset: String(body.offset) });
          if (body.search) query.set('or', '(uid.ilike.*' + body.search + '*,item.ilike.*' + body.search + '*)');
          const rows = await db('wms_nfc_tags?' + query);
          if (!Array.isArray(rows)) throw fail(502, 'A lista de tags não foi confirmada.');
          return res.status(200).json({ ok: true, data: { rows: rows.slice(0, 20), hasMore: rows.length > 20 } });
        }
        const data = await db('rpc/wms_unbind_nfc_tag', 'POST', { p_uid: body.uid, p_item: body.item, p_binding_id: body.bindingId, p_actor: user.u });
        return res.status(200).json({ ok: true, data });
      }
      if (body.action === 'bind') {
        if (!mayBind(user.role)) throw fail(403, 'Seu usuário não tem acesso ao cadastro de etiquetas.');
        const data = await db('rpc/wms_bind_nfc_tag', 'POST', { p_uid: body.uid, p_item: body.item, p_actor: user.u });
        return res.status(200).json({ ok: true, data });
      }
      const rows = await db('wms_nfc_tags?' + new URLSearchParams({ select: 'uid,item,created_at,by_user', uid: 'eq.' + body.uid, limit: '1' }));
      const data = Array.isArray(rows) ? rows[0] : null;
      if (!data) throw fail(404, 'Tag ainda não cadastrada. Vincule o chip à embalagem em Gestão de Etiquetas.');
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      const status = Number(error.status) || 502;
      // Não registra body, senha, chave do banco nem resposta interna do provedor.
      return res.status(status).json({ ok: false, error: error.status ? error.message : 'Sem confirmação do serviço NFC. Confira a conexão e tente novamente.' });
    }
  };
}

module.exports = makeHandler();
module.exports.security = { passwordMatches, mayBind };
module.exports._test = { parse, passwordMatches, mayBind, makeHandler };
