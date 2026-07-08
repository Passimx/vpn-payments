import { logger } from '../common/logger/logger';
import { BadGatewayException } from '@nestjs/common';
import { EventsEnum } from './types/events-enum';
import { ServerEventsType } from './types/server-events.type';

const url = 'wss://notifications.passimx.com';
const waitPong = 4 * 1000;
const intervalPing = 4 * 1000;
const maxReconnectDelay = 30000;
const minReconnectDelay = 2000;

export class PassimxApps {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private pongTimeoutTimer: number | undefined;
  private pingIntervalTimer: number | undefined;
  private reconnectDelay: number = minReconnectDelay;

  private customCatch: (error: unknown) => unknown = (error: unknown) => {
    logger.error(error);
  };

  constructor(private readonly token: string) {}

  public async start() {
    await this.tryCatch(() => this.connect());
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) return resolve();

      this.ws = new WebSocket(url);

      this.ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as ServerEventsType;

          if (payload.event === EventsEnum.PONG) {
            clearTimeout(this.pongTimeoutTimer);
            clearTimeout(this.pingIntervalTimer);
            this.pingIntervalTimer = setTimeout(
              () => this.sendPing(),
              intervalPing,
            );
            return;
          }

          // postMessageToBroadCastChannel(payload);

          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          const exception = new BadGatewayException(
            `Error connection to the server: ${url}`,
          );

          reject(exception);
          logger.error('[WS Worker] Pong timeout expiration. Closing...');
        }
      };

      this.ws.onopen = () => {
        this.reconnectDelay = minReconnectDelay;
        clearTimeout(this.reconnectTimer);
        resolve();
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.clearAllTimeouts();

        this.reconnectTimer = setTimeout(() => {
          this.connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          maxReconnectDelay,
        );
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      this.ws.onerror = (error) => {
        const exception = new BadGatewayException(
          `Error connection to the server: ${url}`,
        );

        reject(exception);
      };
    });
  }

  public catch(customCatch: (error: unknown) => unknown) {
    this.customCatch = customCatch;
  }

  private async tryCatch(func: () => Promise<unknown>) {
    try {
      await func();
    } catch (error) {
      if (this.customCatch) this.customCatch(error);
      else console.error(error);
    }
  }

  private sendPing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({ event: 'ping' }));
    clearTimeout(this.pongTimeoutTimer);
    this.pongTimeoutTimer = setTimeout(() => {
      logger.error('[WS Worker] Pong timeout expiration. Closing...');
      this.ws?.close();
    }, waitPong);
  }

  private clearAllTimeouts() {
    clearTimeout(this.pingIntervalTimer);
    clearTimeout(this.pongTimeoutTimer);
    clearTimeout(this.reconnectTimer);
  }
}
