import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Angemeldet oder nicht – beides geht; angemeldet steht `req.user` bereit. */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try { await super.canActivate(context); } catch { /* ohne Anmeldung */ }
    return true;
  }

  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
