import test from "node:test";
import assert from "node:assert/strict";
import { escanearDadosSensiveis, exigirSomenteSintetico } from "../redaction.mjs";

test("aceita fixture estrutural sem PII nem campo clínico livre", () => {
  assert.deepEqual(escanearDadosSensiveis({ intencao: "solicitar_horario", horario: "2026-08-17T12:00:00-04:00" }), []);
});

test("falha fechada para campo PII, email, telefone e texto clínico livre", () => {
  const dados = { nome_cliente: "Pessoa", contato: "teste@example.com", telefone: "555-555-1212", sintomas: "texto" };
  const codigos = escanearDadosSensiveis(dados).map((item) => item.codigo);
  assert.ok(codigos.includes("CAMPO_PII"));
  assert.ok(codigos.includes("EMAIL_ENCONTRADO"));
  assert.ok(codigos.includes("TELEFONE_ENCONTRADO"));
  assert.ok(codigos.includes("CAMPO_CLINICO_LIVRE"));
  assert.throws(() => exigirSomenteSintetico(dados), /DADOS_SENSIVEIS_REPROVADOS/);
});
