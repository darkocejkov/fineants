import { describe, it, expect } from "vitest";
import { loadConfig, requireAccessUrl, requireApiKey, ConfigError } from "@/lib/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.databasePath).toBe("./data/fineants.db");
    expect(c.syncIntervalHours).toBe(6);
    expect(c.backfillDays).toBe(365);
    expect(c.port).toBe(3000);
    expect(c.simplefinAccessUrl).toBeUndefined();
    expect(c.apiKey).toBeUndefined();
  });
  it("reads values and coerces numbers", () => {
    const c = loadConfig({
      SIMPLEFIN_ACCESS_URL: "https://u:p@bridge.example/simplefin",
      DATABASE_PATH: "/data/x.db",
      SYNC_INTERVAL_HOURS: "0",
      BACKFILL_DAYS: "30",
      API_KEY: "k",
      PORT: "4000",
    });
    expect(c.simplefinAccessUrl).toBe("https://u:p@bridge.example/simplefin");
    expect(c.databasePath).toBe("/data/x.db");
    expect(c.syncIntervalHours).toBe(0);
    expect(c.backfillDays).toBe(30);
    expect(c.apiKey).toBe("k");
    expect(c.port).toBe(4000);
  });
  it("treats empty strings as unset", () => {
    const c = loadConfig({ SIMPLEFIN_ACCESS_URL: "", API_KEY: "  " });
    expect(c.simplefinAccessUrl).toBeUndefined();
    expect(c.apiKey).toBeUndefined();
  });
  it("rejects a non-URL access url", () => {
    expect(() => loadConfig({ SIMPLEFIN_ACCESS_URL: "not a url" })).toThrow(ConfigError);
  });
  it("rejects negative or non-numeric numbers", () => {
    expect(() => loadConfig({ SYNC_INTERVAL_HOURS: "-1" })).toThrow(ConfigError);
    expect(() => loadConfig({ BACKFILL_DAYS: "abc" })).toThrow(ConfigError);
  });
});

describe("require helpers", () => {
  it("throw ConfigError with the variable name", () => {
    const c = loadConfig({});
    expect(() => requireAccessUrl(c)).toThrow(/SIMPLEFIN_ACCESS_URL/);
    expect(() => requireApiKey(c)).toThrow(/API_KEY/);
  });
  it("return the value when set", () => {
    const c = loadConfig({ SIMPLEFIN_ACCESS_URL: "https://u:p@h/simplefin", API_KEY: "k" });
    expect(requireAccessUrl(c)).toBe("https://u:p@h/simplefin");
    expect(requireApiKey(c)).toBe("k");
  });
});

describe("TIMEZONE", () => {
  it("defaults to America/Toronto", () => {
    expect(loadConfig({}).timezone).toBe("America/Toronto");
  });
  it("accepts a valid zone and trims it", () => {
    expect(loadConfig({ TIMEZONE: " UTC " }).timezone).toBe("UTC");
  });
  it("rejects an unknown zone with a ConfigError naming the variable", () => {
    expect(() => loadConfig({ TIMEZONE: "Mars/Olympus" })).toThrow(/TIMEZONE/);
  });
});
