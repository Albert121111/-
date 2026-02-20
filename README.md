# Revda GeoGuessr (Mapillary)

Веб-приложение в стиле GeoGuessr, ограниченное только административной границей города **Ревда (Свердловская область)**.

## Стек
- **Frontend:** React + Vite + Leaflet
- **Backend:** Node.js + Express
- **БД:** SQLite (better-sqlite3)
- **Панорамы:** Mapillary Graph API + embed viewer
- **Геоданные:** Overpass API (OSM relation boundary)

## Что реализовано
- Игровой цикл: старт → 5+ раундов → финальные результаты.
- Таймер на раунд.
- Подсчет дистанции через haversine и скоринг.
- После раунда: правильная точка, дистанция, очки, промежуточный счет.
- Финал: общий счет + теплокарта ошибок по секторам (grid).
- Строгий геофенс: backend проверяет точки и угадывания через point-in-polygon.
- Сидинг pipeline до целевого количества (10 000):
  1. Получение границы Ревды из Overpass.
  2. Генерация сетки внутри bbox + point-in-polygon.
  3. Поиск ближайшей панорамы Mapillary в радиусе.
  4. Валидация доступности pano/image и дедупликация.
  5. Адаптация параметров (шаг сетки/радиус), если точек недостаточно.
- Отчет по сидингу сохраняется в `metadata.seed_report`.

## Получение API ключей
1. Зарегистрируйтесь в Mapillary и получите access token для Graph API.
2. Заполните `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Минимум нужно задать:
- `MAPILLARY_TOKEN`
- `VITE_MAPILLARY_TOKEN`

## Запуск одной командой
```bash
npm run up
```

Что делает команда:
1. Ставит зависимости (если их нет).
2. Создает `.env` из `.env.example` (если отсутствует).
3. Выполняет миграцию SQLite.
4. Поднимает backend + frontend одновременно.

Приложение поднимет:
- backend: `http://localhost:3000`
- frontend: `http://localhost:5173`

## Полный setup (с сидиногом 10 000 точек)
```bash
npm run up
npm run seed --workspace backend
```

## Команды
- `npm run up` — запуск проекта одной командой (install + env + migrate + frontend/backend)
- `npm run dev` — алиас к `npm run up`
- `npm run build` — build frontend + backend
- `npm run start` — запуск backend
- `npm run migrate --workspace backend` — инициализация схемы SQLite
- `npm run seed --workspace backend` — сидинг `locations` до `SEED_TARGET`
- `npm run test` — unit-тесты backend

## Схема БД
- `locations(id, lat, lon, provider, pano_id, captured_at, heading, pitch, tags, quality_score, grid_key)`
- `games(id, created_at, settings_json)`
- `rounds(id, game_id, location_id, guess_lat, guess_lon, distance_m, score, created_at)`
- `metadata(key, value)`

## Ограничения и риски покрытия
- Реальное покрытие Mapillary внутри Ревды может быть ограниченным: достижение 10 000 уникальных pano может занять много времени или оказаться невозможным при текущем покрытии.
- Overpass иногда rate-limited; в проекте есть кэш границы в `data/revda-boundary.geojson`.
- Mapillary API также лимитирует запросы; реализованы кэш запросов, простое throttling и retry/backoff.

## Валидация “годной точки”
Точка принимается только если:
- Mapillary API возвращает реальный `image id`;
- Координата image находится внутри геофенса Ревды;
- `pano_id` уникален;
- расстояние до уже сохраненных точек >= 25 м.

## Примечания
- Если токен не указан, backend вернет понятную ошибку при сидинге.
- Frontend использует Mapillary embed iframe (через `VITE_MAPILLARY_TOKEN`).
