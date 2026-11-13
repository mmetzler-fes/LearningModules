// Nur für die Tests in src/work.

/** Kleine Tabelle im Speicher – genug für find/findOne/create/save/update/remove/delete. */
export function repo(rows: any[] = []) {
  // TypeORM-Bedingungen, soweit die Tests sie brauchen: In, IsNull, Not.
  const ok = (v: any, x: any): boolean => {
    if (v && typeof v === 'object' && typeof v.type === 'string' && '_value' in v) {
      if (v.type === 'in') return (v.value as any[]).includes(x);
      if (v.type === 'isNull') return x === null || x === undefined;
      if (v.type === 'not') return !ok(v.value, x);
    }
    return x === v;
  };
  const match = (r: any, where: any) => Object.entries(where || {}).every(([k, v]) => ok(v, r[k]));
  return {
    rows,
    count: async ({ where }: any) => rows.filter((r) => match(r, where)).length,
    findOne: async ({ where }: any) => rows.find((r) => match(r, where)) || null,
    find: async ({ where }: any = {}) => rows.filter((r) => match(r, where)),
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      const i = rows.findIndex((r) => r.id === x.id);
      x.updatedAt = new Date();
      if (i >= 0) rows[i] = x; else rows.push(x);
      return x;
    },
    update: async (where: any, changes: any) => { rows.filter((r) => match(r, where)).forEach((r) => Object.assign(r, changes)); },
    remove: async (x: any) => { rows.splice(rows.indexOf(x), 1); },
    delete: async (where: any) => { for (const r of rows.filter((x) => match(x, where))) rows.splice(rows.indexOf(r), 1); },
  };
}
