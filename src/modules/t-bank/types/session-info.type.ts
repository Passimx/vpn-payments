import { GlobalResponseType } from './global-response.type';

export type SessionType = {
  accessLevel: 'CLIENT';
  millisLeft: number;
  userId: string;
  ssoId: string;
  hasSsoSession: boolean;
  ssoTokenExpiresIn: number;
  juniorFlg: boolean;
  prepaidFlg: boolean;
};

export type SessionInfoType = GlobalResponseType<SessionType>;
