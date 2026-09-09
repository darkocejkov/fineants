import { SimpleFinAuthError, SimpleFinHttpError, SimpleFinNetworkError } from "./client";

export async function claimSetupToken(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(token.trim(), "base64").toString("utf8").trim();
    new URL(claimUrl);
  } catch {
    throw new Error("The setup token did not decode to a URL. Copy it again from SimpleFin Bridge.");
  }
  let res: Response;
  try {
    res = await fetchImpl(claimUrl, { method: "POST", headers: { "Content-Length": "0" } });
  } catch (cause) {
    throw new SimpleFinNetworkError(cause);
  }
  const body = (await res.text()).trim();
  if (res.status === 403) throw new SimpleFinAuthError("Claim rejected (HTTP 403): the setup token does not exist or was already claimed.");
  if (!res.ok) throw new SimpleFinHttpError(res.status, body);
  return body;
}
