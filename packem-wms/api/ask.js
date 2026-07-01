// /api/ask.js — Vercel Serverless Function
// Recebe a pergunta por voz + um resumo do estoque atual, chama a IA do Google Gemini (plano gratuito)
// com a chave guardada em segredo (variável de ambiente GEMINI_API_KEY) e devolve a resposta.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Diagnóstico: abra /api/ask no navegador (GET) pra ver na hora se a chave chegou no servidor.
  if (req.method === 'GET') {
    const k = (process.env.GEMINI_API_KEY || '').trim();
    res.status(200).json({
      ok: true,
      gemini_key_configured: !!k,
      key_preview: k ? (k.slice(0, 4) + '...' + k.slice(-4) + ' (' + k.length + ' caracteres)') : null,
      dica: k ? 'Chave encontrada no servidor. Se ainda der erro no chat, o problema é outro (veja Vercel > Logs).' : 'Chave NÃO encontrada. Confira Vercel > Settings > Environment Variables do PROJETO (não do Time) e faça um novo deploy.'
    });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }

  try {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor (Vercel > Settings > Environment Variables DO PROJETO, depois faça um novo deploy)' });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const question = (body && body.question) ? String(body.question).slice(0, 500) : '';
    const context = (body && body.context) ? body.context : {};
    const history = Array.isArray(body && body.history) ? body.history.slice(-10) : [];
    if (!question.trim()) { res.status(400).json({ error: 'Faltou a pergunta' }); return; }

    const systemText = [
      'Você é o LogiAssist, o assistente de voz do Packem WMS (sistema de gestão de armazém).',
      'Operadores de empilhadeira e auxiliares de estoque falam com você em voz alta no chão de fábrica. Eles precisam de respostas rápidas, claras e confiáveis — sem enrolação.',
      '',
      'TOM: direto, objetivo, prestativo, focado no trabalho. Nada de textão, introdução ou formalidade excessiva.',
      '',
      'REGRAS DE RESPOSTA:',
      '- Responda em português do Brasil, natural, como se estivesse falando (SEM markdown, SEM asteriscos, SEM listas, SEM títulos — a resposta também é lida em voz alta).',
      '- No máximo 2-3 frases curtas.',
      '- Ao informar uma localização, diga rua, posição/bloco e nível de forma clara.',
      '- Sempre inclua o peso (kg) ou a quantidade quando o operador perguntar ou quando for relevante.',
      '- Se o operador descrever uma ação (ex: "vou mover a bobina X pra rua Y"), confirme que entendeu, mas deixe claro que a movimentação só é registrada de verdade quando ele bipar no sistema.',
      '',
      'COMO ACHAR O PRODUTO NOS DADOS:',
      '- O operador pode se referir ao produto pelo CÓDIGO (ex: "produto 1024") OU pela DESCRIÇÃO (ex: "aquela bobina branca", "o papel kraft de 900 quilos", "a que chegou ontem"). Cruze a pergunta com o campo "descricao" também, não só com o código do produto.',
      '- Faça a correspondência mesmo com descrição parcial, sinônimo ou jeito informal de falar — não exija que o operador saiba o código exato.',
      '- Se a descrição bater com mais de um produto, cite rapidamente as opções e pergunte qual delas é (ex: "achei dois parecidos, o código X e o código Y, qual dos dois?").',
      '- Use APENAS os dados do estoque fornecidos abaixo em JSON. Nunca invente endereço, produto, peso ou quantidade que não estejam nos dados.',
      '- Se não achar a informação nos dados (nem por código, nem por descrição), diga claramente que não encontrou e peça mais detalhes.',
      '- Se a pergunta pedir uma vaga livre, sugira um endereço da lista "exemplos_enderecos_livres" ou baseado em "livres_por_rua".',
      '',
      'Dados atuais do armazém (JSON):',
      JSON.stringify(context).slice(0, 12000)
    ].join('\n');

    const model = 'gemini-2.5-flash';
    const historyContents = history.map(function (h) {
      return { role: (h && h.role === 'assistant') ? 'model' : 'user', parts: [{ text: String((h && h.text) || '').slice(0, 500) }] };
    });
    const contents = historyContents.concat([{ role: 'user', parts: [{ text: question }] }]);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 9000);
    let r;
    try {
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemText }] },
          contents: contents,
          generationConfig: { maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } }
        }),
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      res.status(504).json({ error: (fetchErr && fetchErr.name === 'AbortError') ? 'A IA demorou demais pra responder' : 'Erro de rede ao chamar a IA' });
      return;
    }
    clearTimeout(timer);

    const data = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: (data && data.error && data.error.message) ? data.error.message : 'Erro ao chamar a IA' });
      return;
    }
    const cand = data.candidates && data.candidates[0];
    const answer = (cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text) ? cand.content.parts[0].text.trim() : 'Não consegui pensar em uma resposta agora.';
    res.status(200).json({ answer: answer });
  } catch (e) {
    console.error('[api/ask] erro interno:', e);
    res.status(500).json({ error: 'Erro interno: ' + (e && e.message ? e.message : String(e)) });
  }
};
