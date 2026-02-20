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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload;
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
  const [appError, setAppError] = useState(null);
  const [isReloadingBoundary, setIsReloadingBoundary] = useState(false);

  async function refreshConfig() {
    try {
      const nextConfig = await fetchJson('/api/config');
      setConfig(nextConfig);
      setAppError(null);
    } catch (error) {
      setAppError(error.message);
    }
  }

  useEffect(() => {
    refreshConfig();
  }, []);

  useEffect(() => {
    if (config?.boundaryReady) return;
    const id = setInterval(() => {
      refreshConfig();
    }, 5000);
    return () => clearInterval(id);
  }, [config?.boundaryReady]);

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

  async function reloadBoundary() {
    setIsReloadingBoundary(true);
    try {
      await fetchJson('/api/admin/reload-boundary', { method: 'POST' });
      await refreshConfig();
    } catch (error) {
      setAppError(error.message);
      await refreshConfig();
    } finally {
      setIsReloadingBoundary(false);
    }
  }

  async function startGame() {
    try {
      const game = await fetchJson('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      setGameId(game.gameId);
      setRoundsPlayed(0);
      setResults(null);
      setFeedback(null);
      await loadNextRound(game.gameId);
      setAppError(null);
    } catch (error) {
      setAppError(error.message);
    }
  }

  async function loadNextRound(id = gameId) {
    try {
      const round = await fetchJson(`/api/games/${id}/next-round`);
      setCurrentRound(round);
      setGuess(null);
      setFeedback(null);
      setTimeLeft(settings.timerSeconds);
      setAppError(null);
    } catch (error) {
      setAppError(error.message);
    }
  }

  async function submitGuess() {
    if (!currentRound) return;
    try {
      const safeGuess = guess ?? center;
      const payload = await fetchJson(`/api/games/${gameId}/rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: currentRound.locationId,
          guessLat: safeGuess[0],
          guessLon: safeGuess[1]
        })
      });

      setFeedback(payload);
      const nextCount = roundsPlayed + 1;
      setRoundsPlayed(nextCount);

      if (nextCount >= settings.rounds) {
        const gameResults = await fetchJson(`/api/games/${gameId}/results`);
        setResults(gameResults);
      }
      setAppError(null);
    } catch (error) {
      setAppError(error.message);
    }
  }

  if (!config) return <div className="layout">Loading config...</div>;

  const boundaryPoints = config.boundary ? config.boundary.map(([lon, lat]) => [lat, lon]) : [];

  if (!gameId) {
    return (
      <div className="layout">
        <h1>Revda GeoGuessr</h1>
        <p>Только панорамы внутри административных границ Ревды.</p>
        {!config.boundaryReady ? (
          <div className="feedback">
            <p>Граница Ревды сейчас недоступна, кнопка будет активна после восстановления.</p>
            {config.boundaryError ? <p>Причина: {config.boundaryError}</p> : null}
            <button onClick={reloadBoundary} disabled={isReloadingBoundary}>
              {isReloadingBoundary ? 'Пробуем обновить…' : 'Повторить загрузку границы'}
            </button>
          </div>
        ) : null}
        {appError ? <div className="feedback"><p>Ошибка: {appError}</p></div> : null}
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

      {appError ? <div className="feedback"><p>Ошибка: {appError}</p></div> : null}

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
