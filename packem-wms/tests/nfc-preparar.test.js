const test=require('node:test'),assert=require('node:assert/strict');
const {buildPayload,prepare,choices}=require('../wms-nfc-preparar.js');
const {parseText}=require('../wms-nfc-text.js');
test('prepara a tag usando o cadastro, com zeros no código e decimal exato',()=>{const value=buildPayload('ET001',{codigo:'0303450047',quantidade:'006,300000',unidade:'KG'});assert.equal(value.content,'JOB=wms;ID=ET001;COD=0303450047;QTD=6.3;UN=KG');assert.deepEqual(parseText(value.content),value.tag);assert.equal('uid' in value.tag,false);});
test('recusa conteúdo inválido ou acima da capacidade do protocolo sem truncar',()=>{for(const item of [{codigo:'0303;ID=X',quantidade:1,unidade:'KG'},{codigo:'0303',quantidade:0,unidade:'KG'},{codigo:'0303',quantidade:1,unidade:'ERR'},{codigo:'0303',quantidade:0.0000001,unidade:'KG'}])assert.throws(()=>buildPayload('ET001',item));assert.throws(()=>buildPayload('A'.repeat(32),{codigo:'B'.repeat(64),quantidade:'999999999.999999',unidade:'KG'}),/120/);});
test('consulta somente embalagem existente com contexto autenticado e ativo',async()=>{let calls=0;const context={isActive:()=>true,lookup:async()=>{calls++;return null;}};await assert.rejects(prepare('ET001',context),/não encontrada/);assert.equal(calls,1);await assert.rejects(prepare('ET001',{...context,isActive:()=>false}),/Entre no WMS/);assert.equal(calls,1);await assert.rejects(prepare('ET;001',context));assert.equal(calls,1);});
test('troca de tela ou usuário durante consulta impede devolver conteúdo',async()=>{let active=true;const context={isActive:()=>active,lookup:async()=>{active=false;return {codigo:'0303450047',quantidade:300,unidade:'KG'};}};await assert.rejects(prepare('ET001',context),/usuário ou a tela mudou/);});

test('escolha da embalagem mantém IDs e pesos separados para o mesmo produto',()=>{
  const catalog={T001:{pr:'0303450047',pl:300,desc:'Tecido branco'},T002:{pr:'0303450047',pl:250.5,desc:'Tecido branco'},T003:{pr:'0303410008',pl:6300,desc:'Alça'}};
  assert.deepEqual(choices(catalog,'0303450047').map(item=>[item.id,item.quantidade]),[['T001',300],['T002',250.5]]);
  assert.equal(choices(catalog,'t002')[0].id,'T002');assert.equal(choices(catalog,'BRANCO').length,2);assert.equal(choices(catalog,'inexistente').length,0);
});

test('lista NFC limita os resultados e não oferece registros sem identificação compatível',()=>{
  const catalog={'id inválido':{pr:'X'},vazio:null,semProduto:{pl:5},...Object.fromEntries(Array.from({length:40},(_,i)=>['T'+i,{pr:'X',pl:i+1}]))};
  const list=choices(catalog,'');assert.equal(list.length,25);assert.equal(list[0].id,'T0');assert.equal(list[24].quantidade,25);assert.equal(Object.keys(catalog).length,43);
});
