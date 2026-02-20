import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

const cacheFile = path.resolve(process.cwd(), '..', 'data', 'mapillary-cache.json');
const memoryCache = fs.existsSync(cacheFile)
  ? new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))))
  : new Map();

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function persistCache() {
  fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(memoryCache), null, 2));
}

async function fetchWithRetry(url, opts = {}, retries = 3) {
  let attempt = 0;
  let wait = 500;
  while (attempt <= retries) {
    const now = Date.now();
    const delay = Math.max(0, 200 - (now - lastRequestAt));
    if (delay > 0) await sleep(delay);
    lastRequestAt = Date.now();

    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`Transient API failure ${res.status}`);
      }
      return res;
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(wait);
      wait *= 2;
      attempt += 1;
    }
  }
  throw new Error('Unreachable retry branch');
}

export async function findNearestMapillaryImage(lat, lon, radius = 80) {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) {
    throw new Error('MAPILLARY_TOKEN is required for panorama validation.');
  }

  const key = `${lat.toFixed(6)},${lon.toFixed(6)},${radius}`;
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }

  const url = new URL('https://graph.mapillary.com/images');
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', 'id,computed_geometry,captured_at,compass_angle');
  url.searchParams.set('closeto', `${lon},${lat}`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('radius', String(radius));

  const response = await fetchWithRetry(url.toString());
  if (!response.ok) {
    const payload = { ok: false, reason: `${response.status} ${response.statusText}` };
    memoryCache.set(key, payload);
    persistCache();
    return payload;
  }

  const json = await response.json();
  const first = json.data?.[0];
  if (!first?.id || !first?.computed_geometry?.coordinates) {
    const payload = { ok: false, reason: 'no_image' };
    memoryCache.set(key, payload);
    persistCache();
    return payload;
  }

  const [imgLon, imgLat] = first.computed_geometry.coordinates;
  const payload = {
    ok: true,
    provider: 'mapillary',
    panoId: first.id,
    lat: imgLat,
    lon: imgLon,
    capturedAt: first.captured_at || null,
    heading: first.compass_angle || null,
    pitch: null,
    tags: null,
    qualityScore: 1
  };

  memoryCache.set(key, payload);
  if (memoryCache.size % 50 === 0) persistCache();
  return payload;
}

process.on('exit', () => {
  if (memoryCache.size) persistCache();
});
