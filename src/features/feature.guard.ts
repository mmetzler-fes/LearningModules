import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeaturesService } from './features.service';

export const REQUIRE_FEATURE = 'requireFeature';

/** Route nur für Konten, bei denen diese Funktion freigeschaltet ist. Nach JwtAuthGuard verwenden. */
export const RequireFeature = (feature: string) => SetMetadata(REQUIRE_FEATURE, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly features: FeaturesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(REQUIRE_FEATURE, [context.getHandler(), context.getClass()]);
    if (!feature) return true;
    const user = context.switchToHttp().getRequest().user;
    // Nachgeladen statt aus dem Token: Ein Entzug soll sofort wirken.
    if (!user?.userId || !(await this.features.has(user.userId, feature))) {
      throw new ForbiddenException('Diese Funktion ist für dein Konto nicht freigeschaltet.');
    }
    return true;
  }
}
