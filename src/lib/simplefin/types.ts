export type ErrItem = { code: string; msg: string; connId?: string; accountId?: string; attributedConnectionId?: string };

export type NormalisedConnection = {
  id: string;
  name: string;
  domain?: string;
  url?: string;
  sfinUrl?: string;
  raw: unknown;
};

export type NormalisedTransaction = {
  id: string;
  posted: number;
  transactedAt?: number;
  amountCents: number;
  description: string;
  payee?: string;
  memo?: string;
  pending: boolean;
  raw: unknown;
};

export type NormalisedAccount = {
  id: string;
  connectionId: string;
  name: string;
  currency: string;
  balanceCents: number;
  availableBalanceCents?: number;
  balanceDate: number;
  transactions: NormalisedTransaction[];
  raw: unknown;
};

export type AccountSet = {
  connections: NormalisedConnection[];
  accounts: NormalisedAccount[];
  errlist: ErrItem[];
};
