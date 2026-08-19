/*
 * Leitura de etiqueta por foto.
 * A chave da OpenAI fica somente nas variáveis de ambiente da Vercel
 * (OPENAI_API_KEY) e nunca é enviada ao navegador.
 */

const MAX_IMAGE_CHARS = 6_000_000;
const IMAGE_PREFIX = /^data:image\/(?:jpeg|jpg|png|webp);base64,/i;

function send(res, status, body) {
  res.status(status).json(body);
}

function extractText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output || []).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text).join('\n');
}

function parseJson(text) {
  const clean = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(clean);
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 180) : null;
}

function kgOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : null;
}

function openAIErrorMessage(status, payload) {
  const error = payload && payload.error ? payload.error : {};
  const code = String(error.code || '').toLowerCase();
  const type = String(error.type || '').toLowerCase();
  const raw = String(error.message || '').toLowerCase();
  if (status === 401 || code === 'invalid_api_key' || raw.includes('api key')) {
    return 'A chave da OpenAI está inválida ou foi revogada. Atualize OPENAI_API_KEY na Vercel e faça um novo deploy.';
  }
  if (status === 429 || code === 'insufficient_quota' || type === 'insufficient_quota' || raw.includes('quota') || raw.includes('billing')) {
    return 'A conta da API OpenAI está sem crédito ou cota. Ative o faturamento ou adicione saldo e tente novamente.';
  }
  if (status === 403 || code === 'permission_denied') {
    return 'A chave da OpenAI não tem permissão para usar o modelo de leitura de imagens.';
  }
  if (code === 'model_not_found' || raw.includes('model') && raw.includes('not found')) {
    return 'O modelo de leitura não está disponível neste projeto. Configure OPENAI_OCR_MODEL como gpt-5.6-luna.';
  }
  return 'O serviço de leitura recusou a foto. Verifique a configuração da API OpenAI e tente novamente.';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
  if (!process.env.OPENAI_API_KEY) return send(res, 503, { error: 'Leitura por foto ainda não foi configurada no servidor.' });

  const imageDataUrl = req.body && req.body.imageDataUrl;
  if (typeof imageDataUrl !== 'string' || !IMAGE_PREFIX.test(imageDataUrl) || imageDataUrl.length > MAX_IMAGE_CHARS) {
    return send(res, 400, { error: 'Envie uma foto JPEG, PNG ou WebP de até aproximadamente 4 MB.' });
  }

  try {
    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_OCR_MODEL || 'gpt-5.6-luna',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Leia esta etiqueta industrial. Retorne APENAS JSON válido, sem markdown, com exatamente estas chaves: identificador_bobina (texto ou null), descricao (texto ou null), peso_liquido_kg (número ou null), peso_bruto_kg (número ou null). Descrição deve incluir o material e as medidas/impressões visíveis, por exemplo "ART MAT PLAST · 167 GM² · 180 CM". Não invente dados: use null quando não estiver legível.',
            },
            { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
          ],
        }],
      }),
    });
    const payload = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error('OCR OpenAI error', apiResponse.status, payload && payload.error && payload.error.code, payload && payload.error && payload.error.message);
      return send(res, apiResponse.status === 429 ? 429 : 502, { error: openAIErrorMessage(apiResponse.status, payload) });
    }

    const read = parseJson(extractText(payload));
    return send(res, 200, {
      identificador_bobina: textOrNull(read.identificador_bobina),
      descricao: textOrNull(read.descricao),
      peso_liquido_kg: kgOrNull(read.peso_liquido_kg),
      peso_bruto_kg: kgOrNull(read.peso_bruto_kg),
    });
  } catch (error) {
    console.error('OCR endpoint error', error);
    return send(res, 502, { error: 'Não foi possível interpretar a etiqueta. Tire outra foto, de frente e bem iluminada.' });
  }
};
