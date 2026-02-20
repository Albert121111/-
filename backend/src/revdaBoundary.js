import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

const overpassEndpoints = [
  process.env.OVERPASS_URL,
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
].filter(Boolean);

const cachePath = path.resolve(process.cwd(), '..', 'data', 'revda-boundary.geojson');

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

export async function getRevdaBoundary() {
  const cached = readBoundaryCache();
  if (cached?.polygon?.length) return cached;

  const query = `[out:json][timeout:60];\nrelation["name"="Ревда"]["admin_level"~"8|6"](57.7,59.6,57.95,59.95);\n(._;>;);\nout body;`;
  let lastError = null;

  for (const endpoint of overpassEndpoints) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const json = await fetchOverpass(endpoint, query);
        const ring = parseBoundary(json);
        const minLon = Math.min(...ring.map(([lon]) => lon));
        const minLat = Math.min(...ring.map(([, lat]) => lat));
        const maxLon = Math.max(...ring.map(([lon]) => lon));
        const maxLat = Math.max(...ring.map(([, lat]) => lat));

        const payload = {
          polygon: ring,
          bounds: [minLon, minLat, maxLon, maxLat],
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

  const stale = readBoundaryCache();
  if (stale?.polygon?.length) {
    return { ...stale, stale: true, boundaryWarning: String(lastError?.message || 'Overpass unavailable') };
  }

  throw new Error(`Failed to resolve Revda boundary: ${lastError?.message || 'unknown error'}`);
}
