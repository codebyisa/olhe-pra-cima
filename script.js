/* =========================================================
   Olhe pra cima — script.js
   ========================================================= */
(() => {
  'use strict';

  /* ---------------------------------------------------------
     Configuração
     --------------------------------------------------------- */

  // Se alguma API bloquear chamadas do navegador (CORS), publique o
  // worker.js no Cloudflare Workers e coloque o endereço aqui, assim:
  // const PROXY = 'https://olhe-pra-cima.SEU-USUARIO.workers.dev/?url=';
  const PROXY = 'https://olhe-pra-cima.isaducadev.workers.dev/?url=';

  const REFRESH_FLIGHTS = 10000; // atualiza os aviões a cada 10 s
  const LOAD_FACTOR = 0.82;      // ocupação média dos voos no Brasil (~80%, ANAC)

  const LIBS = {
    satellite: [
      'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/satellite.js/4.1.4/satellite.min.js',
    ],
    topojson: [
      'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js',
      'https://unpkg.com/topojson-client@3/dist/topojson-client.min.js',
    ],
  };
  const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json';

  // Imagens reais da Terra feitas por satélites da NASA (GIBS, domínio público)
  const gibs = (layer, format = 'image/jpeg') =>
    `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=2048&HEIGHT=1024&FORMAT=${encodeURIComponent(format)}`;
  const EARTH_DAY = [gibs('BlueMarble_NextGeneration'), gibs('BlueMarble_ShadedRelief_Bathymetry')];
  const EARTH_NIGHT = [gibs('VIIRS_Black_Marble'), gibs('VIIRS_CityLights_2012')];

  // Fontes de aviões, em ordem de preferência (todas gratuitas)
  const FLIGHT_SOURCES = [
    { name: 'adsb.lol', url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`, parse: parseReadsb },
    { name: 'airplanes.live', url: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`, parse: parseReadsb },
    { name: 'adsb.fi', url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`, parse: parseReadsb },
    {
      name: 'OpenSky',
      url: (latStr, lonStr, nm) => {
        const lat = Number(latStr);
        const lon = Number(lonStr);
        const dLat = (nm * 1.852) / 111;
        const dLon = dLat / Math.cos(lat * Math.PI / 180);
        return `https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(3)}&lomin=${(lon - dLon).toFixed(3)}&lamax=${(lat + dLat).toFixed(3)}&lomax=${(lon + dLon).toFixed(3)}`;
      },
      parse: parseOpenSky,
    },
  ];

  const ISS_ID = 25544;
  const TLE_SOURCES = [
    {
      url: `https://api.wheretheiss.at/v1/satellites/${ISS_ID}/tles`,
      parse: (j) => [j.line1, j.line2],
    },
    {
      url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${ISS_ID}&FORMAT=TLE`,
      text: true,
      parse: (t) => { const l = t.trim().split(/\r?\n/).map((s) => s.trim()); return [l[l.length - 2], l[l.length - 1]]; },
    },
  ];

  /* ---------------------------------------------------------
     Dados de referência
     --------------------------------------------------------- */

  // Companhias aéreas pelo prefixo ICAO do voo
  const AIRLINES = {
    TAM: 'LATAM Brasil', GLO: 'Gol', AZU: 'Azul', PTB: 'Voepass', LAN: 'LATAM Chile', LPE: 'LATAM Peru',
    ARG: 'Aerolíneas Argentinas', AVA: 'Avianca', CMP: 'Copa Airlines', SKU: 'Sky Airline', JAT: 'JetSMART',
    AAL: 'American Airlines', UAL: 'United Airlines', DAL: 'Delta Air Lines', ACA: 'Air Canada',
    AFR: 'Air France', KLM: 'KLM', DLH: 'Lufthansa', BAW: 'British Airways', IBE: 'Iberia', TAP: 'TAP Air Portugal',
    AZA: 'ITA Airways', ITY: 'ITA Airways', SWR: 'Swiss', UAE: 'Emirates', QTR: 'Qatar Airways', THY: 'Turkish Airlines',
    ETH: 'Ethiopian Airlines', SAA: 'South African Airways', AEA: 'Air Europa', AMX: 'Aeroméxico',
    BOV: 'Boliviana de Aviación', AAR: 'Asiana', KAL: 'Korean Air', JAL: 'Japan Airlines', ANA: 'All Nippon Airways',
    FDX: 'FedEx (carga)', UPS: 'UPS (carga)', CLX: 'Cargolux (carga)', GTI: 'Atlas Air (carga)', ABJ: 'Abaeté',
    LTG: 'LATAM Cargo', TUS: 'ABSA Cargo', MWM: 'Modern Logistics (carga)', TTL: 'Total Linhas Aéreas',
  };
  const CARGO = new Set(['FDX', 'UPS', 'CLX', 'GTI', 'LTG', 'TUS', 'MWM', 'ABX', 'CKS', 'GEC', 'BOX', 'TTL']);

  // Assentos aproximados por tipo de aeronave (código ICAO)
  const SEATS = {
    A318: 120, A319: 144, A320: 174, A20N: 174, A321: 220, A21N: 220, A332: 250, A333: 290, A339: 300,
    A359: 330, A35K: 360, A388: 500, B712: 110, B733: 140, B734: 150, B737: 150, B738: 186, B739: 178,
    B37M: 160, B38M: 186, B39M: 186, B752: 200, B763: 220, B764: 240, B772: 300, B77L: 310, B77W: 350,
    B788: 250, B789: 290, B78X: 320, B744: 400, B748: 400, E170: 72, E175: 80, E190: 106, E195: 118,
    E290: 114, E295: 136, E145: 50, AT43: 46, AT45: 46, AT72: 70, AT75: 70, AT76: 70, CRJ9: 76, DH8D: 76,
    C208: 9, PC12: 8, B350: 9, BE20: 9,
  };

  // Faixas de endereço ICAO → país de registro
  const ICAO_COUNTRIES = [
    [0xe40000, 0xe7ffff, 'Brasil'], [0xe00000, 0xe3ffff, 'Argentina'], [0xe80000, 0xe80fff, 'Chile'],
    [0xe84000, 0xe84fff, 'Peru'], [0x0ac000, 0x0acfff, 'Colômbia'], [0x0c2000, 0x0c2fff, 'Panamá'],
    [0xa00000, 0xafffff, 'Estados Unidos'], [0xc00000, 0xc3ffff, 'Canadá'], [0x0d0000, 0x0d7fff, 'México'],
    [0x490000, 0x497fff, 'Portugal'], [0x340000, 0x37ffff, 'Espanha'], [0x380000, 0x3bffff, 'França'],
    [0x3c0000, 0x3fffff, 'Alemanha'], [0x400000, 0x43ffff, 'Reino Unido'], [0x300000, 0x33ffff, 'Itália'],
    [0x480000, 0x487fff, 'Holanda'], [0x4b0000, 0x4b7fff, 'Suíça'], [0x4b8000, 0x4bffff, 'Turquia'],
    [0x896000, 0x896fff, 'Emirados Árabes'], [0x06a000, 0x06a3ff, 'Catar'], [0x040000, 0x040fff, 'Etiópia'],
  ];

  const DIRS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];
  const DIRS_SHORT = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const EARTH_KM = 6371;
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const nfCache = {};
  function fmt(n, dec = 0) {
    if (!nfCache[dec]) nfCache[dec] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return nfCache[dec].format(n);
  }

  const fmtTime = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtClock = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDay = (d) => {
    const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  function dayLabel(d) {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + DAY);
    if (d.toDateString() === today.toDateString()) return 'Hoje';
    if (d.toDateString() === tomorrow.toDateString()) return 'Amanhã';
    const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  const dirName = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const dirShort = (deg) => DIRS_SHORT[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * D2R;
    const dLon = (lon2 - lon1) * D2R;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * D2R) * Math.cos(lat2 * D2R);
    const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon2 - lon1) * D2R);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  // Distância em linha reta (atravessando o espaço) até um ponto em altitude
  function slantKm(lat1, lon1, lat2, lon2, altKm) {
    const toXYZ = (lat, lon, r) => [r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.cos(lat * D2R) * Math.sin(lon * D2R), r * Math.sin(lat * D2R)];
    const a = toXYZ(lat1, lon1, EARTH_KM);
    const b = toXYZ(lat2, lon2, EARTH_KM + altKm);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  // Lembra, para cada site, se a chamada direta ou pelo proxy funcionou
  const routeByHost = {};

  async function rawFetch(url, timeout, text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: text ? 'text/plain' : 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return text ? await res.text() : await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Traduz o erro para algo legível na tela
  function describeError(err, route) {
    if (err.name === 'AbortError') return 'demorou demais para responder';
    if (err.name === 'SyntaxError') {
      return route === 'proxy'
        ? 'o proxy respondeu algo inesperado (o código do worker foi colado e publicado com Deploy?)'
        : 'respondeu algo inesperado';
    }
    if (err instanceof TypeError) {
      return route === 'proxy'
        ? 'o proxy não respondeu ou respondeu sem autorização (abra o endereço do worker numa aba nova para testar)'
        : 'bloqueado pelo navegador (CORS)';
    }
    const code = Number(String(err.message).replace(/\D/g, ''));
    if (code === 401) return 'exige login (HTTP 401)';
    if (code === 403) return 'acesso negado (HTTP 403)';
    if (code === 404) return 'endereço não encontrado (HTTP 404)';
    if (code === 502) return 'o proxy não conseguiu acessar este serviço (HTTP 502)';
    if (code === 429) return 'limite de consultas atingido (HTTP 429)';
    return err.message || 'falhou';
  }

  // Tenta direto; se o navegador bloquear (CORS) ou falhar, tenta pelo proxy
  async function fetchWithTimeout(url, { timeout = 9000, text = false } = {}) {
    const host = new URL(url).hostname;
    const order = routeByHost[host] === 'proxy' ? ['proxy', 'direct'] : ['direct', 'proxy'];
    let lastError = null;
    const details = [];

    for (const route of order) {
      if (route === 'proxy' && !PROXY) continue;
      try {
        const target = route === 'proxy' ? PROXY + encodeURIComponent(url) : url;
        const data = await rawFetch(target, timeout, text);
        if (routeByHost[host] !== route) {
          routeByHost[host] = route;
          console.info(`[olhe pra cima] ${host}: funcionando via ${route === 'proxy' ? 'proxy' : 'chamada direta'}`);
        }
        return data;
      } catch (err) {
        lastError = err;
        details.push(`${route === 'proxy' ? 'pelo proxy' : 'direto'}: ${describeError(err, route)}`);
        console.warn(`[olhe pra cima] ${host}: falhou via ${route === 'proxy' ? 'proxy' : 'chamada direta'} (${err.message})`);
      }
    }
    if (!PROXY) details.push('proxy: não configurado');
    const error = lastError || new Error('Falha na conexão');
    error.details = details;
    throw error;
  }

  function loadScript(urls) {
    return new Promise((resolve, reject) => {
      const list = [...urls];
      const next = () => {
        const src = list.shift();
        if (!src) { reject(new Error('Biblioteca indisponível')); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { s.remove(); next(); };
        document.head.appendChild(s);
      };
      next();
    });
  }

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('opc:' + key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('opc:' + key, JSON.stringify(value)); } catch {}
    },
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------
     Elementos
     --------------------------------------------------------- */
  const el = {
    sky: $('#sky'),
    placeName: $('#placeName'),
    changePlace: $('#changePlace'),

    intro: $('#intro'),
    useLocation: $('#useLocation'),
    cityForm: $('#cityForm'),
    cityInput: $('#cityInput'),
    cityResults: $('#cityResults'),
    introError: $('#introError'),

    results: $('#results'),
    summaryPlace: $('#summaryPlace'),
    clock: $('#clock'),
    countPlanes: $('#countPlanes'),
    countPeople: $('#countPeople'),
    issDistanceSummary: $('#issDistanceSummary'),
    summaryNote: $('#summaryNote'),

    rangeToggle: $('#rangeToggle'),
    radarStatus: $('#radarStatus'),
    radarStatusText: $('#radarStatusText'),
    radarBox: $('#radarBox'),
    radarCanvas: $('#radarCanvas'),
    radarPlanes: $('#radarPlanes'),

    flightDetail: $('#flightDetail'),
    detailClose: $('#detailClose'),
    detailCountry: $('#detailCountry'),
    detailCallsign: $('#detailCallsign'),
    detailAirline: $('#detailAirline'),
    detailAltitude: $('#detailAltitude'),
    detailSpeed: $('#detailSpeed'),
    detailHeading: $('#detailHeading'),
    detailDistance: $('#detailDistance'),
    detailVertical: $('#detailVertical'),
    detailPeople: $('#detailPeople'),
    detailNote: $('#detailNote'),
    flightsCount: $('#flightsCount'),
    flightList: $('#flightList'),

    issCanvas: $('#issCanvas'),
    issOver: $('#issOver'),
    issAltitude: $('#issAltitude'),
    issSpeed: $('#issSpeed'),
    issSpeedNote: $('#issSpeedNote'),
    issDistance: $('#issDistance'),
    issDistanceNote: $('#issDistanceNote'),
    issOrbitsToday: $('#issOrbitsToday'),

    nextPass: $('#nextPass'),
    nextPassDate: $('#nextPassDate'),
    nextPassInfo: $('#nextPassInfo'),
    nextPassCountdown: $('#nextPassCountdown'),
    nextPassCalendar: $('#nextPassCalendar'),
    passList: $('#passList'),

    ladder: $('#ladder'),
    altimeterValue: $('#altimeterValue'),
    ladderPlanes: $('#ladderPlanes'),
    ladderIss: $('#ladderIss'),

    toast: $('#toast'),
    footerYear: $('#footerYear'),
  };

  /* ---------------------------------------------------------
     Estado
     --------------------------------------------------------- */
  let place = null;            // { lat, lon, label }
  let rangeKm = store.get('range', 100);
  let flights = new Map();     // id → avião
  let selectedId = null;
  let sourceIndex = 0;
  let flightTimer = null;
  let tickTimer = null;
  let toastTimer = null;
  let session = 0;             // invalida timers ao trocar de local

  let sat = null;              // biblioteca satellite.js
  let satrec = null;           // órbita da ISS
  let issNow = null;           // { lat, lon, altKm, speedKmh, distKm, elevation, azimuth }
  let passes = [];
  let land = null;             // polígonos do mapa-múndi (reserva)
  let earthDay = null;         // foto de satélite da Terra (dia)
  let earthNight = null;       // foto de satélite da Terra (luzes à noite)
  let issOverLabel = '';
  let lastOverLookup = 0;

  /* =========================================================
     Aviões
     ========================================================= */
  function parseReadsb(json) {
    const list = json.ac || json.aircraft || [];
    return list
      .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
      .map((a) => {
        const ground = a.alt_baro === 'ground';
        const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : typeof a.alt_geom === 'number' ? a.alt_geom : 0;
        const vRateFt = typeof a.baro_rate === 'number' ? a.baro_rate : typeof a.geom_rate === 'number' ? a.geom_rate : 0;
        return {
          id: a.hex,
          callsign: (a.flight || '').trim() || (a.r || '').trim() || a.hex.toUpperCase(),
          reg: (a.r || '').trim(),
          type: (a.t || '').trim().toUpperCase(),
          desc: (a.desc || '').trim(),
          operator: (a.ownOp || '').trim(),
          lat: a.lat,
          lon: a.lon,
          ground,
          altM: ground ? 0 : altFt * 0.3048,
          speedKmh: (a.gs || 0) * 1.852,
          track: a.track ?? a.true_heading ?? a.mag_heading ?? 0,
          vRate: vRateFt * 0.00508, // m/s
          category: a.category || '',
          country: countryFromHex(a.hex),
        };
      });
  }

  function parseOpenSky(json) {
    return (json.states || [])
      .filter((s) => typeof s[5] === 'number' && typeof s[6] === 'number')
      .map((s) => ({
        id: s[0],
        callsign: (s[1] || '').trim() || s[0].toUpperCase(),
        reg: '',
        type: '',
        desc: '',
        operator: '',
        lat: s[6],
        lon: s[5],
        ground: !!s[8],
        altM: s[8] ? 0 : (s[7] ?? s[13] ?? 0),
        speedKmh: (s[9] || 0) * 3.6,
        track: s[10] || 0,
        vRate: s[11] || 0,
        category: '',
        country: s[2] === 'Brazil' ? 'Brasil' : s[2] || '',
      }));
  }

  function countryFromHex(hex) {
    const n = parseInt(hex, 16);
    if (isNaN(n)) return '';
    const found = ICAO_COUNTRIES.find(([a, b]) => n >= a && n <= b);
    return found ? found[2] : '';
  }

  function airlineOf(p) {
    const prefix = p.callsign.slice(0, 3).toUpperCase();
    return /^[A-Z]{3}\d/.test(p.callsign) ? { code: prefix, name: AIRLINES[prefix] || '' } : { code: '', name: '' };
  }

  // Estimativa de pessoas a bordo
  function peopleOnBoard(p) {
    const { code } = airlineOf(p);
    if (code && CARGO.has(code)) return 3;
    if (SEATS[p.type]) {
      const seats = SEATS[p.type];
      return seats > 20 ? Math.round(seats * LOAD_FACTOR) : Math.max(2, Math.round(seats * 0.6));
    }
    switch (p.category) {
      case 'A1': return 3;
      case 'A2': return 8;
      case 'A3': return Math.round(170 * LOAD_FACTOR);
      case 'A4': return Math.round(200 * LOAD_FACTOR);
      case 'A5': return Math.round(300 * LOAD_FACTOR);
      case 'A7': return 3;
      default: return code ? Math.round(150 * LOAD_FACTOR) : 3;
    }
  }

  function flightKind(p) {
    if (p.ground) return 'ground';
    if (Math.abs(p.vRate) > 2.5 && p.altM < 7000) return 'climb';
    return 'air';
  }

  async function fetchFlights(mySession) {
    if (!place) return;
    setRadarStatus('loading', 'Atualizando…');

    const nm = Math.min(250, Math.ceil(rangeKm / 1.852) + 2);
    const lat = place.lat.toFixed(4);
    const lon = place.lon.toFixed(4);

    const report = [];
    for (let i = 0; i < FLIGHT_SOURCES.length; i++) {
      const idx = (sourceIndex + i) % FLIGHT_SOURCES.length;
      const src = FLIGHT_SOURCES[idx];
      try {
        const json = await fetchWithTimeout(src.url(lat, lon, nm));
        if (mySession !== session) return;
        sourceIndex = idx;
        updateFlights(src.parse(json));
        setRadarStatus('ok', `Ao vivo · atualizado às ${fmtClock(new Date())}`);
        return;
      } catch (err) {
        report.push(`<li><strong>${src.name}</strong> — ${(err.details || [err.message]).join(' · ')}</li>`);
      }
    }

    if (mySession !== session) return;
    setRadarStatus('error', 'Não foi possível carregar os aviões agora');
    if (!flights.size) {
      el.flightList.innerHTML = `
        <li class="flight-empty">
          Nenhuma fonte de aviões respondeu. Diagnóstico:
          <ul class="flight-report">${report.join('')}</ul>
          Tentando de novo em instantes…
        </li>`;
    }
  }

  function setRadarStatus(kind, text) {
    el.radarStatus.classList.toggle('is-loading', kind === 'loading');
    el.radarStatus.classList.toggle('is-error', kind === 'error');
    if (kind !== 'loading' || !el.radarStatusText.textContent) el.radarStatusText.textContent = text;
  }

  function updateFlights(list) {
    const now = Date.now();
    const next = new Map();

    list.forEach((p) => {
      p.lat0 = p.lat;
      p.lon0 = p.lon;
      p.t0 = now;
      next.set(p.id, p);
    });

    flights = next;
    if (selectedId && !flights.has(selectedId)) selectedId = null;
    renderFlights();
  }

  // Move os aviões entre uma atualização e outra (estimativa pela velocidade e rumo)
  function deadReckon() {
    const now = Date.now();
    flights.forEach((p) => {
      if (p.ground || !p.speedKmh) return;
      const dt = Math.min(30, (now - p.t0) / 1000);
      const d = (p.speedKmh / 3.6) * dt; // metros
      p.lat = p.lat0 + (d * Math.cos(p.track * D2R)) / 111320;
      p.lon = p.lon0 + (d * Math.sin(p.track * D2R)) / (111320 * Math.cos(p.lat0 * D2R));
    });
  }

  function computeFlightGeo() {
    flights.forEach((p) => {
      p.dist = haversine(place.lat, place.lon, p.lat, p.lon);
      p.brg = bearing(place.lat, place.lon, p.lat, p.lon);
      p.kind = flightKind(p);
      p.people = p.ground ? 0 : peopleOnBoard(p);
    });
  }

  function renderFlights() {
    if (!place) return;
    deadReckon();
    computeFlightGeo();

    const inRange = [...flights.values()].filter((p) => p.dist <= rangeKm).sort((a, b) => a.dist - b.dist);
    const airborne = inRange.filter((p) => !p.ground);
    const people = airborne.reduce((acc, p) => acc + p.people, 0);

    // Contadores do resumo
    el.countPlanes.textContent = fmt(airborne.length);
    el.countPeople.textContent = fmt(people);
    el.flightsCount.textContent = `${inRange.length} ${inRange.length === 1 ? 'aeronave' : 'aeronaves'}`;
    el.ladderPlanes.textContent = `${fmt(airborne.length)} ${airborne.length === 1 ? 'avião' : 'aviões'}`;

    const closest = airborne[0];
    el.summaryNote.textContent = closest
      ? `O avião mais perto é o ${closest.callsign}, a ${fmt(closest.dist, 1)} km de você, voando a ${fmt(Math.round(closest.altM / 100) * 100)} m de altura${airlineOf(closest).name ? ` (${airlineOf(closest).name})` : ''}.`
      : `Nenhum avião voando num raio de ${rangeKm} km agora. Que céu tranquilo!`;

    renderRadarPlanes(inRange);
    renderFlightList(inRange);
    if (selectedId) renderDetail();
  }

  function renderRadarPlanes(list) {
    const existing = new Map($$('.plane', el.radarPlanes).map((n) => [n.dataset.id, n]));
    const keep = new Set();

    list.forEach((p) => {
      const r = (p.dist / rangeKm) * 47; // % do raio (deixa uma margem)
      const x = 50 + r * Math.sin(p.brg * D2R);
      const y = 50 - r * Math.cos(p.brg * D2R);

      let node = existing.get(p.id);
      if (!node) {
        node = document.createElement('button');
        node.type = 'button';
        node.className = 'plane';
        node.dataset.id = p.id;
        node.innerHTML = '<svg class="ico"><use href="#i-plane"/></svg>';
        node.style.setProperty('--x', `${x}%`);
        node.style.setProperty('--y', `${y}%`);
        el.radarPlanes.appendChild(node);
      }

      node.style.setProperty('--x', `${x.toFixed(2)}%`);
      node.style.setProperty('--y', `${y.toFixed(2)}%`);
      node.style.setProperty('--hdg', `${p.track}deg`);
      node.dataset.label = p.callsign;
      node.setAttribute('aria-label', `${p.callsign}, ${fmt(p.dist, 1)} km a ${dirName(p.brg)}`);
      node.classList.toggle('is-ground', p.kind === 'ground');
      node.classList.toggle('is-climb', p.kind === 'climb');
      node.classList.toggle('is-selected', p.id === selectedId);
      keep.add(p.id);
    });

    existing.forEach((node, id) => { if (!keep.has(id)) node.remove(); });
  }

  function renderFlightList(list) {
    if (!list.length) {
      el.flightList.innerHTML = `<li class="flight-empty">Nenhuma aeronave num raio de ${rangeKm} km agora. Experimente aumentar o raio do radar.</li>`;
      return;
    }

    el.flightList.innerHTML = list.slice(0, 60).map((p) => {
      const airline = airlineOf(p).name;
      const meta = p.ground
        ? 'No chão'
        : `${fmt(Math.round(p.altM / 100) * 100)} m · ${fmt(p.speedKmh)} km/h${airline ? ` · ${airline}` : ''}`;
      return `
        <li>
          <button class="flight${p.id === selectedId ? ' is-selected' : ''}${p.kind === 'climb' ? ' is-climb' : ''}${p.kind === 'ground' ? ' is-ground' : ''}"
                  type="button" data-id="${p.id}" style="--hdg:${p.track}deg">
            <svg class="ico"><use href="#i-plane"/></svg>
            <span>
              <span class="flight-callsign">${p.callsign}</span>
              <span class="flight-meta">${meta}</span>
            </span>
            <span class="flight-dist">${fmt(p.dist, p.dist < 10 ? 1 : 0)} km ${dirShort(p.brg)}</span>
          </button>
        </li>`;
    }).join('');
  }

  function renderDetail() {
    const p = flights.get(selectedId);
    if (!p) { el.flightDetail.hidden = true; return; }

    const airline = airlineOf(p);
    el.flightDetail.hidden = false;
    el.detailCountry.textContent = p.country ? `Registrado: ${p.country}` : 'Aeronave';
    el.detailCallsign.textContent = p.callsign;
    el.detailAirline.textContent = [airline.name, p.desc || p.type, p.reg && p.reg !== p.callsign ? p.reg : ''].filter(Boolean).join(' · ');

    el.detailAltitude.textContent = p.ground ? 'No chão' : `${fmt(Math.round(p.altM / 10) * 10)} m`;
    el.detailSpeed.textContent = `${fmt(p.speedKmh)} km/h`;
    el.detailHeading.textContent = `${fmt(p.track)}° · ${dirName(p.track)}`;
    el.detailDistance.textContent = `${fmt(p.dist, 1)} km a ${dirName(p.brg)}`;
    el.detailVertical.textContent = p.ground ? '—' : Math.abs(p.vRate) < 1 ? 'Nivelado' : `${p.vRate > 0 ? 'Subindo' : 'Descendo'} ${fmt(Math.abs(p.vRate) * 60)} m/min`;
    el.detailPeople.textContent = p.ground ? '—' : `~${fmt(p.people)}`;

    let note = '';
    if (p.ground) {
      note = 'Está no chão: taxiando ou estacionado num aeroporto.';
    } else {
      const tempC = p.altM < 11000 ? 15 - 6.5 * (p.altM / 1000) : -56.5;
      if (p.vRate > 2.5) note = 'Subindo: provavelmente acabou de decolar. ';
      else if (p.vRate < -2.5) note = 'Descendo: deve estar se preparando para pousar. ';
      else if (p.altM > 9000) note = 'Em velocidade de cruzeiro. ';
      note += `Lá fora, a essa altura, faz cerca de ${fmt(tempC)} °C.`;
    }
    el.detailNote.textContent = note;

    $$('.plane', el.radarPlanes).forEach((n) => n.classList.toggle('is-selected', n.dataset.id === selectedId));
    $$('.flight', el.flightList).forEach((n) => n.classList.toggle('is-selected', n.dataset.id === selectedId));
  }

  function selectFlight(id) {
    selectedId = selectedId === id ? null : id;
    if (!selectedId) { el.flightDetail.hidden = true; }
    renderDetail();
    if (selectedId && window.innerWidth < 1000) {
      el.flightDetail.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }

  /* =========================================================
     Radar (desenho)
     ========================================================= */
  let sweepAngle = 0;

  function drawRadar() {
    const c = el.radarCanvas;
    const g = c.getContext && c.getContext('2d');
    if (!g) return;

    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(rect.width * dpr);
    if (!W) return;
    if (c.width !== W) { c.width = W; c.height = W; }

    const cx = W / 2;
    const R = W * 0.47;
    g.clearRect(0, 0, W, W);

    const sky = getComputedStyle(document.documentElement).getPropertyValue('--sky').trim() || '#9cc9dd';

    // Anéis de distância
    g.lineWidth = 1 * dpr;
    for (let i = 1; i <= 4; i++) {
      g.beginPath();
      g.arc(cx, cx, (R * i) / 4, 0, Math.PI * 2);
      g.strokeStyle = i === 4 ? 'rgba(156,201,221,.35)' : 'rgba(156,201,221,.14)';
      g.stroke();

      g.fillStyle = 'rgba(156,201,221,.45)';
      g.font = `${10 * dpr}px "JetBrains Mono", monospace`;
      g.fillText(`${Math.round((rangeKm * i) / 4)} km`, cx + 6 * dpr, cx - (R * i) / 4 + 14 * dpr);
    }

    // Cruz
    g.beginPath();
    g.moveTo(cx - R, cx); g.lineTo(cx + R, cx);
    g.moveTo(cx, cx - R); g.lineTo(cx, cx + R);
    g.strokeStyle = 'rgba(156,201,221,.10)';
    g.stroke();

    // Varredura
    if (!reducedMotion) {
      const grad = g.createConicGradient ? g.createConicGradient(sweepAngle - Math.PI / 2, cx, cx) : null;
      if (grad) {
        grad.addColorStop(0, 'rgba(156,201,221,.28)');
        grad.addColorStop(0.12, 'rgba(156,201,221,0)');
        grad.addColorStop(1, 'rgba(156,201,221,0)');
        g.save();
        g.translate(cx, cx);
        g.scale(-1, 1); // varre no sentido horário
        g.translate(-cx, -cx);
        g.beginPath();
        g.arc(cx, cx, R, 0, Math.PI * 2);
        g.fillStyle = grad;
        g.fill();
        g.restore();
      }
      g.beginPath();
      g.moveTo(cx, cx);
      g.lineTo(cx + R * Math.sin(sweepAngle), cx - R * Math.cos(sweepAngle));
      g.strokeStyle = sky;
      g.globalAlpha = 0.55;
      g.lineWidth = 1.5 * dpr;
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function radarLoop() {
    sweepAngle = (sweepAngle + 0.012) % (Math.PI * 2);
    if (!document.hidden && document.body.dataset.view === 'results') drawRadar();
    if (!reducedMotion) requestAnimationFrame(radarLoop);
  }

  /* =========================================================
     Estação Espacial
     ========================================================= */
  function observerGd() {
    return { latitude: place.lat * D2R, longitude: place.lon * D2R, height: 0.7 };
  }

  // Posição aproximada do Sol (coordenadas ECI, em km)
  function sunEci(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545.0;
    const L = (280.460 + 0.9856474 * n) % 360;
    const gAng = ((357.528 + 0.9856003 * n) % 360) * D2R;
    const lambda = (L + 1.915 * Math.sin(gAng) + 0.020 * Math.sin(2 * gAng)) * D2R;
    const eps = (23.439 - 0.0000004 * n) * D2R;
    const R = (1.00014 - 0.01671 * Math.cos(gAng) - 0.00014 * Math.cos(2 * gAng)) * 149597870.7;
    return { x: R * Math.cos(lambda), y: R * Math.cos(eps) * Math.sin(lambda), z: R * Math.sin(eps) * Math.sin(lambda) };
  }

  // A ISS está iluminada pelo Sol? (sombra cilíndrica da Terra)
  function issSunlit(pos, sun) {
    const sl = Math.hypot(sun.x, sun.y, sun.z);
    const s = { x: sun.x / sl, y: sun.y / sl, z: sun.z / sl };
    const dot = pos.x * s.x + pos.y * s.y + pos.z * s.z;
    if (dot > 0) return true;
    const px = pos.x - dot * s.x, py = pos.y - dot * s.y, pz = pos.z - dot * s.z;
    return Math.hypot(px, py, pz) > EARTH_KM;
  }

  function issStateAt(date) {
    const pv = sat.propagate(satrec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const gmst = sat.gstime(date);
    const gd = sat.eciToGeodetic(pv.position, gmst);
    const look = sat.ecfToLookAngles(observerGd(), sat.eciToEcf(pv.position, gmst));
    const v = pv.velocity;
    return {
      lat: sat.degreesLat(gd.latitude),
      lon: sat.degreesLong(gd.longitude),
      altKm: gd.height,
      speedKmh: Math.hypot(v.x, v.y, v.z) * 3600,
      distKm: look.rangeSat,
      elevation: look.elevation * R2D,
      azimuth: look.azimuth * R2D,
      eci: pv.position,
      gmst,
    };
  }

  async function initIss(mySession) {
    // 1. Biblioteca de órbitas
    try {
      await loadScript(LIBS.satellite);
      sat = window.satellite;
    } catch { sat = null; }

    // 2. Órbita atual (TLE)
    if (sat) {
      for (const src of TLE_SOURCES) {
        try {
          const data = await fetchWithTimeout(src.url, { text: !!src.text });
          const [l1, l2] = src.parse(data);
          if (l1 && l2 && l1.startsWith('1 ') && l2.startsWith('2 ')) {
            satrec = sat.twoline2satrec(l1, l2);
            break;
          }
        } catch { /* próxima fonte */ }
      }
    }
    if (mySession !== session) return;

    if (satrec) {
      updateIss();
      // Calcula as passagens sem travar a página
      setTimeout(() => { if (mySession === session) computePasses(); }, 80);
    } else {
      // Sem órbita: usa a posição ao vivo da API
      el.passList.innerHTML = '<li class="pass-empty">Não foi possível baixar a órbita da Estação Espacial agora, então as passagens não puderam ser calculadas. Recarregue a página em alguns minutos.</li>';
      pollIssPosition(mySession);
    }
  }

  async function pollIssPosition(mySession) {
    if (mySession !== session) return;
    try {
      const j = await fetchWithTimeout(`https://api.wheretheiss.at/v1/satellites/${ISS_ID}`);
      issNow = {
        lat: j.latitude,
        lon: j.longitude,
        altKm: j.altitude,
        speedKmh: j.velocity,
        distKm: slantKm(place.lat, place.lon, j.latitude, j.longitude, j.altitude),
        elevation: null,
        azimuth: bearing(place.lat, place.lon, j.latitude, j.longitude),
      };
      renderIss();
    } catch {
      el.issOver.textContent = 'Não foi possível localizar a Estação Espacial agora.';
    }
    setTimeout(() => pollIssPosition(mySession), 5000);
  }

  function updateIss() {
    if (!satrec) return;
    issNow = issStateAt(new Date());
    if (issNow) renderIss();
  }

  function renderIss() {
    const s = issNow;
    if (!s) return;

    el.issAltitude.textContent = fmt(s.altKm);
    el.issSpeed.textContent = fmt(Math.round(s.speedKmh / 10) * 10);
    el.issDistance.textContent = fmt(s.distKm);
    el.issDistanceSummary.textContent = `${fmt(s.distKm)} km`;
    el.ladderIss.textContent = `${fmt(s.distKm)} km`;

    // São Paulo → Rio de Janeiro: ~360 km
    el.issSpeedNote.textContent = `Ela iria de São Paulo ao Rio de Janeiro em ${fmt(360 / (s.speedKmh / 3600))} segundos.`;

    if (s.elevation !== null && s.elevation > 0) {
      el.issDistanceNote.textContent = `Ela está acima do seu horizonte agora, a ${fmt(s.elevation)}° de altura, na direção ${dirName(s.azimuth)}.`;
    } else {
      el.issDistanceNote.textContent = `Agora ela está abaixo do seu horizonte, na direção ${dirName(s.azimuth)}.`;
    }

    // Voltas desde a meia-noite
    const periodMin = satrec ? (2 * Math.PI) / satrec.no : 92.9;
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    el.issOrbitsToday.textContent = fmt((Date.now() - midnight) / MIN / periodMin, 1);

    updateIssOver(s);
    drawIssMap();
  }

  // "Agora ela está sobre…"
  async function updateIssOver(s) {
    const now = Date.now();
    if (now - lastOverLookup > 60000) {
      lastOverLookup = now;
      issOverLabel = oceanName(s.lat, s.lon);
      try {
        const j = await fetchWithTimeout(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${s.lat.toFixed(3)}&longitude=${s.lon.toFixed(3)}&localityLanguage=pt`, { timeout: 6000 });
        if (j.countryName) issOverLabel = j.countryName;
      } catch { /* mantém o oceano */ }
    }
    el.issOver.innerHTML = `Agora ela sobrevoa: <strong>${issOverLabel}</strong> · a ${fmt(s.distKm)} km de você`;
  }

  function oceanName(lat, lon) {
    if (lat < -60) return 'Antártida';
    if (lat > 66) return 'Oceano Ártico';
    if (lon > -70 && lon < 20 && lat > -60) return 'Oceano Atlântico';
    if (lon >= 20 && lon < 120 && lat < 30) return 'Oceano Índico';
    return 'Oceano Pacífico';
  }

  /* ----- Passagens visíveis ----- */
  function computePasses() {
    const step = 30000;
    const start = Date.now();
    const end = start + 10 * DAY;
    const obs = observerGd();
    const found = [];
    let cur = null;

    for (let t = start; t < end; t += step) {
      const date = new Date(t);
      const pv = sat.propagate(satrec, date);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const gmst = sat.gstime(date);
      const look = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, gmst));
      const elev = look.elevation * R2D;
      const az = look.azimuth * R2D;

      if (elev >= 10) {
        if (!cur) cur = { maxEl: 0 };
        const sun = sunEci(date);
        const sunLook = sat.ecfToLookAngles(obs, sat.eciToEcf(sun, gmst));
        const dark = sunLook.elevation * R2D < -6;
        const lit = issSunlit(pv.position, sun);

        if (dark && lit) {
          if (!cur.start) { cur.start = t; cur.startAz = az; }
          cur.end = t;
          cur.endAz = az;
          if (elev > cur.maxEl) { cur.maxEl = elev; cur.maxAz = az; }
        }
      } else if (cur) {
        if (cur.start && cur.end - cur.start >= MIN) found.push(cur);
        cur = null;
        if (found.length >= 8) break;
      }
    }

    passes = found;
    renderPasses();
  }

  function stars(maxEl) {
    const n = maxEl >= 60 ? 3 : maxEl >= 35 ? 2 : 1;
    return '★'.repeat(n) + '☆'.repeat(3 - n);
  }

  function renderPasses() {
    if (!passes.length) {
      el.nextPass.hidden = true;
      el.passList.innerHTML = '<li class="pass-empty">Nenhuma passagem visível nos próximos 10 dias para o seu local. Isso é normal: há semanas em que ela passa só durante o dia, quando o céu está claro demais.</li>';
      return;
    }

    const next = passes[0];
    const s = new Date(next.start);
    const e = new Date(next.end);
    el.nextPass.hidden = false;
    el.nextPassDate.textContent = `${dayLabel(s)} às ${fmtTime(s)}`;
    el.nextPassInfo.textContent = `Aparece a ${dirName(next.startAz)}, sobe até ${fmt(next.maxEl)}° e some a ${dirName(next.endAz)} · visível por ${fmt(Math.max(1, Math.round((e - s) / MIN)))} min`;

    el.passList.innerHTML = passes.map((p, i) => {
      const ps = new Date(p.start);
      const pe = new Date(p.end);
      return `
        <li class="pass">
          <div>
            <span class="pass-date">${fmtDay(ps)}</span>
            <span class="pass-meta">De ${dirShort(p.startAz)} para ${dirShort(p.endAz)} · até ${fmt(p.maxEl)}° · <span class="pass-bright" title="Brilho estimado">${stars(p.maxEl)}</span></span>
          </div>
          <span class="pass-time">${fmtTime(ps)} → ${fmtTime(pe)}</span>
          <button class="pass-cal" type="button" data-pass="${i}">
            <svg class="ico"><use href="#i-calendar"/></svg> Agenda
          </button>
        </li>`;
    }).join('');

    updatePassCountdown();
  }

  function updatePassCountdown() {
    if (!passes.length) return;
    const next = passes[0];
    let diff = next.start - Date.now();

    if (diff <= 0) {
      if (Date.now() <= next.end) {
        el.nextPassCountdown.innerHTML = '<div><strong>Agora!</strong><span>olhe pro céu</span></div>';
        return;
      }
      passes.shift();
      renderPasses();
      return;
    }

    const parts = [
      [Math.floor(diff / DAY), 'dias'],
      [Math.floor((diff % DAY) / HOUR), 'horas'],
      [Math.floor((diff % HOUR) / MIN), 'min'],
      [Math.floor((diff % MIN) / 1000), 'seg'],
    ];
    el.nextPassCountdown.innerHTML = parts.map(([v, label]) => `<div><strong>${String(v).padStart(2, '0')}</strong><span>${label}</span></div>`).join('');
  }

  function downloadPassICS(p) {
    const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const s = new Date(p.start);
    const e = new Date(p.end);
    const desc = `Olhe para o ${dirName(p.startAz)} às ${fmtTime(s)}. Ela aparece como uma estrela brilhante se movendo rápido, sem piscar, e sobe até ${fmt(p.maxEl)}° no céu.`;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Olhe pra cima//PT-BR', 'BEGIN:VEVENT',
      `UID:iss-${p.start}@olhepracima`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(s)}`,
      `DTEND:${icsDate(e)}`,
      'SUMMARY:Passagem da Estação Espacial 🛰️',
      `DESCRIPTION:${desc}`,
      `LOCATION:${place.label}`,
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:A Estação Espacial passa em 10 minutos!', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');

    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `estacao-espacial-${s.toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Evento baixado. Abra o arquivo para salvar na agenda.');
  }

  /* ----- Mapa-múndi ----- */
  function loadImage(urls) {
    return new Promise((resolve, reject) => {
      const list = [...urls];
      const next = () => {
        const src = list.shift();
        if (!src) { reject(new Error('Imagem indisponível')); return; }
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = next;
        img.src = src;
      };
      next();
    });
  }

  async function loadLand() {
    // Fotos de satélite (dia e noite); se falharem, usa o contorno dos continentes
    const [day, night] = await Promise.allSettled([loadImage(EARTH_DAY), loadImage(EARTH_NIGHT)]);
    earthDay = day.status === 'fulfilled' ? day.value : null;
    earthNight = night.status === 'fulfilled' ? night.value : null;
    if (!earthDay) console.warn('[olhe pra cima] Fotos de satélite indisponíveis, usando o mapa simples.');

    if (!earthDay) {
      try {
        await loadScript(LIBS.topojson);
        const topo = await fetchWithTimeout(LAND_URL);
        land = window.topojson.feature(topo, topo.objects.land);
      } catch { land = null; }
    }
    drawIssMap();
  }

  function drawIssMap() {
    const c = el.issCanvas;
    const g = c.getContext && c.getContext('2d');
    if (!g) return;

    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(rect.width * dpr);
    const H = Math.round(rect.height * dpr);
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }

    const X = (lon) => ((lon + 180) / 360) * W;
    const Y = (lat) => ((90 - lat) / 180) * H;

    g.clearRect(0, 0, W, H);

    // Posição do Sol agora → onde é dia e onde é noite
    const now = new Date();
    const sun = sunEci(now);
    const sl = Math.hypot(sun.x, sun.y, sun.z);
    const decl = Math.asin(sun.z / sl);
    const ra = Math.atan2(sun.y, sun.x);
    const gmst = sat ? sat.gstime(now) : gmstApprox(now);
    let subLon = ((ra - gmst) * R2D) % 360;
    if (subLon > 180) subLon -= 360;
    if (subLon < -180) subLon += 360;

    const step = Math.max(2, Math.round(W / 240));
    const safeDecl = Math.abs(decl) < 0.001 ? 0.001 : decl;
    const termY = (x) => {
      const lon = (x / W) * 360 - 180;
      return Y(Math.atan(-Math.cos((lon - subLon) * D2R) / Math.tan(safeDecl)) * R2D);
    };
    const nightPath = () => {
      g.beginPath();
      const edge = safeDecl > 0 ? H : 0;
      g.moveTo(0, edge);
      for (let x = 0; x <= W + step; x += step) g.lineTo(Math.min(x, W), termY(Math.min(x, W)));
      g.lineTo(W, edge);
      g.closePath();
    };

    if (earthDay) {
      // Dia: foto real da Terra (Blue Marble, NASA)
      g.drawImage(earthDay, 0, 0, W, H);

      // Noite: luzes das cidades vistas do espaço (Black Marble, NASA)
      g.save();
      nightPath();
      g.clip();
      if (earthNight) {
        g.drawImage(earthNight, 0, 0, W, H);
        g.fillStyle = 'rgba(4, 8, 18, .25)';
      } else {
        g.fillStyle = 'rgba(2, 5, 12, .72)';
      }
      g.fillRect(0, 0, W, H);
      g.restore();

      // Linha do crepúsculo, suavizada
      g.save();
      g.beginPath();
      for (let x = 0; x <= W; x += step) {
        if (x === 0) g.moveTo(x, termY(x)); else g.lineTo(x, termY(x));
      }
      g.strokeStyle = 'rgba(255, 196, 120, .35)';
      g.lineWidth = 6 * dpr;
      g.filter = `blur(${4 * dpr}px)`;
      g.stroke();
      g.restore();

      // Leve escurecida para os elementos aparecerem melhor
      g.fillStyle = 'rgba(7, 9, 13, .12)';
      g.fillRect(0, 0, W, H);
    } else {
      // Reserva: grade + contorno dos continentes
      g.strokeStyle = 'rgba(156,201,221,.07)';
      g.lineWidth = 1;
      for (let lon = -150; lon <= 150; lon += 30) { g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), H); g.stroke(); }
      for (let lat = -60; lat <= 60; lat += 30) { g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(W, Y(lat)); g.stroke(); }

      if (land) {
        g.fillStyle = 'rgba(156,201,221,.16)';
        g.strokeStyle = 'rgba(156,201,221,.28)';
        g.lineWidth = 0.6 * dpr;
        const drawRing = (ring) => {
          ring.forEach(([lon, lat], i) => {
            const x = X(lon), y = Y(lat);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          });
          g.closePath();
        };
        (land.features || [land]).forEach((f) => {
          const geom = f.geometry || f;
          const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates || [];
          g.beginPath();
          polys.forEach((poly) => poly.forEach(drawRing));
          g.fill('evenodd');
          g.stroke();
        });
      }

      g.fillStyle = 'rgba(0,0,0,.38)';
      nightPath();
      g.fill();
    }

    // Você
    if (place) {
      const ux = X(place.lon), uy = Y(place.lat);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(ux, uy, 3.5 * dpr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc(ux, uy, 8 * dpr, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(238,241,244,.85)';
      g.font = `500 ${11 * dpr}px Inter, sans-serif`;
      g.fillText('você', ux + 11 * dpr, uy + 4 * dpr);
    }

    // Rastro da órbita (−45 a +45 min)
    if (satrec && sat) {
      g.lineWidth = 1.5 * dpr;
      let prev = null;
      for (let m = -45; m <= 45; m += 1) {
        const st = issStateAt(new Date(Date.now() + m * MIN));
        if (!st) continue;
        const x = X(st.lon), y = Y(st.lat);
        if (prev && Math.abs(x - prev.x) < W / 2) {
          g.strokeStyle = m < 0 ? 'rgba(156,201,221,.25)' : 'rgba(156,201,221,.7)';
          g.setLineDash(m < 0 ? [] : [4 * dpr, 4 * dpr]);
          g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(x, y); g.stroke();
        }
        prev = { x, y };
      }
      g.setLineDash([]);
    }

    // A Estação Espacial
    if (issNow) {
      const ix = X(issNow.lon), iy = Y(issNow.lat);
      const glow = g.createRadialGradient(ix, iy, 0, ix, iy, 22 * dpr);
      glow.addColorStop(0, 'rgba(156,201,221,.55)');
      glow.addColorStop(1, 'rgba(156,201,221,0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(ix, iy, 22 * dpr, 0, Math.PI * 2); g.fill();

      g.fillStyle = '#eef8fc';
      g.beginPath(); g.arc(ix, iy, 5 * dpr, 0, Math.PI * 2); g.fill();
      g.fillRect(ix - 13 * dpr, iy - 1.5 * dpr, 26 * dpr, 3 * dpr); // painéis solares

      g.fillStyle = 'rgba(238,241,244,.9)';
      g.font = `600 ${11 * dpr}px "Space Grotesk", sans-serif`;
      g.fillText('ISS', ix + 14 * dpr, iy - 8 * dpr);
    }
  }

  function gmstApprox(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const t = (jd - 2451545.0) / 36525;
    let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t;
    gmst = ((gmst % 360) + 360) % 360;
    return gmst * D2R;
  }

  /* =========================================================
     Escada até a Lua
     ========================================================= */
  let ladderSteps = [];

  function setupLadder() {
    ladderSteps = $$('.step', el.ladder);
    // Espaço entre os degraus proporcional à distância real (em escala logarítmica)
    ladderSteps.forEach((step, i) => {
      if (i === 0) return;
      const prev = Math.max(1, Number(ladderSteps[i - 1].dataset.alt));
      const cur = Math.max(1, Number(step.dataset.alt));
      const gap = clamp((Math.log10(cur) - Math.log10(prev)) * 150, 24, 420);
      step.style.setProperty('--gap', `${Math.round(gap)}px`);
    });
    updateAltimeter();
  }

  function fmtAlt(m) {
    if (m < 1000) return `${fmt(m)} m`;
    if (m < 100000) return `${fmt(m / 1000, 1)} km`;
    return `${fmt(m / 1000)} km`;
  }

  function updateAltimeter() {
    if (!ladderSteps.length) return;
    const mid = window.innerHeight * 0.55;
    const pts = ladderSteps.map((s) => {
      const r = s.getBoundingClientRect();
      return { y: r.top + 30, alt: Number(s.dataset.alt), node: s };
    });

    pts.forEach((p) => p.node.classList.toggle('is-active', p.y < mid));

    let alt = 0;
    if (mid <= pts[0].y) {
      alt = 0;
    } else if (mid >= pts[pts.length - 1].y) {
      alt = pts[pts.length - 1].alt;
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (mid >= a.y && mid < b.y) {
          const t = (mid - a.y) / (b.y - a.y);
          const la = Math.log10(Math.max(1, a.alt));
          const lb = Math.log10(Math.max(1, b.alt));
          alt = a.alt === 0 && t < 0.5 ? b.alt * t * 0.05 : Math.pow(10, la + (lb - la) * t);
          break;
        }
      }
    }
    el.altimeterValue.textContent = fmtAlt(Math.round(alt));
  }

  /* =========================================================
     Céu estrelado
     ========================================================= */
  function startSky() {
    const c = el.sky;
    const g = c.getContext && c.getContext('2d');
    if (!g) return;
    let stars = [];
    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 8000) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.2,
        a: Math.random() * 0.6 + 0.15,
        s: Math.random() * 0.002 + 0.0004,
        o: Math.random() * Math.PI * 2,
        depth: Math.random() * 0.3 + 0.05,
      }));
      if (reducedMotion) draw(0);
    }

    function draw(t) {
      g.clearRect(0, 0, w, h);
      const scroll = window.scrollY;
      for (const s of stars) {
        const tw = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(t * s.s + s.o);
        g.globalAlpha = s.a * tw;
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(s.x, (((s.y - scroll * s.depth) % h) + h) % h, s.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function loop(t) {
      if (!document.hidden) draw(t);
      requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener('resize', resize);
    if (!reducedMotion) requestAnimationFrame(loop);
  }

  /* =========================================================
     Local: geolocalização e busca de cidades
     ========================================================= */
  function introError(msg) { el.introError.textContent = msg; }

  el.useLocation.addEventListener('click', () => {
    introError('');
    if (!('geolocation' in navigator)) {
      introError('Seu navegador não permite usar a localização. Digite sua cidade abaixo.');
      return;
    }
    el.useLocation.disabled = true;
    el.useLocation.lastChild.textContent = ' Localizando…';

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      let label = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
      try {
        const j = await fetchWithTimeout(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`, { timeout: 6000 });
        const city = j.city || j.locality;
        if (city) label = j.principalSubdivisionCode ? `${city}, ${j.principalSubdivisionCode.split('-').pop()}` : city;
      } catch { /* mantém as coordenadas */ }
      resetLocateButton();
      start({ lat, lon, label });
    }, (err) => {
      resetLocateButton();
      introError(err.code === 1
        ? 'Você não permitiu o acesso à localização. Sem problemas: digite sua cidade abaixo.'
        : 'Não conseguimos achar sua localização. Digite sua cidade abaixo.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * MIN });
  });

  function resetLocateButton() {
    el.useLocation.disabled = false;
    el.useLocation.lastChild.textContent = ' Usar minha localização';
  }

  let searchTimer = null;
  let cityMatches = [];
  let activeIndex = -1;

  el.cityInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = el.cityInput.value.trim();
    if (q.length < 2) { hideCities(); return; }
    searchTimer = setTimeout(() => searchCities(q), 300);
  });

  async function searchCities(q) {
    try {
      const j = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=pt&format=json`, { timeout: 7000 });
      cityMatches = (j.results || []).map((r) => ({
        lat: r.latitude,
        lon: r.longitude,
        name: r.name,
        region: [r.admin1, r.country].filter(Boolean).join(', '),
        label: r.admin1 && r.country_code === 'BR' ? `${r.name}, ${abbrUF(r.admin1)}` : `${r.name}${r.country ? `, ${r.country}` : ''}`,
      }));
      renderCities();
    } catch {
      el.cityResults.hidden = false;
      el.cityResults.innerHTML = '<li class="city-empty">Não foi possível buscar agora. Tente de novo.</li>';
    }
  }

  const UFS = {
    'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
    'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
    'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ',
    'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC',
    'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO',
  };
  const abbrUF = (name) => UFS[name] || name;

  function renderCities() {
    activeIndex = -1;
    el.cityResults.hidden = false;
    el.cityResults.innerHTML = cityMatches.length
      ? cityMatches.map((c, i) => `
          <li role="option">
            <button type="button" data-city="${i}" aria-selected="false">
              <span class="city-name">${c.name}</span>
              <span class="city-region">${c.region}</span>
            </button>
          </li>`).join('')
      : '<li class="city-empty">Nenhuma cidade encontrada.</li>';
  }

  function hideCities() {
    el.cityResults.hidden = true;
    el.cityResults.innerHTML = '';
    cityMatches = [];
  }

  el.cityResults.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-city]');
    if (!btn) return;
    const c = cityMatches[Number(btn.dataset.city)];
    if (c) { hideCities(); start({ lat: c.lat, lon: c.lon, label: c.label }); }
  });

  el.cityInput.addEventListener('keydown', (e) => {
    const items = $$('[data-city]', el.cityResults);
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.setAttribute('aria-selected', String(i === activeIndex)));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') {
      hideCities();
    }
  });

  el.cityForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = cityMatches[activeIndex >= 0 ? activeIndex : 0];
    if (c) { hideCities(); start({ lat: c.lat, lon: c.lon, label: c.label }); }
  });

  document.addEventListener('click', (e) => {
    if (!el.cityForm.contains(e.target)) el.cityResults.hidden = true;
  });

  /* =========================================================
     Fluxo principal
     ========================================================= */
  function start(newPlace) {
    session++;
    const mySession = session;
    clearInterval(flightTimer);
    clearInterval(tickTimer);

    place = newPlace;
    store.set('place', place);
    flights = new Map();
    selectedId = null;
    issNow = null;
    passes = [];
    lastOverLookup = 0;
    el.radarPlanes.innerHTML = '';
    el.flightDetail.hidden = true;
    el.flightList.innerHTML = '<li class="flight-empty">Procurando aviões no seu céu…</li>';
    el.passList.innerHTML = '<li class="pass-empty">Calculando as próximas passagens…</li>';
    el.nextPass.hidden = true;

    el.placeName.textContent = place.label;
    el.summaryPlace.textContent = place.label;

    document.body.dataset.view = 'results';
    el.intro.hidden = true;
    el.results.hidden = false;
    el.results.classList.add('is-entering');
    setTimeout(() => el.results.classList.remove('is-entering'), 1500);
    window.scrollTo({ top: 0 });

    syncRangeButtons();
    setupLadder();

    // Aviões
    fetchFlights(mySession);
    flightTimer = setInterval(() => fetchFlights(mySession), REFRESH_FLIGHTS);

    // Estação Espacial e mapa
    initIss(mySession);
    if (!land && !earthDay) loadLand(); else drawIssMap();

    // Relógio, aviões em movimento, ISS e contagem regressiva (1×/s)
    tickTimer = setInterval(() => {
      if (mySession !== session) return;
      el.clock.textContent = fmtClock(new Date());
      if (flights.size) renderFlights();
      if (satrec) updateIss();
      updatePassCountdown();
    }, 1000);
    el.clock.textContent = fmtClock(new Date());
  }

  function syncRangeButtons() {
    $$('button', el.rangeToggle).forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.range) === rangeKm)));
  }

  el.rangeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    rangeKm = Number(btn.dataset.range);
    store.set('range', rangeKm);
    syncRangeButtons();
    drawRadar();
    renderFlights();
    fetchFlights(session);
  });

  el.radarPlanes.addEventListener('click', (e) => {
    const node = e.target.closest('.plane');
    if (node) selectFlight(node.dataset.id);
  });

  el.flightList.addEventListener('click', (e) => {
    const node = e.target.closest('.flight');
    if (node) selectFlight(node.dataset.id);
  });

  el.detailClose.addEventListener('click', () => { selectedId = null; el.flightDetail.hidden = true; renderDetail(); });

  el.passList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pass]');
    if (btn && passes[Number(btn.dataset.pass)]) downloadPassICS(passes[Number(btn.dataset.pass)]);
  });

  el.nextPassCalendar.addEventListener('click', () => { if (passes[0]) downloadPassICS(passes[0]); });

  el.changePlace.addEventListener('click', () => {
    session++;
    clearInterval(flightTimer);
    clearInterval(tickTimer);
    document.body.dataset.view = 'intro';
    el.results.hidden = true;
    el.intro.hidden = false;
    window.scrollTo({ top: 0 });
    setTimeout(() => el.cityInput.focus(), 300);
  });

  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { updateAltimeter(); scrollQueued = false; });
  }, { passive: true });

  window.addEventListener('resize', () => { drawRadar(); drawIssMap(); });

  document.addEventListener('visibilitychange', () => {
    // Ao voltar para a aba, atualiza tudo na hora
    if (!document.hidden && place && document.body.dataset.view === 'results') fetchFlights(session);
  });

  /* =========================================================
     Toast
     ========================================================= */
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-show'), 2800);
  }

  /* =========================================================
     Início
     ========================================================= */
  function init() {
    el.footerYear.textContent = new Date().getFullYear();
    startSky();
    requestAnimationFrame(radarLoop);
    if (reducedMotion) drawRadar();

    const saved = store.get('place', null);
    if (saved && typeof saved.lat === 'number') start(saved);
  }

  init();
})();