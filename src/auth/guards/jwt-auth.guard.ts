import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ALLOW_PENDING_PASSWORD } from './allow-pending-password.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authorized = (await super.canActivate(context)) as boolean;
    if (!authorized) return false;

    // Konten mit Initialpasswort dürfen nur das Passwort ändern.
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowPending) return true;

    const user = context.switchToHttp().getRequest().user;
    if (user?.mustChangePassword) {
      throw new ForbiddenException('Bitte vergeben Sie zuerst ein eigenes Passwort.');
    }
    return true;
  }
}
