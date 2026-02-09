import { TransactionFromServerType } from './transaction-from-server.type';
import { GlobalResponseType } from './global-response.type';

export type TransactionResponseType =
  | TransactionSuccessResponseType
  | TransactionUnSuccessResponseType;

export type TransactionSuccessResponseType = GlobalResponseType<
  TransactionFromServerType[]
>;

export type TransactionUnSuccessResponseType = {
  resultCode: 'AUTHENTICATION_FAILED';
  trackingId: string;
  details: {
    errorId: string;
    errorCode: 'INSUFFICIENT_PRIVILEGES';
    httpStatusCode: 401;
  };
};
