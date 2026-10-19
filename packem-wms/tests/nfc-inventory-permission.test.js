const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lines=fs.readFileSync(require.resolve('../wms-app.js'),'utf8').split(/\r?\n/);
const guardSource=['function acaoDo(el)','function critica(el)',"document.addEventListener('click',async function(e)"].map(prefix=>{const line=lines.find(line=>line.trim().startsWith(prefix));assert.ok(line,'proteção global não encontrada: '+prefix);return line;}).join('\n');
function fixture({view='v-nfc',marked=true,controls=true,target=true,screen=true,text='Encerrar inventário',allowed=true}={}){
 let listener,prompts=0,stopped=false;
 const button={innerText:text,dataset:marked?{nfcInventoryAction:'finish'}:{},classList:{contains:()=>false},
   closest:selector=>selector==='.view'?{id:view}:selector==='[data-nfc-inventory-controls]'?controls&&{}:selector==='[data-nfc-mobile-target="v-nfc-test"]'?target&&{}:selector==='[data-nfc-inventory-screen]'?screen&&{}:null};
 const context={window:{canAction:()=>allowed},document:{addEventListener:(_,fn)=>listener=fn,getElementById:()=>null,querySelector:()=>({id:view})},liberado:new WeakSet(),prompt:()=>{prompts++;return null;},toast:()=>{}};
 vm.runInNewContext(guardSource,context);
 return {async click(){await listener({target:{closest:()=>button},preventDefault(){stopped=true;},stopImmediatePropagation(){stopped=true;}});return {prompts,stopped};},button};
}
test('conferência NFC encaminha encerramento ao serviço autenticado sem prompt do inventário de estoque',async()=>{
 assert.deepEqual(await fixture().click(),{prompts:0,stopped:false});
});
test('marcador sozinho ou fora do painel NFC não dispensa a confirmação do inventário de estoque',async()=>{
 for(const change of [{marked:false},{controls:false},{target:false},{screen:false},{view:'v-inv',target:false,screen:false}])assert.deepEqual(await fixture(change).click(),{prompts:1,stopped:true});
});
test('proteções de estoque, Nota Fiscal e permissão para cadastrar continuam ativas',async()=>{
 assert.deepEqual(await fixture({text:'Zerar chão',view:'v-floor70'}).click(),{prompts:1,stopped:true});
 assert.deepEqual(await fixture({text:'Excluir Nota Fiscal',view:'v-nf'}).click(),{prompts:1,stopped:true});
 assert.deepEqual(await fixture({text:'Iniciar novo inventário',allowed:false}).click(),{prompts:0,stopped:true});
});
