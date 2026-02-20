# Revda GeoGuessr (Mapillary)

Веб-приложение в стиле GeoGuessr, ограниченное только административной границей города **Ревда (Свердловская область)**.

## Стек
- **Frontend:** React + Vite + Leaflet
- **Backend:** Node.js + Express
- **БД:** SQLite (`node:sqlite`, встроенный в Node.js)
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
Что нужно найти в Mapillary:
- **Access Token** (обязателен) — токен для Mapillary Graph API.
- По желанию: свой `MAPILLARY_CLIENT_ID` (если будете расширять интеграцию), но для текущего проекта достаточно токена.

Где это найти:
1. Войдите в аккаунт Mapillary.
2. Откройте раздел разработчика (Developers / API).
3. Создайте новый токен (обычно кнопка `Generate token` / `Create token`).
4. Скопируйте выданный token (строка вида `MLY|...`).

Как подставить в проект:
1. Создайте `.env` из шаблона:
```bash
# Linux/macOS
cp .env.example .env
# Windows PowerShell
copy .env.example .env
```
2. Вставьте токен в оба поля:
- `MAPILLARY_TOKEN` — использует backend (сидинг и API-запросы)
- `VITE_MAPILLARY_TOKEN` — использует frontend (viewer)

Пример:
```env
MAPILLARY_TOKEN=MLY|ваш_токен
VITE_MAPILLARY_TOKEN=MLY|ваш_токен
```

## Запуск одной командой (Windows/Linux/macOS)
```bash
npm run up
```

Команда кроссплатформенная (без `bash` и WSL). Что делает:
1. Ставит зависимости (если их нет).
2. Создает `.env` из `.env.example` (если отсутствует).
3. Выполняет миграцию SQLite.
4. Поднимает backend + frontend одновременно.

Приложение поднимет:
- backend: `http://localhost:3000`
- frontend: `http://localhost:5173`

### Как зайти на localhost
1. Запустите проект:
```bash
npm run up
```
2. Дождитесь в терминале сообщений, что frontend и backend запущены.
3. Откройте в браузере:
   - игра: `http://localhost:5173`
   - API backend: `http://localhost:3000/api/config`

Если страница не открывается:
- проверьте, что команда все еще работает и нет ошибок в терминале;
- убедитесь, что порт `5173` не занят другим приложением;
- попробуйте открыть `http://127.0.0.1:5173`.

Если хотите открыть с телефона в той же Wi‑Fi сети, используйте IP компьютера:
- `http://<IP_ПК>:5173`

## Полный setup (с сидиногом 10 000 точек)
```bash
npm run up
npm run seed --workspace backend
```


## Windows troubleshooting (better-sqlite3 / node-gyp error)

Если ошибка была вида `spawn EINVAL` при `npm run up`, это обычно Windows-особенность запуска `npm.cmd`.
В актуальной версии `up.mjs` это исправлено (запуск через `node + npm-cli.js`).
Обновитесь и запустите снова:

```bash
git pull
npm run up
```

Если вы видели ошибку вида `better-sqlite3 ... node-gyp ... Could not find any Visual Studio installation`,
обновите проект до текущей версии и запустите снова:

```bash
git pull
npm run up
```

Теперь backend использует встроенный в Node модуль `node:sqlite` (без нативной сборки через Visual Studio Build Tools).
Требуется Node.js **22+**.


## Работа без скачивания ZIP (через GitHub)
1. Один раз клонируйте репозиторий:
```bash
git clone <URL_репозитория>
cd <папка_проекта>
```
Для этого репозитория папка называется `-`, поэтому после клонирования обычно нужно:
```bash
cd ./-
```

2. Дальше всегда обновляйтесь так:
```bash
git pull
```
3. Запуск проекта локально:
```bash
npm run up
```

### Быстрый цикл “обновить и запустить”
```bash
cd ./-
git pull
npm run up
```

Если `git pull` сообщает о локальных изменениях, которые мешают обновлению:
```bash
git status
git restore .
git pull
```

### Запуск прямо на GitHub (Codespaces)
Если хотите запускать проект **на GitHub**, а не локально на ПК:
1. Откройте репозиторий на GitHub.
2. Нажмите `Code` → `Codespaces` → `Create codespace on main`.
3. В терминале Codespaces выполните:
```bash
npm run up
```
4. Откройте вкладку `Ports` и сделайте порты публичными/откройте в браузере:
   - `5173` — frontend
   - `3000` — backend

### Что важно понимать про GitHub Actions
Workflow `.github/workflows/ci.yml` запускает только проверки (тесты/линт) при `push` и `pull_request`.
Это **не** постоянный хостинг приложения. Для постоянного онлайн-доступа нужен отдельный хостинг (например, Render/Railway/VPS).

## Команды
- `npm run up` — запуск проекта одной командой (install + env + migrate + frontend/backend), кроссплатформенно
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

- Если Overpass временно недоступен (например, `504 Gateway Timeout`), backend теперь не падает: поднимается в degraded-режиме и отдает `boundaryReady=false` в `/api/config` и `503` для игровых эндпоинтов до восстановления границы.
- Для ручной повторной загрузки границы есть эндпоинт `POST /api/admin/reload-boundary`.
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
