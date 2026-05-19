export class RefInfoDto {
  readonly users: RefInfoUserItemDto[];

  readonly me: RefInfoUserItemDto;

  constructor(users: RefInfoUserItemDto[], me: RefInfoUserItemDto) {
    this.users = users;
    this.me = me;
  }
}

export class RefInfoUserItemDto {
  readonly id: string;

  readonly count: number;
}
