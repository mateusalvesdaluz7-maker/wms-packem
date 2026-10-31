'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const lotCore = require('../bob-lot-core.js');

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
    impStatus: { textContent: '', appendChild() {} },
    impMap: { innerHTML: 'mapeamento aberto' },
    impHrow: { value: '1' },
    mapEt: { value: '0' },
    mapPr: { value: '1' },
    mapDe: { value: '2' },
    mapPl: { value: '3' },
    mapLo: { value: '-1' },
  };
  const actions = [];
  const context = {
    $: (selector) => elements[selector.slice(1)],
    window: { _bobReady: true, BobLotCore: lotCore },
    document: { createElement: () => ({ style: {} }) },
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

test('lote importado é salvo na bobina e encaminhado à Expedição após confirmar na nuvem', async () => {
  const { context, elements, actions } = importContext(async () => { actions.push('cloud'); });
  elements.mapLo.value = '4';
  context.impRows = [
    ['Etiqueta', 'Produto', 'Descrição', 'Quantidade Produzida', 'Lote'],
    ['T30383860', '0303490078', 'Tecido', '18,7', 'LOTE 42'],
  ];
  let sent;
  context.window.EXP = { importBobLotes: async (rows) => {
    sent = rows;
    actions.push('expedicao');
    return { lots: 1, added: 1, skipped: 0, synced: true };
  } };
  await context.doImport();
  assert.equal(context.BOB.T30383860.lote, 'LOTE 42');
  assert.equal(sent[0].lote, 'LOTE 42');
  assert.ok(actions.indexOf('cloud') < actions.indexOf('expedicao'));
  assert.match(elements.impStatus.textContent, /1 lote\(s\) atualizado\(s\) na Expedição/);
});

test('relatório 5646 mantém a coluna OP junto da etiqueta e do lote', async () => {
  const { context, elements } = importContext(async () => {});
  Object.assign(elements, {mapOp:{value:'5'}});
  elements.mapEt.value='1';elements.mapPr.value='6';elements.mapDe.value='7';elements.mapPl.value='9';elements.mapLo.value='15';
  context.impRows=[
    ['Status','Etiqueta','Status','Filial','Tipo','OP','Produto','Descricao','Armazem','Qtd. Prod.','Qtd. Prod. 2','Peso Liquido','Peso Bruto','Metros Lineares','Dt. Apont.','Lote'],
    ['Finalizado','T30384872','Finalizado','010101','','04690601008','0404550219','LINER 198CM',71,1700,0,50,55,1700,'2026-10-02','117.10'],
  ];
  let sent;
  context.window.EXP={importBobMatchingCutOps:async rows=>{sent=rows;return {lots:1,added:1,skipped:0,matched:1,unmatched:0,synced:true};}};
  await context.doImport();
  assert.equal(context.BOB.T30384872.op,'04690601008');
  assert.equal(context.BOB.T30384872.lote,'117.10');
  assert.equal(sent[0].op,'04690601008');
});

test('relatório histórico com muitos lotes pede escolha do lote sem disparar todos', async () => {
  const { context, elements } = importContext(async () => {});
  elements.mapLo.value = '4';
  context.impRows = [['Etiqueta', 'Produto', 'Descrição', 'Quantidade Produzida', 'Lote']];
  for (let i = 0; i < 101; i++) context.impRows.push(['T'+i, '0303490078', 'Tecido', '1', 'LOTE '+i]);
  let dispatched = 0;
  context.window.EXP = { importBobLotes: async () => { dispatched++; } };
  await context.doImport();
  assert.equal(dispatched, 0);
  assert.match(elements.impStatus.textContent, /101 lotes/);
  assert.match(elements.impStatus.textContent, /Informe o lote desejado/);
});

test('migração confirma bobinas no IndexedDB antes de liberar cópia antiga', async () => {
  const start = app.indexOf('/* Confirma a migração antes de liberar a cópia redundante');
  const end = app.indexOf('/* Busca sob demanda somente depois', start);
  assert.ok(start >= 0 && end > start);
  let stored = { T2: { pr: '0303490078', lote: '78.09/26' } };
  const events = [];
  const context = {
    BOB: { T1: { pr: '0303490078', lote: '117.10/26' } },
    _bobIDB: {
      get: async () => stored,
      set: async (_key, value) => { stored = JSON.parse(JSON.stringify(value)); events.push('idb'); },
    },
    localStorage: { removeItem: () => events.push('local-removido') },
    window: { _bobReady: false },
    document: { getElementById: () => null },
    console,
  };
  vm.createContext(context); vm.runInContext(app.slice(start, end), context);
  await new Promise(setImmediate);
  assert.deepEqual(events, ['idb', 'local-removido']);
  assert.equal(context.window._bobReady, true);
  assert.deepEqual(Object.keys(stored).sort(), ['T1', 'T2']);
});

test('NF antiga só libera localStorage após salvar estado e backup no IndexedDB', async () => {
  const legacy=JSON.stringify({NFS:{NF1:{nNF:'1'}},ETQ:{T1:{id:'T1'}},ROMS:{}});
  const storage=new Map([['wmsx_nf',legacy]]),idb=new Map();
  const context={NFS:{NF1:{nNF:'1'}},ETQ:{T1:{id:'T1'}},ROMS:{},saveNF:function(){},
    _nfPub(){},_bobIDB:{get:async key=>idb.get(key),set:async(key,value)=>{idb.set(key,structuredClone(value));}},
    localStorage:{getItem:key=>storage.get(key)??null,removeItem:key=>storage.delete(key)},
    window:{},document:{querySelector:()=>null},updateStageBadge(){},console};
  loadBetween('   /* Migra a cópia antiga da NF', '  /* ---- ponte com a nuvem (Supabase): substitui',context);
  await new Promise(setImmediate);
  assert.equal(storage.has('wmsx_nf'),false);
  assert.equal(idb.get('nf-legacy-backup'),legacy);
  assert.equal(idb.get('nf').ETQ.T1.id,'T1');
  assert.equal(context.window._nfLSFull,true);
});

test('falha no backup da NF preserva a cópia local', async () => {
  const legacy=JSON.stringify({NFS:{},ETQ:{T1:{id:'T1'}},ROMS:{}});
  const storage=new Map([['wmsx_nf',legacy]]),idb=new Map();
  const context={NFS:{},ETQ:{T1:{id:'T1'}},ROMS:{},saveNF:function(){},
    _nfPub(){},_bobIDB:{get:async key=>idb.get(key),set:async(key,value)=>{if(key==='nf-legacy-backup')throw new Error('sem espaço no IDB');idb.set(key,structuredClone(value));}},
    localStorage:{getItem:key=>storage.get(key)??null,removeItem:key=>storage.delete(key)},
    window:{},document:{querySelector:()=>null},updateStageBadge(){},console:{warn(){}}};
  loadBetween('   /* Migra a cópia antiga da NF', '  /* ---- ponte com a nuvem (Supabase): substitui',context);
  await new Promise(setImmediate);
  assert.equal(storage.get('wmsx_nf'),legacy);
  assert.notEqual(context.window._nfLSFull,true);
});

test('NF com mesma quantidade e etiquetas diferentes preserva ambas', async () => {
  const legacy=JSON.stringify({NFS:{},ETQ:{LOCAL:{id:'LOCAL'}},ROMS:{}});
  const storage=new Map([['wmsx_nf',legacy]]),idb=new Map([['nf',{NFS:{},ETQ:{REMOTA:{id:'REMOTA'}},ROMS:{}}]]);
  const context={NFS:{},ETQ:{LOCAL:{id:'LOCAL'}},ROMS:{},saveNF:function(){},
    _nfPub(){},_bobIDB:{get:async key=>idb.get(key),set:async(key,value)=>{idb.set(key,structuredClone(value));}},
    localStorage:{getItem:key=>storage.get(key)??null,removeItem:key=>storage.delete(key)},
    window:{},document:{querySelector:()=>null},updateStageBadge(){},console};
  loadBetween('   /* Migra a cópia antiga da NF', '  /* ---- ponte com a nuvem (Supabase): substitui',context);
  await new Promise(setImmediate);
  assert.deepEqual(Object.keys(idb.get('nf').ETQ).sort(),['LOCAL','REMOTA']);
  assert.equal(idb.get('nf-prior-backup').ETQ.REMOTA.id,'REMOTA');
  assert.equal(storage.has('wmsx_nf'),false);
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
