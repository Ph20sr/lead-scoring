import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineModel, score, rank } from '../src/index.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const model = defineModel({
  fit: [
    { label: 'decisor', field: 'cargo', in: ['dono', 'diretor', 'diretora', 'ceo'], points: 25 },
    { label: 'porte ideal', field: 'empresa.funcionarios', between: [10, 200], points: 20 },
    { label: 'segmento atendido', field: 'empresa.segmento', in: ['clinica', 'imobiliaria', 'contabilidade'], points: 15 },
    { label: 'e-mail pessoal', field: 'email', freeEmail: true, points: -10 },
    { label: 'sem telefone', field: 'telefone', exists: false, points: -5 },
    { label: 'estagiário', field: 'cargo', contains: 'estagi', points: -30 },
  ],
  events: {
    pediu_orcamento: { points: 30, label: 'pediu orçamento' },
    visitou_precos: { points: 10, max: 25, label: 'visitou a página de preços' },
    abriu_email: { points: 2, max: 10 },
    baixou_material: { points: 8 },
    descadastrou: { points: -40 },
  },
  halfLifeDays: 30,
});

/*
 * Joana (A1): decisor 25 + porte 20 + segmento 15 = 60 → A
 *   pediu orçamento hoje 30 + 4 visitas a preços hoje 40 → teto 25 + e-mail aberto há 30 dias 2 × ½ = 1
 *   engajamento 56 → nível 1
 */
const joana = {
  lead: { nome: 'Joana', cargo: 'Dono', email: 'joana@clinicavida.com.br', telefone: '11 98888-0000', empresa: { funcionarios: 35, segmento: 'Clínica' } },
  events: [
    { type: 'pediu_orcamento', at: daysAgo(0) },
    ...Array.from({ length: 4 }, () => ({ type: 'visitou_precos', at: daysAgo(0) })),
    { type: 'abriu_email', at: daysAgo(30) },
    { type: 'abriu_email', at: daysAgo(400) },          // velho demais (maxAgeDays 180)
    { type: 'pediu_orcamento', at: daysAgo(-3) },       // data no futuro: ignorado
    { type: 'evento_desconhecido', at: daysAgo(0) },
  ],
};

/*
 * Rafael (B2): diretor 25 + imobiliária 15 = 40 → B (500 funcionários: fora do porte)
 *   orçamento há 30 dias 15 + material há 10 dias 8 × ½^(1/3) = 6,35 + 3 e-mails hoje 6 = 27,3 → nível 2
 */
const rafael = {
  lead: { nome: 'Rafael', cargo: 'Diretor', email: 'rafael@imobsul.com.br', telefone: '51 3333-0000', empresa: { funcionarios: 500, segmento: 'Imobiliária' } },
  events: [
    { type: 'pediu_orcamento', at: daysAgo(30) },
    { type: 'baixou_material', at: daysAgo(10) },
    ...Array.from({ length: 3 }, () => ({ type: 'abriu_email', at: daysAgo(0) })),
  ],
};

/*
 * Carla (C3): CEO 25 + porte 20 − Gmail 10 = 35 → C
 *   material hoje 8 + preços há 15 dias 10 × ½^½ = 7,07 → 15,1 → nível 3
 */
const carla = {
  lead: { nome: 'Carla', cargo: 'CEO', email: 'carla.ind@gmail.com', telefone: '31 97777-0000', empresa: { funcionarios: 12, segmento: 'Indústria' } },
  events: [{ type: 'baixou_material', at: daysAgo(0) }, { type: 'visitou_precos', at: daysAgo(15) }],
};

/*
 * Lucas (D4): Gmail −10, sem telefone −5, estagiário −30 = −45 → D
 *   material há 60 dias 8 × ¼ = 2 + descadastro há 90 dias −40 (negativo não perde força) = −38 → nível 4
 */
const lucas = {
  lead: { nome: 'Lucas', cargo: 'Estagiário de marketing', email: 'lucas@hotmail.com', empresa: { funcionarios: 5000, segmento: 'Varejo' } },
  events: [{ type: 'baixou_material', at: daysAgo(60) }, { type: 'descadastrou', at: daysAgo(90) }],
};

test('perfil ideal e muito engajado: A1 e MQL', () => {
  const s = score(joana.lead, joana.events, model, NOW);
  assert.deepEqual([s.fit, s.engagement, s.total, s.class, s.mql], [60, 56, 116, 'A1', true]);
  assert.deepEqual(s.reasons[0], { kind: 'engajamento', label: 'pediu orçamento', points: 30, count: 1, capped: false });
  const precos = s.reasons.find((r) => r.label === 'visitou a página de preços');
  assert.deepEqual(precos, { kind: 'engajamento', label: 'visitou a página de preços', points: 25, count: 4, capped: true });
  assert.equal(s.reasons.find((r) => r.label === 'abriu_email').count, 1, 'só o e-mail dentro da janela');
});

test('decaimento por meia-vida: B2 e MQL', () => {
  const s = score(rafael.lead, rafael.events, model, NOW);
  assert.equal(s.fit, 40);
  assert.equal(s.engagement, 27.3);
  assert.equal(s.class, 'B2');
  assert.equal(s.mql, true);
});

test('e-mail pessoal tira pontos e engajamento morno: C3', () => {
  const s = score(carla.lead, carla.events, model, NOW);
  assert.deepEqual([s.fit, s.engagement, s.class, s.mql], [35, 15.1, 'C3', false]);
  assert.ok(s.reasons.some((r) => r.label === 'e-mail pessoal' && r.points === -10));
});

test('pontos negativos e descadastro: D4', () => {
  const s = score(lucas.lead, lucas.events, model, NOW);
  assert.deepEqual([s.fit, s.engagement, s.total, s.class, s.mql], [-45, -38, -83, 'D4', false]);
  assert.deepEqual(s.reasons.map((r) => r.label), ['descadastrou', 'estagiário', 'e-mail pessoal', 'sem telefone', 'baixou_material']);
});

test('o mesmo lead esfria com o tempo', () => {
  const later = new Date(NOW.getTime() + 60 * 86_400_000);
  const past = joana.events.filter((e) => e.at <= NOW.toISOString());
  const s = score(joana.lead, past, model, later);
  // 60 dias depois: orçamento 30 × ¼ = 7,5; preços 40 × ¼ = 10 (abaixo do teto); e-mail 2 × ⅛ = 0,25
  assert.equal(s.engagement, 17.8);
  assert.equal(s.class, 'A3');
  assert.equal(s.mql, false);
});

test('ranking para o time comercial', () => {
  const ranked = rank([lucas, carla, rafael, joana], model, NOW);
  assert.deepEqual(ranked.map((r) => [r.lead.nome, r.score.class]), [['Joana', 'A1'], ['Rafael', 'B2'], ['Carla', 'C3'], ['Lucas', 'D4']]);
});

test('condições compostas, textos sem acento e caminhos aninhados', () => {
  const m = defineModel({
    fit: [
      { label: 'decisor em empresa média', all: [{ field: 'cargo', in: ['sócio', 'dono'] }, { field: 'empresa.funcionarios', gte: 50 }], points: 10 },
      { label: 'veio de indicação ou evento', any: [{ field: 'origem', equals: 'indicacao' }, { field: 'origem', equals: 'evento' }], points: 5 },
      { label: 'fora do Brasil', field: 'pais', notIn: ['Brasil', 'BR'], points: -20 },
    ],
  });
  const a = score({ cargo: 'SOCIO', empresa: { funcionarios: 80 }, origem: 'Indicação', pais: 'brasil' }, [], m, NOW);
  assert.equal(a.fit, 15);
  const b = score({ cargo: 'Sócio', empresa: { funcionarios: 10 }, origem: 'google', pais: 'Portugal' }, [], m, NOW);
  assert.equal(b.fit, -20);
  const c = score({}, [], m, NOW);
  assert.equal(c.fit, 0, 'campo ausente não bate com notIn');
});

test('configuração inválida falha na criação', () => {
  assert.throws(() => defineModel({ fit: [{ field: 'cargo', in: ['dono'] }] }), /points/);
  assert.throws(() => defineModel({ fit: [{ field: 'cargo', points: 5 }] }), /operador/);
  assert.throws(() => defineModel({ fit: [{ in: ['dono'], points: 5 }] }), /field/);
  assert.throws(() => defineModel({ events: { x: { points: 'dez' } } }), /points/);
  assert.throws(() => defineModel({ events: { x: { points: 1, max: 0 } } }), RangeError);
  assert.throws(() => defineModel({ halfLifeDays: 0 }), RangeError);
  assert.throws(() => defineModel({ grades: [{ min: 10, grade: 'A' }, { min: 50, grade: 'B' }] }), /decrescente/);
});
