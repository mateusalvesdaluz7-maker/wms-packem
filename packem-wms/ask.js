// /api/ask.js — Vercel Serverless Function
// Recebe a pergunta por voz + um resumo do estoque atual, chama a IA do Google Gemini (plano gratuito)
// com a chave guardada em segredo (variável de ambiente GEMINI_API_KEY) e devolve a resposta.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor (Vercel > Settings > Environment Variables)' });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const question = (body && body.question) ? String(body.question).slice(0, 500) : '';
    const context = (body && body.context) ? body.context : {};
    const history = Array.isArray(body && body.history) ? body.history.slice(-10) : [];
    if (!question.trim()) { res.status(400).json({ error: 'Faltou a pergunta' }); return; }

    const systemText = [
      'Você é o assistente de voz do Packem WMS, um sistema de gestão de armazém.',
      'Um operador de armazém fez uma pergunta falando em voz alta. Você vai responder em voz alta também.',
      'Regras da resposta:',
      '- Responda em português do Brasil, direto e natural, como se estivesse falando (sem markdown, sem listas, sem asteriscos, sem títulos).',
      '- No máximo 2-3 frases curtas.',
      '- Use APENAS os dados do estoque fornecidos abaixo em JSON. Não invente endereço, produto ou quantidade que não estejam nos dados.',
      '- Se não achar a informação nos dados, diga claramente que não encontrou.',
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
          generationConfig: { maxOutputTokens: 300 }
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
    res.status(500).json({ error: 'Erro interno: ' + (e && e.message ? e.message : String(e)) });
  }
};
