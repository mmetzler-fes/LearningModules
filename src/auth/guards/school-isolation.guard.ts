import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Ensures that users with 'teacher' or 'schooladmin' roles can only access
 * data belonging to their own school.
 */
@Injectable()
export class SchoolIsolationGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Injected by JwtStrategy

    if (!user) {
      return false;
    }

    // Global admins skip this check
    if (user.role === 'admin') {
      return true;
    }

    // Identify target schoolId from the request
    const targetSchoolId = request.params?.schoolId || request.body?.schoolId || request.query?.schoolId;

    // If a schoolId is provided in the request, it MUST match the user's schoolId
    if (targetSchoolId && targetSchoolId !== user.schoolId) {
      throw new ForbiddenException('Zugriff auf Daten anderer Schulen verweigert.');
    }

    return true;
  }
}
