import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { GroupsService } from '../../groups/groups.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly groups: GroupsService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
    });
  }

  /**
   * Die Gruppenmitgliedschaft wird hier einmal pro Anfrage geladen und liegt
   * danach als `req.user.groupIds` bereit. So bleibt `accessLevel()` synchron
   * und ohne Datenbankzugriff, obwohl Freigaben an Gruppen gehen können.
   *
   * Bewusst nicht im Token: Ändert der Admin die Besetzung einer Fachschaft,
   * muss das sofort wirken – ein Entzug, der erst nach dem nächsten Login
   * greift, wäre keiner.
   */
  async validate(payload: any) {
    return {
      userId: payload.sub,
      email: payload.email,
      username: payload.email, // backward compat alias
      role: payload.role,
      mustChangePassword: !!payload.mustChangePassword,
      groupIds: await this.groups.groupIdsFor(payload.sub),
    };
  }
}
