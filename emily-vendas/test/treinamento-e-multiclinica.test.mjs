import test from "node:test";
import assert from "node:assert/strict";
import { lerCurriculo, validarCurriculo } from "../treinamento-vendas.mjs";
import { assertMesmoTenant, criarContextoClinica } from "../contexto-clinica.mjs";
import { estadoCanalGestora, notificarGestora } from "../notificar-gestora.mjs";

test("currículo comercial tem pelo menos 100 fontes e não declara domínio", () => {
  const r = validarCurriculo(lerCurriculo());
  assert.equal(r.ok, true, r.erros.join(" | "));
  assert.ok(r.resumo.total_referencias >= 100);
  assert.equal(r.resumo.afirmacao_permitida, "currículo em curadoria");
});

test("contexto exige identidade e bloqueia mistura de clínicas", () => {
  const c = criarContextoClinica({ clinic_id: "clinica-a", nome_clinica: "A", nome_humano_responsavel: "Ana", fuso_horario: "America/Sao_Paulo", servicos: [{ nome: "Avaliação" }], voz: { tom: "caloroso" } });
  assert.equal(assertMesmoTenant(c, "clinica-a"), true);
  assert.throws(() => assertMesmoTenant(c, "clinica-b"), /outro tenant/);
});

test("canal da gestora falha fechado sem Coexistence validado", async () => {
  assert.match(estadoCanalGestora({ habilitado: true }).motivo, /não validado/);
  let chamouRede = false;
  const r = await notificarGestora({ briefing: { visibilidade: "somente_gestora" }, clinicId: "a", propostaId: "p", config: { habilitado: true }, fetchImpl: async () => { chamouRede = true; } });
  assert.equal(r.enviado, false);
  assert.equal(chamouRede, false);
});

test("canal validado envia uma vez e deduplica por clínica e proposta", async () => {
  const config = { habilitado: true, coexistence_validado: true, telefone_gestora: "15555550100", phone_number_id: "pn", token: "token" };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.1" }] }) });
  const briefing = { visibilidade: "somente_gestora", titulo: "Preparação", resumo: "Resumo", intencao_observada: "descoberta", perguntas_sugeridas: [], oportunidades_autorizadas: [], proxima_acao: "Revisar", evidencia: { limite: "humano" } };
  const enviado = await notificarGestora({ briefing, clinicId: "a", propostaId: "p", config, fetchImpl });
  assert.equal(enviado.enviado, true);
  const repetido = await notificarGestora({ briefing, clinicId: "a", propostaId: "p", config, jaEnviadas: [enviado.chave], fetchImpl });
  assert.equal(repetido.etapa, "idempotencia");
});
