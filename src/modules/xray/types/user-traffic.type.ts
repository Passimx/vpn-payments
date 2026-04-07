export type TrafficType = {
  stat: TrafficRowType[];
};

export type TrafficRowType = {
  name: string;
  value?: never;
};

export type KeyTrafficType = {
  id: string;
  uplink: number;
  downlink: number;
};
