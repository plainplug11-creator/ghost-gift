export interface Env {
  DB: D1Database;
  BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  AUTH_MAX_AGE_SEC?: string;
  BANK_START?: string;
  BANK_RESERVE?: string;
  DAILY_BIG_PRIZE_CAP?: string;
  BIG_PRIZE_MIN_VALUE?: string;
  WITHDRAW_REVIEW_MIN?: string;
  NEW_ACCOUNT_HOURS?: string;
  REVIEW_RISK_SCORE?: string;
  RATE_LIMIT_PER_MIN?: string;
  OPEN_LIMIT_PER_MIN?: string;
  AUTOCLICK_MIN_MS?: string;
  AUTOCLICK_REGULAR_STDDEV_MS?: string;
}

export interface Config {
  botToken: string;
  webhookSecret: string;
  allowedOrigins: string[];
  authMaxAgeSec: number;
  bankStart: number;
  bankReserve: number;
  dailyBigPrizeCap: number;
  bigPrizeMinValue: number;
  withdrawReviewMin: number;
  newAccountHours: number;
  reviewRiskScore: number;
  rateLimitPerMin: number;
  openLimitPerMin: number;
  autoclickMinMs: number;
  autoclickRegularStddevMs: number;
}

export function loadConfig(env: Partial<Env>, overrides: Partial<Config> = {}): Config {
  const num = (v: string | undefined, d: number) => (v == null || v === '' ? d : Number(v));
  return {
    botToken: env.BOT_TOKEN || '',
    webhookSecret: env.WEBHOOK_SECRET || '',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://plainplug11-creator.github.io').split(',').map((s) => s.trim()).filter(Boolean),
    authMaxAgeSec: num(env.AUTH_MAX_AGE_SEC, 86400),
    bankStart: num(env.BANK_START, 10000),
    bankReserve: num(env.BANK_RESERVE, 3000),
    dailyBigPrizeCap: num(env.DAILY_BIG_PRIZE_CAP, 8),
    bigPrizeMinValue: num(env.BIG_PRIZE_MIN_VALUE, 250),
    withdrawReviewMin: num(env.WITHDRAW_REVIEW_MIN, 250),
    newAccountHours: num(env.NEW_ACCOUNT_HOURS, 48),
    reviewRiskScore: num(env.REVIEW_RISK_SCORE, 60),
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 40),
    openLimitPerMin: num(env.OPEN_LIMIT_PER_MIN, 20),
    autoclickMinMs: num(env.AUTOCLICK_MIN_MS, 450),
    autoclickRegularStddevMs: num(env.AUTOCLICK_REGULAR_STDDEV_MS, 25),
    ...overrides,
  };
}
