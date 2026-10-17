const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClient } = require('../wms-nfc-registry.js');
const { AppCounter, AppEnrollment } = require('../wms-nfc-app.js');
const { prepare } = require('../wms-nfc-preparar.js');
const { applyItemReading } = require('../wms-nfc-reader.js');
const { makeHandler, passwordMatches } = require('../api/nfc-tags.js')._test;
const uid = '04112233445566', item = 'T001';
const auth = { u: 'test-operator', p: 'test-password-only' };

function fixture() {
  let active = true, sequence = 0;
  const catalog = { T001: { codigo: '0303450047', quantidade: 300, unidade: 'KG' }, T002: { codigo: '0303450047', quantidade: 250.5, unidade: 'KG' } };
  const store = new Map(), counted = new Set();
  const context = { isActive: () => active, lookup: async id => catalog[id] || null, has: id => counted.has(id), add: async id => counted.add(id) };
  const registry = { async bind(key, id) {
    if ((store.has(key) && store.get(key) !== id) || [...store].some(([other, value]) => other !== key && value === id)) throw Error('Vínculo em conflito');
    const duplicate = store.has(key); store.set(key, id); return { uid: key, item: id, duplicate };
  }, async resolve(key, ctx) { if (!store.has(key)) throw Error('Tag não cadastrada'); return (await prepare(store.get(key), ctx)).tag; } };
  const enrollment = new AppEnrollment({ prepare, bind: registry.bind, uuid: () => String(++sequence) });
  const counter = new AppCounter({ resolve: registry.resolve, apply: applyItemReading, uuid: () => String(++sequence) });
  return { catalog, store, counted, context, registry, enrollment, counter, deactivate: () => { active = false; } };
}

test('tag vazia é cadastrada pelo UID e depois contada sem nenhum NDEF', async () => {
  const f = fixture(), prepared = await prepare(item, f.context);
  const binding = await f.enrollment.start(prepared, f.context);
  assert.equal(binding.mode, 'enroll');
  assert.equal((await f.enrollment.receive({ ...binding, uid })).accepted, true);
  assert.equal(f.store.get(uid), item);
  assert.equal(f.enrollment.binding, null);
  const session = f.counter.start('v-floor', f.context);
  assert.equal((await f.counter.receive({ ...session, uid, content: '' })).duplicate, false);
  assert.equal((await f.counter.receive({ ...session, uid })).duplicate, true);
  assert.equal(f.counted.size, 1);
});

test('não cadastra embalagem alterada durante seleção ou durante leitura', async () => {
  const f = fixture(), selected = await prepare(item, f.context);
  f.catalog.T001.quantidade = 301;
  await assert.rejects(f.enrollment.start(selected, f.context), /cadastro mudou/);
  f.catalog.T001.quantidade = 300;
  const binding = await f.enrollment.start(selected, f.context);
  f.catalog.T001.codigo = '303450047';
  await assert.rejects(f.enrollment.receive({ ...binding, uid }), /código ou peso mudou/);
  assert.equal(f.store.size, 0);
});

test('tag desconhecida não altera contagem; conteúdo escrito nela não substitui UID cadastrado', async () => {
  const f = fixture(), binding = f.counter.start('v-floor', f.context);
  await assert.rejects(f.counter.receive({ ...binding, uid, content: 'JOB=x;ID=T001;COD=0303450047;QTD=300;UN=KG' }), /não cadastrada/);
  assert.equal(f.counted.size, 0);
});

test('cancela antes do envio, recusa retorno antigo e não inicia cadastros paralelos', async () => {
  const f = fixture(), selected = await prepare(item, f.context), binding = await f.enrollment.start(selected, f.context);
  await assert.rejects(f.enrollment.start(selected, f.context), /Encerre/);
  await assert.rejects(f.enrollment.receive({ ...binding, sessionId: 'old', uid }), /não pertence/);
  f.enrollment.stop();
  await assert.rejects(f.enrollment.receive({ ...binding, uid }), /não pertence/);
  assert.equal(f.store.size, 0);
});

test('mudança de usuário durante consulta de cadastro impede vínculo', async () => {
  const f = fixture(), selected = await prepare(item, f.context), binding = await f.enrollment.start(selected, f.context);
  f.deactivate();
  await assert.rejects(f.enrollment.receive({ ...binding, uid }), /usuário mudou/);
  assert.equal(f.store.size, 0);
});

test('cancelamento durante persistência não anuncia sucesso; consulta pode confirmar vínculo já salvo', async () => {
  const f = fixture(), selected = await prepare(item, f.context);
  let release;
  const enrollment = new AppEnrollment({ prepare, uuid: () => 'session', bind: async (key, id) => new Promise(resolve => { release = async () => resolve(await f.registry.bind(key, id)); }) });
  const binding = await enrollment.start(selected, f.context), pending = enrollment.receive({ ...binding, uid });
  await new Promise(resolve => setImmediate(resolve));
  enrollment.stop();
  await assert.rejects(enrollment.start(selected, f.context), /Encerre/);
  await release();
  await assert.rejects(pending, /usuário mudou/);
  assert.equal(f.store.get(uid), item);
  assert.equal(enrollment.binding, null);
});

test('cadastro recusa vínculo incompatível do servidor e falhas não viram sucesso', async () => {
  const f = fixture();
  for (const bind of [async () => ({ uid, item: 'T002' }), async () => { throw Error('Sem rede'); }]) {
    const enrollment = new AppEnrollment({ prepare, bind, uuid: () => 'session' }), binding = await enrollment.start(await prepare(item, f.context), f.context);
    await assert.rejects(enrollment.receive({ ...binding, uid }), /vínculo solicitado|Sem rede/);
    assert.equal(enrollment.binding, null);
  }
});

test('cliente não transmite credenciais sem sessão e valida resposta exata', async () => {
  let calls = 0;
  const client = createClient({ auth: () => null, fetch: async () => { calls++; } });
  await assert.rejects(client.lookup(uid), /Entre novamente/);
  assert.equal(calls, 0);
  const other = createClient({ auth: () => auth, fetch: async (_, options) => {
    assert.equal(options.cache, 'no-store'); assert.deepEqual(JSON.parse(options.body).auth, auth);
    return { ok: true, json: async () => ({ ok: true, data: { uid: '04778899001122', item } }) };
  } });
  await assert.rejects(other.lookup(uid), /vínculo diferente/);
});

function apiFixture(options = {}) {
  let queries = [];
  const handler = makeHandler({ env: () => options.missing ? {} : { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', NODE_ENV: 'production' }, fetcher: async (url, init) => {
    queries.push({ url, init }); assert.equal(init.headers.authorization, 'Bearer server-test-key');
    if (url.includes('/usuarios?')) return { ok: true, json: async () => options.users || [{ ...auth, role: options.role || 'admin', active: true }] };
    if (options.dbError) return { ok: false, json: async () => ({ code: options.dbError }) };
    const data = { uid: options.uid || uid, item, duplicate: false, by_user: auth.u };
    return { ok: true, json: async () => url.includes('/rpc/') ? data : options.unknown ? [] : [data] };
  } });
  return { queries, async run(body, extra = {}) {
    let status, data;
    const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { data = value; return this; } };
    await handler({ method: 'POST', headers: { origin: 'https://wms-packem.vercel.app' }, body, ...extra }, res);
    return { status, data };
  } };
}

test('API exige credencial real e usuário ativo; não confia no usuário informado pelo navegador', async () => {
  for (const [body, options] of [[{ action: 'lookup', uid }, {}], [{ action: 'lookup', uid, auth: { ...auth, p: 'wrong' } }, {}], [{ action: 'lookup', uid, auth }, { users: [{ ...auth, active: false }] }]]) {
    const f = apiFixture(options), response = await f.run(body);
    assert.equal(response.status, 401);
    assert.equal(f.queries.some(q => q.url.includes('/wms_nfc_tags')), false);
  }
});

test('API autentica senha PBKDF2 existente, sem aceitar hash malformado', async () => {
  const salt = Buffer.alloc(16, 7), hash = crypto.pbkdf2Sync(auth.p, salt, 100000, 32, 'sha256').toString('hex');
  const stored = `pbkdf2$100000$${salt.toString('hex')}$${hash}`;
  assert.equal(await passwordMatches(stored, auth.p), true);
  assert.equal(await passwordMatches(stored, 'wrong'), false);
  assert.equal(await passwordMatches('pbkdf2$90000000$invalid$invalid', auth.p), false);
});

test('API salva com ator do banco, retorna UID e não vaza senha nem chave', async () => {
  const f = apiFixture(), response = await f.run({ action: 'bind', uid, item, auth, actor: 'forged' });
  assert.equal(response.status, 200);
  const rpc = f.queries.find(q => q.url.includes('/rpc/'));
  assert.deepEqual(JSON.parse(rpc.init.body), { p_uid: uid, p_item: item, p_actor: auth.u });
  assert.equal(JSON.stringify(response).includes(auth.p), false);
  assert.equal(JSON.stringify(response).includes('server-test-key'), false);
});
test('cadastro e consulta aceitam UID Feiju de sete bytes e recusam identificadores inválidos', async () => {
  const feiju='530AC2BA330001',f=apiFixture({uid:feiju}),response=await f.run({action:'bind',uid:feiju,item,auth});
  assert.equal(response.status,200);assert.equal(response.data.data.uid,feiju);
  assert.equal(JSON.parse(f.queries.find(q=>q.url.includes('/rpc/')).init.body).p_uid,feiju);
  const client=createClient({auth:()=>auth,fetch:async()=>({ok:true,json:async()=>response.data})});
  assert.equal((await client.bind(feiju,item)).uid,feiju);
  for(const invalid of ['00000000000000','FFFFFFFFFFFFFF','540AC2BA330001']){
    await assert.rejects(client.bind(invalid,item),/UID/);
    assert.equal((await f.run({action:'bind',uid:invalid,item,auth})).status,400);
  }
});

test('API aplica permissão do cadastro, conflito de vínculo e estado de implantação', async () => {
  for (const [options, expected] of [[{ role: 'requisitante' }, 403], [{ role: 'operador|v=v-floor' }, 403], [{ dbError: '23505' }, 409], [{ dbError: 'P0001' }, 409], [{ dbError: '42P01' }, 503], [{ missing: true }, 503]]) {
    const response = await apiFixture(options).run({ action: 'bind', uid, item, auth }); assert.equal(response.status, expected);
  }
  assert.equal((await apiFixture({ role: 'viewer|v=v-labels' }).run({ action: 'bind', uid, item, auth })).status, 200);
});

test('API consulta UID cadastrado e devolve tag desconhecida sem criar estoque', async () => {
  assert.equal((await apiFixture().run({ action: 'lookup', uid, auth })).data.data.item, item);
  const f = apiFixture({ unknown: true }); assert.equal((await f.run({ action: 'lookup', uid, auth })).status, 404);
  assert.equal(f.queries.every(q => q.init.method === 'GET'), true);
});

test('API recusa origem, método, UID e conteúdo inválidos antes de acessar banco', async () => {
  const f = apiFixture();
  assert.equal((await f.run({ action: 'lookup', uid, auth }, { method: 'GET' })).status, 405);
  assert.equal((await f.run({ action: 'lookup', uid, auth }, { headers: { origin: 'https://evil.test' } })).status, 403);
  for (const body of [{ action: 'lookup', uid: 'not-a-uid', auth }, { action: 'delete', uid, auth }, { action: 'bind', uid, item: '<script>', auth }, '{bad-json']) assert.equal((await f.run(body)).status, 400);
  assert.equal(f.queries.length, 0);
});
