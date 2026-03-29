export type PurchaseResult =
  | { ok: true; uri: string; keyId: string }
  | { ok: false; error: string };
