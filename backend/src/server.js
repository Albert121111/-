import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import db, { initSchema } from './db.js';
import { buildHeatmapGrid, gridKey, haversineDistanceMeters, pointInPolygon } from './geo.js';
import { getRevdaBoundary } from './revdaBoundary.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

initSchema();
const boundary = await getRevdaBoundary();

function computeScore(distanceM, maxDistance = 5000) {
  const normalized = Math.max(0, 1 - distanceM / maxDistance);
  return Math.round(normalized ** 2 * 5000);
}

app.get('/api/config', (_, res) => {
  res.json({
    city: 'Ревда',
    roundsDefault: 5,
    timerDefault: 90,
    boundary: boundary.polygon,
    bounds: boundary.bounds,
    mapillaryTokenPresent: Boolean(process.env.MAPILLARY_TOKEN)
  });
});

app.post('/api/games', (req, res) => {
  const rounds = Number(req.body?.rounds || 5);
  const timerSeconds = Number(req.body?.timerSeconds || 90);
  const settings = { rounds, timerSeconds };
  const info = db.prepare('INSERT INTO games(settings_json) VALUES (?)').run(JSON.stringify(settings));
  res.status(201).json({ gameId: info.lastInsertRowid, settings });
});

app.get('/api/games/:gameId/next-round', (req, res) => {
  const gameId = Number(req.params.gameId);
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const used = db.prepare('SELECT location_id FROM rounds WHERE game_id=?').all(gameId).map((r) => r.location_id);
  const placeholders = used.map(() => '?').join(',');
  const query = used.length
    ? `SELECT * FROM locations WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`
    : 'SELECT * FROM locations ORDER BY RANDOM() LIMIT 1';
  const location = db.prepare(query).get(...used);

  if (!location) return res.status(400).json({ error: 'No locations available. Run seeding first.' });

  if (!pointInPolygon([location.lon, location.lat], boundary.polygon)) {
    return res.status(500).json({ error: 'Location failed geofence validation.' });
  }

  res.json({
    locationId: location.id,
    provider: location.provider,
    panoId: location.pano_id,
    lat: location.lat,
    lon: location.lon,
    heading: location.heading
  });
});

app.post('/api/games/:gameId/rounds', (req, res) => {
  const gameId = Number(req.params.gameId);
  const { locationId, guessLat, guessLon } = req.body;
  if (!pointInPolygon([guessLon, guessLat], boundary.polygon)) {
    return res.status(400).json({ error: 'Guess must be inside Revda boundary.' });
  }

  const location = db.prepare('SELECT * FROM locations WHERE id=?').get(locationId);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const distance = haversineDistanceMeters(guessLat, guessLon, location.lat, location.lon);
  const score = computeScore(distance);
  db.prepare(
    'INSERT INTO rounds(game_id, location_id, guess_lat, guess_lon, distance_m, score) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(gameId, locationId, guessLat, guessLon, distance, score);

  const rounds = db.prepare('SELECT score FROM rounds WHERE game_id=?').all(gameId);
  const totalScore = rounds.reduce((sum, r) => sum + r.score, 0);

  res.json({
    location: { lat: location.lat, lon: location.lon },
    distance,
    score,
    totalScore,
    roundNumber: rounds.length
  });
});

app.get('/api/games/:gameId/results', (req, res) => {
  const gameId = Number(req.params.gameId);
  const rounds = db
    .prepare(
      `SELECT r.*, l.lat as actual_lat, l.lon as actual_lon
       FROM rounds r JOIN locations l ON l.id = r.location_id
       WHERE r.game_id=?`
    )
    .all(gameId);

  if (!rounds.length) return res.status(404).json({ error: 'No rounds played' });

  const heat = buildHeatmapGrid(boundary.bounds);
  for (const round of rounds) {
    const key = gridKey(round.actual_lat, round.actual_lon, 250);
    const idx = Math.abs(
      key
        .split(':')
        .map(Number)
        .reduce((acc, value) => acc + value, 0)
    ) % heat.length;
    heat[idx].count += 1;
    heat[idx].totalDistance += round.distance_m;
  }

  res.json({
    rounds,
    totalScore: rounds.reduce((sum, r) => sum + r.score, 0),
    averageDistance: rounds.reduce((sum, r) => sum + r.distance_m, 0) / rounds.length,
    heatmap: heat.filter((cell) => cell.count > 0)
  });
});

app.get('/api/seed-report', (_, res) => {
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('seed_report');
  res.json(row ? JSON.parse(row.value) : { error: 'No seed report yet' });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
