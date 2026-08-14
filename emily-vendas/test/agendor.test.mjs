import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE_V3, CANDIDATOS_LEITURA, assinaturaValida, configAgendor, descobrir, lerCompromissos, normalizarCompromissos } from "../agendor.mjs";

// A sonda grava em disco. Em teste ela grava num temporário — nunca no `.agendor/` do projeto,
// senão uma execução de teste passa a alterar o comportamento da próxima (e foi o que aconteceu).
function arquivoTemp() {
  return join(mkdtempSync(join(tmpdir(), "agendor-")), "descoberta.json");
}

// ---------------------------------------------------------------- flag fail-closed
test("sem AGENDOR_ENABLED a integração fica desligada e diz por quê", () => {
  const r = configAgendor({});
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /AGENDOR_ENABLED/);
});

test("ligada mas sem token, explica exatamente o que falta para a Andreia fazer", () => {
  const r = configAgendor({ AGENDOR_ENABLED: "true" });
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /AGENDOR_TOKEN/);
  assert.match(r.motivo, /Configura(ç|c)(õ|o)es/i, "a mensagem tem de dizer onde ela gera o token");
});

test("com token mas sem endpoint confirmado, manda rodar a descoberta em vez de chutar", () => {
  const r = configAgendor({ AGENDOR_ENABLED: "true", AGENDOR_TOKEN: "tok", AGENDOR_ENDPOINT_TAREFAS: "" });
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /descobrir/);
});

test("indisponibilidade do Agendor NÃO derruba o painel — devolve lista vazia", async () => {
  const r = await lerCompromissos({ env: {} });
  assert.equal(r.disponivel, false);
  assert.deepEqual(r.compromissos, []);
});

test("erro de rede vira motivo legível, não exceção", async () => {
  const r = await lerCompromissos({
    env: { AGENDOR_ENABLED: "true", AGENDOR_TOKEN: "tok", AGENDOR_ENDPOINT_TAREFAS: "/tasks" },
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /ECONNREFUSED/);
});

test("HTTP não-200 vira motivo acionável (token/plano), não silêncio", async () => {
  const r = await lerCompromissos({
    env: { AGENDOR_ENABLED: "true", AGENDOR_TOKEN: "tok", AGENDOR_ENDPOINT_TAREFAS: "/tasks" },
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /403/);
  assert.match(r.motivo, /token e plano/);
});

// ---------------------------------------------------------------- normalização
test("normaliza formatos diferentes de data sem inventar horário", () => {
  const c = normalizarCompromissos({
    data: [
      { id: 1, start_date: "2026-08-20T18:00:00.000Z", end_date: "2026-08-20T19:00:00.000Z", text: "sessão" },
      { id: 2, due_date: "2026-08-21T14:00:00.000Z", title: "retorno" },
      { id: 3, text: "tarefa sem data nenhuma" },
    ],
  });
  assert.equal(c.length, 2, "o item sem data tem de ser descartado, não chutado");
  assert.equal(c.ignorados, 1);
  assert.equal(c[0].inicio, "2026-08-20T18:00:00.000Z");
  assert.equal(c[0].fim, "2026-08-20T19:00:00.000Z");
  // Sem fim declarado, assume 1h — e isso está explícito no código, não escondido.
  assert.equal(c[1].fim, "2026-08-21T15:00:00.000Z");
  assert.equal(c[1].titulo, "retorno");
});

test("data inválida é descartada em vez de virar Invalid Date na agenda", () => {
  const c = normalizarCompromissos([{ id: 9, start_date: "não é data" }]);
  assert.equal(c.length, 0);
  assert.equal(c.ignorados, 1);
});

// ---------------------------------------------------------------- webhook
test("webhook sem assinatura é recusado", () => {
  assert.equal(assinaturaValida({ corpoBruto: "{}", assinatura: null, segredo: "s3gredo" }), false);
  assert.equal(assinaturaValida({ corpoBruto: "{}", assinatura: "sha256=qualquer", segredo: "" }), false);
});

test("webhook com assinatura correta é aceito; corpo adulterado é recusado", () => {
  const segredo = "s3gredo";
  const corpo = '{"event":"on_activity_created"}';
  const assinatura = createHmac("sha256", segredo).update(corpo).digest("hex");
  assert.equal(assinaturaValida({ corpoBruto: corpo, assinatura, segredo }), true);
  assert.equal(assinaturaValida({ corpoBruto: corpo, assinatura: `sha256=${assinatura}`, segredo }), true);
  assert.equal(assinaturaValida({ corpoBruto: '{"event":"outro"}', assinatura, segredo }), false);
});

// ---------------------------------------------------------------- descoberta
test("a descoberta sonda os candidatos e falha honestamente quando nenhum responde", async () => {
  const sondados = [];
  const r = await descobrir({
    env: { AGENDOR_TOKEN: "tok" },
    arquivo: arquivoTemp(),
    fetchImpl: async (url) => {
      sondados.push(url);
      return { ok: false, status: 404 };
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.endpoint_escolhido, null);
  assert.equal(sondados.length, CANDIDATOS_LEITURA.length);
  assert.ok(sondados.every((u) => u.startsWith(BASE_V3)));
});

test("a descoberta grava o primeiro endpoint que respondeu 200", async () => {
  const r = await descobrir({
    env: { AGENDOR_TOKEN: "tok" },
    arquivo: arquivoTemp(),
    fetchImpl: async (url) => (url.endsWith("/activities")
      ? { ok: true, status: 200, text: async () => '{"data":[]}' }
      : { ok: false, status: 404 }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.endpoint_escolhido, "/activities");
});

test("sem token não há o que sondar — e o comando diz isso", async () => {
  const r = await descobrir({ env: {}, arquivo: arquivoTemp() });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /AGENDOR_TOKEN ausente/);
});
