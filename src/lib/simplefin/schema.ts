import { z } from "zod";
import { MoneyParseError, parseAmountToCents } from "../money";
import type { AccountSet, ErrItem, NormalisedAccount, NormalisedConnection, NormalisedTransaction } from "./types";

export class SimpleFinParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SimpleFinParseError";
  }
}

function parseAmountOrThrow(value: string | number, context: string): number {
  try {
    return parseAmountToCents(value);
  } catch (err) {
    if (err instanceof MoneyParseError) {
      throw new SimpleFinParseError(`${context} ${JSON.stringify(value)} is not a numeric amount`, { cause: err });
    }
    throw err;
  }
}

const amount = z.union([z.string(), z.number()]);
const unixSeconds = z.number().int();

const wireTransaction = z
  .object({
    id: z.string(),
    posted: unixSeconds,
    amount,
    description: z.string().default(""),
    payee: z.string().optional(),
    memo: z.string().optional(),
    pending: z.boolean().optional(),
    transacted_at: unixSeconds.optional(),
  })
  .loose();

const wireOrg = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    domain: z.string().optional(),
    url: z.string().optional(),
    "sfin-url": z.string().optional(),
  })
  .loose();

const wireAccount = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    balance: amount,
    "available-balance": amount.optional(),
    "balance-date": unixSeconds,
    transactions: z.array(wireTransaction).default([]),
    org: wireOrg.optional(),
    conn_id: z.string().optional(),
  })
  .loose();

const wireConnection = z
  .object({
    conn_id: z.string(),
    name: z.string(),
    org_id: z.string().optional(),
    org_url: z.string().optional(),
    sfin_url: z.string().optional(),
  })
  .loose();

const wireErrItem = z
  .object({ code: z.string(), msg: z.string(), conn_id: z.string().optional(), account_id: z.string().optional() })
  .loose();

const wireAccountSet = z
  .object({
    errors: z.array(z.string()).optional(),
    errlist: z.array(wireErrItem).optional(),
    connections: z.array(wireConnection).optional(),
    accounts: z.array(wireAccount).default([]),
  })
  .loose();

function orgConnectionId(org: z.infer<typeof wireOrg>): string {
  return org.id ?? org["sfin-url"] ?? org.domain ?? org.name ?? "unknown";
}

export function parseAccountSet(json: unknown): AccountSet {
  const parsed = wireAccountSet.safeParse(json);
  if (!parsed.success) {
    throw new SimpleFinParseError(`Unrecognised SimpleFin response: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const wire = parsed.data;

  const connections = new Map<string, NormalisedConnection>();
  for (const c of wire.connections ?? []) {
    connections.set(c.conn_id, { id: c.conn_id, name: c.name, url: c.org_url, sfinUrl: c.sfin_url, raw: c });
  }

  const accounts: NormalisedAccount[] = wire.accounts.map((a) => {
    let connectionId: string;
    if (a.conn_id) {
      connectionId = a.conn_id;
      if (!connections.has(connectionId)) {
        connections.set(connectionId, {
          id: connectionId,
          name: "Unknown connection",
          raw: { synthesized: true, conn_id: connectionId },
        });
      }
    } else {
      const org = a.org ?? {};
      connectionId = orgConnectionId(org);
      if (!connections.has(connectionId)) {
        connections.set(connectionId, {
          id: connectionId,
          name: org.name ?? connectionId,
          domain: org.domain,
          url: org.url,
          sfinUrl: org["sfin-url"],
          raw: org,
        });
      }
    }

    const transactions: NormalisedTransaction[] = a.transactions.map((t) => ({
      id: t.id,
      posted: t.posted,
      transactedAt: t.transacted_at,
      amountCents: parseAmountOrThrow(t.amount, `Transaction ${t.id} in account ${a.id}: amount`),
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      pending: t.pending ?? t.posted === 0,
      raw: t,
    }));

    return {
      id: a.id,
      connectionId,
      name: a.name,
      currency: a.currency,
      balanceCents: parseAmountOrThrow(a.balance, `Account ${a.id}: balance`),
      availableBalanceCents:
        a["available-balance"] === undefined
          ? undefined
          : parseAmountOrThrow(a["available-balance"], `Account ${a.id}: available-balance`),
      balanceDate: a["balance-date"],
      transactions,
      raw: a,
    };
  });

  const errlist: ErrItem[] = [
    ...(wire.errors ?? []).map((msg) => ({ code: "gen.legacy", msg })),
    ...(wire.errlist ?? []).map((e) => {
      const item: ErrItem = { code: e.code, msg: e.msg };
      if (e.conn_id) item.connId = e.conn_id;
      if (e.account_id) item.accountId = e.account_id;
      return item;
    }),
  ];

  return { connections: [...connections.values()], accounts, errlist };
}
