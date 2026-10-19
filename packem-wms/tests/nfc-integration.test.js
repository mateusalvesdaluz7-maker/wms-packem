'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { normalizeCode, createReader } = require('../nfc-core.js');

// Revisão independente. Protocolos e timers locais; nenhuma chamada a produção.
function errorPt(callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof Error);
    assert.ok(typeof error.message === 'string' && error.message.trim().length > 0);
    assert.match(error.message, /c[oó]digo|v[aá]lid|texto|modo|limite|caracter|bytes|leitura|conte[uú]do|endere[cç]o|somente|permit|vazio|URL|UID|NFC/i);
    return true;
  });
}

function harness(extra = {}) {
  let id = 0; let timerId = 0;
  const timers = new Map(); const sent = []; const states = []; const delivered = []; const delays = []; const cleared = [];
  const reader = createReader({
    send: (payload) => { sent.push(structuredClone(payload)); if (extra.send) return extra.send(payload); },
    deliver: (code, context, mode) => { delivered.push({ code, context, mode }); return extra.deliver ? extra.deliver(code, context, mode) : true; },
    onState: (state) => states.push({ ...state }),
    makeId: () => `review-request-${++id}`,
    setTimer: (callback, delay) => { const key = ++timerId; timers.set(key, callback); delays.push(delay); return key; },
    clearTimer: (key) => { cleared.push(key); timers.delete(key); },
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  });
  return {
    reader, timers, sent, states, delivered, delays, cleared,
    requestId: () => sent.filter((m) => m.action === 'scan').at(-1).requestId,
    fire: () => { for (const [key, callback] of [...timers]) { timers.delete(key); callback(); } },
  };
}
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

test('normalização NDEF preserva conteúdo para o limpador existente', () => {
  assert.equal(normalizeCode('  T123\nCOD: 031|VAGA: A-100-1  '), 'T123\nCOD: 031|VAGA: A-100-1');
  assert.equal(normalizeCode('  abc-0001  ', 'ndef'), 'abc-0001');
  assert.equal(normalizeCode('A\tB\r\nC|D', 'ndef'), 'A\tB\r\nC|D');
});
for (const [label, value] of [['null', null], ['undefined', undefined], ['número', 123], ['array', ['CODE']], ['objeto', {}], ['booleano', false], ['vazio', ''], ['branco', ' \t\r\n ']]) {
  test(`NDEF exige string não vazia: ${label}`, () => errorPt(() => normalizeCode(value, 'ndef')));
}
for (const code of ['A\u0000B', 'A\u0001B', 'A\u000bB', 'A\u001bB', 'A\u007fB', 'A\u0085B', '<img src=x>', 'A>B', 'A`B']) {
  test(`NDEF rejeita controles ou markup ${JSON.stringify(code)}`, () => errorPt(() => normalizeCode(code, 'ndef')));
}
test('NDEF aceita limites de 1024 caracteres/2048 bytes', () => {
  for (const code of ['A'.repeat(1024), 'á'.repeat(1024), '😀'.repeat(512), '界'.repeat(682) + 'é']) assert.equal(normalizeCode(code), code);
});
test('NDEF limita caracteres e bytes separadamente', () => {
  for (const code of ['A'.repeat(1025), '漢'.repeat(683), '😀'.repeat(513)]) errorPt(() => normalizeCode(code));
});
for (const key of ['etiqueta', 'codigo', 'code', 'sku']) {
  test(`URL aceita somente o código da query ${key}`, () => assert.equal(normalizeCode(`https://example.test/tag?${key}=ET-0001`), 'ET-0001'));
}
test('URL decodifica código sem abrir ou entregar a URL inteira', () => {
  assert.equal(normalizeCode('http://example.test/?codigo=T123%0ACOD%3A%20031%7CVAGA%3A%20A-100-1'), 'T123\nCOD: 031|VAGA: A-100-1');
});
for (const url of ['https://example.test/', 'https://example.test/ET1', 'https://example.test/?code=', 'https://example.test/?code=A&sku=B', 'https://example.test/?code=A&code=B', 'https://example.test/?code=%3Cscript%3E']) {
  test(`URL sem código único seguro é rejeitada: ${url}`, () => errorPt(() => normalizeCode(url)));
}
test('UID explícito admite somente hexadecimal par de 8 a 32 caracteres', () => {
  assert.equal(normalizeCode('aabbccdd', 'uid'), 'AABBCCDD');
  assert.equal(normalizeCode('ab'.repeat(16), 'uid'), 'AB'.repeat(16));
  assert.equal(normalizeCode('AABBCCDD', 'ndef'), 'AABBCCDD');
});
for (const code of ['AABBCC', 'AABBCCD', 'A'.repeat(33), 'AA:BB:CC:DD', '0xAABBCCDD', 'AABBCCGG', 'AA\nBBCCDD']) {
  test(`UID inválido: ${JSON.stringify(code)}`, () => errorPt(() => normalizeCode(code, 'uid')));
}
for (const mode of ['NDEF', 'auto', ['ndef'], {}, null]) {
  test(`modo sem coerção: ${JSON.stringify(mode)}`, () => errorPt(() => normalizeCode('AABBCCDD', mode)));
}
test('core UMD também carrega isolado no navegador sem navegação', () => {
  let opened = 0;
  const context = { URL, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, console, open: () => { opened += 1; throw new Error('navegação proibida'); } };
  context.window = context; context.self = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'nfc-core.js'), 'utf8'), context);
  assert.equal(typeof context.PackemNfcCore.normalizeCode, 'function');
  assert.equal(context.PackemNfcCore.normalizeCode('https://example.test/?code=ET1'), 'ET1');
  assert.equal(opened, 0);
});

test('reader inicia protocolo explícito, nonce e timeout padrão', () => {
  const h = harness(); const context = { inputId: 'mBob' };
  assert.equal(h.reader.isBusy(), false); assert.equal(h.reader.start(context, { mode: 'ndef' }), true);
  assert.deepEqual(h.sent, [{ action: 'scan', requestId: 'review-request-1', mode: 'ndef' }]);
  assert.equal(h.reader.isBusy(), true); assert.equal(h.states.at(-1).status, 'scanning'); assert.deepEqual(h.delays, [35000]);
});
test('reader ocupado não substitui contexto nem requestId', async () => {
  const h = harness(); const first = { inputId: 'first' }; const second = { inputId: 'second' };
  h.reader.start(first, { mode: 'ndef' }); const id = h.requestId();
  assert.equal(h.reader.start(second, { mode: 'uid' }), false); assert.equal(h.sent.length, 1); assert.equal(h.states.at(-1).status, 'busy');
  assert.equal(await h.reader.receive({ requestId: id, status: 'read', text: 'ET1' }), true);
  assert.equal(h.delivered.length, 1); assert.equal(h.delivered[0].context, first); assert.equal(h.delivered[0].mode, 'ndef');
});
test('reader rejeita callbacks sem sessão, nonce incorreto e status inválido', async () => {
  const h = harness(); assert.equal(await h.reader.receive({ requestId: 'old', status: 'read', text: 'ET1' }), false);
  h.reader.start({}, { mode: 'ndef' }); const id = h.requestId();
  for (const payload of [null, [], {}, { status: 'read', text: 'ET1' }, { requestId: ['review-request-1'], status: 'read', text: 'ET1' }, { requestId: 'wrong', status: 'read', text: 'ET1' }, { requestId: id, status: ['read'], text: 'ET1' }, { requestId: id, status: 'unknown', text: 'ET1' }]) assert.equal(await h.reader.receive(payload), false);
  assert.equal(h.reader.isBusy(), true); assert.equal(h.delivered.length, 0);
});
test('callback correspondente é consumido uma única vez', async () => {
  const h = harness(); h.reader.start({}, { mode: 'ndef' }); const payload = { requestId: h.requestId(), status: 'read', text: '  ET1  ' };
  assert.equal(await h.reader.receive(payload), true); assert.equal(await h.reader.receive(payload), false);
  assert.equal(h.delivered.length, 1); assert.equal(h.delivered[0].code, 'ET1'); assert.equal(h.states.at(-1).status, 'delivered');
  assert.equal(h.reader.isBusy(), false); assert.equal(h.timers.size, 0); assert.ok(h.cleared.length > 0);
});
test('cancelamento invalida nonce, limpa timer e não entrega callback tardio', async () => {
  const h = harness(); h.reader.start({}, { mode: 'ndef' }); const id = h.requestId();
  assert.equal(h.reader.cancel(), true); assert.equal(h.reader.cancel(), false); assert.equal(h.reader.isBusy(), false);
  assert.equal(h.sent.at(-1).action, 'cancel'); assert.equal(h.sent.at(-1).requestId, id); assert.equal(h.timers.size, 0);
  assert.equal(h.states.at(-1).status, 'cancelled'); assert.equal(await h.reader.receive({ requestId: id, status: 'read', text: 'ET1' }), false); assert.equal(h.delivered.length, 0);
});
test('timeout cancela nativo e callback antigo não interfere na nova sessão', async () => {
  const h = harness({ timeoutMs: 15 }); h.reader.start({}, { mode: 'ndef' }); const old = h.requestId(); assert.deepEqual(h.delays, [15]); h.fire();
  assert.equal(h.reader.isBusy(), false); assert.equal(h.sent.at(-1).action, 'cancel'); assert.equal(h.sent.at(-1).requestId, old); assert.ok(['error', 'cancelled'].includes(h.states.at(-1).status));
  assert.equal(h.timers.size, 0); assert.ok(h.cleared.length > 0);
  h.reader.start({ inputId: 'new' }, { mode: 'ndef' }); const current = h.requestId(); assert.notEqual(current, old);
  assert.equal(await h.reader.receive({ requestId: old, status: 'read', text: 'OLD' }), false); assert.equal(h.reader.isBusy(), true);
  assert.equal(await h.reader.receive({ requestId: current, status: 'read', text: 'NEW' }), true); assert.equal(h.delivered[0].code, 'NEW');
});
for (const status of ['error', 'cancelled']) {
  test(`callback nativo ${status} encerra sem entregar`, async () => {
    const h = harness(); h.reader.start({}, { mode: 'ndef' }); const id = h.requestId();
    assert.equal(await h.reader.receive({ requestId: id, status, message: 'Operação encerrada.' }), true);
    assert.equal(h.reader.isBusy(), false); assert.equal(h.timers.size, 0); assert.equal(h.delivered.length, 0); assert.equal(h.states.at(-1).status, status);
    assert.equal(await h.reader.receive({ requestId: id, status: 'read', text: 'ET1' }), false);
  });
}
test('NDEF inválido não usa UID como fallback silencioso', async () => {
  const h = harness(); h.reader.start({}, { mode: 'ndef' });
  assert.equal(await h.reader.receive({ requestId: h.requestId(), status: 'read', text: '', uid: 'AABBCCDD' }), true);
  assert.equal(h.delivered.length, 0); assert.equal(h.states.at(-1).status, 'error'); assert.equal(h.reader.isBusy(), false);
});
test('modo UID explícito entrega somente UID normalizado', async () => {
  const h = harness(); h.reader.start({}, { mode: 'uid' });
  assert.equal(await h.reader.receive({ requestId: h.requestId(), status: 'read', text: 'aabbccdd', uid: 'AABBCCDD' }), true);
  assert.equal(h.delivered[0].code, 'AABBCCDD'); assert.equal(h.delivered[0].mode, 'uid');
});
for (const outcome of [undefined, true]) {
  test(`deliver ${String(outcome)} é sucesso`, async () => {
    const h = harness({ deliver: () => outcome }); h.reader.start({}, { mode: 'ndef' });
    assert.equal(await h.reader.receive({ requestId: h.requestId(), status: 'read', text: 'ET1' }), true); assert.equal(h.states.at(-1).status, 'delivered');
  });
}
for (const [name, callback] of [['false', () => false], ['throw', () => { throw new Error('Falha do dispatcher'); }]]) {
  test(`deliver ${name} encerra em erro sem repetir`, async () => {
    const h = harness({ deliver: callback }); h.reader.start({}, { mode: 'ndef' }); const payload = { requestId: h.requestId(), status: 'read', text: 'ET1' };
    assert.equal(await h.reader.receive(payload), true); assert.equal(h.states.at(-1).status, 'error'); assert.equal(h.reader.isBusy(), false);
    assert.equal(await h.reader.receive(payload), false); assert.equal(h.delivered.length, 1);
  });
}
for (const result of ['resolve', 'false', 'reject']) {
  test(`Promise de entrega ${result}: busy, dedupe e conclusão correta`, async () => {
    const d = deferred(); const h = harness({ deliver: () => d.promise }); h.reader.start({}, { mode: 'ndef' });
    const payload = { requestId: h.requestId(), status: 'read', text: 'ET1' }; const receiving = h.reader.receive(payload);
    assert.equal(h.delivered.length, 1); assert.equal(h.reader.isBusy(), true); assert.equal(h.reader.cancel(), false);
    assert.equal(await h.reader.receive(payload), false); assert.equal(h.reader.start({}, { mode: 'ndef' }), false); assert.equal(h.sent.length, 1);
    if (result === 'reject') d.reject(new Error('Erro assíncrono')); else d.resolve(result === 'false' ? false : true);
    assert.equal(await receiving, true); assert.equal(h.reader.isBusy(), false); assert.equal(h.delivered.length, 1);
    assert.equal(h.states.at(-1).status, result === 'resolve' ? 'delivered' : 'error');
  });
}
test('falha do transporte retorna erro e não deixa sessão aberta', async () => {
  const h = harness({ send: () => { throw new Error('Bridge indisponível'); } });
  assert.equal(h.reader.start({}, { mode: 'ndef' }), false); assert.equal(h.reader.isBusy(), false); assert.equal(h.states.at(-1).status, 'error'); assert.equal(h.timers.size, 0);
  assert.equal(await h.reader.receive({ requestId: 'review-request-1', status: 'read', text: 'ET1' }), false);
});
test('modo inválido não envia pedido nativo', () => {
  const h = harness(); assert.equal(h.reader.start({}, { mode: ['ndef'] }), false); assert.equal(h.sent.length, 0); assert.equal(h.reader.isBusy(), false); assert.equal(h.states.at(-1).status, 'error');
});
test('nova aproximação pode ler o mesmo código com novo nonce', async () => {
  const h = harness(); const ids = [];
  for (let i = 0; i < 2; i += 1) { assert.equal(h.reader.start({}, { mode: 'ndef' }), true); const id = h.requestId(); ids.push(id); assert.equal(await h.reader.receive({ requestId: id, status: 'read', text: 'ET1' }), true); }
  assert.notEqual(ids[0], ids[1]); assert.equal(h.delivered.length, 2);
});

// DOM mínimo para a factory injetável e o dispatcher real, sem carregar o WMS inteiro.
class Element {
  constructor(doc, tag) { this.doc = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.style = {}; this.dataset = {}; this.attributes = {}; this.className = ''; this.id = ''; this.type = tag === 'input' ? 'text' : ''; this.value = ''; this.disabled = false; this.hidden = false; this.textContent = ''; this.events = []; this.listeners = {}; }
  get isConnected() { return this === this.doc.body || this === this.doc.head || !!(this.parentNode && this.parentNode.isConnected); }
  get nextSibling() { return this.parentNode && this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null; }
  get classList() { const el = this; return { contains: (name) => el.className.split(/\s+/).includes(name), add: (name) => { if (!el.className.split(/\s+/).includes(name)) el.className += ' ' + name; }, remove: (name) => { el.className = el.className.split(/\s+/).filter((v) => v !== name).join(' '); } }; }
  appendChild(el) { if (el.parentNode) el.parentNode.removeChild(el); el.parentNode = this; this.children.push(el); return el; }
  insertBefore(el, before) { if (el.parentNode) el.parentNode.removeChild(el); const index = before ? this.children.indexOf(before) : this.children.length; el.parentNode = this; this.children.splice(index, 0, el); return el; }
  removeChild(el) { this.children.splice(this.children.indexOf(el), 1); el.parentNode = null; return el; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { this.events.push(event); for (const fn of this.listeners[event.type] || []) fn(event); return true; }
  click() { if (!this.disabled && this.onclick) return this.onclick(); }
  focus() { this.doc.activeElement = this; }
  closest(selector) { for (let el = this; el; el = el.parentNode) if (selector === '.view' && el.classList.contains('view')) return el; return null; }
  getClientRects() { for (let el = this; el; el = el.parentNode) if (el.hidden || el.style.display === 'none') return []; return this.isConnected && this.type !== 'hidden' ? [{}] : []; }
}
class Document {
  constructor() { this.body = new Element(this, 'body'); this.head = new Element(this, 'head'); this.listeners = {}; this.hidden = false; }
  createElement(tag) { return new Element(this, tag); }
  all() { const visit = (el) => [el, ...el.children.flatMap(visit)]; return [...visit(this.head), ...visit(this.body)]; }
  getElementById(id) { return this.all().find((el) => el.id === id) || null; }
  querySelector(selector) { return this.all().find((el) => selector.split('.').filter(Boolean).every((name) => el.classList.contains(name))) || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type) { for (const fn of this.listeners[type] || []) fn(); }
}
class ScanEvent { constructor(type, properties = {}) { this.type = type; Object.assign(this, properties); } preventDefault() { this.defaultPrevented = true; } }
const appSource = fs.readFileSync(path.join(root, 'wms-app.js'), 'utf8');
function segment(startText, endText) {
  const start = appSource.indexOf(startText); const end = appSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `localizar bloco real: ${startText}`); return appSource.slice(start, end);
}
function environment({ native = true, viewId = 'v-mov', options = { enter: true } } = {}) {
  const doc = new Document(); const toasts = []; const sent = []; const events = {}; const timers = new Map(); let serial = 0; let timerId = 0;
  const permissions = new Set(['visualizar', 'cadastrar', 'separar_requisicao']); const policy = { role: 'operador', views: [viewId] };
  const view = doc.createElement('div'); view.id = viewId; view.className = 'view active'; doc.body.appendChild(view);
  const wrapper = doc.createElement('div'); wrapper.className = 'camfield'; view.appendChild(wrapper);
  const input = doc.createElement('input'); input.id = 'target'; wrapper.appendChild(input);
  const cameraButton = doc.createElement('button'); cameraButton.className = 'cambtn'; wrapper.appendChild(cameraButton);
  const camera = doc.createElement('div'); camera.id = 'scan'; doc.body.appendChild(camera);
  const win = { canAction: (action) => permissions.has(action), addEventListener: (type, fn) => { (events[type] ||= []).push(fn); }, fetch: () => { throw new Error('API real proibida'); }, open: () => { throw new Error('Navegação proibida'); } };
  if (native) win.webkit = { messageHandlers: { packemNFC: { postMessage: (message) => sent.push({ ...message }) } } };
  const context = { window: win, document: doc, session: { u: 'operador' }, US: [{ u: 'operador', active: true }, { u: 'outro', active: true }], curRole: () => policy.role, allowedViews: () => policy.views, ETQ: {}, ROMS: {}, BOB: {}, norm: (v) => String(v || '').trim().toUpperCase(), toast: (...args) => toasts.push(args), Event: ScanEvent, KeyboardEvent: ScanEvent, console: { warn() {} }, O: { inputId: 'target', ...options } };
  vm.createContext(context);
  vm.runInContext(segment('window.cleanScanCode=function(', '/* ===== LEITOR POR CÂMERA'), context);
  vm.runInContext(segment('  function resolveRomSupplierScan(raw){', '  /* O depósito precisa'), context);
  vm.runInContext(segment('/* PACKEM_NFC_DISPATCH_START', '/* PACKEM_NFC_DISPATCH_END'), context);
  const shim = { createReader: (settings) => createReader({ ...settings, makeId: () => `ui-request-${++serial}`, setTimer: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimer: (key) => timers.delete(key) }) };
  const api = require('../wms-nfc.js')(win, doc, shim);
  return { doc, win, context, permissions, policy, view, input, wrapper, cameraButton, camera, api, toasts, sent, timers, options,
    node: (cls) => doc.all().find((el) => el.classList.contains(cls)),
    snapshot: (opts = options) => win.packemNfcContext('target', opts),
    apply: (raw, opts = options, expected) => win.applyPackemNfcScan('target', raw, opts, expected),
    openAndStart() { api.attach('target', options); this.node('packem-nfc-button').click(); this.node('packem-nfc-start').click(); return sent.at(-1); },
    emit: (type) => { for (const fn of events[type] || []) fn(); },
  };
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

test('dispatcher real: limpeza multilinha, input e Enter preservados', () => {
  const h = environment(); const expected = h.snapshot();
  assert.equal(h.apply('ET1\nCOD: 123|VAGA: A-100-1', h.options, expected), true);
  assert.equal(h.input.value, 'ET1'); assert.deepEqual(h.input.events.map((e) => e.type), ['input', 'keydown']);
  assert.equal(h.input.events[1].key, 'Enter'); assert.equal(h.input.events[1].bubbles, true);
});
test('dispatcher real: endereço usa scanKind e enter false não envia Enter', () => {
  const h = environment({ options: { scanKind: 'addr', enter: false } });
  assert.equal(h.apply('ET1|VAGA: A-100-1', h.options, h.snapshot()), true); assert.equal(h.input.value, 'A-100-1'); assert.deepEqual(h.input.events.map((e) => e.type), ['input']);
});
test('dispatcher onResult recebe código limpo sem preencher ou emitir Enter', () => {
  const received = []; const h = environment({ options: { enter: true, onResult: (v) => { received.push(v); return false; } } });
  assert.equal(h.apply('ET1|COD: P1', h.options, h.snapshot()), false); assert.deepEqual(received, ['ET1']); assert.equal(h.input.value, ''); assert.deepEqual(h.input.events, []);
});
test('dispatcher captura exceção síncrona e preserva Promise assíncrona', async () => {
  const h = environment({ options: { onResult: () => { throw new Error('Falha simulada'); } } });
  assert.equal(h.apply('ET1', h.options, h.snapshot()), false); assert.ok(h.toasts.length > 0);
  const d = deferred(); const options = { onResult: () => d.promise }; const expected = h.snapshot(options);
  const result = h.apply('ET1', options, expected); assert.equal(result, d.promise); d.resolve(false); assert.equal(await result, false);
});
test('câmera continua usando o mesmo fillScanTarget e a mesma semântica de entrega', () => {
  const h = environment(); assert.equal(h.context.fill('ET1'), true); const cameraEvents = h.input.events.map((e) => ({ type: e.type, key: e.key }));
  h.input.events.length = 0; assert.equal(h.apply('ET1', h.options, h.snapshot()), true); assert.deepEqual(h.input.events.map((e) => ({ type: e.type, key: e.key })), cameraEvents);
  assert.match(appSource, /function fill\(val\)\{return fillScanTarget\(O,val\);\}/);
});
for (const [viewId, options, expected] of [['v-mov', {}, 'visualizar'], ['v-mov', { enter: true }, 'cadastrar'], ['v-requisicao', { onResult() {} }, 'separar_requisicao'], ['v-etqconsulta', { onResult() {} }, 'visualizar']]) {
  test(`autorização dinâmica usa ${expected} em ${viewId}`, () => {
    const h = environment({ viewId, options }); assert.equal(h.snapshot().action, expected); h.permissions.delete(expected); assert.equal(h.snapshot(), null);
  });
}
for (const [label, modify] of [
  ['logout', (h) => { h.context.session = null; }], ['outro usuário', (h) => { h.context.session.u = 'outro'; }],
  ['outra função', (h) => { h.policy.role = 'administrador'; }], ['conta inativa', (h) => { h.context.US[0].active = false; }],
  ['permissão revogada', (h) => h.permissions.clear()], ['aba não permitida', (h) => { h.policy.views = []; }],
  ['campo disabled', (h) => { h.input.disabled = true; }], ['campo hidden', (h) => { h.input.type = 'hidden'; }],
  ['campo invisível', (h) => { h.input.style.display = 'none'; }], ['campo desconectado', (h) => h.wrapper.removeChild(h.input)],
  ['mesmo ID com novo elemento', (h) => { h.wrapper.removeChild(h.input); const replacement = h.doc.createElement('input'); replacement.id = 'target'; h.wrapper.appendChild(replacement); }],
  ['câmera aberta', (h) => h.camera.classList.add('show')],
  ['aba ativa trocada', (h) => { h.view.classList.remove('active'); const other = h.doc.createElement('div'); other.id = 'v-other'; other.className = 'view active'; h.doc.body.appendChild(other); }],
]) {
  test(`snapshot não autoriza entrega após ${label}`, () => {
    let received = 0; const h = environment({ options: { onResult: () => { received += 1; } } }); const expected = h.snapshot(); assert.ok(expected); modify(h);
    assert.equal(h.apply('ET1', h.options, expected), false); assert.equal(received, 0); assert.deepEqual(h.input.events, []);
  });
}
test('dispatcher exige snapshot inicial e bloqueia conta ausente', () => {
  const h = environment(); assert.equal(h.apply('ET1'), false); h.context.US = []; assert.equal(h.snapshot(), null);
});
test('guarda de documento usa resolvedor real antes de onResult', () => {
  let received = 0; const options = { allowedDocKey: 'ROM-A', onResult: () => { received += 1; return true; } }; const h = environment({ options });
  h.context.ETQ['2600267407'] = { nf: 'ROM-B', nRomaneio: 'B', bobina: '2600267407', status: 'pendente' }; h.context.ROMS['ROM-B'] = { supplierLabels: true };
  assert.equal(h.apply('4392$2600267407$11894', options, h.snapshot()), false); assert.equal(received, 0);
  h.context.ETQ['2600267407'].nf = 'ROM-A'; assert.equal(h.apply('4392$2600267407$11894', options, h.snapshot()), true); assert.equal(received, 1);
});
test('guarda de OCR bloqueia inexistente, recebido e saída; aceita pendente do documento', () => {
  const received = []; const options = { allowedDocKey: 'ROM-A', keepOpenOnOcr: true, onResult: (v) => { received.push(v); return true; } }; const h = environment({ options });
  assert.equal(h.apply('2600267407', options, h.snapshot()), false);
  for (const status of ['entrada', 'saida']) { h.context.ETQ['2600267407'] = { nf: 'ROM-A', status }; assert.equal(h.apply('2600267407', options, h.snapshot()), false); }
  h.context.ETQ['2600267407'].status = 'pendente'; assert.equal(h.apply('2600267407', options, h.snapshot()), true); assert.deepEqual(received, ['2600267407']);
});
test('resolvedor ambíguo não chega ao callback', () => {
  let calls = 0; const h = environment({ options: { onResult: () => { calls += 1; } } });
  assert.equal(h.apply('$2600267407$$2600267408$', h.options, h.snapshot()), false); assert.equal(calls, 0);
});

test('factory DOM anexa um botão NFC e preserva botão de câmera', () => {
  const h = environment(); assert.equal(h.api.attach('target', {}), true); assert.equal(h.api.attach('target', { enter: true }), true);
  assert.equal(h.doc.all().filter((el) => el.classList.contains('packem-nfc-button')).length, 1); assert.ok(h.wrapper.children.includes(h.cameraButton)); assert.equal(h.cameraButton.className, 'cambtn');
  assert.equal(h.api.attach('ausente', {}), false); h.input.type = 'hidden'; assert.equal(h.api.attach('target', {}), false);
});
test('Safari sem bridge informa indisponibilidade e não simula leitura', () => {
  const h = environment({ native: false }); h.api.attach('target', {}); h.node('packem-nfc-button').click();
  assert.equal(h.node('packem-nfc-start').disabled, true); assert.match(h.node('packem-nfc-status').textContent, /navegador não acessa o NFC/i); assert.equal(h.sent.length, 0); assert.equal(h.input.value, '');
});
test('UI exige ação explícita e bridge recebe modo selecionado e requestId', async () => {
  const h = environment(); h.api.attach('target', h.options); h.node('packem-nfc-button').click(); assert.equal(h.sent.length, 0);
  h.doc.getElementById('packem-nfc-mode').value = 'uid'; h.node('packem-nfc-start').click(); assert.equal(h.sent[0].mode, 'uid'); assert.equal(typeof h.sent[0].requestId, 'string');
  assert.equal(h.api.receive({ requestId: h.sent[0].requestId, status: 'read', text: 'aabbccdd' }), undefined); await flush(); assert.equal(h.input.value, 'AABBCCDD');
});
test('UI revalida alvo substituído entre aproximação e callback', async () => {
  const h = environment(); const scan = h.openAndStart(); h.wrapper.removeChild(h.input); const replacement = h.doc.createElement('input'); replacement.id = 'target'; h.wrapper.appendChild(replacement);
  h.api.receive({ requestId: scan.requestId, status: 'read', text: 'ET1' }); await flush(); assert.equal(replacement.value, ''); assert.equal(h.input.value, ''); assert.ok(h.node('packem-nfc-result').classList.contains('error'));
});
test('UI revalida permissão e disabled depois de iniciar', async () => {
  for (const change of [(h) => h.permissions.clear(), (h) => { h.input.disabled = true; }]) {
    const h = environment(); const scan = h.openAndStart(); change(h); h.api.receive({ requestId: scan.requestId, status: 'read', text: 'ET1' }); await flush(); assert.equal(h.input.value, ''); assert.deepEqual(h.input.events, []);
  }
});
test('UI deduplica callback e reporta rejeição assíncrona do dispatcher', async () => {
  let calls = 0; const d = deferred(); const h = environment({ options: { onResult: () => { calls += 1; return d.promise; } } }); const scan = h.openAndStart();
  const payload = { requestId: scan.requestId, status: 'read', text: 'ET1' }; h.api.receive(payload); h.api.receive(payload); assert.equal(calls, 1);
  h.node('packem-nfc-close').click(); assert.match(h.node('packem-nfc-status').textContent, /Aguarde/); d.reject(new Error('Falha assíncrona simulada')); await flush();
  assert.ok(h.node('packem-nfc-result').classList.contains('error')); assert.equal(calls, 1);
});
for (const cause of ['pagehide', 'visibilitychange']) {
  test(`UI cancela em ${cause} e ignora resposta tardia`, async () => {
    const h = environment(); const scan = h.openAndStart(); if (cause === 'pagehide') h.emit(cause); else { h.doc.hidden = true; h.doc.emit(cause); }
    assert.equal(h.sent.at(-1).action, 'cancel'); assert.equal(h.sent.at(-1).requestId, scan.requestId);
    h.api.receive({ requestId: scan.requestId, status: 'read', text: 'ET1' }); await flush(); assert.equal(h.input.value, ''); assert.equal(h.timers.size, 0);
  });
}
test('scripts e CSS NFC carregam antes do app; addCam preserva câmera e anexa NFC', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const name of ['nfc-core.js', 'wms-nfc.js', 'wms-nfc.css']) assert.ok(index.indexOf(name) >= 0 && index.indexOf(name) < index.indexOf('src="wms-app.js'));
  const addCam = segment(' window.addCam=function(', " addCam('mBob'"); assert.match(addCam, /b\.onclick=.*scanInto/); assert.match(addCam, /PackemNFC\.attach\(inputId,opts\|\|\{\}\)/);
});
