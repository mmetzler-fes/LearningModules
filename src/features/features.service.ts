import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';

/**
 * Funktionen in Entwicklung, die der Admin erst freischaltet – für einzelne
 * Lehrkräfte oder für alle. So lässt sich etwas im Betrieb ausprobieren, ohne
 * dass andere es sehen.
 *
 * Ob eine Funktion für jemanden gilt: Einstellung des Admins ('off' |
 * 'selected' | 'all'), bei 'selected' das Häkchen am Konto (User.features),
 * und die Funktion muss auf diesem Server überhaupt möglich sein (z. B. ein
 * Renderer eingetragen).
 */
export type FeatureMode = 'off' | 'selected' | 'all';

export const FEATURES: Record<string, { label: string; available: () => boolean; needs: string }> = {
  worksheets: {
    label: 'Arbeitsblätter (Modultyp „Dokument“, Druck als .odt/.pdf)',
    available: () => !!process.env.WORKSHEET_RENDERER_URL,
    needs: 'WORKSHEET_RENDERER_URL (Renderer-Container, worksheet-renderer/README.md)',
  },
};

const CONFIG_KEY = 'features';
const MODES: FeatureMode[] = ['off', 'selected', 'all'];

@Injectable()
export class FeaturesService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
  ) {}

  async modes(): Promise<Record<string, FeatureMode>> {
    const row = await this.configRepo.findOne({ where: { key: CONFIG_KEY } });
    const stored = (row?.value && typeof row.value === 'object') ? row.value : {};
    return Object.fromEntries(Object.keys(FEATURES).map((f) => [f, MODES.includes(stored[f]) ? stored[f] : 'off']));
  }

  /** Was für dieses Konto gilt – für Login, /me und den Guard. */
  async enabledFor(user: Pick<User, 'features'> | null | undefined): Promise<string[]> {
    if (!user) return [];
    const modes = await this.modes();
    const own = Array.isArray(user.features) ? user.features : [];
    return Object.keys(FEATURES).filter((f) => FEATURES[f].available()
      && (modes[f] === 'all' || (modes[f] === 'selected' && own.includes(f))));
  }

  async has(userId: string, feature: string): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'features'] });
    return (await this.enabledFor(user)).includes(feature);
  }

  /** Übersicht für den Admin. */
  async overview() {
    const modes = await this.modes();
    return {
      features: Object.entries(FEATURES).map(([id, f]) => ({
        id, label: f.label, mode: modes[id], available: f.available(), needs: f.needs,
      })),
    };
  }

  async setMode(feature: string, mode: string) {
    this.known(feature);
    if (!MODES.includes(mode as FeatureMode)) throw new BadRequestException(`Modus: ${MODES.join(', ')}`);
    const modes = await this.modes();
    modes[feature] = mode as FeatureMode;
    await this.configRepo.save({ key: CONFIG_KEY, value: modes });
    return this.overview();
  }

  async setForUser(userId: string, feature: string, enabled: boolean) {
    this.known(feature);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Benutzer nicht gefunden.');
    const set = new Set(Array.isArray(user.features) ? user.features : []);
    if (enabled) set.add(feature); else set.delete(feature);
    user.features = set.size ? [...set] : null;
    await this.userRepo.save(user);
    return { success: true, features: user.features || [] };
  }

  private known(feature: string) {
    if (!FEATURES[feature]) throw new BadRequestException(`Unbekannte Funktion: ${feature}`);
  }
}
