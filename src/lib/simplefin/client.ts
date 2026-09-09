import { parseAccountSet, SimpleFinParseError } from "./schema";
import type { AccountSet } from "./types";

export class SimpleFinAuthError extends Error {
  constructor(message = "SimpleFin rejected the credentials (HTTP 403). The access URL may be revoked or the setup token already claimed.") {
    super(message);
    this.name = "SimpleFinAuthError";
  }
}
export class SimpleFinPaymentError extends Error {
  constructor() {
    super("SimpleFin Bridge returned HTTP 402: payment required. Check your bridge subscription.");
    this.name = "SimpleFinPaymentError";
  }
}
export class SimpleFinHttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`SimpleFin returned HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "SimpleFinHttpError";
  }
}
export class SimpleFinNetworkError extends Error {
  constructor(public readonly cause: unknown) {
    super(`Network error talking to SimpleFin: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SimpleFinNetworkError";
  }
}

export type FetchAccountsOptions = {
  start: number;
  end: number;
  pending?: boolean;
  accountIds?: string[];
  fetchImpl?: typeof fetch;
};

export type FetchAccountsResult = { accountSet: AccountSet; rawBody: string; httpStatus: number };

export function splitAccessUrl(accessUrl: string): { baseUrl: string; authHeader: string } {
  const u = new URL(accessUrl);
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  const base = u.toString().replace(/\/$/, "");
  return { baseUrl: base, authHeader: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

export function buildAccountsRequest(accessUrl: string, opts: FetchAccountsOptions): { url: string; headers: Record<string, string> } {
  const { baseUrl, authHeader } = splitAccessUrl(accessUrl);
  const u = new URL(`${baseUrl}/accounts`);
  u.searchParams.set("start-date", String(Math.floor(opts.start)));
  u.searchParams.set("end-date", String(Math.floor(opts.end)));
  if (opts.pending ?? true) u.searchParams.set("pending", "1");
  for (const id of opts.accountIds ?? []) u.searchParams.append("account", id);
  return { url: u.toString(), headers: { Authorization: authHeader, Accept: "application/json" } };
}

export async function fetchAccounts(accessUrl: string, opts: FetchAccountsOptions): Promise<FetchAccountsResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { url, headers } = buildAccountsRequest(accessUrl, opts);
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers });
  } catch (cause) {
    throw new SimpleFinNetworkError(cause);
  }
  const rawBody = await res.text();
  if (res.status === 403) throw Object.assign(new SimpleFinAuthError(), { status: 403, rawBody });
  if (res.status === 402) throw Object.assign(new SimpleFinPaymentError(), { status: 402, rawBody });
  if (!res.ok) throw Object.assign(new SimpleFinHttpError(res.status, rawBody), { rawBody });
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw Object.assign(new SimpleFinParseError(`Response was not JSON: ${rawBody.slice(0, 120)}`), { rawBody });
  }
  try {
    return { accountSet: parseAccountSet(json), rawBody, httpStatus: res.status };
  } catch (err) {
    throw Object.assign(err as Error, { rawBody });
  }
}
