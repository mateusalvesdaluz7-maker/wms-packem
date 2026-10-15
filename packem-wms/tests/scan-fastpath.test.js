const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
const start=source.indexOf('  function resolveRomSupplierScan(raw){');
const end=source.indexOf('  window.resolveRomSupplierScan=resolveRomSupplierScan;',start);
assert.ok(start>=0&&end>start,'localizar o resolvedor usado pelo leitor');
const code=source.slice(start,end);

function resolver(ETQ,ROMS,BOB){
  const context={ETQ,ROMS,BOB,norm:value=>String(value||'').trim().toUpperCase()};
  vm.runInNewContext(code,context);
  return context.resolveRomSupplierScan;
}

test('código físico delimitado resolve sem percorrer todo o catálogo',()=>{
  const catalog=new Proxy({}, {ownKeys(){throw new Error('busca completa desnecessária');}});
  const resolve=resolver({'2600267407':{nf:'ROM-1',nRomaneio:'1',bobina:'2600267407'}},{'ROM-1':{supplierLabels:true}},catalog);
  assert.equal(resolve('4392$2600267407$11894').id,'2600267407');
  assert.equal(resolve('4392$2600267407$11894').supplier,true);
  assert.equal(resolve('2600267407').id,'2600267407');
});

test('número de dez dígitos sem cadastro não inicia busca por fragmentos',()=>{
  const catalog=new Proxy({}, {ownKeys(){throw new Error('busca completa desnecessária');}});
  const resolve=resolver({}, {}, catalog);
  assert.equal(resolve('2600267407'),null);
});

test('código longo ainda localiza etiqueta incorporada e rejeita ambiguidade',()=>{
  const catalog=new Proxy({}, {ownKeys(){throw new Error('busca completa desnecessária');}});
  const resolve=resolver({'2600267407':{nf:'ROM-1',nRomaneio:'1',bobina:'2600267407'}},{'ROM-1':{supplierLabels:true}},catalog);
  assert.equal(resolve('4392260026740711894').id,'2600267407');
  assert.equal(resolve('$2600267407$$2600267408$').ambiguous,true);
});

test('conferência consulta somente etiquetas vinculadas ao documento',()=>{
  const start=source.indexOf('  function nfDocLabelIds(key){');
  const end=source.indexOf('  /* ---- excluir nota importada',start);
  assert.ok(start>=0&&end>start);
  const labels=new Proxy({'2600267407':{nf:'ROM-1'}},{ownKeys(){throw new Error('catálogo completo não deve ser percorrido');}});
  const context={ETQ:labels,NFS:{},ROMS:{'ROM-1':{labelIds:['2600267407','ausente']}}};
  vm.runInNewContext(source.slice(start,end),context);
  assert.deepEqual(Array.from(context.nfDocLabelIds('ROM-1')),['2600267407']);
});
