'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'wms-app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

test('ABC de consumo usa produção no período sem duplicar IDs e separa unidades', function(){
 const analyze=require('../wms-abc-consumo.js').analyze;
 const at='2026-08-20T12:00:00Z',opts={from:Date.parse('2026-08-01'),to:Date.parse('2026-09-01'),unit:'KG'};
 const rows=[{id:'1',action:'producao',pr:'A',q:80,u:'KG',at},{id:'1',action:'producao',pr:'A',q:80,u:'KG',at},{id:'2',action:'producao',pr:'B',q:15,u:'KG',at},{id:'3',action:'producao',pr:'C',q:5,u:'KG',at},{id:'4',action:'saida',pr:'X',q:1000,u:'KG',at},{id:'5',action:'producao',pr:'Y',q:1000,u:'MT',at},{id:'6',action:'producao',pr:'Z',q:99,u:'KG',at:'2025-01-01'}];
 const result=analyze(rows,opts);assert.equal(result.total,100);assert.deepEqual(result.rows.map(r=>r.cls),['A','B','C']);assert.equal(result.rows[0].count,1);
 assert.equal(analyze(rows,{...opts,allExits:true}).total,1100);
 assert.equal(analyze([] ,opts).total,0);
});

test('ABC soma todas as saídas de produção por material incluindo histórico antigo', function(){
 const analyze=require('../wms-abc-consumo.js').analyze;
 const base={pr:'A',u:'KG',at:'2025-01-01T12:00:00Z'};
 const rows=[{...base,id:'1',action:'producao',code:'A-10-1',q:100},{...base,id:'2',action:'producao',code:'PRODUÇÃO',q:25},{...base,id:'3',action:'saida',destination:'PRODUÇÃO',q:50},{...base,id:'4',action:'produção',q:10},{...base,id:'5',action:'saida',code:'CLIENTE',q:999},{...base,id:'6',action:'transf',code:'PRODUÇÃO',q:999}];
 const result=analyze(rows,{unit:'KG'});
 assert.equal(result.total,185);assert.equal(result.rows.length,1);assert.equal(result.rows[0].count,4);
 assert.equal(analyze(rows,{unit:'KG',from:Date.parse('2026-01-01')}).total,0);
});

test('ABC separa unidades, saneia quantidades e mantém maior material na classe A', function () {
  const vm=require('node:vm');
  const source=app.slice(app.indexOf('function abcData(){'),app.indexOf('function renderABC(){'));
  const ctx={window:{abcUnit:'KG'},abcMetric:'peso',occSpaces:()=>[{pr:'a',q:'90',u:'KG'},{pr:'b',q:10,u:'KG'},{pr:'c',q:900,u:'MT'},{pr:'d',q:Infinity,u:'KG'}],unitOf:x=>x.u,valOf:()=>0};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const data=ctx.abcData();assert.equal(data.total,100);assert.equal(data.arr.length,2);assert.equal(data.arr[0].cls,'A');
  ctx.window.abcUnit='MT';assert.equal(ctx.abcData().total,900);
  ctx.abcMetric='valor';assert.equal(ctx.abcData().arr.length,0);
});

test('produção integra filtro e direção de saída sem regravar movimentos', function () {
  assert.match(app,/producao:\['Saída para produção','out'\]/);
  assert.match(app,/else if\(tp==='saida'\)rows=rows.filter\(m=>m.action==='saida'\|\|m.action==='producao'\)/);
});

test('não recria usuários ou senhas fixas no navegador', function () {
  assert.equal(app.includes('ensureRequestedUsersAug18'), false);
  assert.equal(app.includes('reqPins'), false);
  ['6842', '3175', '9084', '5261'].forEach(function (pin) {
    assert.equal(app.includes("'" + pin + "'"), false);
  });
});

test('a operação de estoque passa pela API transacional', function () {
  const rewrite = (vercel.rewrites || []).find(function (item) {
    return item.source === '/wms-data/stock-operation';
  });
  assert.ok(rewrite);
  assert.equal(rewrite.destination, '/api/stock-operation');
});

test('recebimento mantém o item visível até o operador escolher o destino', function () {
  const inicio = app.indexOf('async function recvAdd');
  const fim = app.indexOf('function renderRecv', inicio);
  const fluxo = app.slice(inicio, fim);
  assert.match(fluxo, /STAGE\.unshift\(_it\)/);
  assert.match(fluxo, /syncStage\(_it\)/);
  assert.doesNotMatch(fluxo, /window\.f70Entrada\(_it,true\)/);
  assert.doesNotMatch(fluxo, /code:'INTERMEDIÁRIO'/);
  assert.equal(app.includes('recvBackfill70'), false);
});

test('bipagem da NF puxa código e peso para a fila do recebimento', function () {
  const inicio = app.indexOf('function nfRecvBip');
  const fim = app.indexOf('function nfDeleteNote', inicio);
  const fluxo = app.slice(inicio, fim);
  assert.match(fluxo, /STAGE\.unshift\(_it\)/);
  assert.match(fluxo, /syncStage\(_it\)/);
  assert.match(fluxo, /Puxado para o Recebimento/);
  assert.ok(fluxo.indexOf('STAGE.unshift(_it)') < fluxo.indexOf("e.status='entrada'"));
});

test('entrada no Chão é idempotente e nunca remove automaticamente outro estoque', function () {
  const inicioEntrada = app.indexOf('window.f70Entrada=function');
  const fimEntrada = app.indexOf('window.f70Saida=function', inicioEntrada);
  const entrada = app.slice(inicioEntrada, fimEntrada);
  assert.match(entrada, /if\(f70HasEt\(et\)\)return true/);

  const inicioManual = app.indexOf('window.floor70Add=async function');
  const fimManual = app.indexOf('function updateF70()', inicioManual);
  assert.ok(inicioManual >= 0 && fimManual > inicioManual, 'função de entrada manual do Chão 70 não localizada');
  const manual = app.slice(inicioManual, fimManual);
  assert.doesNotMatch(manual, /window\.floorSaida\(et\)/);
  assert.doesNotMatch(manual, /freeStored\(et\)/);
});

test('bipagem da vaga resolve pendência local antes de consultar a nuvem', function () {
  const inicio = app.indexOf('async function bobFetch');
  const fim = app.indexOf('window.bobFetch=bobFetch', inicio);
  const busca = app.slice(inicio, fim);
  assert.match(busca, /STAGE\.find/);
  assert.match(busca, /Promise\.all/);
  assert.match(busca, /3500/);
});

test('vaga livre limpa etiquetas órfãs e não mostra lista paralela de bobinas', function () {
  const inicio = app.indexOf('function openSpace');
  const fim = app.indexOf("$('#mLoc').addEventListener", inicio);
  const vaga = app.slice(inicio, fim);
  assert.match(vaga, /\(!x\.o\|\|\(Number\(x\.q\)\|\|0\)<=0\)/);
  assert.match(vaga, /delete LOC\[et\]/);
  assert.doesNotMatch(vaga, /Bobinas nesta posição/);

  const inicioLocal = app.indexOf('window.wmsLocalDaEtiqueta=function');
  const fimLocal = app.indexOf('window.wmsAvisarEtiquetaOcupada=function', inicioLocal);
  const local = app.slice(inicioLocal, fimLocal);
  assert.match(local, /_sp&&_sp\.o&&\(Number\(_sp\.q\)\|\|0\)>0/);
  assert.match(local, /syncDelLoc\(et\)/);
});

test('exclusão direta de estoque fica restrita ao admin sem bloquear a saída operacional', function () {
  assert.match(app, /strictAdm=\(typeof isStrictAdmin==='function'&&isStrictAdmin\(\)\)/);
  assert.match(app, /Somente admin pode excluir pendência/);
  assert.match(app, /floorRemoveEt\(achouPr,et,true\)/);
  assert.match(app, /f70RemoveEt\(achouPr,et,true\)/);
  assert.match(app, /function floorRemoveEt\(pr,et,saidaOperacional\)\{if\(!saidaOperacional&&!isStrictAdmin\(\)\)/);
  assert.match(app, /function f70RemoveEt\(pr,et,saidaOperacional\)\{if\(!saidaOperacional&&!isStrictAdmin\(\)\)/);
  assert.match(app, /window\.recicRemoveCode=function\(pr\)\{if\(!\(typeof isStrictAdmin/);
});

test('saída que zera a vaga libera a etiqueta mesmo com saldo interno divergente', function () {
  assert.match(app, /if\(\(ra<=0\|\|sp\.q<=0\)&&LOC\[et\]\)\{delete LOC\[et\];saveLOC\(\);\}/);
  assert.match(app, /if\(m\.action==='entrada'\)\{syncLoc\(m\.et,m\.code\);\}else if\(m\.action==='saida'\)/);
  assert.match(app, /else\{syncDelLoc\(m\.et\);\}/);
});

test('mapa 3D exibe ocupação inteligente em tela cheia e a empilhadeira alterna corredores', function () {
  assert.match(app, /id="occ3dPanel"/);
  assert.match(app, /GÊMEO DIGITAL · DEP 70/);
  assert.match(app, /Tela cheia/);
  assert.doesNotMatch(app, /Modo TV/);
  assert.match(app, /getElementById\('v-3d'\)/);
  assert.match(app, /function refreshOccPanel3d/);
  assert.match(app, /visual antigo sobre o mapa desativado/);
  assert.match(app, /f\.aislesX\.length>1/);
  assert.match(app, /f\.patrolSide=!f\.patrolSide/);
});

test('arquivo principal permanece compatível com Safari de celulares e tablets antigos', function () {
  assert.doesNotMatch(app, /\(\?<=/);
  assert.doesNotMatch(app, /\?\?/);
  assert.match(app, /20260821-mobile1|Compatível com Safari\/iOS antigos/);
});

test('limpeza remota do chão substitui o cache local em todos os dispositivos', function () {
  const inicioChao = app.indexOf('window.floorPullCloud=function');
  const fimChao = app.indexOf('window.floorApplyRealtimeRow=function', inicioChao);
  const fluxoChao = app.slice(inicioChao, fimChao);
  const inicioChao70 = app.indexOf('window.floor70PullCloud=function');
  const fimChao70 = app.indexOf('window.floor70ApplyRealtimeRow=function', inicioChao70);
  const fluxoChao70 = app.slice(inicioChao70, fimChao70);

  assert.match(fluxoChao, /if\(readErr\)/);
  assert.match(fluxoChao70, /if\(readErr\)/);
  assert.doesNotMatch(fluxoChao, /!rows\.length[^\n]*localEts\.length/);
  assert.doesNotMatch(fluxoChao70, /!rows\.length[^\n]*localEts\.length/);
  assert.match(fluxoChao, /FLOOR=merged;saveFloor\(\)/);
  assert.match(fluxoChao70, /FLOOR70=merged;saveF70\(\)/);
});

test('zerar mapa invalida o cache antigo mesmo no pull rápido de 200 vagas', function () {
  assert.match(app, /resetSrc='__WMS_MAP_RESET__\|'/);
  assert.match(app, /chunkUp\('espacos',todas\.map\(spRow\)\)/);
  assert.match(app, /function _applyMapResetMarkers\(rows\)/);
  assert.match(app, /const sp=await pgAll\('espacos'\);if\(sp\.length\)\{_applyMapResetMarkers\(sp\)/);
  assert.match(app, /if\(t==='espacos'&&n\)\{_applyMapResetMarkers\(\[n\]\)/);
  assert.match(app, /if\(_applyMapResetMarkers\(_spr\.data\)\)_spNew\+\+/);
});

test('resumo por produto saneia cada valor e usa os mesmos locais do total do sistema', function () {
  assert.match(app, /function reportQty\(v\).*isFinite\(n\)&&n>=0/);
  assert.match(app, /function stockProductReport\(\)/);
  assert.match(app, /\[\['f','chao'\],\['f70','chao70'\],\['rec','rec'\]\]/);
  assert.match(app, /\['Codigo','Descricao','Total','Unidade','Prateleiras','Chao','Chao70','Recicladora91','Posicoes','BobinasAreas'\]/);
  assert.doesNotMatch(app, /\['Codigo','Descricao','TotalKG','Posicoes'\]/);
});

test('CSV usa decimal brasileiro e não deixa o Excel criar números gigantes', function () {
  assert.match(app, /function csvValue\(v\)/);
  assert.match(app, /Math\.round\(v\*1000\)\/1000/);
  assert.match(app, /String\(n\)\.replace\('\.',','\)/);
  assert.match(app, /if\(!isFinite\(v\)\)return '0'/);
  assert.match(app, /csvValue\(c\)\.replace/);
});

test('requisição interna permanece e requisições externa, inventário e VSM foram removidos', function () {
  assert.match(index, /data-view="v-requisicao"/);
  assert.match(index, /id="v-requisicao"/);
  assert.match(index, /wms-requisicao\.js/);
  assert.match(index, /wms-requisicao-fix\.css/);
  assert.match(app, /const REMOVED_VIEWS=\['v-reqlive','v-inv','v-vsm'\]/);
  assert.match(app, /function go\(id\)\{if\(REMOVED_VIEWS\.indexOf\(id\)>=0\)id='v-home'/);
  assert.doesNotMatch(app, /addNavAfter\([^\n]*'v-vsm'/);
  assert.doesNotMatch(app, /addNavAfter\([^\n]*'v-reqlive'/);
  assert.doesNotMatch(app, /\['v-inv','Inventário'\]|\['v-vsm','VSM Tempo Real'\]/);
  assert.match(app, /function purgeRemovedViews\(\)/);
  assert.match(app, /MutationObserver\(function\(\)\{purgeRemovedViews\(\);\}\)/);
  assert.match(app, /if\(role==='requisitante'\)return \['v-requisicao'\]/);
});

test('menu mantém somente um acesso aos Alertas da Logística', function () {
  assert.match(app, /querySelectorAll\('\.nav\[data-view="v-logalert"\]'\)/);
  assert.match(app, /nodes\.forEach\(function\(duplicado\)\{duplicado\.remove\(\);\}\)/);
  assert.match(app, /querySelectorAll\('\.navAlertLabel,\.menuLabel'\)/);
  assert.match(app, /label\.className='menuLabel'/);
  assert.doesNotMatch(app, /<span class="navAlertLabel">Alertas da Logística<\/span>/);
});

test('menu oficial mantém o acesso à requisição interna', function () {
  assert.match(app, /\['v-requisicao','Requisição'\]/);
});

test('etiqueta rastreável respeita KG, MT ou UN escolhidos no formulário', function () {
  assert.match(app, /normUnit\(e&&\(e\.uCom\|\|e\.un\|\|e\.u\)\)/);
  assert.match(app, /if\(marcada==='MT'\)return 'MT'/);
  assert.match(app, /if\(marcada==='UN'\)return 'UN'/);
  assert.match(app, /if\(marcada==='KG'\)return 'KG'/);
  assert.match(app, /uCom:\(data\.un\|\|'KG'\)/);
});

test('conversão da NF e romaneio usa a tabela atualizada de códigos', function () {
  assert.match(app, /"167 X 91":\{"cod":"0303410058"/);
  assert.match(app, /"156 X 396":\{"cod":"0303450157"/);
  assert.match(app, /s\.replace\(\/\(\\d\)\\s\*\[X×\]\\s\*\(\\d\)\/g,'\$1 X \$2'\)/);
  assert.match(app, /var CONV_AMB=\{"SUCATA PET":\["103580008 - PET FLAKE AZUL","103580003 - PET FLAKE CRISTAL"\]\}/);
});

test('admin pode importar e sincronizar a tabela de códigos pela Nota Fiscal', function () {
  assert.match(app, /id="convFile" accept="\.xlsx,\.xls"/);
  assert.match(app, /window\.convImportFile=function\(file\)/);
  assert.match(app, /CONV_CLOUD_KEY='__codigo_norte_mp__'/);
  assert.match(app, /supa\.from\('romaneios'\)\.upsert\(\{key:CONV_CLOUD_KEY/);
  assert.match(app, /if\(r\.key===CONV_CLOUD_KEY\)\{if\(r\.data\)convApplyPayload\(r\.data,true\);return;\}/);
  assert.match(app, /Não encontrei as colunas CÓDIGO, DESCRIÇÃO PACKEM e DESCRIÇÃO NOTA FISCAL/);
});

test('tabela de códigos fica disponível a todos e documentos fiscais são separados por situação', function () {
  assert.doesNotMatch(app, /isAdmin\(\)\?\('<div class="panel nfImportCard"><div class="ph"><span class="pdot"><\/span>Tabela de conversão de códigos/);
  assert.match(app, /\['aberto','Abertos',_nfSitCount\.aberto\]/);
  assert.match(app, /\['processo','Em processo',_nfSitCount\.processo\]/);
  assert.match(app, /\['finalizado','Finalizados',_nfSitCount\.finalizado\]/);
  assert.match(app, /data-nf-status/);
  assert.match(app, /status==='entrada'\|\|ETQ\[id\]\.status==='saida'/);
  assert.match(app, /sort\(_nfMaisNovo\)/);
});

test('prateleira recusa quantidade zero ou inválida antes de armazenar', function () {
  assert.match(app, /function placeBobina\(et,pr,pl,c\)\{pl=Number\(pl\);if\(!Number\.isFinite\(pl\)\|\|pl<=0\)/);
  assert.match(app, /Não é permitido armazenar quantidade zero na prateleira/);
});

test('giro manual do mapa 3D é contínuo e independente da volta completa', function () {
  assert.match(app, /const minFrame=presenting\?40:33/);
  assert.match(app, /denseScene=S\.length>1200,perfGfx=lowGfx\|\|denseScene/);
  assert.match(app, /_3d\.theta\+=\(orbiting\?0\.36:0\.096\)\*\(elapsed\/1000\)/);
  assert.match(app, /if\(!presenting&&Math\.abs\(_3d\.theta\)>Math\.PI\*2\)_3d\.theta%=Math\.PI\*2/);
});

test('ABC inclui saídas diretas repetidas da prateleira e soma quantidades sem confundir lançamentos', function(){
 const analyze=require('../wms-abc-consumo.js').analyze;
 const base={pr:'A',u:'KG',at:'2026-08-31T12:00:00Z',action:'saida',code:'A-20-1'};
 const result=analyze([{...base,id:'1',operation_id:'op',q:100},{...base,id:'2',operation_id:'op',q:200},{...base,id:'3',q:50},{...base,id:'3',q:50},{...base,id:'4',code:'RECICLADORA',q:999},{...base,id:'5',action:'transf',q:999},{...base,id:'6',note:'retorno de produção',q:999}],{unit:'KG'});
 assert.equal(result.total,350);assert.equal(result.rows[0].count,3);assert.equal(result.rows[0].shelfQuantity,350);
});

test('ABC compartilha a fonte da Movimentação em vez de consultar histórico paralelo',function(){
 const vm=require('node:vm');const source=app.slice(app.indexOf('function trkBaseRows(){'),app.indexOf('function trkRows(){'));
 const ctx={window:{},MV:[{id:'local',q:50}]};vm.createContext(ctx);vm.runInContext(source,ctx);
 assert.equal(ctx.trkBaseRows()[0].id,'local');ctx.window._trkServerRows=[{id:'server',q:100}];assert.equal(ctx.trkBaseRows()[0].id,'server');ctx.window._trkServerRows=[];assert.equal(ctx.trkBaseRows().length,0);
 const abc=fs.readFileSync(path.join(root,'wms-abc-consumo.js'),'utf8');assert.match(abc,/state.rows=trkBaseRows\(\).slice\(\)/);assert.match(abc,/await loadTrackPeriod\(from,to\)/);
});

test('Histórico compartilhado pagina todos os registros mesmo com página curta e recusa falha parcial',async function(){
 const {readMovementHistory}=require('../wms-abc-consumo.js');
 const data=Array.from({length:1201},(_,id)=>({id,action:'producao',q:1}));let calls=0;
 const query={select(){return this},lte(){return this},gte(){return this},order(){return this},async range(start,end){calls++;return {data:data.slice(start,Math.min(end+1,start+200)),count:data.length};}};
 const rows=await readMovementHistory({from:()=>query},'','2026-08-31');assert.equal(rows.length,1201);assert.equal(calls,7);
 query.range=async function(start){return start?{error:{message:'falha de rede'}}:{data:data.slice(0,200),count:1201};};
 await assert.rejects(()=>readMovementHistory({from:()=>query},'','2026-08-31'),/falha de rede/);
});

test('Pareto usa acumulado global e limita somente as barras, não o cálculo',function(){
 const {analyze,renderPareto}=require('../wms-abc-consumo.js');
 const rows=Array.from({length:20},(_,i)=>({id:String(i),pr:'P'+i,q:10,u:'MT',action:'producao',at:'2026-08-31'}));
 const result=analyze(rows,{unit:'MT'}),html=renderPareto(result.rows,'MT');
 assert.equal(result.rows.length,20);assert.equal(result.rows[14].acc,75);
 assert.match(html,/15 maiores de 20 materiais/);assert.match(html,/75.0% acumulado/);assert.equal((html.match(/<rect /g)||[]).length,15);
 assert.match(renderPareto([],'KG'),/Consulte as movimentações/);
 assert.doesNotMatch(renderPareto([{pr:'<script>',quantity:1,count:1,acc:100,cls:'A'}],'KG'),/<script>/);
});

test('Pareto permite todos os materiais e interação acessível sem mudar o acumulado',function(){
 const {analyze,renderPareto}=require('../wms-abc-consumo.js');
 const rows=analyze(Array.from({length:35},(_,i)=>({id:String(i),pr:'P'+i,q:35-i,u:'KG',action:'producao',at:'2026-08-31'})),{unit:'KG'}).rows;
 assert.equal((renderPareto(rows,'KG',30).match(/<rect /g)||[]).length,30);
 const all=renderPareto(rows,'KG','all');assert.equal((all.match(/<rect /g)||[]).length,35);assert.match(all,/100.0% acumulado/);assert.match(all,/role="button" tabindex="0"/);
});

test('Alças e cadarços consolidam histórico KG e MT em metros sem converter quantidades',function(){
 const {analyze}=require('../wms-abc-consumo.js');
 const base={action:'producao',at:'2026-08-31',q:100,u:'KG'};
 const rows=[{...base,id:'1',pr:'alca'},{...base,id:'2',pr:'alca',q:200,u:'MT'},{...base,id:'3',pr:'cadarco'},{...base,id:'4',pr:'filme'}];
 const describe=p=>({alca:'ALÇA PP 1000KGF 70MM',cadarco:'Cadarço PET 15MM',filme:'FILME PE'}[p]);
 const mt=analyze(rows,{unit:'MT',describe});assert.equal(mt.total,400);assert.equal(mt.rows.find(r=>r.pr==='alca').count,2);
 assert.equal(analyze(rows,{unit:'KG',describe}).total,100);assert.equal(rows[0].u,'KG');
 assert.equal(analyze([{...base,pr:'x',description:'ALCA PP'}],{unit:'MT'}).total,100);
});

test('ABC exclui códigos T e numéricos longos de totais, classes e gráfico sem apagar movimentos',function(){
 const {analyze,renderPareto}=require('../wms-abc-consumo.js');
 const base={action:'producao',at:'2026-08-31',q:100,u:'KG'};
 const rows=['T40378384',' t123 ','02000003034300083100048400','0303410008'].map((pr,i)=>({...base,id:String(i),pr}));
 const r=analyze(rows,{unit:'KG'});assert.equal(r.total,100);assert.equal(r.excludedCodes,3);assert.equal(r.rows.length,1);assert.equal(r.rows[0].pr,'0303410008');assert.equal(r.rows[0].share,100);
 assert.doesNotMatch(renderPareto(r.rows,'KG'),/T40378384|02000003034300083100048400/);assert.equal(rows.length,4);
});

test('ABC calcula média por lançamento na unidade correta e parcela Saída sem inferir destino',function(){
 const {analyze}=require('../wms-abc-consumo.js');const base={pr:'P',at:'2026-08-31',u:'KG',action:'producao'};
 const rows=[{...base,id:'1',q:100},{...base,id:'2',q:300},{...base,id:'3',action:'saida',code:'A-20-1',q:200},{...base,id:'3',action:'saida',code:'A-20-1',q:200}];
 const r=analyze(rows,{unit:'KG'}).rows[0];assert.equal(r.average,200);assert.equal(r.count,3);assert.equal(r.directQuantity,200);assert.equal(r.quantity,600);
 const mt=analyze(rows,{unit:'MT',describe:()=> 'ALÇA PP'}).rows[0];assert.equal(mt.average,200);assert.equal(mt.unit,'MT');assert.equal(analyze([],{unit:'KG'}).rows.length,0);
});

test('NF encaminha TEC. ao Chão 70 e demais ao recebimento, sem confirmar falha ou duplicar bipe',function(){
 const vm=require('node:vm');const start=app.indexOf('  function nfRecvBip(v){'),end=app.indexOf('  /* ---- excluir nota',start);const source=app.slice(start,end);
 function fixture(desc,ok=true){let floor=0;const ctx={ETQ:{E1:{cProd:'0303450001',xProd:desc,kg:150,status:'gerada'}},NFS:{},ROMS:{},STAGE:[],norm:x=>String(x).trim().toUpperCase(),nowISO:()=> '2026-08-31T12:00:00Z',session:{u:'admin'},toast:()=>{},fmt:String,saveStage:()=>{},syncStage:()=>{},saveNF:()=>{},syncEtiqueta:()=>{},renderNF:()=>{},document:{querySelector:()=>null},window:{f70Entrada:()=>{floor++;return ok;}}};vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,count:()=>floor};}
 const tec=fixture(' tec.TUBULAR PP');tec.ctx.nfRecvBip('E1');assert.equal(tec.count(),1);assert.equal(tec.ctx.STAGE.length,0);assert.equal(tec.ctx.ETQ.E1.status,'entrada');tec.ctx.nfRecvBip('E1');assert.equal(tec.count(),1);assert.equal(tec.ctx.ETQ.E1.hist.length,1);
 const other=fixture('ALCA PP');other.ctx.nfRecvBip('E1');assert.equal(other.count(),0);assert.equal(other.ctx.STAGE.length,1);other.ctx.nfRecvBip('E1');assert.equal(other.ctx.STAGE.length,1);
 const fail=fixture('TEC.PLANO',false);fail.ctx.nfRecvBip('E1');assert.equal(fail.ctx.ETQ.E1.status,'gerada');assert.equal(fail.ctx.STAGE.length,0);
 const missing=fixture('TEC.PLANO');missing.ctx.window={};missing.ctx.nfRecvBip('E1');assert.equal(missing.ctx.ETQ.E1.status,'gerada');
});

test('Botão temporário de transferência foi removido e roteamento automático da NF permanece',function(){
 assert.doesNotMatch(app,/recvMoveTec|Transferir TEC\. pendentes/);
 assert.match(app,/window\.f70Entrada\(_it,true\)/);
});

test('Maria ou administrador exclui uma etiqueta não recebida da NF e limpa catálogo e nuvem',function(){
 assert.match(app,/async function excluirEtiqueta\(id\)/);
 assert.match(app,/window\.nfPodeExcluirEtiqueta=function\(\)/);
 assert.match(app,/Somente Maria ou administrador pode excluir etiqueta/);
 assert.match(app,/e\.status==='entrada'\|\|e\.status==='saida'/);
 assert.match(app,/data-rbd-del=/);
 assert.match(app,/delete ETQ\[id\]/);
 assert.match(app,/delete BOB\[id\];saveBOB\(\)/);
 assert.match(app,/syncDelEtiqueta\(id\)/);
 assert.match(app,/syncDelBobina\(id\)/);
 assert.match(app,/As outras etiquetas da nota serão mantidas/);
});

test('Permissão especial da Maria atravessa a proteção global do botão excluir etiqueta',function(){
 assert.match(app,/\.rbdDel&&typeof window\.nfPodeExcluirEtiqueta==='function'&&window\.nfPodeExcluirEtiqueta\(\)/);
});

test('Zerar mapa aguarda a nuvem, confere ocupações e não anuncia sucesso parcial',function(){
 assert.match(app,/go\.disabled=true;go\.textContent='Zerando e conferindo na nuvem…'/);
 assert.match(app,/await chunkUp\('espacos',todas\.map\(spRow\)\)/);
 assert.match(app,/\.eq\('w',wh\)\.eq\('o',true\)\.limit\(1\)/);
 assert.match(app,/a nuvem ainda possui vaga ocupada/);
 assert.match(app,/S=S\.map\(function\(x\)\{return porId\[x\.id\]\|\|x;\}\)/);
 assert.match(app,/Nenhuma limpeza foi confirmada/);
});

test('Auditoria do zeramento remove da nuvem os vínculos das etiquetas com vagas antigas',function(){
 assert.match(app,/var etiquetasAntes=\[\]/);
 assert.match(app,/supa\.from\('locais'\)\.delete\(\)\.in\('etiqueta',bloco\)/);
 assert.match(app,/for\(var tent=0;tent<3&&!delOk;tent\+\+\)/);
 assert.match(app,/if\(!mapaNuvemZerado\)/);
 assert.match(app,/Mapa zerado, mas faltou limpar vínculos de etiquetas/);
});

test('Auditoria do tempo real ignora canal antigo e evita pulls iniciais concorrentes',function(){
 assert.match(app,/let _rtChan=null,_rtOk=false,_rtRetry=0,_rtGen=0/);
 assert.match(app,/var gen=\+\+_rtGen;clearTimeout\(startRealtime\._t\)/);
 assert.match(app,/if\(gen!==_rtGen\)return/);
 assert.match(app,/window\._initialCloudPullStarted=true;startRealtime\(\);startAutoSync\(\)/);
 assert.match(app,/if\(!window\._initialCloudPullStarted\)/);
});

test('Exclusões de materiais e usuários chegam imediatamente aos outros aparelhos',function(){
 assert.match(app,/t==='valores'.*ev==='DELETE'.*VL=VL\.filter/);
 assert.match(app,/t==='usuarios'.*ev==='DELETE'.*US=US\.filter/);
});

test('Movimentações carregam mais registros ao descer sem limitar a consulta a 120',function(){
 assert.match(app,/window\._trkVisibleLimit=window\._trkVisibleLimit\|\|120/);
 assert.match(app,/cap=rows\.slice\(0,limite\)/);
 assert.match(app,/Carregar mais \('\+restantes\+' restantes\)/);
 assert.match(app,/window\._trkVisibleLimit=limite\+200/);
 assert.match(app,/new IntersectionObserver/);
 assert.doesNotMatch(app,/movimentos recentes · 120 mostrados/);
});

test('Somente administrador adiciona e exclui vagas manuais sincronizadas',function(){
 assert.match(app,/function spaceAtiva\(x\)/);
 assert.match(app,/function boardGerenciarVagas\(\)/);
 assert.match(app,/Somente administrador pode adicionar ou excluir vagas/);
 assert.match(app,/id="spDeleteSlot"/);
 assert.match(app,/Esvazie a vaga antes de excluir/);
 assert.match(app,/x\.src='__WMS_SLOT_DISABLED__'/);
 assert.match(app,/if\(sp&&spaceAtiva\(sp\)\)/);
 assert.match(app,/syncSpace\(sp\)/);
 assert.match(app,/manageSlotsBtn/);
 assert.match(app,/__WMS_MANUAL_SLOT__/);
 assert.match(app,/vagas extras são preservadas/);
});

test('Reimportação da NF imprime somente as etiquetas da geração atual',function(){
 assert.match(app,/function nfDocLabelIds\(key\)/);
 assert.match(app,/labelIds:created\.slice\(\)/);
 assert.match(app,/var ids=nfDocLabelIds\(key\)\.sort/);
 assert.match(app,/async function nfDeleteNote\(key\)/);
 assert.match(app,/await syncDelEtiquetasLote\(ids\)/);
 assert.match(app,/await syncDelNota\(key\)/);
 assert.match(app,/n&&\!\(typeof window\._etqDelActive/);
 assert.match(app,/604800000/);
});

test('Exclusão da NF chega a aparelhos que perderam o evento em tempo real',function(){
 assert.match(app,/fiscalApi\('delete_note',\{key:key\}\)/);
 assert.match(app,/n\.data&&n\.data\.deleted.*delete NFS\[n\.key\]/);
 assert.match(app,/r\.data&&r\.data\.deleted.*delete NFS\[r\.key\]/);
 assert.match(app,/ETQ\[id\]\.nf===r\.key\)delete ETQ\[id\]/);
 assert.doesNotMatch(app,/from\('notas_fiscais'\)\.delete\(\)\.eq\('key',key\)/);
});

test('Enviar para nuvem nunca publica o cache fiscal de um computador desatualizado',function(){
 assert.match(app,/async function publishNFBase\(\)/);
 assert.match(app,/Somente o administrador pode publicar a base fiscal/);
 assert.match(app,/Use somente no computador que está correto/);
 assert.match(app,/await fiscalApi\('upsert_note',\{row:nr\}\)/);
 assert.match(app,/await fiscalApi\('upsert_rom',\{row:rr\}\)/);
 assert.match(app,/await syncDocumentoFiscal\(ak\)/);
 assert.match(app,/fiscalApi\('reconcile_labels',\{doc_key:ak,rows:\[\]\}\)/);
 const push=app.slice(app.indexOf('async function pushAll(btn)'),app.indexOf('/* ===== DIAGNÓSTICO DE CONEXÃO'));
 assert.doesNotMatch(push,/publishNFBase\(\)/);
 assert.match(push,/Nota Fiscal sincroniza automaticamente/);
});

test('Varredura completa substitui o cache fiscal pela fonte oficial da nuvem',function(){
 assert.match(app,/window\.nfPullCloud=function\(rowsEtq,rowsNotas,rowsRom,autoritativo\)/);
 assert.match(app,/if\(autoritativo\)\{/);
 assert.match(app,/if\(\(!k\|\|k==='__vaga__'\)&&!fromCloud\[id\]/);
 assert.match(app,/window\.nfPullCloud\(snap\.labels,snap\.notes,snap\.roms,true\)/);
 const pull=app.slice(app.indexOf('async function pullNF(force)'),app.indexOf('window.pullNF=pullNF;'));
 assert.doesNotMatch(pull,/Object\.keys\(NFS\|\|\{\}\)\.forEach\(function\(k\)\{keys\[k\]=1/);
 assert.doesNotMatch(pull,/AUTO-REPARO/);
 assert.match(app,/key:NF_CANON_KEY,data:\{canonical:true,publishedAt:at/);
});

test('Exclusão de romaneio também permanece sincronizável',function(){
 assert.match(app,/async function nfDeleteRomaneio\(key\)/);
 assert.match(app,/await syncDelRomaneio\(key\)/);
 assert.match(app,/fiscalApi\('delete_rom',\{key:key\}\)/);
 assert.match(app,/n\.data&&n\.data\.deleted.*delete ROMS\[n\.key\]/);
 assert.doesNotMatch(app,/from\('romaneios'\)\.delete\(\)\.eq\('key',key\)/);
 assert.match(app,/async function pullNFExclusoes\(\)/);
 assert.match(app,/pullNF\(\);pullNFExclusoes\(\)/);
});

test('Alterações fiscais normais passam pela API do servidor',function(){
 assert.match(app,/async function fiscalApi\(action,payload\)/);
 assert.match(app,/paths=\['\/wms-data\/fiscal-sync','\/api\/fiscal-sync'\]/);
 assert.match(app,/fiscalApi\('upsert_labels'/);
 assert.match(app,/fiscalApi\('upsert_note'/);
 assert.match(app,/fiscalApi\('upsert_rom'/);
 assert.match(app,/fiscalApi\('delete_note'/);
 assert.match(app,/fiscalApi\('delete_rom'/);
 assert.match(app,/fiscalApi\('delete_labels'/);
 assert.match(app,/fiscalApi\('reconcile_labels'/);
 assert.match(app,/async function fiscalDirect\(action,payload\)/);
 assert.match(app,/return await fiscalDirect\(action,payload\)/);
});

test('Expedição remove exclusão remota e concede controle total somente à Joyce',function(){
 assert.match(app,/EXPEDICAO_EDITORES=\['admin','joyce','joyce\.peixoto'/);
 assert.match(app,/function expFullAccess\(\)/);
 assert.match(app,/if\(rr\._del\)\{/);
 assert.match(app,/romaneios\.splice\(idx,1\)/);
 assert.match(app,/if\(remoteDeleted\)saveStoreAuthoritative\(\)/);
 assert.doesNotMatch(app,/exclusao_remota_ignorada/);
 assert.match(app,/dados-%3E%3Ecancelado=eq\.true/);
 assert.match(app,/if\(rem&&!loc\.cancelado\)/);
});
