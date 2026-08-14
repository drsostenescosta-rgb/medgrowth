import test from "node:test";
import assert from "node:assert/strict";

import { abertura, apelidoServico, fechamento, horaFalada, montar, nivelRelacao, rotuloQuando } from "../voz.mjs";

const NY = "America/New_York";
const AGORA = "2026-08-14T18:00:00.000Z"; // sexta, 2 da tarde em NY

// ---------------------------------------------------------------- nomes curtos
test("o serviço é chamado como a cliente chama, não como está no catálogo", () => {
  assert.equal(apelidoServico("Drenagem linfática"), "drenagem");
  assert.equal(apelidoServico("Pós-operatório"), "pós");
  assert.equal(apelidoServico("Massoterapia masculina"), "massagem");
  assert.equal(apelidoServico("Massagem modeladora"), "modeladora");
});

test("serviço desconhecido volta como veio — nunca inventamos apelido", () => {
  assert.equal(apelidoServico("Protocolo Xyz 3000"), "Protocolo Xyz 3000");
  assert.equal(apelidoServico(null), null);
});

test("a clínica pode sobrescrever os apelidos pela configuração", () => {
  const cfg = { voz: { apelidos_servico: { "Drenagem linfática": "drena" } } };
  assert.equal(apelidoServico("Drenagem linfática", cfg), "drena");
});

// ---------------------------------------------------------------- hora falada
test("a hora sai falada, não em formato de sistema", () => {
  assert.equal(horaFalada("2026-08-19T18:00:00.000Z", NY), "2 da tarde");
  assert.equal(horaFalada("2026-08-19T14:00:00.000Z", NY), "10 da manhã");
  assert.equal(horaFalada("2026-08-19T23:00:00.000Z", NY), "7 da noite");
  assert.equal(horaFalada("2026-08-19T16:00:00.000Z", NY), "meio-dia");
  assert.equal(horaFalada("2026-08-19T18:30:00.000Z", NY), "2 e meia da tarde");
  assert.equal(horaFalada("2026-08-19T18:15:00.000Z", NY), "2 e quinze da tarde");
});

test("nenhuma hora falada usa formato de 24h — a clínica é nos EUA", () => {
  for (let h = 0; h < 24; h++) {
    const iso = new Date(Date.UTC(2026, 7, 19, h, 0)).toISOString();
    assert.doesNotMatch(horaFalada(iso, NY), /\b(1[3-9]|2[0-3]):/, `hora ${h}Z saiu em 24h`);
  }
});

test("rotuloQuando fala hoje, amanhã e o dia da semana — nunca 'quarta-feira às 14 horas'", () => {
  assert.equal(rotuloQuando("2026-08-14T22:00:00.000Z", { fuso: NY, agora: AGORA }), "hoje às 6 da tarde");
  assert.equal(rotuloQuando("2026-08-15T18:00:00.000Z", { fuso: NY, agora: AGORA }), "amanhã, 2 da tarde");
  assert.equal(rotuloQuando("2026-08-19T18:00:00.000Z", { fuso: NY, agora: AGORA }), "quarta, 2 da tarde");
  assert.doesNotMatch(rotuloQuando("2026-08-19T18:00:00.000Z", { fuso: NY, agora: AGORA }), /-feira|horas/);
});

test("o rótulo respeita o fuso da clínica, não o do servidor", () => {
  // 15/08 às 01:00Z ainda é 14/08 às 21:00 em NY → "hoje", não "amanhã".
  assert.equal(rotuloQuando("2026-08-15T01:00:00.000Z", { fuso: NY, agora: AGORA }), "hoje às 9 da noite");
});

// ---------------------------------------------------------------- temperatura
test("a relação esquenta a partir da terceira sessão", () => {
  assert.equal(nivelRelacao(0), "nova");
  assert.equal(nivelRelacao(1), "conhecida");
  assert.equal(nivelRelacao(2), "conhecida");
  assert.equal(nivelRelacao(3), "de_casa");
  assert.equal(nivelRelacao(12), "de_casa");
});

test("cliente nova é a única que recebe a apresentação da Emily", () => {
  assert.match(abertura("nova", "Bruna"), /Aqui é a Emily/);
  assert.doesNotMatch(abertura("conhecida", "Bruna"), /Aqui é a Emily/);
  assert.doesNotMatch(abertura("de_casa", "Bruna"), /Aqui é a Emily/);
  assert.match(abertura("de_casa", "Paty"), /Oi, Paty/);
});

test('"Te espero" só existe quando há horário confirmado', () => {
  assert.match(fechamento("de_casa", "confirmado"), /Te espero/);
  assert.doesNotMatch(fechamento("de_casa", "aguardando_resposta"), /Te espero/);
  assert.doesNotMatch(fechamento("conhecida", "informacao"), /Te espero/);
  assert.equal(fechamento("de_casa", "encerrado"), "");
});

// ---------------------------------------------------------------- montagem
test("a montagem capitaliza o miolo e não repete emoji", () => {
  const t = montar({ nivel: "de_casa", primeiroNome: "Paty", corpo: "entendi 😘", situacao: "informacao" });
  assert.match(t, /^Oi, Paty! 😘 Entendi/);
  assert.equal((t.match(/😘/g) || []).length, 1, "o mesmo emoji não pode aparecer duas vezes");
});

test("mensagem encerrada não ganha fecho pendurado", () => {
  const t = montar({ nivel: "conhecida", primeiroNome: "Bia", corpo: "tudo bem, não te mando mais mensagem.", situacao: "encerrado" });
  assert.equal(t, "Oi, Bia! Tudo bem, não te mando mais mensagem.");
});

test("sem abertura, o miolo é preservado como está (texto literal da dona)", () => {
  const t = montar({ comAbertura: false, corpo: "Só para confirmar direitinho: posso considerar?", situacao: "encerrado" });
  assert.equal(t, "Só para confirmar direitinho: posso considerar?");
});
