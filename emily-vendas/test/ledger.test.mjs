import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GENESIS,
  canonico,
  diffTexto,
  estatisticas,
  fila,
  historico,
  novaProposta,
  registrar,
  registrarAcaoAgenda,
  registrarDecisao,
  verificarCadeia,
} from "../ledger.mjs";

function arquivoTemp() {
  return join(mkdtempSync(join(tmpdir(), "ledger-")), "aprovacoes.jsonl");
}

const DECISAO_MOTOR = {
  acao: "reperguntar_confirmacao",
  regra: "R1.CONFIRMACAO_AMBIGUA",
  resposta_sugerida: "Só para confirmar: posso considerar confirmado?",
  acao_agenda: { tipo: "nenhuma" },
  bloqueios: ["não marcar como confirmado"],
};

test("canônico ordena chaves — mesmo conteúdo, mesmo hash", () => {
  assert.equal(canonico({ b: 1, a: 2 }), canonico({ a: 2, b: 1 }));
  assert.notEqual(canonico({ a: 1 }), canonico({ a: 2 }));
});

test("chave com undefined é tratada como ausente, igual ao JSON.stringify", () => {
  // Regressão real: um payload com `frescor_min: undefined` era hasheado com a chave e
  // gravado sem ela, e a releitura acusava a cadeia como quebrada sem ninguém ter mexido.
  assert.equal(canonico({ a: 1, b: undefined }), canonico({ a: 1 }));
  assert.equal(canonico({ a: 1, b: undefined }), JSON.stringify(JSON.parse(JSON.stringify({ a: 1, b: undefined }))));
  assert.equal(canonico([1, undefined, 2]), "[1,null,2]");
});

test("payload com undefined sobrevive à ida e volta pelo arquivo", () => {
  const arq = arquivoTemp();
  novaProposta({
    canal: "whatsapp",
    alias: "Cliente Demo 15",
    mensagem: "oi",
    decisao_motor: { ...DECISAO_MOTOR, origem_ocupacoes: { fonte: "indisponivel", motivo: "sem espelho", frescor_min: undefined } },
    arquivo: arq,
  });
  const r = verificarCadeia(arq);
  assert.equal(r.ok, true, `cadeia deveria estar íntegra: ${JSON.stringify(r.quebras)}`);
});

test("cadeia nasce no genesis e cresce íntegra", () => {
  const arq = arquivoTemp();
  const id = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 01", mensagem: "tá bom", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id, decisao: "aprovada", aprovador: "Sostenes", texto_original: "a", texto_final: "a", arquivo: arq });

  const r = verificarCadeia(arq);
  assert.equal(r.ok, true, JSON.stringify(r.quebras));
  assert.equal(r.total, 2);

  const linhas = readFileSync(arq, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(linhas[0].hash_anterior, GENESIS);
  assert.equal(linhas[1].hash_anterior, linhas[0].hash);
});

test("editar uma linha do meio quebra a cadeia e é detectado", () => {
  const arq = arquivoTemp();
  const id = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 02", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id, decisao: "aprovada", aprovador: "Sostenes", texto_original: "a", texto_final: "a", arquivo: arq });
  assert.equal(verificarCadeia(arq).ok, true);

  // Alguém troca o texto aprovado direto no arquivo, mantendo o hash antigo.
  const linhas = readFileSync(arq, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  linhas[1].payload.texto_final = "texto adulterado";
  writeFileSync(arq, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const r = verificarCadeia(arq);
  assert.equal(r.ok, false);
  assert.ok(r.quebras.some((q) => q.campo === "hash"), "a adulteração precisa aparecer como hash divergente");
});

test("apagar uma linha do meio também quebra a cadeia", () => {
  const arq = arquivoTemp();
  const a = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 03", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id: a, decisao: "aprovada", aprovador: "Sostenes", texto_original: "x", texto_final: "x", arquivo: arq });
  novaProposta({ canal: "whatsapp", alias: "Cliente Demo 04", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });

  const linhas = readFileSync(arq, "utf8").trim().split("\n");
  writeFileSync(arq, [linhas[0], linhas[2]].join("\n") + "\n");
  assert.equal(verificarCadeia(arq).ok, false);
});

test("decisão exige aprovador nomeado — decisão anônima é recusada", () => {
  const arq = arquivoTemp();
  const id = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 05", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  assert.throws(() => registrarDecisao({ id, decisao: "aprovada", aprovador: "", texto_original: "a", texto_final: "a", arquivo: arq }), /aprovador obrigatório/);
  assert.throws(() => registrarDecisao({ id, decisao: "inventada", aprovador: "Sostenes", texto_original: "a", texto_final: "a", arquivo: arq }), /decisão inválida/);
});

test("a mesma proposta não pode ser decidida duas vezes", () => {
  const arq = arquivoTemp();
  const id = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 06", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id, decisao: "aprovada", aprovador: "Sostenes", texto_original: "a", texto_final: "a", arquivo: arq });
  assert.throws(
    () => registrarDecisao({ id, decisao: "escalada", aprovador: "Andreia", texto_original: "a", texto_final: "a", arquivo: arq }),
    /não está pendente/,
  );
});

test("a fila mostra só o que ainda não foi decidido, em ordem", () => {
  const arq = arquivoTemp();
  const a = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 07", mensagem: "um", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  const b = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 08", mensagem: "dois", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  assert.deepEqual(fila(arq).map((p) => p.id), [a, b]);
  registrarDecisao({ id: a, decisao: "aprovada", aprovador: "Sostenes", texto_original: "x", texto_final: "x", arquivo: arq });
  assert.deepEqual(fila(arq).map((p) => p.id), [b]);
});

test("o ledger registra o que foi editado, não só que foi editado", () => {
  const arq = arquivoTemp();
  const id = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 09", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id, decisao: "editada", aprovador: "Andreia", texto_original: "rascunho da Emily", texto_final: "texto que a Andreia escreveu", arquivo: arq });

  const h = historico(arq).find((x) => x.id === id);
  const dec = h.eventos.find((e) => e.tipo === "decisao_humana");
  assert.equal(dec.diff.alterado, true);
  assert.equal(dec.diff.texto_antes, "rascunho da Emily");
  assert.equal(dec.diff.texto_depois, "texto que a Andreia escreveu");
  assert.equal(dec.envio_automatico, false, "nem aprovada a mensagem é enviada sozinha na Fase 1");
});

test("diffTexto não marca alteração quando o texto saiu igual", () => {
  assert.equal(diffTexto("igual", "igual").alterado, false);
  assert.equal(diffTexto("a", "b").alterado, true);
});

test("aprovar sem mandar texto_final é aprovação LIMPA, não edição", () => {
  // Regressão real: o painel aprova sem reenviar o texto quando nada mudou. Contar isso como
  // edição faria a taxa de aprovação sem edição (a métrica do piloto) mentir para baixo.
  const arq = arquivoTemp();
  const a = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 16", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id: a, decisao: "aprovada", aprovador: "Andreia", texto_original: "rascunho da Emily", arquivo: arq });

  const dec = historico(arq)[0].eventos.find((e) => e.tipo === "decisao_humana");
  assert.equal(dec.diff.alterado, false);
  assert.equal(dec.texto_final, "rascunho da Emily");
  assert.equal(estatisticas(arq).taxa_aprovacao_sem_edicao, 1);
});

test("descarte não conta como edição", () => {
  const arq = arquivoTemp();
  const a = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 17", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id: a, decisao: "descartada", aprovador: "Sostenes", texto_original: "rascunho", arquivo: arq });
  const dec = historico(arq)[0].eventos.find((e) => e.tipo === "decisao_humana");
  assert.equal(dec.diff.alterado, false);
  assert.equal(dec.texto_final, "");
  assert.equal(estatisticas(arq).editadas, 0);
});

test("no modo sintético o ledger recusa PII em vez de gravar", () => {
  const arq = arquivoTemp();
  assert.throws(
    () => novaProposta({ canal: "whatsapp", alias: "Cliente Demo 10", mensagem: "meu email é maria@exemplo.com", decisao_motor: DECISAO_MOTOR, arquivo: arq, modoSintetico: true }),
    /DADOS_SENSIVEIS_REPROVADOS/,
  );
  assert.throws(
    () => novaProposta({ canal: "whatsapp", alias: "Cliente Demo 11", mensagem: "me liga no 617 555-0100", decisao_motor: DECISAO_MOTOR, arquivo: arq, modoSintetico: true }),
    /DADOS_SENSIVEIS_REPROVADOS/,
  );
  assert.equal(verificarCadeia(arq).total, 0, "nada pode ter sido gravado nas tentativas recusadas");
});

test("estatísticas contam aprovação sem edição — a métrica que diz se a Emily está boa", () => {
  const arq = arquivoTemp();
  const a = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 12", mensagem: "um", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  const b = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 13", mensagem: "dois", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id: a, decisao: "aprovada", aprovador: "Sostenes", texto_original: "x", texto_final: "x", arquivo: arq });
  registrarDecisao({ id: b, decisao: "editada", aprovador: "Sostenes", texto_original: "x", texto_final: "y", arquivo: arq });

  const s = estatisticas(arq);
  assert.equal(s.propostas, 2);
  assert.equal(s.decididas, 2);
  assert.equal(s.pendentes, 0);
  assert.equal(s.editadas, 1);
  assert.equal(s.taxa_aprovacao_sem_edicao, 0.5);
  assert.deepEqual(s.aprovadores, ["Sostenes"]);
  assert.equal(s.cadeia.ok, true);
});

test("ação de agenda bloqueada fica registrada como bloqueada", () => {
  const arq = arquivoTemp();
  const id = novaProposta({ canal: "whatsapp", alias: "Cliente Demo 14", mensagem: "oi", decisao_motor: DECISAO_MOTOR, arquivo: arq });
  registrarDecisao({ id, decisao: "aprovada", aprovador: "Sostenes", texto_original: "x", texto_final: "x", arquivo: arq });
  registrarAcaoAgenda({ id, resultado: "bloqueada", detalhe: { motivo: "preflight reprovado" }, arquivo: arq });
  const h = historico(arq).find((x) => x.id === id);
  assert.ok(h.eventos.some((e) => e.tipo === "acao_agenda" && e.resultado === "bloqueada"));
  assert.equal(verificarCadeia(arq).ok, true);
});

test("tipo de evento desconhecido é recusado", () => {
  const arq = arquivoTemp();
  assert.throws(() => registrar({ tipo: "qualquer_coisa", payload: {}, arquivo: arq }), /tipo de evento desconhecido/);
});
