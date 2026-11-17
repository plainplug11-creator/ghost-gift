# Ghost Gift — античит на Cloudflare Workers + D1

Порт сервера из `../server` (Node + SQLite) на Cloudflare Workers с базой D1, бесплатный план. HTTP API тот же, поэтому клиент `src/api/http.ts` работает без изменений: достаточно собрать фронт с `VITE_API_URL=https://<воркер>`.

Что внутри (логика как в Node-версии):

- проверка `initData` по HMAC (Web Crypto) и свежести `auth_date`;
- provably fair: заранее публикуется `sha256(serverSeed)`, исход = `HMAC_SHA256(serverSeed, clientSeed:nonce)`; значения совпадают с Node-версией бит в бит;
- ledger всех операций с балансом и `X-Idempotency-Key`;
- rate limit, детект автокликера, мультиаккаунты (общий device id / IP), risk score;
- очередь проверки выводов (`withdrawals.status = 'review'`);
- `POST /v1/webhook/telegram`: `successful_payment` и `refunded_payment`;
- резерв банка и дневной лимит крупных призов (дата по Europe/Kyiv);
- CORS только для `https://plainplug11-creator.github.io` (переменная `ALLOWED_ORIGINS`).

## Локально

```bash
cd worker
npm ci
npm test                      # vitest внутри рантайма Workers (Miniflare), D1 в памяти
npm run typecheck
cp .dev.vars.example .dev.vars   # впишите BOT_TOKEN (файл не коммитится)
npm run db:migrate:local
npm run dev                   # http://localhost:8787
```

## Деплой (когда появится аккаунт Cloudflare)

Аккаунт бесплатный, карта не нужна.

1. Вход: `npx wrangler login` (откроет браузер) **или** API-токен с правами *Workers Scripts: Edit* и *D1: Edit*:
   ```bash
   export CLOUDFLARE_API_TOKEN=...      # не коммитить
   export CLOUDFLARE_ACCOUNT_ID=...
   ```
2. Создать базу и вписать её id в `wrangler.toml` (`database_id`):
   ```bash
   cd worker
   npm ci
   npx wrangler d1 create ghost-gift
   ```
3. Применить миграции к боевой базе:
   ```bash
   npm run db:migrate:remote        # = npx wrangler d1 migrations apply ghost-gift --remote
   ```
4. Секреты (вводятся в интерактивном запросе, в файлы не пишутся):
   ```bash
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET   # необязательно, но нужно до включения вебхука
   ```
5. Задеплоить и проверить:
   ```bash
   npx wrangler deploy
   curl https://ghost-gift-api.<ваш-субдомен>.workers.dev/health   # {"ok":true}
   ```
6. Подключить фронт: собрать с `VITE_API_URL=https://ghost-gift-api.<субдомен>.workers.dev`. Для GitHub Pages: добавить в шаг `Build` файла `.github/workflows/deploy.yml` строку `env: { VITE_API_URL: ${{ vars.VITE_API_URL }} }` и завести переменную репозитория `VITE_API_URL`. Пока переменной нет, приложение остаётся на mock.
7. Вебхук бота (только когда всё проверено и задан `WEBHOOK_SECRET`):
   `setWebhook` с `url=https://…workers.dev/v1/webhook/telegram` и `secret_token=<WEBHOOK_SECRET>`.

Настройки (банк, лимиты, антиабьюз) лежат в `[vars]` файла `wrangler.toml`, смысл тот же, что в `../server/README.md`.

## Лимиты бесплатного плана

- 100 000 запросов в день, около 10 мс CPU на запрос. Ожидание D1 в CPU не входит; HMAC/SHA-256 выполняются нативно.
- D1: 5 млн прочитанных и 100 000 записанных строк в день, 5 ГБ. Обычный запрос пишет около 2 строк (rate limit + отпечаток), открытие кейса около 15 с учётом индексов. Этого хватает примерно на 5–6 тысяч платных открытий в день; дальше нужен платный план Workers ($5/мес) или чистка старых данных.

## Отличия от Node-версии

- В D1 нет интерактивных транзакций. Каждая мутация читает состояние, а все записи коммитит одним атомарным `db.batch()`. В начале батча стоит guard по `users.version`: если параллельный запрос успел изменить пользователя, батч целиком откатывается и запрос повторяется (до 3 раз, потом `429 BUSY`). Повтор с тем же `X-Idempotency-Key` возвращает сохранённый ответ.
- Счётчики rate limit, тайминги спинов и рост risk score от автокликера пишутся до основного батча и не откатываются, если открытие потом не удалось (в Node они откатывались вместе с транзакцией).
- Отпечатки хранятся как уникальные тройки (user, device, ip) с `seen_at` последнего визита, последние 50 на пользователя. Результат детекта тот же, записей в базу намного меньше.
- Дневной счётчик крупных призов сбрасывается атомарно при следующем реальном открытии, а не при чтении.
- CORS: вместо `*` отвечаем только разрешённым origin из `ALLOWED_ORIGINS` (по умолчанию GitHub Pages). Для локальной разработки добавьте `http://localhost:5173`.
- IP берётся из `CF-Connecting-IP`.
- Без `BOT_TOKEN` воркер отвечает `500 {"error":"BUSY"}` (Node-сервер просто не запускался).
- Добавлены индексы под запросы (в Node их не было) и колонка `users.version`.
