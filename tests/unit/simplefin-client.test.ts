import { describe, it, expect } from "vitest";
import { buildAccountsRequest, fetchAccounts, SimpleFinAuthError, SimpleFinPaymentError, SimpleFinHttpError, SimpleFinNetworkError } from "@/lib/simplefin/client";
import { claimSetupToken } from "@/lib/simplefin/claim";
import { SimpleFinParseError } from "@/lib/simplefin/schema";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";

const ACCESS = "https://alice:s3cret@bridge.example/simplefin";

describe("buildAccountsRequest", () => {
  it("strips userinfo, adds basic auth and query params", () => {
    const { url, headers } = buildAccountsRequest(ACCESS, { start: 100, end: 200, pending: true, accountIds: ["A", "B"] });
    const u = new URL(url);
    expect(u.username).toBe("");
    expect(u.origin + u.pathname).toBe("https://bridge.example/simplefin/accounts");
    expect(u.searchParams.get("start-date")).toBe("100");
    expect(u.searchParams.get("end-date")).toBe("200");
    expect(u.searchParams.get("pending")).toBe("1");
    expect(u.searchParams.getAll("account")).toEqual(["A", "B"]);
    expect(headers.Authorization).toBe("Basic " + Buffer.from("alice:s3cret").toString("base64"));
    expect(headers.Accept).toBe("application/json");
  });
  it("omits pending when false", () => {
    const { url } = buildAccountsRequest(ACCESS, { start: 1, end: 2, pending: false });
    expect(new URL(url).searchParams.has("pending")).toBe(false);
  });
});

describe("fetchAccounts", () => {
  it("returns parsed set, raw body and status", async () => {
    const body = { errlist: [], connections: [], accounts: [] };
    const fetchImpl = makeFetchMock(() => jsonResponse(body));
    const res = await fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl });
    expect(res.httpStatus).toBe(200);
    expect(res.rawBody).toBe(JSON.stringify(body));
    expect(res.accountSet.accounts).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(1);
  });
  it("maps 403 to SimpleFinAuthError", async () => {
    const fetchImpl = makeFetchMock(() => new Response("forbidden", { status: 403 }));
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinAuthError);
  });
  it("maps 402 to SimpleFinPaymentError", async () => {
    const fetchImpl = makeFetchMock(() => new Response("pay", { status: 402 }));
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinPaymentError);
  });
  it("maps other statuses to SimpleFinHttpError with status", async () => {
    const fetchImpl = makeFetchMock(() => new Response("boom", { status: 500 }));
    const err = await fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(SimpleFinHttpError);
    expect((err as SimpleFinHttpError).status).toBe(500);
    expect((err as SimpleFinHttpError).body).toBe("boom");
  });
  it("wraps network failures", async () => {
    const fetchImpl = makeFetchMock(() => { throw new TypeError("fetch failed"); });
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinNetworkError);
  });
  it("throws SimpleFinParseError on invalid JSON", async () => {
    const fetchImpl = makeFetchMock(() => new Response("<html>", { status: 200 }));
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinParseError);
  });
});

describe("claimSetupToken", () => {
  it("decodes base64, POSTs with empty body, returns trimmed access url", async () => {
    const claimUrl = "https://bridge.example/simplefin/claim/DEMO";
    const token = Buffer.from(claimUrl).toString("base64");
    const fetchImpl = makeFetchMock(() => new Response("https://u:p@bridge.example/simplefin\n", { status: 200 }));
    const access = await claimSetupToken(token, fetchImpl);
    expect(access).toBe("https://u:p@bridge.example/simplefin");
    expect(fetchImpl.calls[0].url).toBe(claimUrl);
    expect(fetchImpl.calls[0].init?.method).toBe("POST");
    expect((fetchImpl.calls[0].init?.headers as Record<string, string>)["Content-Length"]).toBe("0");
  });
  it("throws SimpleFinAuthError on 403 (already claimed)", async () => {
    const token = Buffer.from("https://bridge.example/claim/X").toString("base64");
    const fetchImpl = makeFetchMock(() => new Response("", { status: 403 }));
    await expect(claimSetupToken(token, fetchImpl)).rejects.toBeInstanceOf(SimpleFinAuthError);
  });
  it("rejects a token that does not decode to a URL", async () => {
    await expect(claimSetupToken("!!!notbase64!!!")).rejects.toThrow(/setup token/i);
  });
});
