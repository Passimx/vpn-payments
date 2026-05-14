import { ServerEntity } from '../../../database/entities/server.entity';

export class GetServerDto {
  readonly id: string;

  readonly code: string;

  readonly host: string;

  constructor(id: string, code: string, host: string) {
    this.id = id;
    this.code = code;
    this.host = host;
  }

  public static getFromServerEntity(entity: ServerEntity) {
    return new GetServerDto(entity.id, entity.code, entity.host);
  }

  public static getManyFromServerEntities(entities: ServerEntity[]) {
    return entities.map((entity) => GetServerDto.getFromServerEntity(entity));
  }
}
