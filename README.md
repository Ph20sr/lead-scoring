# lead-scoring

[![CI](https://github.com/Ph20sr/lead-scoring/actions/workflows/ci.yml/badge.svg)](https://github.com/Ph20sr/lead-scoring/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

**Pontuação de leads para CRMs**: diz ao time comercial quem atender primeiro. Separa **perfil** (o lead é o cliente ideal?) de **engajamento** (ele está interessado agora?), faz o interesse esfriar com o tempo e explica cada ponto. Não tem dependências.

## Uso

```js
import { defineModel, score, rank } from 'lead-scoring';

const modelo = defineModel({
  fit: [
    { label: 'decisor', field: 'cargo', in: ['dono', 'diretor', 'ceo'], points: 25 },
    { label: 'porte ideal', field: 'empresa.funcionarios', between: [10, 200], points: 20 },
    { label: 'segmento atendido', field: 'empresa.segmento', in: ['clínica', 'imobiliária'], points: 15 },
    { label: 'e-mail pessoal', field: 'email', freeEmail: true, points: -10 },
    { label: 'estagiário', field: 'cargo', contains: 'estagi', points: -30 },
  ],
  events: {
    pediu_orcamento: { points: 30, label: 'pediu orçamento' },
    visitou_precos: { points: 10, max: 25 },     // teto: 50 visitas não valem mais que 1 orçamento
    abriu_email: { points: 2, max: 10 },
    descadastrou: { points: -40 },               // negativo não esfria com o tempo
  },
  halfLifeDays: 30,                              // um evento vale metade a cada 30 dias
});

score(lead, eventos, modelo);
// {
//   fit: 60, engagement: 56, total: 116,
//   grade: 'A', level: 1, class: 'A1', mql: true,
//   reasons: [
//     { kind: 'engajamento', label: 'pediu orçamento', points: 30, count: 1, capped: false },
//     { kind: 'perfil', label: 'decisor', points: 25 },
//     { kind: 'engajamento', label: 'visitou_precos', points: 25, count: 4, capped: true },
//     ...
//   ]
// }

rank([{ lead, events }, ...], modelo);   // A1, A2, …, D4; empate pelo total
```

## Perfil × engajamento (A1 a D4)

Um número só mistura duas perguntas diferentes. Um estagiário que baixou dez materiais não é melhor lead que um dono de clínica que pediu orçamento uma vez. Por isso a nota tem duas partes:

| | 1 (quente) | 2 | 3 | 4 (frio) |
| --- | --- | --- | --- | --- |
| **A** (perfil ideal) | ligar hoje | ligar | nutrir | nutrir |
| **B** | ligar | ligar | nutrir | — |
| **C** | qualificar | nutrir | — | — |
| **D** (fora do perfil) | — | — | — | descartar |

As faixas de `grades` (A ≥ 60, B ≥ 40, C ≥ 20) e de `levels` (1 ≥ 50, 2 ≥ 25, 3 ≥ 10) e o critério de **MQL** (padrão: B2 ou melhor) são configuráveis.

## Regras de perfil

| operador | exemplo |
| --- | --- |
| `equals`, `in`, `notIn` | `{ field: 'cargo', in: ['dono', 'sócio'] }`, sem acento e sem maiúsculas: "SÓCIO" bate |
| `contains` | `{ field: 'cargo', contains: 'estagi' }` |
| `gte`, `lte`, `between` | `{ field: 'empresa.funcionarios', between: [10, 200] }` (caminho aninhado) |
| `exists` | `{ field: 'telefone', exists: false }` |
| `freeEmail` | Gmail, Hotmail, UOL, BOL… |
| `all`, `any` | `{ all: [{ field: 'cargo', in: ['dono'] }, { field: 'empresa.funcionarios', gte: 50 }], points: 10 }` |

Erros na configuração (operador desconhecido, `points` faltando, faixas fora de ordem) aparecem em `defineModel`, e não no meio de uma campanha.

## Decaimento

Cada evento vale `pontos × ½^(idade / meia-vida)`. Um pedido de orçamento de hoje vale 30, o de um mês atrás vale 15 e o de dois meses atrás vale 7,5. Eventos com mais de `maxAgeDays` (padrão: 180) ou com data no futuro são ignorados. O lead que **parou de interagir cai de nível sozinho**, sem rotina para "zerar" pontuação.

## Desenvolvimento

```bash
npm test
```

Os testes usam quatro leads, um para cada canto da matriz (A1, B2, C3 e D4), com os pontos calculados à mão nos comentários.

## Licença

MIT
