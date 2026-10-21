import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeaturesService } from './features.service';

export const REQUIRE_FEATURE = 'requireFeature';

/**
 * Route nur für Konten, bei denen diese Funktion freigeschaltet ist. Nach
 * JwtAuthGuard verwenden. An Klasse und Methode zugleich: beide sind nötig.
 */
export const RequireFeature = (feature: string) => SetMetadata(REQUIRE_FEATURE, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly features: FeaturesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = [context.getClass(), context.getHandler()]
      .map((target) => this.reflector.get<string>(REQUIRE_FEATURE, target))
      .filter((f): f is string => !!f);
    if (!required.length) return true;
    const user = context.switchToHttp().getRequest().user;
    // Nachgeladen statt aus dem Token: Ein Entzug soll sofort wirken.
    for (const feature of required) {
      if (!user?.userId || !(await this.features.has(user.userId, feature))) {
        throw new ForbiddenException('Diese Funktion ist für dein Konto nicht freigeschaltet.');
      }
    }
    return true;
  }
}
