import { Reflector } from '@nestjs/core';
import { FeatureGuard, RequireFeature } from './feature.guard';

@RequireFeature('worksheets')
class Ctrl {
  @RequireFeature('pdfImport')
  importPdf() {}
  render() {}
}

describe('FeatureGuard', () => {
  function guard(enabled: string[]) {
    const features = { has: async (_id: string, f: string) => enabled.includes(f) };
    const g = new FeatureGuard(new Reflector(), features as any);
    const ctx = (handler: () => void) => ({
      getHandler: () => handler, getClass: () => Ctrl,
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u' } }) }),
    }) as any;
    return { g, ctx };
  }

  it('verlangt Funktion der Klasse und der Methode', async () => {
    const { g, ctx } = guard(['worksheets']);
    await expect(g.canActivate(ctx(Ctrl.prototype.render))).resolves.toBe(true);
    await expect(g.canActivate(ctx(Ctrl.prototype.importPdf))).rejects.toThrow('nicht freigeschaltet');
    const both = guard(['worksheets', 'pdfImport']);
    await expect(both.g.canActivate(both.ctx(Ctrl.prototype.importPdf))).resolves.toBe(true);
    const onlyPdf = guard(['pdfImport']);
    await expect(onlyPdf.g.canActivate(onlyPdf.ctx(Ctrl.prototype.importPdf))).rejects.toThrow('nicht freigeschaltet');
  });
});
