// Pontuação de leads: perfil (fit) + engajamento com decaimento no tempo.

const DAY = 86_400_000;

const FREE_EMAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'msn.com',
]);

const fold = (v) => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const empty = (v) => v === undefined || v === null || v === '';

// Operadores das regras de perfil. Textos são comparados sem acento e sem maiúsculas.
const OPERATORS = {
  equals: (v, x) => !empty(v) && fold(v) === fold(x),
  in: (v, list) => !empty(v) && list.some((x) => fold(x) === fold(v)),
  notIn: (v, list) => !empty(v) && !list.some((x) => fold(x) === fold(v)),
  contains: (v, x) => !empty(v) && fold(v).includes(fold(x)),
  gte: (v, x) => typeof v === 'number' && v >= x,
  lte: (v, x) => typeof v === 'number' && v <= x,
  between: (v, [lo, hi]) => typeof v === 'number' && v >= lo && v <= hi,
  exists: (v, yes) => !empty(v) === yes,
  freeEmail: (v, yes) => !empty(v) && FREE_EMAIL.has(fold(v).split('@')[1]) === yes,
};

function matches(lead, cond) {
  if (cond.all) return cond.all.every((c) => matches(lead, c));
  if (cond.any) return cond.any.some((c) => matches(lead, c));
  const op = Object.keys(cond).find((k) => k in OPERATORS);
  return OPERATORS[op](get(lead, cond.field), cond[op]);
}

function validateCondition(cond, where) {
  if (cond.all || cond.any) return (cond.all ?? cond.any).forEach((c, i) => validateCondition(c, `${where}.${i}`));
  if (!cond.field) throw new TypeError(`${where}: falta "field"`);
  const ops = Object.keys(cond).filter((k) => k in OPERATORS);
  if (ops.length !== 1) throw new TypeError(`${where}: use exatamente um operador (${Object.keys(OPERATORS).join(', ')})`);
}

/** Valida e completa a configuração. Erros aparecem na criação, não no meio da campanha. */
export function defineModel(config) {
  const {
    fit = [], events = {}, halfLifeDays = 30, maxAgeDays = 180,
    grades = [{ min: 60, grade: 'A' }, { min: 40, grade: 'B' }, { min: 20, grade: 'C' }],
    levels = [{ min: 50, level: 1 }, { min: 25, level: 2 }, { min: 10, level: 3 }],
    mql = { grade: 'B', level: 2 },
  } = config;
  fit.forEach((rule, i) => {
    if (typeof rule.points !== 'number') throw new TypeError(`fit[${i}]: points deve ser número`);
    validateCondition(rule, `fit[${i}]`);
  });
  for (const [type, e] of Object.entries(events)) {
    if (typeof e.points !== 'number') throw new TypeError(`events.${type}: points deve ser número`);
    if (e.max !== undefined && !(e.max > 0)) throw new RangeError(`events.${type}: max deve ser positivo`);
  }
  if (!(halfLifeDays > 0)) throw new RangeError('halfLifeDays deve ser positivo');
  for (const [key, arr] of [['grades', grades], ['levels', levels]]) {
    if (!arr.every((x, i) => i === 0 || x.min < arr[i - 1].min)) throw new RangeError(`${key} deve estar em ordem decrescente de min`);
  }
  return { fit, events, halfLifeDays, maxAgeDays, grades, levels, mql };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Pontua um lead.
 * - fit: soma das regras de perfil que batem (cargo, porte, segmento…)
 * - engagement: cada evento vale menos com o tempo (meia-vida), com teto por tipo;
 *   eventos negativos (descadastro, e-mail devolvido) não perdem força a não ser que `decay: true`
 * - class: matriz perfil × engajamento, de A1 (perfil ideal, muito engajado) a D4
 */
export function score(lead, events, model, now = new Date()) {
  const m = model.grades ? model : defineModel(model);
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const reasons = [];

  let fit = 0;
  for (const rule of m.fit) {
    if (!matches(lead, rule)) continue;
    fit += rule.points;
    reasons.push({ kind: 'perfil', label: rule.label ?? rule.field ?? 'regra', points: rule.points });
  }

  const byType = new Map();
  for (const ev of events ?? []) {
    const cfg = m.events[ev.type];
    if (!cfg) continue;
    const age = (t - Date.parse(ev.at)) / DAY;
    if (age < 0 || age > m.maxAgeDays) continue;
    const decays = cfg.decay ?? cfg.points > 0;
    const value = decays ? cfg.points * 0.5 ** (age / m.halfLifeDays) : cfg.points;
    const entry = byType.get(ev.type) ?? { points: 0, count: 0 };
    entry.points += value;
    entry.count++;
    byType.set(ev.type, entry);
  }
  let engagement = 0;
  for (const [type, { points, count }] of byType) {
    const cfg = m.events[type];
    const capped = cfg.max !== undefined && points > cfg.max ? cfg.max : points;
    engagement += capped;
    reasons.push({ kind: 'engajamento', label: cfg.label ?? type, points: round1(capped), count, capped: capped !== points });
  }

  const grade = m.grades.find((g) => fit >= g.min)?.grade ?? 'D';
  const level = m.levels.find((l) => engagement >= l.min)?.level ?? 4;
  reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return {
    fit,
    engagement: round1(engagement),
    total: round1(fit + engagement),
    grade,
    level,
    class: `${grade}${level}`,
    mql: grade <= m.mql.grade && level <= m.mql.level,
    reasons,
  };
}

/**
 * Ordena leads para o time comercial: melhor classe primeiro (A1, A2, B1…), depois maior total.
 * `items`: [{ lead, events }]
 */
export function rank(items, model, now = new Date()) {
  const m = model.grades ? model : defineModel(model);
  return items
    .map((it) => ({ ...it, score: score(it.lead, it.events, m, now) }))
    .sort((a, b) => a.score.class.localeCompare(b.score.class) || b.score.total - a.score.total);
}
