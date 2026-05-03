export class DataResponse<T> {
  readonly success: boolean;

  readonly data: string | T;

  constructor(data: string | T, success?: boolean) {
    if (!success) this.success = typeof data !== 'string';
    else this.success = success;

    this.data = data;
  }
}
