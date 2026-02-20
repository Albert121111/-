import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

const overpassUrl = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
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

export async function getRevdaBoundary() {
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }

  const query = `[out:json][timeout:60];\nrelation["name"="Ревда"]["admin_level"~"8|6"](57.7,59.6,57.95,59.95);\n(._;>;);\nout body;`;
  const response = await fetch(overpassUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`
  });
  if (!response.ok) {
    throw new Error(`Overpass error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const ring = parseBoundary(json);

  const minLon = Math.min(...ring.map(([lon]) => lon));
  const minLat = Math.min(...ring.map(([, lat]) => lat));
  const maxLon = Math.max(...ring.map(([lon]) => lon));
  const maxLat = Math.max(...ring.map(([, lat]) => lat));

  const payload = {
    polygon: ring,
    bounds: [minLon, minLat, maxLon, maxLat]
  };

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));
  return payload;
}
