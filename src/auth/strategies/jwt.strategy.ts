import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupsService } from '../../groups/groups.service';
import { User } from '../../core/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly groups: GroupsService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
    });
  }

  /**
   * Gruppenmitgliedschaft und Nutzungsrechte werden hier einmal pro Anfrage
   * geladen und liegen danach als `req.user.groupIds` und `req.user.grants`
   * bereit. So bleibt `accessLevel()` synchron und ohne Datenbankzugriff.
   *
   * Bewusst nicht im Token: Ein Entzug muss sofort wirken. Aus demselben
   * Grund wird das Konto selbst nachgeschlagen – ein deaktiviertes oder
   * gelöschtes Konto ist mit dem nächsten Klick draußen, nicht erst nach
   * Ablauf des Tokens.
   */
  async validate(payload: any) {
    // Zwischen-Tokens (z. B. der 2FA-Anmeldung) sind keine Sitzung.
    if (payload?.purpose) throw new UnauthorizedException('Kein Sitzungs-Token.');
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Dieses Konto gibt es nicht mehr.');
    if (user.active === false) throw new UnauthorizedException('Dieses Konto ist deaktiviert.');
    return {
      userId: payload.sub,
      email: user.email,
      username: user.email, // backward compat alias
      role: payload.role,
      mustChangePassword: !!payload.mustChangePassword,
      // Schule und Schuladmin-Recht frisch aus der Datenbank – ein Entzug
      // durch den Hauptadmin wirkt damit beim nächsten Klick.
      schoolId: user.schoolId || null,
      isSchoolAdmin: !!user.schoolId && !!user.isSchoolAdmin,
      groupIds: await this.groups.groupIdsFor(payload.sub),
      grants: await this.groups.grantsFor(payload.sub),
    };
  }
}
