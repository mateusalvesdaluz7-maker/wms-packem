'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'wms-app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

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
