import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const optionalString = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : undefined;
  });

const nonNegativeInt = (def: number) =>
  optionalString.transform((v, ctx) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: `must be a non-negative integer, got ${JSON.stringify(v)}` });
      return z.NEVER;
    }
    return n;
  });

const envSchema = z.object({
  SIMPLEFIN_ACCESS_URL: optionalString.refine(
    (v) => v === undefined || /^https?:\/\/.+/.test(v),
    { message: "must be an http(s) URL" },
  ),
  SIMPLEFIN_SETUP_TOKEN: optionalString,
  DATABASE_PATH: optionalString.transform((v) => v ?? "./data/fineants.db"),
  SYNC_INTERVAL_HOURS: nonNegativeInt(6),
  BACKFILL_DAYS: nonNegativeInt(365),
  API_KEY: optionalString,
  PORT: nonNegativeInt(3000),
});

export type Config = {
  simplefinAccessUrl?: string;
  simplefinSetupToken?: string;
  databasePath: string;
  syncIntervalHours: number;
  backfillDays: number;
  apiKey?: string;
  port: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = result.data;
  return {
    simplefinAccessUrl: e.SIMPLEFIN_ACCESS_URL,
    simplefinSetupToken: e.SIMPLEFIN_SETUP_TOKEN,
    databasePath: e.DATABASE_PATH,
    syncIntervalHours: e.SYNC_INTERVAL_HOURS,
    backfillDays: e.BACKFILL_DAYS,
    apiKey: e.API_KEY,
    port: e.PORT,
  };
}

export function requireAccessUrl(config: Config): string {
  if (!config.simplefinAccessUrl) {
    throw new ConfigError(
      "SIMPLEFIN_ACCESS_URL is not set. Run `npm run claim` with SIMPLEFIN_SETUP_TOKEN set, then paste the access URL into .env.",
    );
  }
  return config.simplefinAccessUrl;
}

export function requireApiKey(config: Config): string {
  if (!config.apiKey) {
    throw new ConfigError("API_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.");
  }
  return config.apiKey;
}
