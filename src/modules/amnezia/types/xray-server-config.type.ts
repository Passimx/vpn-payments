export type XrayServerConfigType = {
  inbounds: [
    { settings: { clients: { flow: 'xtls-rprx-vision'; id: string }[] } },
  ];
};
