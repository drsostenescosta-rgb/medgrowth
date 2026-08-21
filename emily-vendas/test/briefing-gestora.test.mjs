import test from "node:test";
import assert from "node:assert/strict";
import { gerarBriefingGestora, briefingComoTexto } from "../briefing-gestora.mjs";

const operacao = { servicos: [{ id: "drenagem", nome_publico: "Drenagem linfática", preco_usd: 60 }] };

test("briefing é privado, minimizado e só oferece item do catálogo", () => {
  const b = gerarBriefingGestora({
    decisao: { regra: "COM.PRECO_SERVICO", acao: "responder" },
    contexto: { primeiro_nome: "Bia Sobrenome", servico: "drenagem", telefone: "+1 555 999 0000", email: "bia@example.com" },
    operacao,
    clinica: { nome_clinica: "Clínica A" },
  });
  const texto = briefingComoTexto(b);
  assert.equal(b.visibilidade, "somente_gestora");
  assert.match(texto, /Bia/);
  assert.match(texto, /Drenagem linfática/);
  assert.match(texto, /US\$ 60/);
  assert.doesNotMatch(texto, /Sobrenome|555|example\.com/);
  assert.ok(b.nao_fazer.includes("não diagnosticar nem indicar tratamento"));
});

test("urgência interrompe venda e não produz oportunidade", () => {
  const b = gerarBriefingGestora({
    decisao: { regra: "R6.URGENCIA", acao: "escalar" },
    contexto: { primeiro_nome: "Ana", servico: "drenagem" }, operacao,
  });
  assert.deepEqual(b.oportunidades_autorizadas, []);
  assert.match(b.proxima_acao, /não vende nem orienta/);
  assert.doesNotMatch(briefingComoTexto(b), /US\$/);
});

test("serviço não catalogado nunca aparece como oportunidade", () => {
  const b = gerarBriefingGestora({ decisao: { regra: "R8.NAO_SABE" }, contexto: { servico: "Ozempic" }, operacao });
  assert.equal(b.oportunidades_autorizadas.some((o) => o.nome === "Ozempic"), false);
});
