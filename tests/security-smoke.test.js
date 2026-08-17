'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('client has no fixed administrative password', () => {
  const app = read('packem-wms/wms-app.js');
  assert.doesNotMatch(app, /ADM_PASS\s*=/);
  assert.doesNotMatch(app, /adm123/i);
});

test('APIs do not enable wildcard CORS', () => {
  for (const file of ['api/ask.js', 'api/requisicoes.js', 'api/req-baixa.js']) {
    assert.doesNotMatch(read(file), /Access-Control-Allow-Origin['"],\s*['"]\*['"]/);
  }
});

test('assistant diagnostic never exposes key fragments', () => {
  const ask = read('api/ask.js');
  assert.doesNotMatch(ask, /slice\(0,\s*4\).*slice\(-4\)/s);
  assert.match(ask, /key_preview:\s*null/);
});

test('mirrored API files remain identical', () => {
  for (const file of ['ask.js', 'requisicoes.js', 'req-baixa.js', '_security.js']) {
    assert.equal(read('api/' + file), read('packem-wms/api/' + file), file + ' divergiu');
  }
});
