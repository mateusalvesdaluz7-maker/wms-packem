'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'wms-app.js'), 'utf8');

function loadBetween(start, end, context) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `trecho ${start} encontrado`);
  vm.createContext(context);
  vm.runInContext(app.slice(from, to), context);
  return context;
}

function importContext(syncBobDelta) {
  const elements = {
    mapDo: { disabled: false },
    impStatus: { textContent: '' },
    impMap: { innerHTML: 'mapeamento aberto' },
    impHrow: { value: '1' },
    mapEt: { value: '0' },
    mapPr: { value: '1' },
    mapDe: { value: '2' },
    mapPl: { value: '3' },
  };
  const actions = [];
  const context = {
    $: (selector) => elements[selector.slice(1)],
    window: { _bobReady: true },
    impRows: [['Etiqueta', 'Produto', 'Descrição', 'Quantidade Produzida'], ['T30383860', '0303490078', 'Tecido', '18,7']],
    BOB: { T30383860: { pr: '0303490078', desc: 'Tecido', pl: 18.7, rem: 5 } },
    _bobIDB: { set: async () => { actions.push('idb'); } },
    saveBOB: () => actions.push('saveBOB'),
    syncBobDelta,
    renderBobCatalog: () => {},
    logAct: () => actions.push('log'),
    toast: () => {},
    nowISO: () => '2026-09-26T12:00:00Z',
    session: { u: 'admin' },
    brNum: (value) => Number(String(value).replace(',', '.')),
  };
  loadBetween('async function doImport()', 'function bobImportUI()', context);
  return { context, elements, actions };
}

test('reimporta etiqueta já salva localmente e só confirma após a nuvem responder', async () => {
  let resolveUpload;
  const pendingUpload = new Promise((resolve) => { resolveUpload = resolve; });
  let sent;
  const { context, elements, actions } = importContext(async (ids, progress) => {
    sent = ids;
    progress(ids.length);
    await pendingUpload;
  });
  const importing = context.doImport();
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], 'T30383860');
  assert.equal(elements.impMap.innerHTML, 'mapeamento aberto');
  assert.equal(actions.includes('log'), false);
  assert.equal(context.BOB.T30383860.rem, 5);
  resolveUpload();
  await importing;
  assert.equal(elements.impMap.innerHTML, '');
  assert.match(elements.impStatus.textContent, /confirmadas na nuvem/);
  assert.equal(actions.includes('log'), true);
});

test('falha no envio mantém a importação local identificada como incompleta e permite repetir', async () => {
  const { context, elements, actions } = importContext(async () => { throw new Error('rede indisponível'); });
  await context.doImport();
  assert.match(elements.impStatus.textContent, /envio incompleto à nuvem/);
  assert.equal(elements.impMap.innerHTML, 'mapeamento aberto');
  assert.equal(elements.mapDo.disabled, false);
  assert.equal(actions.includes('log'), false);
});

test('recuperação envia o catálogo local com inserção somente de ausentes', async () => {
  const elements = { bobRestoreCloud: { disabled: false }, bobRestoreStatus: { textContent: '' } };
  let call;
  const context = {
    $: (selector) => elements[selector.slice(1)],
    window: { _bobReady: true },
    BOB: {
      T30383860: { pr: '0303490078', desc: 'Tecido', pl: 18.7, apAt: '2026-09-25T12:00:00Z' },
      R_REMOVIDA: { pr: '0303490078', desc: 'Etiqueta antiga', pl: 18.7 },
    },
    supa: {},
    chunkUp: async (table, rows, options, progress) => { call = { table, rows, options }; progress(rows.length); },
    toast: () => {},
  };
  loadBetween('async function restoreBobMissing()', 'function printBobLabel(', context);
  await context.restoreBobMissing();
  assert.equal(call.table, 'bobinas');
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].etiqueta, 'T30383860');
  assert.equal(call.options.onConflict, 'etiqueta');
  assert.equal(call.options.ignoreDuplicates, true);
  assert.match(elements.bobRestoreStatus.textContent, /Ausentes adicionadas; existentes preservadas/);
});

test('envio em blocos só avança após resposta válida e para na primeira falha', async () => {
  const calls = [], progress = [];
  const context = {
    window: { _bulkUp: 0 },
    supa: { from: (table) => ({ upsert: async (rows, options) => {
      calls.push({ table, count: rows.length, options });
      return calls.length === 2 ? { error: { message: 'falha no segundo lote' } } : { error: null };
    } }) },
  };
  loadBetween('async function chunkUp(', '/* Publica a aba fiscal', context);
  const rows = Array.from({ length: 850 }, (_, i) => ({ etiqueta: `T${i}` }));
  await assert.rejects(context.chunkUp('bobinas', rows, { ignoreDuplicates: true }, (done) => progress.push(done)), /falha no segundo lote/);
  assert.deepEqual(calls.map((call) => call.count), [400, 400]);
  assert.equal(calls[0].options.ignoreDuplicates, true);
  assert.deepEqual(progress, [400]);
  assert.equal(context.window._bulkUp, 0);
  context.supa.from = () => ({ upsert: async () => null });
  await assert.rejects(context.chunkUp('bobinas', rows.slice(0, 1)), /falha ao gravar/);
});

test('consulta diferencia ausência real de falha de conexão', async () => {
  function makeLookup(results) {
    const context = {
      window: { etqLookup: () => null },
      BOB: {},
      STAGE: [],
      supa: { from: (table) => ({ select() { return this; }, eq() { return this; }, limit() { return Promise.resolve(results[table]); } }) },
      saveBOB: () => {},
      setTimeout: () => 0,
    };
    loadBetween('var _bobFetchPending={};', 'window.bobFetch=bobFetch;', context);
    return context.bobFetch;
  }
  const missing = makeLookup({ bobinas: { data: [] }, etiquetas: { data: [] } });
  assert.equal(await missing('T30383860'), null);
  const offline = makeLookup({ bobinas: { data: null, error: { message: 'timeout' } }, etiquetas: { data: [] } });
  await assert.rejects(offline('T30383860'), /Falha ao consultar/);
  const incomplete = makeLookup({ bobinas: null, etiquetas: { data: [] } });
  await assert.rejects(incomplete('T30383860'), /Resposta incompleta/);
  const found = makeLookup({ bobinas: { data: [{ pr: '0303490078', descricao: 'Tecido', pl: 18.7 }] }, etiquetas: { data: null, error: { message: 'timeout' } } });
  assert.equal((await found('T30383860')).pr, '0303490078');
});
