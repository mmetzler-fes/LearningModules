import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HELP_GROUPS, forTeachers, isDocName, outline } from './help-docs';

/**
 * Hilfe: Themenübersicht und einzelne Seiten aus docs/ – für angemeldete
 * Lehrkräfte und Admins, Entwicklerteile ausgeblendet.
 */
@Controller('help')
@UseGuards(JwtAuthGuard)
export class HelpController {
  /** dist/help → Projektwurzel; im Container /app. */
  private dir(): string {
    const candidates = [path.resolve(__dirname, '../../docs'), path.resolve(process.cwd(), 'docs')];
    return candidates.find((d) => fs.existsSync(d)) || candidates[1];
  }

  private read(name: string): string | null {
    if (!isDocName(name)) return null;
    const file = path.join(this.dir(), `${name}.md`);
    return fs.existsSync(file) ? forTeachers(fs.readFileSync(file, 'utf-8')) : null;
  }

  @Get()
  overview() {
    const available = fs.existsSync(this.dir())
      ? fs.readdirSync(this.dir()).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter(isDocName)
      : [];
    const entry = (name: string) => {
      const md = this.read(name);
      return md ? { name, ...outline(md) } : null;
    };
    const known = new Set(HELP_GROUPS.flatMap((g) => g.files));
    const groups = HELP_GROUPS.map((g) => ({
      title: g.title,
      icon: g.icon,
      docs: g.files.filter((f) => available.includes(f)).map(entry).filter(Boolean),
    }));
    const rest = available.filter((f) => !known.has(f)).sort().map(entry).filter(Boolean);
    if (rest.length) groups.push({ title: 'Weitere', icon: '📄', docs: rest });
    return { groups: groups.filter((g) => g.docs.length) };
  }

  @Get(':name')
  page(@Param('name') name: string) {
    const md = this.read(name);
    if (!md) throw new NotFoundException('Diese Hilfeseite gibt es nicht.');
    return { name, title: outline(md).title, markdown: md };
  }
}
