import { EventsEnum } from './events-enum';

type Pong = {
  readonly event: EventsEnum.PONG;
  readonly data: unknown;
};

export type ServerEventsType = Pong;
