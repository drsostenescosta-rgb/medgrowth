import test from "node:test";
import assert from "node:assert/strict";

import {
  classificarConfirmacao,
  conflitosEm,
  decidir,
  diaDaSemana,
  ehAlegacaoBloqueada,
  ehAmanha,
  ehDuvidaClinica,
  ehIntercorrenciaPosOp,
  ehPedidoDeDesconto,
  renderRepergunta,
} from "../regras.mjs";
import { rodarTodos, GATE_HOJE } from "../cenarios-andreia.mjs";

const OPERACAO = {
  regras: {
    confirmacao: {
      aceitos: ["sim", "confirmo", "confirmado"],
      nao_aceitos: ["ta bom", "ok", "blz"],
      repergunta_padrao: "So para confirmar direitinho: posso considerar confirmado seu horario de [servico], amanha as [hora]? Responde sim ou nao, por favor",
    },
    cancelamento: { antecedencia_minima_horas: 24 },
    conteudo_bloqueado: [{ descricao_aprovada: "O EMSzero é uma máquina de tonificação muscular." }],
  },
  servicos: [
    { nome_publico: "Drenagem linfática", preco_usd: 60, politica_operacional: { duracao_min: 50, buffer_min: 10 } },
  ],
};
const AGENDA = { fuso_horario: "America/New_York", duracao_min: 50, buffer_min: 10 };
const AGORA = "2026-08-14T18:00:00.000Z";

function d(mensagem, contexto = {}, gate = GATE_HOJE) {
  return decidir({ mensagem, operacao: OPERACAO, agenda: AGENDA, contexto: { agora: AGORA, ...contexto }, gate });
}

// ---------------------------------------------------------------- os cinco cenários da missão
test("os cinco cenários críticos da Andreia decidem como esperado, sem PII", () => {
  const r = rodarTodos();
  for (const item of r.resultados) {
    assert.equal(item.ok, true, `${item.id} falhou: ${item.falhas.join(" | ")}`);
  }
  assert.equal(r.aprovados, 5);
  assert.deepEqual(r.pii_achados, [], "a fixture dos cenários não pode conter PII");
  assert.equal(r.veredito, "APTO_PARA_REVISAO_HUMANA");
});

// ---------------------------------------------------------------- invariantes da Fase 1
test("nenhuma decisão possível dispensa aprovação humana ou libera envio automático", () => {
  const mensagens = [
    "quanto custa a drenagem?", "tá bom", "quero cancelar", "tenho muita dor", "me dá um desconto",
    "quero marcar amanhã", "o emszero queima quantas calorias?", "parar", "", "asdkjhasd",
    "quero falar com a Andreia", "estou atrasada", "tem lista de espera?",
  ];
  for (const m of mensagens) {
    const r = d(m, { aguardando_confirmacao: false });
    assert.equal(r.requer_aprovacao_humana, true, `"${m}" dispensou aprovação`);
    assert.equal(r.envio_automatico, false, `"${m}" liberou envio automático`);
    assert.equal(r.tom_validado, false, `"${m}" marcou tom como validado com a pendência 6.5 aberta`);
  }
});

test("mensagem desconhecida escala em vez de improvisar (regra 8, fail-closed)", () => {
  const r = d("xyzzy plugh 42");
  assert.equal(r.acao, "escalar");
  assert.equal(r.regra, "R8.NAO_SABE");
  assert.ok(r.bloqueios.includes("não inventar resposta"));
});

// ---------------------------------------------------------------- regra 1: confirmação
test('"tá bom", emoji e silêncio não confirmam; só "sim"/"confirmo" confirmam', () => {
  for (const ambigua of ["tá bom", "ok", "blz", "👍", "  ", "beleza então"]) {
    assert.equal(
      d(ambigua, { aguardando_confirmacao: true, servico: "Drenagem linfática" }).acao,
      "reperguntar_confirmacao",
      `"${ambigua}" não deveria confirmar`,
    );
  }
  const sim = d("sim", { aguardando_confirmacao: true, servico: "Drenagem linfática", horario_alvo: "2026-08-19T18:00:00.000Z" });
  assert.equal(sim.acao, "responder");
  assert.equal(sim.regra, "R1.CONFIRMACAO_EXPLICITA");
  assert.equal(sim.acao_agenda.tipo, "marcar");
});

test('"simplesmente não posso" não é confundido com "sim"', () => {
  assert.equal(classificarConfirmacao("simplesmente não posso", OPERACAO), "nenhuma");
  assert.equal(classificarConfirmacao("sim", OPERACAO), "explicita");
  assert.equal(classificarConfirmacao("okinawa", OPERACAO), "nenhuma");
});

test("confirmação explícita NÃO vence conflito de agenda (regra 2 acima da regra 1)", () => {
  const r = d("sim, confirmo", {
    aguardando_confirmacao: true,
    horario_alvo: "2026-08-20T18:00:00.000Z",
    ocupacoes: [{ inicio: "2026-08-20T18:30:00.000Z", fim: "2026-08-20T19:30:00.000Z" }],
  });
  assert.equal(r.acao, "bloquear");
  assert.equal(r.regra, "R2.CONFLITO");
  assert.equal(r.acao_agenda.tipo, "bloqueada_por_conflito");
  assert.ok(r.bloqueios.includes("não criar dupla marcação"));
});

// ---------------------------------------------------------------- a correção do "amanhã"
test("a repergunta da Andreia mantém 'amanhã' só quando é mesmo amanhã", () => {
  const tpl = OPERACAO.regras.confirmacao.repergunta_padrao;
  const amanha = renderRepergunta(tpl, { agora: AGORA, horario_alvo: "2026-08-15T18:00:00.000Z", servico: "Drenagem linfática" });
  assert.match(amanha, /amanha as 2 da tarde/);

  const outroDia = renderRepergunta(tpl, { agora: AGORA, horario_alvo: "2026-08-19T18:00:00.000Z", servico: "Drenagem linfática" });
  assert.match(outroDia, /quarta, 2 da tarde/);
  assert.doesNotMatch(outroDia, /amanh/i, "não pode dizer 'amanhã' para um horário que não é amanhã");

  // E em nenhum dos dois o nome longo do serviço aparece.
  for (const t of [amanha, outroDia]) {
    assert.match(t, /de drenagem,/);
    assert.doesNotMatch(t, /linf[áa]tica/i);
  }
});

test("ehAmanha respeita o fuso da clínica, não o do servidor", () => {
  // 2026-08-15T02:00Z ainda é 14/08 às 22:00 em New York → NÃO é amanhã em relação a 14/08.
  assert.equal(ehAmanha(AGORA, "2026-08-15T02:00:00.000Z", "America/New_York"), false);
  assert.equal(ehAmanha(AGORA, "2026-08-15T18:00:00.000Z", "America/New_York"), true);
});

// ---------------------------------------------------------------- regra 5: sexta/sábado
test("cancelamento tardio em sexta e sábado exige a Andreia antes de remarcar", () => {
  const sexta = d("preciso remarcar", { horario_alvo: "2026-08-14T21:00:00.000Z" });
  assert.equal(sexta.regra, "R5.CANCELAMENTO_TARDIO_SEX_SAB");
  assert.equal(sexta.acao_agenda.tipo, "nenhuma");
  assert.ok(sexta.bloqueios.includes("não liberar a vaga"));

  const sabado = d("preciso remarcar", { horario_alvo: "2026-08-15T16:00:00.000Z" });
  assert.equal(sabado.regra, "R5.CANCELAMENTO_TARDIO_SEX_SAB");

  // Quarta que vem, com folga: continua escalando (regra 3), mas não é o caso premium.
  const quarta = d("preciso remarcar", { horario_alvo: "2026-08-19T18:00:00.000Z" });
  assert.equal(quarta.regra, "R3.CANCELAMENTO");
});

test("diaDaSemana usa o fuso da clínica", () => {
  assert.equal(diaDaSemana("2026-08-14T21:00:00.000Z", "America/New_York"), "sex");
  assert.equal(diaDaSemana("2026-08-15T16:00:00.000Z", "America/New_York"), "sab");
  // 15/08 às 02:00Z = 14/08 às 22:00 em NY: ainda sexta.
  assert.equal(diaDaSemana("2026-08-15T02:00:00.000Z", "America/New_York"), "sex");
});

// ---------------------------------------------------------------- regra 9: alegação bloqueada
test("a alegação de calorias do EMSzero permanece bloqueada e só sai a descrição aprovada", () => {
  const r = d("é verdade que o emszero queima 1000 calorias?");
  assert.equal(r.regra, "R9.ALEGACAO_BLOQUEADA");
  assert.doesNotMatch(r.resposta_sugerida, /\d{3,}/, "nenhum número de calorias pode aparecer");
  assert.match(r.resposta_sugerida, /tonificação muscular/);
  assert.ok(r.bloqueios.includes("proibido citar calorias"));
  assert.equal(ehAlegacaoBloqueada("emszero equivale a quantos abdominais?"), true);
  assert.equal(ehAlegacaoBloqueada("o emszero dói?"), false, "pergunta neutra sobre o aparelho não é alegação");
});

// ---------------------------------------------------------------- comercial
test("pacote 10x9 é benefício autorizado; qualquer outro desconto escala", () => {
  assert.equal(ehPedidoDeDesconto("tem desconto?"), true);
  assert.equal(ehPedidoDeDesconto("como funciona o pacote de 10 sessões?"), false);
  assert.equal(d("consegue fazer mais barato?").regra, "COM.DESCONTO");
});

test("preço responde só com o catálogo autorizado e lembra da avaliação", () => {
  const r = d("quanto custa a drenagem?");
  assert.equal(r.regra, "COM.PRECO_CATALOGO");
  assert.match(r.resposta_sugerida, /US\$ 60/);
  assert.match(r.resposta_sugerida, /avaliação/i);
  assert.ok(r.bloqueios.includes("nenhum valor fora do catálogo"));
});

// ---------------------------------------------------------------- clínico e pós-op
test("intercorrência de pós-operatório escala com prioridade alta", () => {
  const r = d("fiz lipo semana passada e tá saindo secreção do ponto");
  assert.equal(r.regra, "R6.INTERCORRENCIA_POS_OP");
  assert.ok(r.alertas.some((a) => /PRIORIDADE ALTA/.test(a)));
  assert.equal(ehIntercorrenciaPosOp("tá inchado", { pos_operatorio: true }), true);
  assert.equal(ehIntercorrenciaPosOp("tá inchado", {}), false, "sinal sem contexto de pós-op não basta");
});

test("dúvida mista flacidez × gordura é clínica, não comercial", () => {
  assert.equal(ehDuvidaClinica("é flacidez ou gordura?"), true);
  assert.equal(ehDuvidaClinica("tenho flacidez na barriga e gordura no braço, o que faço?"), true);
  assert.equal(ehDuvidaClinica("vocês tratam flacidez?"), false, "pergunta sobre o serviço não é indicação individualizada");
});

// ---------------------------------------------------------------- pendências abertas
test("com a grade PENDENTE a Emily nunca oferece horário", () => {
  for (const m of ["quero marcar", "tem horário quinta?", "dá pra hoje?", "quero agendar amanhã"]) {
    const r = d(m);
    assert.equal(r.regra, "PEND.2_3_GRADE_HORARIOS", `"${m}" deveria cair na pendência da grade`);
    assert.doesNotMatch(r.resposta_sugerida, /\b\d{1,2}\s*(h\b|:\d{2})/, `"${m}" ofereceu horário concreto`);
  }
});

test("com a grade CONFIRMADA a Emily passa a propor horário", () => {
  const r = d("quero marcar", {}, { ...GATE_HOJE, grade_definida: true });
  assert.equal(r.regra, "AGENDA.PROPOR_HORARIO");
  assert.equal(r.acao_agenda.tipo, "propor_horario");
});

test("sinal e lista de espera não são prometidos enquanto a regra 4.6 está pendente", () => {
  const r = d("precisa pagar sinal pra reservar?");
  assert.equal(r.regra, "PEND.4_6_SINAL_LISTA_ESPERA");
  assert.ok(r.bloqueios.includes("não mencionar valor de sinal"));
});

// ---------------------------------------------------------------- conflito puro
test("conflito considera duração + buffer; encostado não conflita", () => {
  const ocupacoes = [{ inicio: "2026-08-20T18:00:00.000Z", fim: "2026-08-20T19:00:00.000Z" }];
  // 17:00 + 50min + 10min buffer = 18:00 exato → encosta, não sobrepõe.
  assert.equal(conflitosEm({ inicio: "2026-08-20T17:00:00.000Z", duracaoMin: 50, bufferMin: 10, ocupacoes }).length, 0);
  // 17:10 + 60 = 18:10 → invade.
  assert.equal(conflitosEm({ inicio: "2026-08-20T17:10:00.000Z", duracaoMin: 50, bufferMin: 10, ocupacoes }).length, 1);
});

// ---------------------------------------------------------------- LGPD
test("opt-out tem precedência e não faz contraproposta", () => {
  const r = d("PARAR");
  assert.equal(r.regra, "LGPD.OPT_OUT");
  assert.ok(r.bloqueios.includes("nenhuma cadência futura"));
  assert.doesNotMatch(r.resposta_sugerida, /promo|desconto|oferta/i);
});

test("a Emily nunca finge ser a Andreia", () => {
  const r = d("você é robô ou é a Andreia mesmo?");
  assert.equal(r.regra, "R6.PESSOAL");
  assert.ok(r.bloqueios.includes("a Emily nunca finge ser a Andreia"));
});
