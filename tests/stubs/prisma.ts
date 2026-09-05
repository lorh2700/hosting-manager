/**
 * 인메모리 Prisma 스텁. 테스트가 db[model] 배열을 직접 채우고 결과를 검사한다.
 * 지원 범위는 이 프로젝트 코드가 실제로 쓰는 where 연산자·select·include 에 한정된다.
 * 모든 호출은 `calls` 에 `${model}.${op}` 로 기록되어 순서 검증에 쓴다.
 */
type Row = Record<string, any>;

export const db: Record<string, Row[]> = {};
export const calls: string[] = [];
let seq = 0;

export function resetDb() {
  for (const k of Object.keys(db)) delete db[k];
  calls.length = 0;
  seq = 0;
}

export const nextId = (prefix = 'id') => `${prefix}-${++seq}`;

// 관계 해석: row 에 이미 실려 있으면 그것을, 아니면 외래키로 다른 컬렉션에서 찾는다.
const RELATIONS: Record<string, { model: string; localKey?: string; foreignKey?: string; many?: boolean }> = {
  cleaner: { model: 'cleaner', localKey: 'cleanerId' },
  property: { model: 'property', localKey: 'propertyId' },
  user: { model: 'user', localKey: 'userId' },
  event: { model: 'event', localKey: 'eventId' },
  applications: { model: 'cleaningApplication', foreignKey: 'cleaningId', many: true },
  properties: { model: 'userProperty', foreignKey: 'userId', many: true },
  invitations: { model: 'invitation', foreignKey: 'cleanerId', many: true },
  channels: { model: 'propertyChannel', foreignKey: 'propertyId', many: true },
};

const OPERATORS = new Set(['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'has', 'hasSome', 'hasEvery', 'mode']);

function isOperatorObject(v: any): boolean {
  return v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)
    && Object.keys(v).some(k => OPERATORS.has(k));
}

function matchValue(actual: any, cond: any): boolean {
  if (cond === null) return actual === null || actual === undefined;
  if (cond instanceof Date) return actual instanceof Date ? actual.getTime() === cond.getTime() : actual === cond;
  if (typeof cond !== 'object' || Array.isArray(cond)) return actual === cond;
  if (!isOperatorObject(cond)) {
    // 중첩 관계 필터 (예: where: { property: { ownerId } }) — 실린 객체가 있으면 그것으로, 없으면 통과.
    return actual && typeof actual === 'object' ? matches(actual, cond) : true;
  }
  let ok = true;
  if ('equals' in cond) ok = ok && actual === cond.equals;
  if ('not' in cond) ok = ok && (cond.not === null ? actual !== null && actual !== undefined : actual !== cond.not);
  if ('in' in cond) ok = ok && cond.in.includes(actual);
  if ('notIn' in cond) ok = ok && !cond.notIn.includes(actual);
  if ('lt' in cond) ok = ok && actual < cond.lt;
  if ('lte' in cond) ok = ok && actual <= cond.lte;
  if ('gt' in cond) ok = ok && actual > cond.gt;
  if ('gte' in cond) ok = ok && actual >= cond.gte;
  if ('contains' in cond) ok = ok && String(actual ?? '').toLowerCase().includes(String(cond.contains).toLowerCase());
  if ('startsWith' in cond) ok = ok && String(actual ?? '').startsWith(cond.startsWith);
  if ('endsWith' in cond) ok = ok && String(actual ?? '').endsWith(cond.endsWith);
  if ('has' in cond) ok = ok && Array.isArray(actual) && actual.includes(cond.has);
  if ('hasSome' in cond) ok = ok && Array.isArray(actual) && cond.hasSome.some((x: any) => actual.includes(x));
  if ('hasEvery' in cond) ok = ok && Array.isArray(actual) && cond.hasEvery.every((x: any) => actual.includes(x));
  return ok;
}

// 복합 유니크 키(예: propertyId_channelId_originalUid: {...})를 평평하게 편다.
function flattenWhere(where: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k.includes('_') && v && typeof v === 'object' && !isOperatorObject(v) && !Array.isArray(v)) {
      Object.assign(out, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function matches(row: Row, where: Row | undefined): boolean {
  for (const [k, v] of Object.entries(flattenWhere(where ?? {}))) {
    if (k === 'AND') { if (!(Array.isArray(v) ? v : [v]).every((w: Row) => matches(row, w))) return false; continue; }
    if (k === 'OR') { if (!(v as Row[]).some(w => matches(row, w))) return false; continue; }
    if (k === 'NOT') { if ((Array.isArray(v) ? v : [v]).some((w: Row) => matches(row, w))) return false; continue; }
    if (!matchValue(row[k], v)) return false;
  }
  return true;
}

function resolveRelation(row: Row, key: string): any {
  if (key in row) return row[key];
  const rel = RELATIONS[key];
  if (!rel) return undefined;
  const table = db[rel.model] ?? [];
  if (rel.many) return table.filter(r => r[rel.foreignKey!] === row.id);
  const fk = row[rel.localKey!];
  return fk ? (table.find(r => r.id === fk) ?? null) : null;
}

function project(row: Row, select?: Row, include?: Row): Row {
  if (!select && !include) return { ...row };
  const out: Row = select ? {} : { ...row };
  const spec = select ?? include ?? {};
  for (const [k, v] of Object.entries(spec)) {
    if (!v) continue;
    if (k === '_count') {
      out._count = Object.fromEntries(Object.keys((v as Row).select ?? {}).map(rk => [rk, (resolveRelation(row, rk) ?? []).length]));
      continue;
    }
    if (k in RELATIONS || (typeof v === 'object' && (v as Row).select)) {
      const related = resolveRelation(row, k);
      const sub = typeof v === 'object' ? (v as Row) : {};
      out[k] = Array.isArray(related)
        ? related.map(r => project(r, sub.select, sub.include))
        : related ? project(related, sub.select, sub.include) : related ?? null;
      continue;
    }
    out[k] = row[k];
  }
  return out;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Row) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [field, dir] of clauses) {
      const av = a[field], bv = b[field];
      if (av === bv) continue;
      const cmp = av > bv ? 1 : -1;
      return (typeof dir === 'string' ? dir : (dir as Row)?.sort) === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function notFound(model: string): Error {
  const e = new Error(`Record not found in ${model}`) as Error & { code: string };
  e.code = 'P2025';
  return e;
}

function collection(model: string) {
  const rows = () => (db[model] ??= []);
  const record = (op: string) => calls.push(`${model}.${op}`);
  return {
    findMany: async (args: Row = {}) => {
      record('findMany');
      let out = sortRows(rows().filter(r => matches(r, args.where)), args.orderBy);
      if (args.distinct) {
        const seen = new Set<string>();
        out = out.filter(r => { const key = args.distinct.map((d: string) => r[d]).join('|'); if (seen.has(key)) return false; seen.add(key); return true; });
      }
      if (args.skip) out = out.slice(args.skip);
      if (args.take) out = out.slice(0, args.take);
      return out.map(r => project(r, args.select, args.include));
    },
    findFirst: async (args: Row = {}) => {
      record('findFirst');
      const r = sortRows(rows().filter(r => matches(r, args.where)), args.orderBy)[0];
      return r ? project(r, args.select, args.include) : null;
    },
    findUnique: async (args: Row = {}) => {
      record('findUnique');
      const r = rows().find(r => matches(r, args.where));
      return r ? project(r, args.select, args.include) : null;
    },
    count: async (args: Row = {}) => { record('count'); return rows().filter(r => matches(r, args.where)).length; },
    create: async (args: Row) => {
      record('create');
      const row = { id: nextId(model), ...args.data };
      rows().push(row);
      return project(row, args.select, args.include);
    },
    createMany: async (args: Row) => {
      record('createMany');
      for (const d of args.data) rows().push({ id: nextId(model), ...d });
      return { count: args.data.length };
    },
    update: async (args: Row) => {
      record('update');
      const r = rows().find(r => matches(r, args.where));
      if (!r) throw notFound(model);
      Object.assign(r, args.data);
      return project(r, args.select, args.include);
    },
    updateMany: async (args: Row) => {
      record('updateMany');
      const targets = rows().filter(r => matches(r, args.where));
      for (const r of targets) Object.assign(r, args.data);
      return { count: targets.length };
    },
    upsert: async (args: Row) => {
      record('upsert');
      const r = rows().find(r => matches(r, args.where));
      if (r) { Object.assign(r, args.update); return project(r, args.select, args.include); }
      const row = { id: nextId(model), ...args.create };
      rows().push(row);
      return project(row, args.select, args.include);
    },
    delete: async (args: Row) => {
      record('delete');
      const idx = rows().findIndex(r => matches(r, args.where));
      if (idx === -1) throw notFound(model);
      const [removed] = rows().splice(idx, 1);
      return removed;
    },
    deleteMany: async (args: Row = {}) => {
      record('deleteMany');
      const before = rows().length;
      db[model] = rows().filter(r => !matches(r, args.where));
      return { count: before - db[model].length };
    },
    groupBy: async () => { record('groupBy'); return []; },
  };
}

export const prisma: any = new Proxy({}, {
  get(_target, name: string) {
    if (name === '$transaction') return (ops: Promise<any>[] | ((tx: any) => Promise<any>)) => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
    if (name === '$queryRaw') return async () => [];
    if (typeof name !== 'string' || name.startsWith('then')) return undefined;
    return collection(name);
  },
});

export default prisma;
