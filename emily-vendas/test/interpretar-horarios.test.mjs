// Interpretação de AM/PM: a diferença entre DEDUZIR e CHUTAR.
// Deduzir = a regra resolve de forma única. Chutar = escolher entre leituras que sobreviveram.
// Só o primeiro é permitido; o segundo continua caindo em PENDENTE e derrubando o preflight.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { candidatosDeHora, instanteLocal, interpretarFaixa, interpretarSemana, lerHora, proximosLivres, subtrairBloqueio } from "../interpretar-horarios.mjs";
import { rotuloQuando } from "../voz.mjs";

const NY = "America/New_York";

// ---------------------------------------------------------------- as respostas reais dela
test("as sete respostas da Andreia têm leitura única — nenhuma vira palpite", () => {
  const respostas = {
    seg: "2:00 as 8:00", ter: "11:00 as 8:00", qua: "10:30 as 8:00",
    qui: "10:00 as 8:00", sex: "8:00 as 8:00", sab: "8:00 as 8:00", dom: "10:30 as 3:00",
  };
  const esperado = {
    seg: "14:00-20:00", ter: "11:00-20:00", qua: "10:30-20:00",
    qui: "10:00-20:00", sex: "08:00-20:00", sab: "08:00-20:00", dom: "10:30-15:00",
  };
  for (const [dia, bruto] of Object.entries(respostas)) {
    const r = interpretarFaixa(bruto);
    assert.equal(r.ok, true, `${dia}: "${bruto}" deveria resolver`);
    assert.equal(r.faixa, esperado[dia], `${dia}: "${bruto}"`);
  }
});

test("a academia é descontada da grade, e sexta/sábado passam a começar às 10:00", () => {
  const r = interpretarSemana(
    { sex: "8:00 as 8:00", seg: "2:00 as 8:00" },
    { bloqueios: ["07:30-10:00"] },
  );
  assert.deepEqual(r.dias.sex, ["10:00-20:00"], "8h–10h da sexta é hora de academia dela");
  assert.deepEqual(r.dias.seg, ["14:00-20:00"], "segunda começa depois da academia, nada muda");
  assert.equal(r.ok, true);
});

test("bloqueio no MEIO do expediente parte a faixa em duas", () => {
  assert.deepEqual(subtrairBloqueio("10:00-20:00", "13:00-14:00"), ["10:00-13:00", "14:00-20:00"]);
  assert.deepEqual(subtrairBloqueio("10:00-20:00", "07:00-09:00"), ["10:00-20:00"]);
  assert.deepEqual(subtrairBloqueio("10:00-12:00", "09:00-13:00"), []);
});

// ---------------------------------------------------------------- o limite: quando NÃO deduzir
test("ambiguidade de verdade continua PENDENTE — a regra não escolhe a leitura mais provável", () => {
  // "9 às 5" resolve: só 09:00-17:00 sobrevive às restrições.
  assert.equal(interpretarFaixa("9:00 as 5:00").faixa, "09:00-17:00");
  // "7 às 9" NÃO resolve: 07:00-09:00, 07:00-21:00 e 19:00-21:00 são todas plausíveis numa
  // clínica. Três leituras vivas = ambiguidade real, e aqui a regra se recusa a escolher.
  const ambigua = interpretarFaixa("7:00 as 9:00");
  assert.equal(ambigua.ok, false);
  assert.match(ambigua.motivo, /leituras plaus/);
  assert.match(ambigua.motivo, /só a Andreia resolve/);
});

test("texto ilegível não vira horário", () => {
  for (const t of ["banana as 8:00", "de manhã", "", "8:00"]) {
    assert.equal(interpretarFaixa(t).ok, false, `"${t}" não deveria resolver`);
  }
});

test("um dia que não resolve mantém o marcador que o preflight já sabe derrubar", () => {
  const r = interpretarSemana({ seg: "7:00 as 9:00" });
  assert.equal(r.ok, false);
  assert.match(r.dias.seg[0], /\[PREENCHER/);
  assert.equal(r.pendentes.length, 1);
});

// ---------------------------------------------------------------- âncoras
test("12 é meio-dia e 0 é meia-noite — nenhum dos dois muda de lado", () => {
  assert.deepEqual(candidatosDeHora({ h: 12, m: 0 }), [720]);
  assert.deepEqual(candidatosDeHora({ h: 0, m: 0 }), [0]);
  assert.deepEqual(candidatosDeHora({ h: 2, m: 0 }), [120, 840]);
  // Hora já escrita em 24h é respeitada como veio.
  assert.deepEqual(candidatosDeHora({ h: 19, m: 30 }), [19 * 60 + 30]);
  assert.equal(interpretarFaixa("12:00 as 20:00").faixa, "12:00-20:00");
});

test("lerHora aceita os formatos que as pessoas escrevem", () => {
  assert.deepEqual(lerHora("8h"), { h: 8, m: 0 });
  assert.deepEqual(lerHora("10:30"), { h: 10, m: 30 });
  assert.deepEqual(lerHora("14"), { h: 14, m: 0 });
  assert.equal(lerHora("25:00"), null);
});

// ---------------------------------------------------------------- horários concretos
test("os horários saem no fuso da clínica, não no do servidor", () => {
  // 15/08/2026 às 14:00 em New York = 18:00 UTC (EDT, -4).
  assert.equal(instanteLocal(2026, 8, 15, 14, 0, NY), "2026-08-15T18:00:00.000Z");
  // Em janeiro (EST, -5) o mesmo horário local dá outra hora UTC.
  assert.equal(instanteLocal(2026, 1, 15, 14, 0, NY), "2026-01-15T19:00:00.000Z");
});

test("proximosLivres respeita grade, antecedência de 24h e duração + buffer", () => {
  const agenda = JSON.parse(readFileSync(join(homedir(), "Applications", "clinic-now-piloto-familia", "config", "agenda-config.json"), "utf8"));
  const agora = "2026-08-14T18:00:00.000Z"; // sexta, 2 da tarde em NY
  const r = proximosLivres({ agenda, agora, limite: 3 });

  assert.equal(r.horarios.length, 3);
  // Nada dentro das próximas 24h.
  for (const h of r.horarios) {
    assert.ok(new Date(h).getTime() >= new Date(agora).getTime() + 24 * 3600_000, `${h} fere a antecedência`);
  }
  // Passo de 60min = 50 de duração + 10 de buffer.
  assert.equal(new Date(r.horarios[1]) - new Date(r.horarios[0]), 60 * 60_000);
  // E o rótulo sai falado.
  assert.match(rotuloQuando(r.horarios[0], { fuso: NY, agora }), /da (manhã|tarde|noite)|meio-dia/);
});

test("horário ocupado não é oferecido", () => {
  const agenda = JSON.parse(readFileSync(join(homedir(), "Applications", "clinic-now-piloto-familia", "config", "agenda-config.json"), "utf8"));
  const agora = "2026-08-14T18:00:00.000Z";
  const semNada = proximosLivres({ agenda, agora, limite: 1 }).horarios[0];
  const comOcupacao = proximosLivres({
    agenda, agora, limite: 1,
    ocupacoes: [{ inicio: semNada, fim: new Date(new Date(semNada).getTime() + 3600_000).toISOString() }],
  }).horarios[0];
  assert.notEqual(comOcupacao, semNada, "o horário ocupado tem de sair da lista");
});

test("sem espelho do Agendor, a origem é declarada como NÃO confiável", () => {
  const agenda = JSON.parse(readFileSync(join(homedir(), "Applications", "clinic-now-piloto-familia", "config", "agenda-config.json"), "utf8"));
  const cega = proximosLivres({ agenda, agora: "2026-08-14T18:00:00.000Z" });
  assert.equal(cega.confiavel, false);
  assert.match(cega.fonte, /NÃO foi lida/);
  const lida = proximosLivres({ agenda, agora: "2026-08-14T18:00:00.000Z", confiavel: true });
  assert.equal(lida.confiavel, true);
  assert.match(lida.fonte, /Agendor/);
});

test("faixa pendente na grade é ignorada, nunca vira horário oferecido", () => {
  const agenda = { fuso_horario: NY, duracao_min: 50, buffer_min: 10, antecedencia_horas: 0, horizonte_dias: 7,
    dias: { seg: ["[PREENCHER — PENDENTE]"], ter: ["[PREENCHER]"], qua: [], qui: [], sex: [], sab: [], dom: [] } };
  assert.deepEqual(proximosLivres({ agenda, agora: "2026-08-14T18:00:00.000Z" }).horarios, []);
});
