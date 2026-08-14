import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { criarAtestacaoHumana, executarWorkbench, resolverSaida } from "../shadow-workbench.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const json = (nome) => JSON.parse(readFileSync(join(ROOT, "..", "fixtures", nome), "utf8"));
const entradas = () => ({ operacao: json("shadow-operacao.v1.json"), casos: json("shadow-casos.v1.json"), timestamp: "2026-08-11T12:00:00.000Z" });

test("outputs esperados preservam cinco cenários e nenhum efeito real", () => {
  const relatorio = executarWorkbench(entradas());
  assert.equal(relatorio.resultados.length, 5);
  assert.equal(relatorio.revisao_humana, "PENDENTE");
  assert.equal(relatorio.revisao_humana_concluida, false);
  assert.equal(relatorio.atestacao_humana, null);
  assert.equal(relatorio.veredito, "APTO_PARA_REVISAO_HUMANA");
  assert.match(relatorio.hash_relatorio, /^[a-f0-9]{64}$/);
  assert.ok(relatorio.resultados.every((resultado) => !resultado.envio_realizado && !resultado.reserva_realizada && !resultado.remocao_realizada));
  assert.deepEqual(relatorio.resultados.map((r) => r.decisao), ["RASCUNHO_PARA_REVISAO", "BLOQUEAR_E_OFERECER_ALTERNATIVAS", "PEDIR_CONFIRMACAO_EXPLICITA", "MANTER_AGENDAMENTO_E_ESCALAR", "PAUSAR_E_ESCALAR"]);
});

test("novo pedido e conflito oferecem exatamente dois slots, sem mutar agenda", () => {
  const relatorio = executarWorkbench(entradas());
  for (const tipo of ["novo_pedido", "conflito"]) {
    const resultado = relatorio.resultados.find((item) => item.cenario === tipo);
    assert.equal(resultado.alternativas_sinteticas.length, 2);
    assert.equal(new Set(resultado.alternativas_sinteticas).size, 2);
    assert.ok(resultado.alternativas_sinteticas.every((slot) => slot.endsWith("Z")));
    assert.equal(resultado.estado_agenda.estado_inalterado, true);
    assert.equal(resultado.estado_agenda.sem_dupla_reserva, true);
    assert.equal(resultado.estado_agenda.hash_antes, resultado.estado_agenda.hash_depois);
    assert.equal(resultado.estado_agenda.ocupacoes_antes, resultado.estado_agenda.ocupacoes_depois);
  }
  assert.equal(relatorio.resultados.find((item) => item.cenario === "conflito").invariantes.conflito_detectado, true);
});

test("confirmação ambígua permanece não confirmada e aguardando", () => {
  const resultado = executarWorkbench(entradas()).resultados.find((item) => item.cenario === "confirmacao_ambigua");
  assert.equal(resultado.status_operacional, "aguardando_confirmacao_explicita");
  assert.equal(resultado.invariantes.confirmacao_registrada, false);
  assert.equal(resultado.invariantes.aguardando_confirmacao, true);
});

test("cancelamento ambíguo aguarda confirmação antes da pendência de revisão", () => {
  const resultado = executarWorkbench(entradas()).resultados.find((item) => item.cenario === "cancelamento");
  assert.deepEqual(resultado.etapas, ["manter_agendamento", "pedir_confirmacao_cancelamento", "aguardar_confirmacao_explicita"]);
  assert.equal(resultado.status_operacional, "aguardando_confirmacao_cancelamento");
  assert.deepEqual(resultado.proxima_transicao_condicional, { se: "confirmacao_cancelamento_explicita", entao: "cancelamento_pendente_revisao" });
  assert.equal(resultado.remocao_realizada, false);
});

test("dúvida clínica pausa e bloqueia resposta, followup e upsell", () => {
  const resultado = executarWorkbench(entradas()).resultados.find((item) => item.cenario === "escalacao_clinica");
  assert.equal(resultado.status_operacional, "pausado_aguardando_responsavel");
  assert.deepEqual(resultado.acoes_bloqueadas, ["followup", "upsell"]);
  assert.deepEqual(resultado.invariantes, { resposta_clinica_gerada: false, followup_gerado: false, upsell_gerado: false });
});

test("reprova PII, campo extra e string arbitrária", () => {
  const comPii = entradas();
  comPii.operacao.clinica.contato_email = "real@example.com";
  assert.throws(() => executarWorkbench(comPii), /DADOS_SENSIVEIS_REPROVADOS/);

  const comExtra = entradas();
  comExtra.casos.casos[0].mensagem = "qualquer texto";
  assert.throws(() => executarWorkbench(comExtra), /SCHEMA_CHAVE_DESCONHECIDA/);

  const comStringArbitraria = entradas();
  comStringArbitraria.casos.casos[2].termo = "claro, pode marcar";
  assert.throws(() => executarWorkbench(comStringArbitraria), /SCHEMA_ENUM_INVALIDO/);
});

test("reprova tipo duplicado, extra, ID divergente e campo obrigatório ausente", () => {
  const duplicado = entradas();
  duplicado.casos.casos[4] = structuredClone(duplicado.casos.casos[0]);
  assert.throws(() => executarWorkbench(duplicado), /SCHEMA_CENARIOS_INVALIDOS/);

  const extra = entradas();
  extra.casos.casos[4] = { id: "outro", tipo: "outro" };
  assert.throws(() => executarWorkbench(extra), /SCHEMA_TIPO_CENARIO_INVALIDO/);

  const idDivergente = entradas();
  idDivergente.casos.casos[0].id = "conflito";
  assert.throws(() => executarWorkbench(idDivergente), /SCHEMA_ENUM_INVALIDO/);

  const ausente = entradas();
  delete ausente.casos.casos[0].horario_solicitado;
  assert.throws(() => executarWorkbench(ausente), /SCHEMA_CAMPO_AUSENTE/);
});

test("reprova divergência entre cenários e simulações e chaves desconhecidas na operação", () => {
  const divergente = entradas();
  divergente.operacao.operacao.shadow_sintetico.simulacoes = ["novo_pedido", "conflito", "confirmacao_ambigua", "cancelamento", "cancelamento"];
  assert.throws(() => executarWorkbench(divergente), /SCHEMA_SIMULACOES_INVALIDAS/);

  const extraRaiz = entradas();
  extraRaiz.operacao.canal = "whatsapp";
  assert.throws(() => executarWorkbench(extraRaiz), /SCHEMA_CHAVE_DESCONHECIDA/);

  const extraAninhada = entradas();
  extraAninhada.operacao.operacao.automacao.reservar = true;
  assert.throws(() => executarWorkbench(extraAninhada), /SCHEMA_CHAVE_DESCONHECIDA/);

  const servicoLivre = entradas();
  servicoLivre.operacao.operacao.servicos[0].id = "nome_de_pessoa";
  assert.throws(() => executarWorkbench(servicoLivre), /SCHEMA_ENUM_INVALIDO/);
});

test("reprova alternativa ocupada ou cenário de conflito sem conflito real", () => {
  const slotOcupado = entradas();
  slotOcupado.casos.casos[0].alternativas_sinteticas[0] = "2026-08-17T10:30:00-04:00";
  assert.throws(() => executarWorkbench(slotOcupado), /INVARIANTE_SLOT_OCUPADO/);

  const semConflito = entradas();
  semConflito.casos.casos[1].horario_solicitado = "2026-08-17T16:00:00-04:00";
  assert.throws(() => executarWorkbench(semConflito), /INVARIANTE_CONFLITO_AUSENTE/);
});

test("conflito considera duração mais buffer quando 09:00 invade ocupação 10:00", () => {
  const config = entradas();
  config.operacao.agenda.duracao_min = 50;
  config.operacao.agenda.buffer_min = 20;
  config.operacao.agenda.dias.seg = ["09:00-18:00"];
  config.operacao.operacao.servicos[0].politica_operacional.duracao_min = 50;
  config.operacao.operacao.servicos[0].politica_operacional.buffer_min = 20;
  config.casos.casos[1].horario_solicitado = "2026-08-17T09:00:00-04:00";
  config.casos.casos[1].alternativas_sinteticas = ["2026-08-17T11:20:00-04:00", "2026-08-17T12:30:00-04:00"];
  const conflito = executarWorkbench(config).resultados.find((item) => item.cenario === "conflito");
  assert.equal(conflito.invariantes.conflito_detectado, true);
  assert.equal(conflito.invariantes.conflito_considera_buffer, true);
});

test("reprova horário solicitado, alternativa, dia ou offset fora da operação", () => {
  const solicitadoFora = entradas();
  solicitadoFora.casos.casos[0].horario_solicitado = "2026-08-17T09:00:00-04:00";
  assert.throws(() => executarWorkbench(solicitadoFora), /INVARIANTE_SLOT_FORA_FAIXA/);

  const alternativaFora = entradas();
  alternativaFora.casos.casos[0].alternativas_sinteticas[0] = "2026-08-17T17:10:00-04:00";
  assert.throws(() => executarWorkbench(alternativaFora), /INVARIANTE_SLOT_FORA_FAIXA/);

  const diaInativo = entradas();
  diaInativo.casos.casos[0].horario_solicitado = "2026-08-16T12:00:00-04:00";
  assert.throws(() => executarWorkbench(diaInativo), /INVARIANTE_SLOT_FORA_FAIXA/);

  const offsetErrado = entradas();
  offsetErrado.casos.casos[0].horario_solicitado = "2026-08-17T12:00:00-05:00";
  assert.throws(() => executarWorkbench(offsetErrado), /INVARIANTE_FUSO_DIVERGENTE/);
});

test("reprova timestamp inexistente e normaliza timestamp do relatório", () => {
  assert.throws(() => executarWorkbench({ ...entradas(), timestamp: "2026-02-30T12:00:00-08:00" }), /SCHEMA_TIMESTAMP_INVALIDO/);
  const relatorio = executarWorkbench({ ...entradas(), timestamp: "2026-08-11T12:00:00-07:00" });
  assert.equal(relatorio.timestamp, "2026-08-11T19:00:00.000Z");
});

test("atestação rejeita hash divergente, autoaprovação e ausência de confirmação humana", () => {
  const relatorio = executarWorkbench(entradas());
  const base = { relatorio, hash_atestado: relatorio.hash_relatorio, revisor: "Pessoa Revisora", decisao: "REPROVADO", confirmacao: "REVISAO_HUMANA_CONFIRMADA" };
  assert.throws(() => criarAtestacaoHumana({ ...base, hash_atestado: "0".repeat(64) }), /ATESTACAO_HASH_DIVERGENTE/);
  assert.throws(() => criarAtestacaoHumana({ ...base, revisor: "workbench auto" }), /ATESTACAO_AUTOAPROVACAO_PROIBIDA/);
  assert.throws(() => criarAtestacaoHumana({ ...base, confirmacao: "" }), /ATESTACAO_CONFIRMACAO_HUMANA_AUSENTE/);
  const adulterado = structuredClone(relatorio);
  adulterado.resultados[0].decisao = "ALTERADO";
  assert.throws(() => criarAtestacaoHumana({ ...base, relatorio: adulterado }), /ATESTACAO_RELATORIO_ADULTERADO/);
});

test("atestação feliz registra apenas autodeclaração local não autenticada", () => {
  const relatorio = executarWorkbench(entradas());
  const atestacao = criarAtestacaoHumana({
    relatorio,
    hash_atestado: relatorio.hash_relatorio,
    revisor: "Pessoa Revisora",
    decisao: "REPROVADO",
    confirmacao: "REVISAO_HUMANA_CONFIRMADA",
    timestamp: "2026-08-11T12:30:00-07:00",
  });
  assert.equal(atestacao.natureza, "AUTODECLARACAO_LOCAL_NAO_AUTENTICADA");
  assert.equal(atestacao.decisao, "REPROVADO");
  assert.equal(atestacao.timestamp, "2026-08-11T19:30:00.000Z");
});

test("saída fica confinada, latest pode sobrescrever e novo relatório exige opção explícita", () => {
  const seguro = () => ({ symlink: false, nlink: 1 });
  const latest = resolverSaida([], () => false, seguro);
  assert.match(latest.caminho, /\.shadow-reports\/shadow-workbench-latest\.json$/);
  assert.equal(latest.sobrescrever, true);
  assert.throws(() => resolverSaida(["--saida", "../../fora.json"], () => false, seguro), /SAIDA_FORA_DIRETORIO_PROTEGIDO/);
  assert.throws(() => resolverSaida(["--saida", "/tmp/fora.json"], () => false, seguro), /SAIDA_FORA_DIRETORIO_PROTEGIDO/);
  assert.throws(() => resolverSaida(["--saida", "auditoria-1.json"], () => false, seguro), /NOVO_RELATORIO_EXIGE_FLAG_EXPLICITA/);
  const novo = resolverSaida(["--saida", "auditoria-1.json", "--novo-relatorio"], () => false, seguro);
  assert.equal(novo.sobrescrever, false);
  assert.throws(() => resolverSaida(["--saida", "auditoria-1.json", "--novo-relatorio"], (caminho) => caminho.endsWith("auditoria-1.json"), seguro), /RELATORIO_EXISTENTE_NAO_SOBRESCRITO/);
  assert.throws(() => resolverSaida([], (caminho) => caminho.endsWith("shadow-workbench-latest.json"), () => ({ symlink: false, nlink: 2 })), /SAIDA_HARDLINK_PROIBIDA/);
});
