import { ServerEntity } from '../../../database/entities/server.entity';

export class GetServerDto {
  readonly id: string;

  readonly code: string;

  constructor(id: string, code: string) {
    this.id = id;
    this.code = code;
  }

  public static getFromServerEntity(entity: ServerEntity) {
    return new GetServerDto(entity.id, entity.code);
  }

  public static getManyFromServerEntities(entities: ServerEntity[]) {
    return entities.map((entity) => GetServerDto.getFromServerEntity(entity));
  }
}
