// Corpus de mensagens do dia a dia de uma clínica brasileira em Massachusetts.
//
// Existe porque a rodada 2 da auditoria mostrou que os meus testes passavam nos MEUS exemplos:
// eu testava "quanto custa a drenagem?" e o detector de idioma escalava "qual o valor do pós?".
// Teste que só cobre o caso que o autor imaginou é conforto, não rede. Este arquivo é a rede:
// mensagens escritas do jeito que chegam, incluindo as 20 que o auditor usou para me derrubar.
//
// Regra do corpus: se um caso novo aparecer na operação, ele entra AQUI antes de virar correção.

import test from "node:test";
import assert from "node:assert/strict";

import { decidir, detectarIdioma, temSinalCorporal } from "../regras.mjs";
import { carregarConfigAndreia, GATE_HOJE } from "../cenarios-andreia.mjs";

const cfg = carregarConfigAndreia();
const AGORA = "2026-08-14T18:00:00.000Z";
const d = (mensagem, contexto = {}) =>
  decidir({ mensagem, operacao: cfg.operacao, agenda: cfg.agenda, clinica: cfg.clinica, contexto: { agora: AGORA, ...contexto }, gate: GATE_HOJE });

const ehAlta = (r) => r.alertas.some((a) => /PRIORIDADE ALTA/.test(a));

// ---------------------------------------------------------------- português comum
// As 9 frases que a rodada 2 escalava como se fossem inglês, por causa de um único token: "do".
const PORTUGUES_COMUM = [
  "qual o valor do pós?",
  "quanto custa o valor do pacote?",
  "o preço do pacote mudou?",
  "depois do casamento eu volto",
  "antes do feriado tem vaga?",
  "o resultado do tratamento demora?",
  "me fala do pós-operatório por favor",
  "é perto do centro?",
  "quanto custa a drenagem?",
  "vocês abrem no sábado?",
  "onde fica a clínica?",
  "aceita cartão?",
  "obrigada, depois eu falo com você",
  "bom dia! tudo bem?",
];

test("corpus — nenhuma mensagem em português comum é escalada por idioma", () => {
  const erradas = PORTUGUES_COMUM.filter((m) => d(m).regra === "IDIOMA.NAO_IDENTIFICADO");
  assert.deepEqual(erradas, [], `escalou por idioma indevidamente: ${JSON.stringify(erradas)}`);
});

test("corpus — e nenhuma delas dispara PRIORIDADE ALTA", () => {
  const erradas = PORTUGUES_COMUM.filter((m) => ehAlta(d(m)));
  assert.deepEqual(erradas, [], `alarme alto indevido: ${JSON.stringify(erradas)}`);
});

// ---------------------------------------------------------------- estrangeiro de verdade
const ESTRANGEIRAS = [
  "I have an appointment tomorrow with you",
  "cuanto cuesta el masaje?",
  "I have diabetes, can I do the massage? how much is it?",
  "I need to cancel my appointment tomorrow",
  "Could you please tell me what time you are open?",
  "quisiera saber el precio del drenaje",
];

test("corpus — mensagem estrangeira continua escalando (a regra dela existe e funciona)", () => {
  for (const m of ESTRANGEIRAS) {
    assert.equal(d(m).regra, "IDIOMA.NAO_IDENTIFICADO", `"${m}" deveria escalar por idioma`);
  }
});

test("corpus — segurança vence idioma: urgência em outro idioma continua PRIORIDADE ALTA", () => {
  for (const m of ["I'm in a lot of pain and bleeding", "tengo mucho dolor", "help me please, I have a fever"]) {
    assert.ok(ehAlta(d(m)), `"${m}" deveria ser PRIORIDADE ALTA`);
  }
});

test("corpus — o detector exige evidência: um token solto não decide idioma", () => {
  // Cada uma tem no máximo um marcador estrangeiro ambíguo — nenhuma pode ser "afirmada".
  for (const m of ["qual o valor do pós?", "é perto do centro?", "depois do casamento eu volto"]) {
    assert.notEqual(detectarIdioma(m), "en", `"${m}" não é inglês`);
  }
});

// ---------------------------------------------------------------- alarme vermelho
// Seis falsos alarmes que a rodada 2 encontrou: cor solta não é sinal clínico.
const COR_SEM_CORPO = [
  "comprei um vestido vermelho pro casamento",
  "pintei o cabelo de roxo",
  "quero o pacote vermelho da promoção",
  "o sofá da recepção é vermelho lindo",
  "comprei uma bolsa roxa",
  "a luz vermelha da máquina acendeu",
  "meu carro é vermelho",
];

test("corpus — cor solta NÃO acende alarme clínico", () => {
  for (const m of COR_SEM_CORPO) {
    assert.equal(temSinalCorporal(m), false, `"${m}" não é sinal clínico`);
    assert.equal(ehAlta(d(m)), false, `"${m}" não pode ser PRIORIDADE ALTA`);
  }
});

test("corpus — sinal com referência ao corpo acende, e sinal forte acende sozinho", () => {
  const devemAcender = [
    ["minha barriga tá muito inchada e vermelha desde ontem", {}],
    ["a perna ficou roxa depois da sessão", {}],
    ["tá saindo secreção do ponto", {}],
    ["fiz lipo e tá com pus", {}],
    ["a cicatriz tá endurecida", {}],
    ["tá saindo um liquido do lugar", { servico: "Pós-operatório" }],
  ];
  for (const [m, ctx] of devemAcender) {
    assert.ok(ehAlta(d(m, ctx)), `"${m}" deveria ser PRIORIDADE ALTA`);
  }
});

test("corpus — o alarme é raro: sobre o corpus inteiro, só o que é clínico acende", () => {
  const todas = [...PORTUGUES_COMUM, ...COR_SEM_CORPO];
  const acesos = todas.filter((m) => ehAlta(d(m)));
  assert.equal(acesos.length, 0, `alarme perdeu a raridade: ${JSON.stringify(acesos)}`);
});

// ---------------------------------------------------------------- intenção
test("corpus — negação não vira pedido de horário, mas pedido explícito sobrevive à negação", () => {
  assert.equal(d("amanhã não vou dar, desculpa").regra, "R3.CANCELAMENTO");
  assert.equal(d("não vou conseguir ir na quinta").regra, "R3.CANCELAMENTO");
  // Este caía no default silencioso: a negação vetava o pedido explícito na mesma frase.
  assert.equal(d("não posso de manhã, tem horário à tarde?").regra, "PEND.2_3_GRADE_HORARIOS");
  assert.equal(d("não dá segunda, tem vaga na quarta?").regra, "PEND.2_3_GRADE_HORARIOS");
});

test("corpus — ruído não vira caso clínico", () => {
  // "câncer" solto era pergunta clínica; "meu signo é câncer" é conversa fiada.
  assert.notEqual(d("meu signo é câncer haha").regra, "R6.DUVIDA_CLINICA");
  // E a condição de verdade continua escalando.
  assert.equal(d("tive câncer de mama, posso fazer drenagem?").regra, "R6.DUVIDA_CLINICA");
});

// ---------------------------------------------------------------- invariantes sobre o corpus
test("corpus — nenhuma mensagem do corpus produz envio automático ou dispensa aprovação", () => {
  for (const m of [...PORTUGUES_COMUM, ...ESTRANGEIRAS, ...COR_SEM_CORPO]) {
    const r = d(m);
    assert.equal(r.requer_aprovacao_humana, true, m);
    assert.equal(r.envio_automatico, false, m);
  }
});

test("corpus — com a grade pendente, nenhuma resposta do corpus oferece horário concreto", () => {
  for (const m of [...PORTUGUES_COMUM, ...COR_SEM_CORPO]) {
    const t = d(m).resposta_sugerida;
    assert.doesNotMatch(t, /\b\d{1,2}\s*(h\b|:\d{2})/, `"${m}" ofereceu horário: ${t}`);
  }
});
