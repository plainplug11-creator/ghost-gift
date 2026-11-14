export interface Config {
  port: number;
  botToken: string;
  webhookSecret: string;
  authMaxAgeSec: number;
  databasePath: string;
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

const num = (k: string, d: number) => {
  const v = process.env[k];
  return v == null || v === '' ? d : Number(v);
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: num('PORT', 8787),
    botToken: process.env.BOT_TOKEN || process.env.GHOST_GIFT_BOT_TOKEN || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    authMaxAgeSec: num('AUTH_MAX_AGE_SEC', 86400),
    databasePath: process.env.DATABASE_PATH || './data/ghost-gift.db',
    bankStart: num('BANK_START', 10000),
    bankReserve: num('BANK_RESERVE', 3000),
    dailyBigPrizeCap: num('DAILY_BIG_PRIZE_CAP', 8),
    bigPrizeMinValue: num('BIG_PRIZE_MIN_VALUE', 250),
    withdrawReviewMin: num('WITHDRAW_REVIEW_MIN', 250),
    newAccountHours: num('NEW_ACCOUNT_HOURS', 48),
    reviewRiskScore: num('REVIEW_RISK_SCORE', 60),
    rateLimitPerMin: num('RATE_LIMIT_PER_MIN', 40),
    openLimitPerMin: num('OPEN_LIMIT_PER_MIN', 20),
    autoclickMinMs: num('AUTOCLICK_MIN_MS', 450),
    autoclickRegularStddevMs: num('AUTOCLICK_REGULAR_STDDEV_MS', 25),
    ...overrides,
  };
}
