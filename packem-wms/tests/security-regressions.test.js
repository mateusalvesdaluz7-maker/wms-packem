'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'wms-app.js'), 'utf8');
const requisicao = fs.readFileSync(path.join(root, 'wms-requisicao.js'), 'utf8');
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

test('requisição completa aguarda confirmação após bip ou quantidade', function () {
  const requestApi = fs.readFileSync(path.join(root, 'api', 'req-baixa.js'), 'utf8');
  assert.match(app, /r\.status='separado';r\.ts_fim_separacao=fim/);
  assert.match(requestApi, /status: 'separado'/);
  assert.match(requestApi, /requestStatus = 'separado'/);
});

test('criação e alterações locais de requisição disparam sincronização com a nuvem', function () {
  assert.match(requisicao, /REQS\.unshift\(r\);try\{reqPersist\(\);window\.wmsReqCloudPush\(\);\}/);
  assert.match(requisicao, /reqLocalSig\(\)!==reqLastLocalSig\)window\.wmsReqCloudPush\(\)/);
  assert.match(requisicao, /reqLastLocalSig=reqLocalSig\(\)/);
});

test('recebimento envia diretamente ao Chão 70 sem criar saldo intermediário', function () {
  const inicio = app.indexOf('async function recvAdd');
  const fim = app.indexOf('function renderRecv', inicio);
  const fluxo = app.slice(inicio, fim);
  assert.match(fluxo, /window\.f70Entrada\(_it,true\)/);
  assert.doesNotMatch(fluxo, /STAGE\.unshift/);
  assert.doesNotMatch(fluxo, /code:'INTERMEDIÁRIO'/);
  assert.equal(app.includes('recvBackfill70'), false);
});

test('bipagem da NF só confirma entrada depois da gravação física no Chão 70', function () {
  const inicio = app.indexOf('function nfRecvBip');
  const fim = app.indexOf('function nfDeleteNote', inicio);
  const fluxo = app.slice(inicio, fim);
  assert.match(fluxo, /window\.f70Entrada\(_it,true\)/);
  assert.doesNotMatch(fluxo, /STAGE\.unshift/);
  assert.doesNotMatch(fluxo, /INTERMEDIÁRIO/);
  assert.ok(fluxo.indexOf('window.f70Entrada(_it,true)') < fluxo.indexOf("e.status='entrada'"));
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

test('menu mantém somente um acesso aos Alertas da Logística', function () {
  assert.match(app, /querySelectorAll\('\.nav\[data-view="v-logalert"\]'\)/);
  assert.match(app, /nodes\.forEach\(function\(duplicado\)\{duplicado\.remove\(\);\}\)/);
  assert.match(app, /querySelectorAll\('\.navAlertLabel,\.menuLabel'\)/);
  assert.match(app, /label\.className='menuLabel'/);
  assert.doesNotMatch(app, /<span class="navAlertLabel">Alertas da Logística<\/span>/);
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
