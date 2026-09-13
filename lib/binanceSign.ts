import crypto from "crypto";

export function signQuery(queryString: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(queryString)
    .digest("hex");
}

export function buildSignedParams(
  params: Record<string, string | number>,
  secret: string
): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  const signature = signQuery(query, secret);

  return `${query}&signature=${signature}`;
}
