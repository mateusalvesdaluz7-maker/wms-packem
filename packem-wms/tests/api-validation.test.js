'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const stock = require('../api/stock-operation.js')._test;
const request = require('../api/req-baixa.js')._test;

test('normaliza e valida uma saída de estoque', function () {
  const value = stock.validate({
    operation_id: 'saida:req-123:label-1', action: 'saida', source_space_id: 'a-10-1',
    label: 'ryv6wfgpy8', product: '03034105', quantity: 100, unit: 'kg', actor: 'admin'
  });
  assert.equal(value.source_space_id, 'A-10-1');
  assert.equal(value.label, 'RYV6WFGPY8');
  assert.equal(value.quantity, 100);
});

test('rejeita quantidade inválida', function () {
  assert.throws(function () {
    stock.validate({ operation_id: 'saida:12345678', action: 'saida', source_space_id: 'A-1-1', label: 'ET1', product: 'P1', quantity: -1, actor: 'admin' });
  }, /Quantidade inválida/);
});

test('rejeita corpo maior que o limite', function () {
  assert.throws(function () { stock.parseBody({ headers: { 'content-length': String(20000) }, body: {} }); }, /excedem o limite/);
});

test('origem do WMS é aceita e origem externa é recusada', function () {
  const old = process.env.WMS_ALLOWED_ORIGINS;
  delete process.env.WMS_ALLOWED_ORIGINS;
  assert.equal(stock.allowedOrigin({ headers: { origin: 'https://wms-packem.vercel.app' } }), true);
  assert.equal(stock.allowedOrigin({ headers: { origin: 'https://exemplo-invalido.test' } }), false);
  if (old === undefined) delete process.env.WMS_ALLOWED_ORIGINS; else process.env.WMS_ALLOWED_ORIGINS = old;
});

test('sanitização da requisição limita campos', function () {
  assert.equal(request.clean('  operador  ', 20), 'operador');
  assert.equal(request.clean('123456', 4), '1234');
});

