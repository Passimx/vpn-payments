export class DataResponse<T> {
  readonly success: boolean;

  readonly data: string | T;

  constructor(data: string | T) {
    this.success = typeof data !== 'string';

    this.data = data;
  }
}
