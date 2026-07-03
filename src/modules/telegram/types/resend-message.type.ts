export type ResendMessageType = {
  started: boolean;
  languageCode: string;
  chatId: number;
  messageId: number;
  sendToAll?: boolean;
};
