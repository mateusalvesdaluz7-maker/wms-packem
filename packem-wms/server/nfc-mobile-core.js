'use strict';
const crypto = require('node:crypto');
const {passwordMatches, mayBind} = require('../api/nfc-tags.js').security;
const UID = /^04[A-F0-9]{12}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const targets = ['v-floor','v-floor70','v-recic','v-inv'];
const fail = (status, message) => Object.assign(new Error(message), {status});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function mayCount(role, target) {
  if (!targets.includes(target)) return false;
  const parts = String(role || '').split('|'), base = parts[0], views = parts.find(v => v.startsWith('v='));
  if (base === 'admin' || target === 'v-inv') return true;
  if (views) return views.slice(2).split(',').includes(target);
  return base === 'operador' || (base === 'recepcao' && ['v-floor','v-floor70'].includes(target));
}
function bodyOf(req) {
  if (Number(req.headers['content-length']) > 8192) throw fail(413,'Dados excedem o limite NFC.');
  let body = req.body;
  if (typeof body === 'string') {if(Buffer.byteLength(body)>8192)throw fail(413,'Dados excedem o limite NFC.');try{body=JSON.parse(body);}catch{throw fail(400,'JSON inválido.');}}
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body))>8192) throw fail(400,'Dados NFC inválidos.');
  return body;
}
function normalizeUid(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-f0-9:\s-]+$/i.test(value)) throw fail(422,'A leitura não informou o UID de uma NTAG213. QR Code não cadastra chip NFC.');
  const uid = value.replace(/[:\s-]/g,'').toUpperCase();
  if (!UID.test(uid)) throw fail(422,'UID incompatível com a tag cadastrada. Desative o modo sem identificador do leitor.');
  return uid;
}
const buckets = new Map();
function limit(req, now) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  if (buckets.size>2000) for (const [key,value] of buckets) if(now-value.at>60000)buckets.delete(key);
  if (buckets.size>=2000&&!buckets.has(ip))throw fail(429,'Aguarde um instante para continuar.');
  let item=buckets.get(ip);if(!item||now-item.at>60000){item={at:now,n:0};buckets.set(ip,item);}
  if(++item.n>600)throw fail(429,'Muitas leituras. Aguarde um instante.');
}
function service(options = {}) {
  const env = (options.env || (()=>process.env))(), fetcher = options.fetcher || fetch, now = options.now || Date.now;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw fail(503,'O serviço NFC ainda precisa ser ativado no servidor do WMS.');
  let base;try{base=new URL(env.SUPABASE_URL);}catch{throw fail(503,'Configuração do serviço NFC indisponível.');}
  if(base.protocol!=='https:'||base.username||base.password)throw fail(503,'Configuração do serviço NFC indisponível.');
  const signingKey = crypto.createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update('packem-nfc-mobile-session-v1').digest();
  function check(req) {
    const allowed=['https://wms-packem.vercel.app','https://wms-packem-git-fork-testemateus458-alt-cod-e27b10-vercelcomdrop.vercel.app',...(env.WMS_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean)];
    const origin=req.headers.origin;
    if(origin&&!allowed.includes(origin)&&!(env.NODE_ENV!=='production'&&/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)))throw fail(403,'Origem não autorizada.');
    limit(req,now());
  }
  async function db(path, payload) {
    const response=await fetcher(base.origin+'/rest/v1/'+path,{method:payload===undefined?'GET':'POST',
      headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
      body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      if(['42P01','PGRST202','PGRST205'].includes(data?.code))throw fail(503,'O cadastro NFC ainda precisa ser ativado no banco do WMS.');
      if(['23505','P0001','22023'].includes(data?.code))throw fail(409,'Operação NFC recusada. Confira o vínculo, a sessão ativa e a validade do leitor.');
      throw fail(502,'Sem confirmação do serviço NFC. Confira antes de repetir.');
    }
    return data;
  }
  async function user(name, password) {
    const query=new URLSearchParams({select:password===undefined?'u,role,active':'u,p,role,active',u:'eq.'+name,active:'eq.true',limit:'1'});
    const rows=await db('usuarios?'+query), row=Array.isArray(rows)?rows[0]:null;
    if(!row||row.active!==true||(password!==undefined&&!(await passwordMatches(row.p,password))))throw fail(401,'Entre novamente no WMS para conectar o NFC.');
    return {u:row.u,role:row.role};
  }
  function issue(actor) {
    const encoded=Buffer.from(JSON.stringify({u:actor.u,exp:now()+15*60000,scope:'nfc-mobile'})).toString('base64url');
    return encoded+'.'+crypto.createHmac('sha256',signingKey).update(encoded).digest('base64url');
  }
  async function authenticate(req) {
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(token.length>2048)throw fail(401,'Sessão NFC expirada. Entre novamente.');
    const [encoded,signature,extra]=token.split('.');
    const expected=crypto.createHmac('sha256',signingKey).update(encoded||'').digest('base64url');
    if(extra||!signature||!/^[A-Za-z0-9_-]{43}$/.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw fail(401,'Sessão NFC expirada. Entre novamente.');
    let claims;try{claims=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw fail(401,'Sessão NFC inválida.');}
    if(claims.scope!=='nfc-mobile'||typeof claims.u!=='string'||!Number.isFinite(claims.exp)||claims.exp<=now()||claims.exp>now()+15*60000)throw fail(401,'Sessão NFC expirada. Entre novamente.');
    return user(claims.u);
  }
  return {env,check,db,user,issue,authenticate,rpc:(action,actor,payload)=>db('rpc/wms_nfc_mobile',{p_action:action,p_actor:actor,p_payload:payload})};
}
function respondError(res,error){return res.status(error.status||502).json({ok:false,error:error.status?error.message:'Sem confirmação do serviço NFC. Tente novamente.'});}
module.exports={service,bodyOf,normalizeUid,mayBind,mayCount,fail,hash,UUID,UID,targets,respondError};
