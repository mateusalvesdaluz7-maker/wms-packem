const test=require('node:test'),assert=require('node:assert/strict');
const {applyReading,validateReading,validReply}=require('../wms-nfc-reader.js');
const event={seq:1,uid:'04A27F1B5E8000',item:'T001',codigo:'0303450047',quantidade:'300',unidade:'KG'};
function context(overrides={}){const counted=new Set(),added=[];return {counted,added,isActive:()=>true,lookup:async()=>({codigo:'0303450047',quantidade:300,unidade:'KG'}),has:id=>counted.has(id),add:async id=>{counted.add(id);added.push(id);},...overrides};}
test('leitura usa ID da embalagem; mesma etiqueta não soma de novo e outra do mesmo produto soma',async()=>{
  const c=context();assert.deepEqual(await applyReading(event,c),{duplicate:false});assert.deepEqual(await applyReading(event,c),{duplicate:true});
  await applyReading({...event,item:'T002',uid:'04A27F1B5E8001',seq:2},c);assert.deepEqual(c.added,['T001','T002']);
});
test('não aplica leitura sem destino ativo nem depois de mudar de tela/usuário durante a consulta',async()=>{
  const c=context({isActive:()=>false});await assert.rejects(applyReading(event,c));assert.equal(c.added.length,0);
  let active=true;const race=context({isActive:()=>active,lookup:async()=>{active=false;return {codigo:event.codigo,quantidade:300,unidade:'KG'};}});
  await assert.rejects(applyReading(event,race));assert.equal(race.added.length,0);
});
test('não cria catálogo a partir da tag nem aceita código, peso ou unidade divergentes',async()=>{
  for(const item of [null,{codigo:'303450047',quantidade:300,unidade:'KG'},{codigo:event.codigo,quantidade:301,unidade:'KG'},{codigo:event.codigo,quantidade:300,unidade:'MT'}]){
    const c=context({lookup:async()=>item});await assert.rejects(applyReading(event,c));assert.equal(c.added.length,0);
  }
});
test('entrada recusada pelo fluxo normal do WMS não vira confirmação NFC',async()=>{const c=context({add:async()=>false});await assert.rejects(applyReading(event,c),/não confirmou/);});
test('recusa UID ausente, campos inválidos e mensagem de outra janela/origem',()=>{
  assert.throws(()=>validateReading({...event,uid:'SIMULADO'}));assert.throws(()=>validateReading({...event,quantidade:'6.300,00'}));assert.throws(()=>validateReading({...event,codigo:'<script>'}));
  const station={},reply={source:station,origin:'https://reader.example',data:{linkId:'abc'}};
  assert.ok(validReply(reply,station,reply.origin,'abc'));assert.equal(validReply({...reply,source:{}},station,reply.origin,'abc'),false);assert.equal(validReply(reply,station,'https://outro.example','abc'),false);assert.equal(validReply(reply,station,reply.origin,'velho'),false);
});
