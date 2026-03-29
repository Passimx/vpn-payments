export type RenewKeyResult =
  | { ok: true; keyId: string }
  | { ok: false; error: string };
