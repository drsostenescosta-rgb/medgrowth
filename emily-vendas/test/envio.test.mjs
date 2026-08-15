import test from "node:test";
import assert from "node:assert/strict";

import {
  ACOES_AUTOENVIAVEIS,
  LIMITE_POR_CONTATO_HORA,
  chaveConteudo,
  despacharResposta,
  jaProcessado,
  podeAutoenviar,
  verificarRepeticao,
} from "../envio.mjs";

const GATE_OK = { preflight_aprovado: true, tom_validado: true };
const CFG_LIGADO = { envio_automatico: true, token: "t", phone_number_id: "1" };
const TEL = "15551234567";
const AGORA = new Date("2026-08-15T18:00:00.000Z");

function decisao(acao, extra = {}) {
  return { acao, regra: "X", resposta_sugerida: "oi, tudo bem?", alertas: [], ...extra };
}

function fetchFalso(resultado = { ok: true, status: 200, corpo: { messages: [{ id: "wamid.ABC" }] } }) {
  const chamadas = [];
  const impl = async (url, opcoes) => {
    chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
    return { ok: resultado.ok, status: resultado.status, json: async () => resultado.corpo };
  };
  impl.chamadas = chamadas;
  return impl;
}

// ---------------------------------------------------------------- a linha do que envia sozinho
test("só regra que RESPONDE envia sozinha; o que escala continua indo para a Andreia", () => {
  for (const acao of ACOES_AUTOENVIAVEIS) {
    assert.equal(podeAutoenviar({ decisao: decisao(acao), gate: GATE_OK, config: CFG_LIGADO }).ok, true);
  }
  for (const acao of ["escalar", "bloquear"]) {
    const r = podeAutoenviar({ decisao: decisao(acao), gate: GATE_OK, config: CFG_LIGADO });
    assert.equal(r.ok, false, `"${acao}" não pode sair sozinho`);
    assert.match(r.motivo, /decisão da Andreia/);
  }
});

test("decisão com alerta nunca sai sozinha — alerta existe para o humano olhar", () => {
  const r = podeAutoenviar({
    decisao: decisao("responder", { alertas: ["Horários vêm da grade — CONFIRA no Agendor"] }),
    gate: GATE_OK,
    config: CFG_LIGADO,
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /alerta/);
});

test("preflight reprovado e tom não validado travam o envio automático", () => {
  const semPreflight = podeAutoenviar({ decisao: decisao("responder"), gate: { preflight_aprovado: false, tom_validado: true }, config: CFG_LIGADO });
  assert.equal(semPreflight.ok, false);
  assert.match(semPreflight.motivo, /fail-closed/);

  const semTom = podeAutoenviar({ decisao: decisao("responder"), gate: { preflight_aprovado: true, tom_validado: false }, config: CFG_LIGADO });
  assert.equal(semTom.ok, false);
  assert.match(semTom.motivo, /6\.5/);
});

test("com a chave desligada nada sai, mesmo com tudo o resto aprovado", () => {
  const r = podeAutoenviar({ decisao: decisao("responder"), gate: GATE_OK, config: { envio_automatico: false } });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------- a dor #5, agora automática
test("mesma mensagem recebida não é processada duas vezes (a Meta REENVIA webhook)", () => {
  assert.equal(jaProcessado("wamid.A", ["wamid.A", "wamid.B"]), true);
  assert.equal(jaProcessado("wamid.C", ["wamid.A"]), false);
  assert.equal(jaProcessado(null, ["wamid.A"]), false);
});

test("texto idêntico para o mesmo contato não sai duas vezes na janela", () => {
  const texto = "Oi! Tenho quarta, 2 da tarde. Serve?";
  const historico = [{ telefone: TEL, chave_conteudo: chaveConteudo(TEL, texto), ts: "2026-08-15T17:30:00.000Z" }];
  const r = verificarRepeticao({ telefone: TEL, texto, historico, agora: AGORA });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /idêntico/);
});

test("a repetição olha o conteúdo, não a formatação: espaço e caixa não driblam a trava", () => {
  const a = "Oi!  Tenho quarta,   2 da tarde. Serve?";
  const b = "oi! tenho quarta, 2 da tarde. serve?";
  assert.equal(chaveConteudo(TEL, a), chaveConteudo(TEL, b));
});

test("a trava é por contato: o mesmo texto para OUTRA cliente continua podendo sair", () => {
  const texto = "Oi! Tenho quarta, 2 da tarde. Serve?";
  const historico = [{ telefone: TEL, chave_conteudo: chaveConteudo(TEL, texto), ts: "2026-08-15T17:30:00.000Z" }];
  const r = verificarRepeticao({ telefone: "15559999999", texto, historico, agora: AGORA });
  assert.equal(r.ok, true, "resposta padrão para clientes diferentes não é repetição");
});

test("teto por contato transforma bug em silêncio, não em enxurrada", () => {
  const historico = Array.from({ length: LIMITE_POR_CONTATO_HORA }, (_, i) => ({
    telefone: TEL,
    chave_conteudo: `outro-${i}`,
    ts: new Date(AGORA.getTime() - (i + 1) * 60_000).toISOString(),
  }));
  const r = verificarRepeticao({ telefone: TEL, texto: "mensagem nova e diferente", historico, agora: AGORA });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /teto de/);
});

test("passada a janela, a mesma mensagem pode voltar a sair", () => {
  const texto = "Oi! Tenho quarta, 2 da tarde. Serve?";
  const historico = [{ telefone: TEL, chave_conteudo: chaveConteudo(TEL, texto), ts: "2026-08-15T10:00:00.000Z" }];
  assert.equal(verificarRepeticao({ telefone: TEL, texto, historico, agora: AGORA }).ok, true);
});

// ---------------------------------------------------------------- o caminho inteiro
test("despacho feliz chama a Meta uma vez e devolve o wamid", async () => {
  const f = fetchFalso();
  const r = await despacharResposta({ decisao: decisao("responder"), telefone: TEL, gate: GATE_OK, config: CFG_LIGADO, fetchImpl: f, agora: AGORA });
  assert.equal(r.enviado, true);
  assert.equal(r.wamid, "wamid.ABC");
  assert.equal(f.chamadas.length, 1);
  assert.equal(f.chamadas[0].corpo.to, TEL);
  assert.equal(f.chamadas[0].corpo.text.body, "oi, tudo bem?");
});

test("escalada NÃO chega a chamar a Meta — a trava é antes da rede", async () => {
  const f = fetchFalso();
  const r = await despacharResposta({ decisao: decisao("escalar"), telefone: TEL, gate: GATE_OK, config: CFG_LIGADO, fetchImpl: f, agora: AGORA });
  assert.equal(r.enviado, false);
  assert.equal(r.etapa, "politica");
  assert.equal(f.chamadas.length, 0, "nem uma chamada de rede para o que é da Andreia");
});

test("Meta recusando não vira sucesso silencioso", async () => {
  const f = fetchFalso({ ok: false, status: 401, corpo: { error: { message: "token expirado" } } });
  const r = await despacharResposta({ decisao: decisao("responder"), telefone: TEL, gate: GATE_OK, config: CFG_LIGADO, fetchImpl: f, agora: AGORA });
  assert.equal(r.enviado, false);
  assert.equal(r.etapa, "meta");
  assert.match(r.motivo, /token expirado/);
});

test("rede caindo devolve motivo, não exceção solta no meio do webhook", async () => {
  const explode = async () => { throw new Error("ECONNRESET"); };
  const r = await despacharResposta({ decisao: decisao("responder"), telefone: TEL, gate: GATE_OK, config: CFG_LIGADO, fetchImpl: explode, agora: AGORA });
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /ECONNRESET/);
});

test("resposta vazia não vira mensagem em branco na cliente", async () => {
  const f = fetchFalso();
  const r = await despacharResposta({ decisao: decisao("responder", { resposta_sugerida: "   " }), telefone: TEL, gate: GATE_OK, config: CFG_LIGADO, fetchImpl: f, agora: AGORA });
  assert.equal(r.enviado, false);
  assert.equal(f.chamadas.length, 0);
});
