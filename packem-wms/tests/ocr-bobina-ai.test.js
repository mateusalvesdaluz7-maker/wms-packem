'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/ocr-etiqueta.js');

async function callAi(upstream, tipo = 'numero_bobina') {
  const oldFetch = global.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  let sent;
  global.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return upstream;
  };
  process.env.OPENAI_API_KEY = 'test-only';
  const res = {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await handler({ method: 'POST', body: { tipo, imageDataUrl: 'data:image/jpeg;base64,AAAA' } }, res);
    return { res, sent };
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}

test('IA para bobina pede só o número e devolve ID válido', async () => {
  const { res, sent } = await callAi({ ok: true, json: async () => ({ output_text: '{"identificador_bobina":"2600255962"}' }) });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { identificador_bobina: '2600255962' });
  assert.equal(sent.reasoning.effort, 'low');
  assert.equal(sent.text.format.name, 'numero_bobina');
  assert.equal(sent.text.format.strict, true);
  assert.match(sent.input[0].content[0].text, /Ignore código de barras/);
});

test('IA não aceita identificador incompleto ou de outro formato', async () => {
  for (const id of ['260025596', '1197026002', '26002559622']) {
    const { res } = await callAi({ ok: true, json: async () => ({ output_text: JSON.stringify({ identificador_bobina: id }) }) });
    assert.deepEqual(res.body, { identificador_bobina: null });
  }
});

test('API distingue limite de uso de falta de crédito', async () => {
  const rate = await callAi({ ok: false, status: 429, json: async () => ({ error: { code: 'rate_limit_exceeded' } }) });
  assert.equal(rate.res.code, 429);
  assert.match(rate.res.body.error, /limite de uso/);
  const quota = await callAi({ ok: false, status: 429, json: async () => ({ error: { code: 'insufficient_quota' } }) });
  assert.match(quota.res.body.error, /sem crédito ou cota/);
});
