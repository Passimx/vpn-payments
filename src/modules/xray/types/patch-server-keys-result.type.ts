export type PatchServerKeysResult = {
  serverId: string;
  serverCode: string;
  keysTotal: number;
  ok: number;
  fail: number;
};

export type CreateServerResult = {
  server: {
    id: string;
    host: string;
    code: string;
    canDefaultCreateKey: boolean;
    canCreateKey: boolean;
    port: number | null;
    forCascadeInboundTag: string | null;
  };
  patch: PatchServerKeysResult;
};
