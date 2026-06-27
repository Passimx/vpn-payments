export class StringsUtil {
  public static getShortName(payload: string) {
    if (payload.length > 8)
      return `${payload.slice(0, 4)}...${payload.slice(-4)}`;
    else return payload;
  }
}
