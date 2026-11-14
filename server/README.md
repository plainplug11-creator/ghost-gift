# Ghost Gift — сервер (античит)

Сервер — единственный источник истины по балансу, инвентарю и исходам круток. Клиент без `VITE_API_URL` работает как раньше, на mock. Этот сервис **нигде не задеплоен** и вебхук бота **не переключается**, пока вы сами этого не сделаете.

## Запуск

Нужен Node 22+ (есть встроенный SQLite).

```bash
cd server
npm install
cp .env.example .env   # впишите BOT_TOKEN (или экспортируйте GHOST_GIFT_BOT_TOKEN)
npm test
npm start              # http://localhost:8787
```

Проверка: `GET /health` → `{"ok":true}`.

Клиент (в корне репозитория) подключается так:

```bash
VITE_API_URL=http://localhost:8787 npm run dev
```

В продакшене соберите фронт с `VITE_API_URL=https://ваш-сервер`. Без этой переменной приложение остаётся на mock — поведение не меняется.

## Переменные окружения

| Переменная | Смысл | По умолчанию |
|---|---|---|
| `BOT_TOKEN` или `GHOST_GIFT_BOT_TOKEN` | токен бота для HMAC-проверки `initData` | обязателен |
| `PORT` | порт HTTP | `8787` |
| `DATABASE_PATH` | файл SQLite | `./data/ghost-gift.db` |
| `AUTH_MAX_AGE_SEC` | максимальный возраст `auth_date` | `86400` (сутки) |
| `WEBHOOK_SECRET` | если задан, вебхук ждёт заголовок `X-Telegram-Bot-Api-Secret-Token` | пусто |
| `BANK_START` | стартовый баланс банка | `10000` |
| `BANK_RESERVE` | ниже этого порога редкие призы (rare+) не выпадают | `3000` |
| `DAILY_BIG_PRIZE_CAP` | дневной лимит крупных призов (дата — Europe/Kyiv) | `8` |
| `BIG_PRIZE_MIN_VALUE` | порог «крупного» приза в Stars | `250` |
| `WITHDRAW_REVIEW_MIN` | выводы от этой суммы идут на проверку | `250` |
| `NEW_ACCOUNT_HOURS` | новые аккаунты — выводы на проверку | `48` |
| `REVIEW_RISK_SCORE` | порог риск-скора для проверки вывода | `60` |
| `RATE_LIMIT_PER_MIN` | лимит запросов на пользователя | `40` |
| `OPEN_LIMIT_PER_MIN` | лимит круток на пользователя | `20` |
| `AUTOCLICK_MIN_MS` | интервал быстрее этого считается автокликером | `450` |
| `AUTOCLICK_REGULAR_STDDEV_MS` | слишком ровные интервалы — тоже автокликер | `25` |

## API (кратко)

Все игровые запросы (кроме вебхука и `/health`) требуют заголовок `Authorization: tma <initData>`. Подпись проверяется HMAC-SHA256 по схеме Telegram WebApp, просроченный `auth_date` отклоняется. Мутации идемпотентны по `X-Idempotency-Key`.

- `POST /v1/bootstrap` — баланс, инвентарь, хэш следующего раунда
- `GET /v1/next-round` — `sha256(serverSeed)` до крутки, `clientSeed`, `nonce`
- `POST /v1/open` — `{ caseId, demo }` → приз, баланс, раскрытый `serverSeed`
- `POST /v1/sell` / `/v1/withdraw` / `/v1/buy-premium`
- `GET /v1/inventory`, `GET /v1/cases`
- `POST /v1/fairness/verify` — проверка `{ serverSeed, clientSeed, nonce, serverSeedHash }` (можно без авторизации)
- `POST /v1/webhook/telegram` — `successful_payment` зачисляет Stars, `refunded_payment` снимает их и помечает игрока

RNG: перед раундом публикуется `sha256(serverSeed)`, исход = `HMAC_SHA256(serverSeed, clientSeed:nonce)` как число в `[0, 1)`. После раунда seed раскрывается и ротируется. Каждая операция с балансом пишется в ledger.

Обычные выводы подтверждаются сразу (`approved`, статус предмета `withdrawing`). Крупные, с новых аккаунтов или с высоким риском попадают в очередь `review`. Риск-скор растёт от автокликера, общего отпечатка устройства / IP и возвратов платежей.

## Хостинг (позже, сейчас ничего не деплоим)

Подойдёт любой хост с Node 22+ и постоянным диском под SQLite:

1. **Свой VPS** (Timeweb, Hetzner и т.п.) — systemd + этот сервис, файл БД на диске. Проще всего контролировать вебхук и секреты.
2. **Fly.io** — маленький Node-сервис и volume под SQLite.
3. **Railway** — тоже удобный вариант для одного процесса; диск или volume для `data/`.

Актуальные цены смотрите на сайте выбранного хостера, они часто меняются. Вебхук бота переключайте на `/v1/webhook/telegram` только когда сервер уже работает у вас и задан `WEBHOOK_SECRET`.
