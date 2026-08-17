'use strict';

const buckets = new Map();

function clientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim();
}

function allowedOrigins(req) {
  const configured = String(process.env.WMS_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const host = String(req.headers.host || '').trim();
  if (host) configured.push('https://' + host, 'http://' + host);
  if (process.env.VERCEL_URL) configured.push('https://' + process.env.VERCEL_URL);
  return new Set(configured);
}

function secure(req, res, options) {
  options = options || {};
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', options.cache || 'no-store');
  res.setHeader('Vary', 'Origin');

  const origin = String(req.headers.origin || '');
  const fetchSite = String(req.headers['sec-fetch-site'] || '');
  if (fetchSite === 'cross-site' || (origin && !allowedOrigins(req).has(origin))) {
    res.status(403).json({ error: 'Origem não autorizada' });
    return false;
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', options.methods || 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-WMS-Request');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }

  const limit = Math.max(1, Number(options.limit) || 60);
  const windowMs = Math.max(1000, Number(options.windowMs) || 60000);
  const key = clientIp(req) + ':' + String(options.name || 'api');
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.reset) b = { count: 0, reset: now + windowMs };
  b.count += 1;
  buckets.set(key, b);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - b.count)));
  if (b.count > limit) {
    res.setHeader('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
    res.status(429).json({ error: 'Muitas tentativas. Aguarde e tente novamente.' });
    return false;
  }
  return true;
}

function body(req, maxBytes) {
  let value = req.body;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > (maxBytes || 32768)) throw new Error('Corpo muito grande');
    value = JSON.parse(value);
  }
  const encoded = JSON.stringify(value || {});
  if (Buffer.byteLength(encoded, 'utf8') > (maxBytes || 32768)) throw new Error('Corpo muito grande');
  return value || {};
}

function text(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
}

module.exports = { secure, body, text };
