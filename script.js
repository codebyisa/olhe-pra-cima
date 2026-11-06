const PROXY = 'olhe-pra-cima.isaducadev.workers.dev/?url=';


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