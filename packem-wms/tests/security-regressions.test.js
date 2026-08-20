'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'wms-app.js'), 'utf8');
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

test('requisição completa é finalizada automaticamente por bip ou quantidade', function () {
  const requestApi = fs.readFileSync(path.join(root, 'api', 'req-baixa.js'), 'utf8');
  assert.match(app, /r\.status='entregue';r\.ts_fim_separacao=fim;r\.ts_entrega=fim/);
  assert.match(requestApi, /status: 'entregue'/);
  assert.match(requestApi, /requestStatus = 'entregue'/);
});
