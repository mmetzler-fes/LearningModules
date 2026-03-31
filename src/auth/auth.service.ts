import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (user && user.passwordHash) {
      const [salt, hash] = user.passwordHash.split(':');
      if (salt && hash) {
        const derivedKey = crypto.scryptSync(pass, salt, 32);
        if (derivedKey.toString('hex') === hash) {
          const { passwordHash, ...result } = user;
          return result;
        }
      }
    } else if (user && !user.passwordHash && pass === '') {
      // Support for empty student passwords if hash is empty
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(username: string, pass: string) {
    const user = await this.validateUser(username, pass);
    if (!user) {
      throw new UnauthorizedException('Ungültige Anmeldedaten');
    }
    
    const payload = { 
      sub: user.id, 
      username: user.username, 
      role: user.role, 
      schoolId: user.schoolId 
    };

    return {
      token: this.jwtService.sign(payload),
      role: user.role,
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    };
  }
}
