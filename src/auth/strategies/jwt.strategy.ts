import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'secretKey', // In production, move this to env variables
    });
  }

  async validate(payload: any) {
    // The object returned here is attached to the Request as 'user'
    return { 
      userId: payload.sub, 
      username: payload.username, 
      role: payload.role, 
      schoolId: payload.schoolId 
    };
  }
}
