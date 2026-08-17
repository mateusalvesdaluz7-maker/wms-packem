'use strict';

function config() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados');
  return { url, key };
}

async function rpc(name, payload) {
  const { url, key } = config();
  const response = await fetch(url + '/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: 'Bearer ' + key,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && (data.message || data.details || data.hint);
    const error = new Error(message || ('Supabase RPC HTTP ' + response.status));
    error.status = response.status;
    throw error;
  }
  return data;
}

module.exports = { rpc };
