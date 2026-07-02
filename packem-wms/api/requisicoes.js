// /api/requisicoes.js — Vercel Serverless Function
// Busca as requisições e itens do app "REQUISIÇÃO PACKEM" (Base44) e devolve pro WMS.
// Precisa da variável de ambiente BASE44_API_KEY (Vercel > Settings > Environment Variables do PROJETO).
// Como obter a chave: no Base44, abre o app REQUISIÇÃO PACKEM > Settings/Configurações > API Keys > cria uma chave.

const APP_ID = '69f21c3bf6750842cd0ab83c'; // REQUISIÇÃO PACKEM

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Método não permitido' }); return; }

  const key = (process.env.BASE44_API_KEY || '').trim();
  if (!key) {
    res.status(500).json({ error: 'BASE44_API_KEY não configurada no servidor (Vercel > Settings > Environment Variables do PROJETO, depois faça um novo deploy)' });
    return;
  }

  async function b44(entity, params) {
    const qs = new URLSearchParams(params || {}).toString();
    const url = 'https://app.base44.com/api/apps/' + APP_ID + '/entities/' + entity + (qs ? ('?' + qs) : '');
    const r = await fetch(url, { headers: { api_key: key, 'content-type': 'application/json' } });
    const data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || ('HTTP ' + r.status);
      const e = new Error('Base44 ' + entity + ': ' + msg);
      e.status = r.status;
      throw e;
    }
    return Array.isArray(data) ? data : ((data && data.results) || []);
  }

  try {
    // Busca por STATUS, não por data: garante que TODAS as abertas apareçam,
    // mesmo as antigas (senão as pausadas de semanas atrás ficam fora do limite e somem).
    const [pend, sepa, paus, entregues, cancel, items] = await Promise.all([
      b44('Requisicao', { status: 'pendente', limit: '200' }),
      b44('Requisicao', { status: 'em_separacao', limit: '200' }),
      b44('Requisicao', { status: 'pausado', limit: '200' }),
      b44('Requisicao', { status: 'entregue', sort: '-created_date', limit: '30' }),
      b44('Requisicao', { status: 'cancelado', sort: '-created_date', limit: '10' }),
      b44('ItemRequisicao', { sort: '-created_date', limit: '1000' })
    ]);
    // junta tudo, abertas primeiro (mais antigas no topo pra separar por ordem de chegada)
    function ordAntigo(a, b) { return (a.created_date || '') < (b.created_date || '') ? -1 : 1; }
    function ordNovo(a, b) { return (a.created_date || '') > (b.created_date || '') ? -1 : 1; }
    const abertas = [].concat(pend, sepa, paus).sort(ordAntigo);
    const fechadas = [].concat(entregues, cancel).sort(ordNovo);
    const reqs = [].concat(abertas, fechadas);

    const itemsByReq = {};
    function addItem(it) {
      const rid = it.requisicao_id;
      if (!rid) return;
      var mat = String(it.material || '');
      var codMatch = mat.match(/\b\d{6,}\b/);
      (itemsByReq[rid] = itemsByReq[rid] || []).push({
        id: it.id,
        maquina: it.maquina || '',
        material: mat,
        codigo: codMatch ? codMatch[0] : '',
        qtd: it.quantidade,
        un: it.unidade || 'kg',
        separado: !!it.separado,
        qtd_separada: it.quantidade_separada,
        falta: !!it.falta_material,
        obs: it.obs_item || ''
      });
    }
    items.forEach(addItem);
    // garante os itens de TODAS as abertas (as antigas podem estar fora do lote de 1000 acima)
    const faltando = abertas.filter(function (r) { return !itemsByReq[r.id]; });
    if (faltando.length) {
      const extras = await Promise.all(faltando.map(function (r) {
        return b44('ItemRequisicao', { requisicao_id: r.id, limit: '100' }).catch(function () { return []; });
      }));
      extras.forEach(function (arr) { (arr || []).forEach(addItem); });
    }

    const out = reqs.map(function (r) {
      return {
        id: r.id,
        numero: r.numero || '',
        data: r.data || '',
        hora: r.hora || '',
        turno: r.turno || '',
        solicitante: r.solicitante || '',
        setor: r.setor || '',
        lote: r.lote || '',
        status: r.status || 'pendente',
        prioridade: r.prioridade || 'normal',
        obs: r.observacoes || '',
        operador: r.operador_logistica || '',
        tempo_min: r.tempo_separacao_min,
        criada_em: r.created_date || '',
        entregue_em: r.ts_entrega || '',
        itens: itemsByReq[r.id] || []
      };
    });

    res.status(200).json({ ok: true, atualizado_em: new Date().toISOString(), requisicoes: out });
  } catch (e) {
    console.error('[api/requisicoes] erro:', e);
    res.status(e.status === 401 || e.status === 403 ? 502 : 500).json({ error: (e && e.message) || 'Erro ao buscar no Base44' });
  }
};
