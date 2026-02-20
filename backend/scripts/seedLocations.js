import 'dotenv/config';
import db, { initSchema } from '../src/db.js';
import { findNearestMapillaryImage } from '../src/panoramaProvider.js';
import { getRevdaBoundary } from '../src/revdaBoundary.js';
import { gridKey, haversineDistanceMeters, pointInPolygon } from '../src/geo.js';

const TARGET = Number(process.env.SEED_TARGET || 10000);
const INITIAL_STEP_M = Number(process.env.SEED_STEP_M || 45);
const MIN_STEP_M = Number(process.env.SEED_MIN_STEP_M || 20);
const INITIAL_RADIUS = Number(process.env.SEED_RADIUS_M || 70);
const MAX_RADIUS = Number(process.env.SEED_MAX_RADIUS_M || 140);

function metersToDegLat(m) {
  return m / 111320;
}

function* generateGridPoints(bounds, stepM) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const latStep = metersToDegLat(stepM);
  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    const lonStep = stepM / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let lon = minLon; lon <= maxLon; lon += lonStep) {
      yield { lat, lon };
    }
  }
}

function isUniqueEnough(candidateLat, candidateLon, minDist = 25) {
  const candidateKey = gridKey(candidateLat, candidateLon, minDist);
  const nearby = db
    .prepare('SELECT lat, lon FROM locations WHERE grid_key IN (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .all(
      candidateKey,
      `${Number(candidateKey.split(':')[0]) + 1}:${candidateKey.split(':')[1]}`,
      `${Number(candidateKey.split(':')[0]) - 1}:${candidateKey.split(':')[1]}`,
      `${candidateKey.split(':')[0]}:${Number(candidateKey.split(':')[1]) + 1}`,
      `${candidateKey.split(':')[0]}:${Number(candidateKey.split(':')[1]) - 1}`,
      `${Number(candidateKey.split(':')[0]) + 1}:${Number(candidateKey.split(':')[1]) + 1}`,
      `${Number(candidateKey.split(':')[0]) + 1}:${Number(candidateKey.split(':')[1]) - 1}`,
      `${Number(candidateKey.split(':')[0]) - 1}:${Number(candidateKey.split(':')[1]) + 1}`,
      `${Number(candidateKey.split(':')[0]) - 1}:${Number(candidateKey.split(':')[1]) - 1}`
    );

  return nearby.every((row) => haversineDistanceMeters(candidateLat, candidateLon, row.lat, row.lon) >= minDist);
}

function insertLocation(loc) {
  const key = gridKey(loc.lat, loc.lon, 25);
  db.prepare(
    `INSERT OR IGNORE INTO locations (lat, lon, provider, pano_id, captured_at, heading, pitch, tags, quality_score, grid_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    loc.lat,
    loc.lon,
    loc.provider,
    loc.panoId,
    loc.capturedAt,
    loc.heading,
    loc.pitch,
    loc.tags,
    loc.qualityScore,
    key
  );
}

function setMetadata(key, value) {
  db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

(async () => {
  initSchema();
  const { polygon, bounds } = await getRevdaBoundary();

  let inserted = db.prepare('SELECT COUNT(*) as count FROM locations').get().count;
  let attempts = 0;
  let outside = 0;
  let noPanorama = 0;
  let duplicates = 0;

  let step = INITIAL_STEP_M;
  let radius = INITIAL_RADIUS;

  while (inserted < TARGET && step >= MIN_STEP_M) {
    for (const point of generateGridPoints(bounds, step)) {
      if (inserted >= TARGET) break;
      attempts += 1;

      if (!pointInPolygon([point.lon, point.lat], polygon)) {
        outside += 1;
        continue;
      }

      const pano = await findNearestMapillaryImage(point.lat, point.lon, radius);
      if (!pano.ok) {
        noPanorama += 1;
        continue;
      }

      const exists = db.prepare('SELECT 1 FROM locations WHERE pano_id = ?').get(pano.panoId);
      if (exists || !isUniqueEnough(pano.lat, pano.lon)) {
        duplicates += 1;
        continue;
      }

      insertLocation(pano);
      inserted = db.prepare('SELECT COUNT(*) as count FROM locations').get().count;
      if (inserted % 100 === 0) {
        console.log(`Inserted ${inserted}/${TARGET}`);
      }
    }

    if (inserted < TARGET) {
      if (radius < MAX_RADIUS) radius += 15;
      else step -= 5;
      console.log(`Adjusting parameters: step=${step}m radius=${radius}m`);
    }
  }

  const report = {
    target: TARGET,
    inserted,
    attempts,
    outside,
    noPanorama,
    duplicates,
    finalStep: step,
    finalRadius: radius,
    timestamp: new Date().toISOString()
  };

  setMetadata('seed_report', JSON.stringify(report));
  console.log('Seed report:', report);
})();
