export class MoneyParseError extends Error {
  constructor(value: unknown) {
    super(`Cannot parse money amount: ${JSON.stringify(value)}`);
    this.name = "MoneyParseError";
  }
}

const AMOUNT_RE = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/;

export function parseAmountToCents(value: string | number): number {
  const str = typeof value === "number" ? value.toFixed(2) : value.trim();
  const m = AMOUNT_RE.exec(str);
  if (!m) throw new MoneyParseError(value);
  const sign = m[1] === "-" ? -1 : 1;
  const units = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
  const cents = sign * (units * 100 + frac);
  return cents === 0 ? 0 : cents;
}

export function formatCents(cents: number, currency: string, locale = "en-CA"): string {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
    } catch {
      // unknown ISO code, fall through
    }
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${units}.${frac} ${currency}`;
}
