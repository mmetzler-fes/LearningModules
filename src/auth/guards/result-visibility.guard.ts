import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * ResultVisibilityGuard ensures that teachers only see results for students
 * who are assigned to them (via teacherId).
 * Admins and schooladmins can still see all results within their school context.
 */
@Injectable()
export class ResultVisibilityGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // User object from JwtStrategy

    if (!user) return false;

    // Global admins and school admins are exempt from the individual teacher filter
    if (user.role === 'admin' || user.role === 'schooladmin') {
      return true;
    }

    // Identify if the request asks for specific teacher's results (e.g., via query)
    const targetTeacherId = request.query.teacherId || request.params.teacherId || (request.body && request.body.teacherId);

    // If a teacher tries to query results for someone else, deny it
    if (user.role === 'teacher' && targetTeacherId && targetTeacherId !== user.userId) {
      throw new ForbiddenException('Lehrer können nur die Ergebnisse ihrer eigenen Schüler einsehen.');
    }

    return true;
  }
}
