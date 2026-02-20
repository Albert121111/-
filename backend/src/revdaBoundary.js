import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const overpassEndpoints = [
  process.env.OVERPASS_URL,
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
].filter(Boolean);

const cachePath = path.resolve(__dirname, '..', '..', 'data', 'revda-boundary.geojson');

function parseBoundary(data) {
  const relation = data.elements.find((e) => e.type === 'relation');
  if (!relation?.members) throw new Error('Revda relation not found in Overpass response.');
  const ways = new Map(data.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const nodes = new Map(data.elements.filter((e) => e.type === 'node').map((n) => [n.id, [n.lon, n.lat]]));

  const rings = [];
  const outerWays = relation.members.filter((m) => m.type === 'way' && m.role === 'outer');
  for (const member of outerWays) {
    const way = ways.get(member.ref);
    if (!way?.nodes) continue;
    const coords = way.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (coords.length > 2) rings.push(coords);
  }
  if (!rings.length) throw new Error('Could not parse outer rings for Revda boundary.');
  rings.sort((a, b) => b.length - a.length);
  return rings[0];
}

function normalizeClosedRing(ring) {
  if (!ring.length) return ring;
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    return [...ring, [firstLon, firstLat]];
  }
  return ring;
}

function parseNominatimBoundary(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Nominatim returned empty result.');
  }

  const withPolygon = items.find((item) => item?.geojson?.type === 'Polygon' || item?.geojson?.type === 'MultiPolygon');
  if (!withPolygon) {
    throw new Error('Nominatim result has no polygon geometry.');
  }

  const geometry = withPolygon.geojson;
  let ring = null;
  if (geometry.type === 'Polygon') {
    ring = geometry.coordinates?.[0];
  }
  if (geometry.type === 'MultiPolygon') {
    ring = geometry.coordinates?.[0]?.[0];
  }

  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error('Invalid polygon ring from Nominatim.');
  }

  return normalizeClosedRing(ring.map(([lon, lat]) => [Number(lon), Number(lat)]));
}

function calcBounds(ring) {
  const minLon = Math.min(...ring.map(([lon]) => lon));
  const minLat = Math.min(...ring.map(([, lat]) => lat));
  const maxLon = Math.max(...ring.map(([lon]) => lon));
  const maxLat = Math.max(...ring.map(([, lat]) => lat));
  return [minLon, minLat, maxLon, maxLat];
}

function readBoundaryCache() {
  if (!fs.existsSync(cachePath)) return null;
  return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

function writeBoundaryCache(payload) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOverpass(endpoint, query, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Overpass error from ${endpoint}: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNominatimBoundary(timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&polygon_geojson=1' +
      '&city=%D0%A0%D0%B5%D0%B2%D0%B4%D0%B0&state=%D0%A1%D0%B2%D0%B5%D1%80%D0%B4%D0%BB%D0%BE%D0%B2%D1%81%D0%BA%D0%B0%D1%8F%20%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C&country=%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'revda-geoguessr/1.0 (boundary-fetch)'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const ring = parseNominatimBoundary(json);
    return {
      polygon: ring,
      bounds: calcBounds(ring),
      source: 'nominatim.openstreetmap.org',
      fetchedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRevdaBoundary() {
  const cached = readBoundaryCache();
  if (cached?.polygon?.length) return cached;

  const query = `[out:json][timeout:60];\nrelation["name"="Ревда"]["admin_level"~"8|6"](57.7,59.6,57.95,59.95);\n(._;>;);\nout body;`;
  let lastError = null;

  for (const endpoint of overpassEndpoints) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const json = await fetchOverpass(endpoint, query);
        const ring = normalizeClosedRing(parseBoundary(json));

        const payload = {
          polygon: ring,
          bounds: calcBounds(ring),
          source: endpoint,
          fetchedAt: new Date().toISOString()
        };

        writeBoundaryCache(payload);
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await sleep(500 * attempt);
      }
    }
  }

  try {
    const fallbackPayload = await fetchNominatimBoundary();
    writeBoundaryCache(fallbackPayload);
    return fallbackPayload;
  } catch (error) {
    lastError = error;
  }

  const stale = readBoundaryCache();
  if (stale?.polygon?.length) {
    return { ...stale, stale: true, boundaryWarning: String(lastError?.message || 'Boundary providers unavailable') };
  }

  throw new Error(`Failed to resolve Revda boundary: ${lastError?.message || 'unknown error'}`);
}
