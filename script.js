/* =========================================================
   Olhe pra cima — proxy opcional (Cloudflare Workers)

   Use só se alguma API bloquear chamadas direto do navegador (CORS).
   1. Crie um Worker em https://dash.cloudflare.com → Workers & Pages
   2. Cole este código e publique
   3. No script.js, preencha:
      const PROXY = 'https://SEU-WORKER.workers.dev/?url=';
   ========================================================= */

// Só repassa pedidos para estes endereços (evita virar um proxy aberto)
const ALLOWED_HOSTS = [
  'api.adsb.lol',
  'api.airplanes.live',
  'opensky-network.org',
  'api.wheretheiss.at',
  'celestrak.org',
  'api.bigdatacloud.net',
  'geocoding-api.open-meteo.com',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('Faltou o parâmetro ?url=', { status: 400, headers: CORS });

    let url;
    try { url = new URL(target); } catch { return new Response('URL inválida', { status: 400, headers: CORS }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Endereço não permitido', { status: 403, headers: CORS });
    }

    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'olhe-pra-cima (projeto pessoal)', Accept: request.headers.get('Accept') || '*/*' },
      cf: { cacheTtl: 5, cacheEverything: true }, // cache curtinho para poupar as APIs
    });

    const headers = new Headers(upstream.headers);
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};