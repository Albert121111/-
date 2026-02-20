import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polygon, TileLayer, useMapEvents } from 'react-leaflet';

function GuessMarker({ guess, setGuess }) {
  useMapEvents({
    click(e) {
      setGuess([e.latlng.lat, e.latlng.lng]);
    }
  });
  return guess ? <Marker position={guess} /> : null;
}

function mapillaryUrl(panoId, token) {
  if (!panoId || !token) return null;
  return `https://www.mapillary.com/embed?mapillaryKey=${panoId}&style=photo&token=${token}`;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [settings, setSettings] = useState({ rounds: 5, timerSeconds: 90 });
  const [gameId, setGameId] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [guess, setGuess] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [timeLeft, setTimeLeft] = useState(90);
  const [results, setResults] = useState(null);

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setConfig);
  }, []);

  useEffect(() => {
    if (!gameId || feedback || results) return;
    if (timeLeft <= 0) {
      submitGuess();
      return;
    }
    const t = setTimeout(() => setTimeLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, gameId, feedback, results]);

  const center = useMemo(() => {
    if (!config?.bounds) return [56.8, 59.9];
    const [minLon, minLat, maxLon, maxLat] = config.bounds;
    return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
  }, [config]);

  async function startGame() {
    const game = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    }).then((r) => r.json());
    setGameId(game.gameId);
    setRoundsPlayed(0);
    setResults(null);
    setFeedback(null);
    await loadNextRound(game.gameId);
  }

  async function loadNextRound(id = gameId) {
    const round = await fetch(`/api/games/${id}/next-round`).then((r) => r.json());
    setCurrentRound(round);
    setGuess(null);
    setFeedback(null);
    setTimeLeft(settings.timerSeconds);
  }

  async function submitGuess() {
    if (!currentRound) return;
    const safeGuess = guess ?? center;
    const payload = await fetch(`/api/games/${gameId}/rounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: currentRound.locationId,
        guessLat: safeGuess[0],
        guessLon: safeGuess[1]
      })
    }).then((r) => r.json());

    setFeedback(payload);
    const nextCount = roundsPlayed + 1;
    setRoundsPlayed(nextCount);

    if (nextCount >= settings.rounds) {
      const r = await fetch(`/api/games/${gameId}/results`).then((x) => x.json());
      setResults(r);
    }
  }

  if (!config) return <div className="layout">Loading config...</div>;

  const boundaryPoints = config.boundary ? config.boundary.map(([lon, lat]) => [lat, lon]) : [];

  if (!gameId) {
    return (
      <div className="layout">
        <h1>Revda GeoGuessr</h1>
        <p>Только панорамы внутри административных границ Ревды.</p>
        <label>Раундов: <input type="number" value={settings.rounds} onChange={(e) => setSettings((s) => ({ ...s, rounds: Number(e.target.value) }))} /></label>
        <label>Таймер (сек): <input type="number" value={settings.timerSeconds} onChange={(e) => setSettings((s) => ({ ...s, timerSeconds: Number(e.target.value) }))} /></label>
        <button onClick={startGame} disabled={!config.boundaryReady}>Начать игру</button>
      </div>
    );
  }

  return (
    <div className="layout">
      <header>
        <h2>Раунд {Math.min(roundsPlayed + 1, settings.rounds)} / {settings.rounds}</h2>
        <div>Осталось: {timeLeft}s</div>
      </header>

      {currentRound && (
        <iframe
          title="panorama"
          className="viewer"
          src={mapillaryUrl(currentRound.panoId, import.meta.env.VITE_MAPILLARY_TOKEN)}
        />
      )}

      {!config.boundaryReady && (
        <div className="feedback">
          <p>Граница Ревды временно недоступна (Overpass). Сервер запущен, попробуйте позже или перезапустите.</p>
          {config.boundaryError ? <p>Причина: {config.boundaryError}</p> : null}
        </div>
      )}

      <MapContainer center={center} zoom={12} className="map">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {boundaryPoints.length > 0 ? <Polygon positions={boundaryPoints} pathOptions={{ color: 'red' }} /> : null}
        <GuessMarker guess={guess} setGuess={setGuess} />
      </MapContainer>

      {!feedback ? <button onClick={submitGuess}>Подтвердить ответ</button> : (
        <div className="feedback">
          <p>Расстояние: {feedback.distance.toFixed(1)} м</p>
          <p>Очки за раунд: {feedback.score}</p>
          <p>Итого: {feedback.totalScore}</p>
          {results ? null : <button onClick={() => loadNextRound()}>Следующий раунд</button>}
        </div>
      )}

      {results && (
        <section>
          <h3>Итоги игры</h3>
          <p>Сумма очков: {results.totalScore}</p>
          <p>Средняя ошибка: {results.averageDistance.toFixed(1)} м</p>
          <h4>Теплокарта ошибок по секторам</h4>
          <ul>
            {results.heatmap.map((cell, idx) => (
              <li key={idx}>[{cell.lat.toFixed(3)}, {cell.lon.toFixed(3)}] — раундов: {cell.count}, средняя ошибка: {(cell.totalDistance / cell.count).toFixed(1)} м</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
