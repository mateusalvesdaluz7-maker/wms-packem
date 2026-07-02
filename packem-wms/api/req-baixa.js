// /api/req-baixa.js — Vercel Serverless Function
// Recebe do WMS a baixa de um item de requisição (produto separado numa vaga) e ESCREVE no Base44:
// marca o item como separado (ou parcial) e soma a quantidade_separada.
// Usa a MESMA variável BASE44_API_KEY já configurada no projeto.
//
// Corpo esperado (POST JSON):
//   { item_id: "<id do ItemRequisicao>", kg: 300, endereco: "T-220-4", usuario: "Leonardo" }
// Opcional: { requisicao_id, concluir_requisicao: true }

const APP_ID = '69f21c3bf6750842cd0ab83c'; // REQUISIÇÃO PACKEM
const BASE = 'https://app.base44.com/api/apps/' + APP_ID + '/entities/';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }

  const key = (process.env.BASE44_API_KEY || '').trim();
  if (!key) { res.status(500).json({ error: 'BASE44_API_KEY não configurada no servidor' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const itemId = body && body.item_id;
  const kg = Number(body && body.kg) || 0;
  const endereco = (body && body.endereco) ? String(body.endereco) : '';
  const usuario = (body && body.usuario) ? String(body.usuario) : 'WMS';
  if (!itemId) { res.status(400).json({ error: 'Faltou item_id' }); return; }

  async function b44(method, path, payload) {
    const r = await fetch(BASE + path, {
      method: method,
      headers: { api_key: key, 'content-type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || ('HTTP ' + r.status);
      const e = new Error(msg); e.status = r.status; throw e;
    }
    return data;
  }

  try {
    // 1) lê o item atual pra somar em cima do que já tinha
    const item = await b44('GET', 'ItemRequisicao/' + itemId);
    if (!item || !item.id) { res.status(404).json({ error: 'Item não encontrado no Base44' }); return; }

    const pedido = Number(item.quantidade) || 0;
    const jaSep = Number(item.quantidade_separada) || 0;
    const novoSep = kg > 0 ? (jaSep + kg) : jaSep;
    const completo = pedido > 0 ? (novoSep >= pedido - 0.001) : true; // tolerância p/ arredondamento

    const patch = {
      quantidade_separada: novoSep,
      separado: completo,
      entrega_parcial: !completo && novoSep > 0
    };
    const obsAdd = 'WMS: ' + (kg > 0 ? (kg + 'kg ') : '') + (endereco ? ('de ' + endereco + ' ') : '') + 'por ' + usuario;
    patch.obs_item = item.obs_item ? (item.obs_item + ' | ' + obsAdd) : obsAdd;

    const updated = await b44('PUT', 'ItemRequisicao/' + itemId, patch);

    // 2) se pediram, e todos os itens da requisição estão separados, fecha a requisição
    let requisicao_status = null;
    const reqId = (body && body.requisicao_id) || item.requisicao_id;
    if (reqId) {
      const irmaos = await b44('GET', 'ItemRequisicao?requisicao_id=' + encodeURIComponent(reqId) + '&limit=200');
      const arr = Array.isArray(irmaos) ? irmaos : ((irmaos && irmaos.results) || []);
      const todosOk = arr.length > 0 && arr.every(function (x) {
        return x.id === itemId ? completo : !!x.separado;
      });
      if (todosOk) {
        const nowISO = new Date().toISOString();
        try {
          const reqAtual = await b44('GET', 'Requisicao/' + reqId);
          const hist = Array.isArray(reqAtual && reqAtual.historico) ? reqAtual.historico.slice() : [];
          hist.push({ ts: nowISO, acao: 'Separação Concluída', usuario: usuario, detalhe: 'Baixa via WMS' });
          hist.push({ ts: nowISO, acao: 'Entregue', usuario: usuario, detalhe: 'Material separado no armazém (WMS)' });
          await b44('PUT', 'Requisicao/' + reqId, {
            status: 'entregue',
            operador_logistica: (reqAtual && reqAtual.operador_logistica) || usuario,
            ts_fim_separacao: nowISO,
            ts_entrega: nowISO,
            historico: hist
          });
          requisicao_status = 'entregue';
        } catch (e2) { requisicao_status = 'erro_ao_fechar: ' + (e2 && e2.message); }
      } else {
        // marca em separação se ainda estava pendente
        try {
          const reqAtual = await b44('GET', 'Requisicao/' + reqId);
          if (reqAtual && reqAtual.status === 'pendente') {
            const hist = Array.isArray(reqAtual.historico) ? reqAtual.historico.slice() : [];
            hist.push({ ts: new Date().toISOString(), acao: 'Separação Iniciada', usuario: usuario, detalhe: 'Via WMS' });
            await b44('PUT', 'Requisicao/' + reqId, { status: 'em_separacao', operador_logistica: usuario, ts_inicio_separacao: new Date().toISOString(), historico: hist });
            requisicao_status = 'em_separacao';
          }
        } catch (e3) { /* silencioso */ }
      }
    }

    res.status(200).json({
      ok: true,
      item_id: itemId,
      quantidade_separada: novoSep,
      separado: completo,
      requisicao_status: requisicao_status
    });
  } catch (e) {
    console.error('[api/req-baixa] erro:', e);
    res.status(500).json({ error: (e && e.message) || 'Erro ao escrever no Base44' });
  }
};
