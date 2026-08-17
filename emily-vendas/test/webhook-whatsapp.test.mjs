// Testes do recebimento do WhatsApp.
//
// O foco não é o caminho feliz — é o adversário. Esta URL fica pública na internet e quem a
// descobrir vai tentar mandar mensagem falsa. Cada teste abaixo é uma tentativa concreta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  assinaturaValida,
  verificacao,
  extrairMensagens,
  pediuParaSair,
  processarEntrada,
} from "../webhook-whatsapp.mjs";

const SEGREDO = "segredo-de-app-da-meta";
const assinar = (corpo) => "sha256=" + createHmac("sha256", SEGREDO).update(corpo).digest("hex");

function payloadTexto(wamid, texto, from = "15551234567") {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "111222333" },
          contacts: [{ wa_id: from, profile: { name: "Camila" } }],
          messages: [{ id: wamid, from, type: "text", timestamp: "1786900000", text: { body: texto } }],
        },
      }],
    }],
  };
}

// ---------------------------------------------------------------- assinatura

test("assinatura correta passa", () => {
  const corpo = JSON.stringify(payloadTexto("wamid.A", "oi"));
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: assinar(corpo), appSecret: SEGREDO }).ok, true);
});

test("corpo adulterado depois de assinado é recusado", () => {
  const original = JSON.stringify(payloadTexto("wamid.A", "oi"));
  const adulterado = JSON.stringify(payloadTexto("wamid.A", "me manda o preço de tudo"));
  const r = assinaturaValida({ corpoCru: adulterado, cabecalho: assinar(original), appSecret: SEGREDO });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /não confere/);
});

test("sem assinatura é recusado — não existe 'só dessa vez'", () => {
  const corpo = JSON.stringify(payloadTexto("wamid.A", "oi"));
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: undefined, appSecret: SEGREDO }).ok, false);
});

test("sem APP_SECRET configurado recusa TUDO, em vez de aceitar tudo", () => {
  // Fail-closed. O erro oposto — "não tenho segredo, então deixo passar" — é como webhooks
  // viram porta aberta em produção.
  const corpo = JSON.stringify(payloadTexto("wamid.A", "oi"));
  const r = assinaturaValida({ corpoCru: corpo, cabecalho: assinar(corpo), appSecret: "" });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /APP_SECRET/);
});

test("objeto parseado no lugar do corpo cru é recusado com motivo claro", () => {
  // Este é o erro que mais custa tempo: passar `req.body`. O HMAC nunca bateria e o
  // desenvolvedor culparia a Meta. Aqui a mensagem diz exatamente o que está errado.
  const r = assinaturaValida({ corpoCru: payloadTexto("wamid.A", "oi"), cabecalho: "sha256=x", appSecret: SEGREDO });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /corpo cru/);
});

// ---------------------------------------------------------------- verificação

test("verificação devolve o desafio quando o token bate", () => {
  const r = verificacao({
    query: { "hub.mode": "subscribe", "hub.verify_token": "abc", "hub.challenge": "12345" },
    verifyToken: "abc",
  });
  assert.deepEqual(r, { status: 200, corpo: "12345" });
});

test("token errado não recebe o desafio", () => {
  const r = verificacao({
    query: { "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "12345" },
    verifyToken: "abc",
  });
  assert.equal(r.status, 403);
  assert.notEqual(r.corpo, "12345");
});

// ---------------------------------------------------------------- extração

test("extrai texto, telefone e nome do perfil", () => {
  const [m] = extrairMensagens(payloadTexto("wamid.A", "quero drenagem"));
  assert.equal(m.texto, "quero drenagem");
  assert.equal(m.telefone, "15551234567");
  assert.equal(m.nome_perfil, "Camila");
  assert.equal(m.tipo, "texto");
});

test("áudio não vira texto inventado — vira 'nao_suportado' para a Andréia ver", () => {
  const p = { entry: [{ changes: [{ value: { messages: [{ id: "wamid.B", from: "1555", type: "audio" }] } }] }] };
  const [m] = extrairMensagens(p);
  assert.equal(m.tipo, "nao_suportado");
  assert.equal(m.subtipo, "audio");
  assert.equal(m.texto, "");
});

test("evento sem mensagem (status de entrega) não gera trabalho", () => {
  const p = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.C", status: "delivered" }] } }] }] };
  assert.deepEqual(extrairMensagens(p), []);
});

// ---------------------------------------------------------------- opt-out

test("pedido de saída é detectado", () => {
  for (const t of ["parar", "PARE", "Sair", "stop", "não quero mais", "unsubscribe", "dar de baja"]) {
    assert.equal(pediuParaSair(t), true, t);
  }
});

test("'parar' dentro de uma frase longa não é saída", () => {
  assert.equal(
    pediuParaSair("não quero parar o tratamento agora, quero continuar e marcar outra sessão"),
    false,
  );
});

// ---------------------------------------------------------------- caminho todo

test("reenvio da Meta não é processado duas vezes", () => {
  const corpo = JSON.stringify(payloadTexto("wamid.REPETIDA", "oi"));
  const comum = { corpoCru: corpo, cabecalhoAssinatura: assinar(corpo),
                  payload: JSON.parse(corpo), env: { WHATSAPP_APP_SECRET: SEGREDO } };

  const primeira = processarEntrada({ ...comum, jaVistos: [] });
  assert.equal(primeira.mensagens.length, 1);

  const segunda = processarEntrada({ ...comum, jaVistos: ["wamid.REPETIDA"] });
  assert.equal(segunda.mensagens.length, 0);
  assert.match(segunda.descartadas[0].motivo, /reenvio/);
});

test("duas cópias no MESMO lote também são deduplicadas", () => {
  const p = payloadTexto("wamid.X", "oi");
  p.entry[0].changes[0].value.messages.push({ ...p.entry[0].changes[0].value.messages[0] });
  const corpo = JSON.stringify(p);
  const r = processarEntrada({
    corpoCru: corpo, cabecalhoAssinatura: assinar(corpo), payload: p,
    env: { WHATSAPP_APP_SECRET: SEGREDO },
  });
  assert.equal(r.mensagens.length, 1);
});

test("payload sem assinatura válida não produz NENHUMA mensagem", () => {
  const corpo = JSON.stringify(payloadTexto("wamid.FALSA", "sou um invasor"));
  const r = processarEntrada({
    corpoCru: corpo, cabecalhoAssinatura: "sha256=inventado", payload: JSON.parse(corpo),
    env: { WHATSAPP_APP_SECRET: SEGREDO },
  });
  assert.equal(r.aceito, false);
  assert.equal(r.mensagens.length, 0);
});

test("quem pede para sair chega marcado, não some", () => {
  // Marcar em vez de descartar: a saída precisa virar registro (apagar o cadastro e bloquear
  // contato). Se sumisse aqui, ninguém saberia que a pessoa pediu.
  const corpo = JSON.stringify(payloadTexto("wamid.OUT", "PARAR"));
  const r = processarEntrada({
    corpoCru: corpo, cabecalhoAssinatura: assinar(corpo), payload: JSON.parse(corpo),
    env: { WHATSAPP_APP_SECRET: SEGREDO },
  });
  assert.equal(r.mensagens.length, 1);
  assert.equal(r.mensagens[0].opt_out, true);
});
