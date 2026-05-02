import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../modules/api/services/auth.service';
import { CustomFastifyRequest } from './custom-fastify-request.type';
import { IS_PUBLIC_METADATA_KEY } from './public-type.metadata-key';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.getVerificationType(context);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    const payload = await this.getJWTPayloadByContext(context);
    if (!payload) return false;

    request.userId = payload.userId;

    return true;
  }

  private getJWTPayloadByContext(
    context: ExecutionContext,
  ): ReturnType<typeof this.authService.verifyTokenAsync> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const token = context.getArgs()[0]?.headers?.authorization as string;

    return this.authService.verifyTokenAsync(token);
  }

  private getVerificationType(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}
