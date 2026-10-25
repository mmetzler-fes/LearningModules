// Nur für die Tests in src/work.

/** Kleine Tabelle im Speicher – genug für find/findOne/create/save/update/remove/delete. */
export function repo(rows: any[] = []) {
  const match = (r: any, where: any) => Object.entries(where || {}).every(([k, v]) => r[k] === v);
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
