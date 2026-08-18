// /webhooks/whatsapp — o endereço que a Meta chama quando uma cliente escreve.
//
// A lógica de verdade (assinatura, dedup, opt-out) mora em ../../webhook-whatsapp.mjs e tem
// 16 testes. Este arquivo é só a casca HTTP: ler o corpo cru, chamar, responder rápido.
//
// TRÊS DECISÕES QUE PARECEM ERRADAS E SÃO DE PROPÓSITO
//
// 1. Sempre responde 200 no POST, mesmo quando recusa. A Meta reenvia tudo que não recebe 200,
//    e reenviar um payload com assinatura inválida não vai fazer a assinatura passar — só gera
//    fila infinita. O que aconteceu fica no log e, quando é grave, no ledger.
//
// 2. Não responde a cliente aqui dentro. Este handler recebe, registra e devolve. Quem decide
//    é o motor; quem envia é envio.mjs depois do gate. A Meta dá segundos de prazo: pensar
//    dentro do ciclo de resposta é como se perde mensagem.
//
// 3. Lê o corpo do stream, não de req.body. A Vercel entrega req.body já parseado, e o HMAC
//    da Meta é sobre os BYTES. JSON.stringify de um objeto parseado não reproduz o original.

import { processarEntrada, verificacao } from "../../webhook-whatsapp.mjs";

export const config = { api: { bodyParser: false } };

function texto(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(String(corpo));
}

async function corpoCru(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  return Buffer.concat(partes).toString("utf8");
}

export default async function handler(req, res) {
  const url = new URL(req.url, "https://placeholder.local");

  if (req.method === "GET") {
    const query = Object.fromEntries(url.searchParams.entries());
    const r = verificacao({ query, verifyToken: process.env.WHATSAPP_VERIFY_TOKEN });
    return texto(res, r.status, r.corpo);
  }

  if (req.method !== "POST") return texto(res, 405, "método não suportado");

  let cru;
  try {
    cru = await corpoCru(req);
  } catch {
    return texto(res, 200, "corpo ilegível");
  }

  let payload;
  try {
    payload = JSON.parse(cru || "{}");
  } catch {
    console.warn("[whatsapp] corpo não é JSON");
    return texto(res, 200, "ok");
  }

  const r = processarEntrada({
    corpoCru: cru,
    cabecalhoAssinatura: req.headers["x-hub-signature-256"],
    payload,
    // TODO(dedup persistente): hoje a janela de dedup é só a deste lote. Enquanto o
    // envio automático estiver desligado, uma duplicata vira no máximo uma linha repetida
    // na fila da Andréia — visível e descartável. Antes de ligar o envio automático isto
    // PRECISA ler os wamid já processados do Postgres, senão reenvio da Meta vira mensagem
    // duplicada para a cliente.
    jaVistos: [],
  });

  if (!r.aceito) {
    // Não vaza o motivo para quem chamou: quem forjou assinatura não merece dica de por quê
    // falhou. O motivo fica no log da função, que só nós lemos.
    console.warn("[whatsapp] entrada recusada:", r.motivo);
    return texto(res, 200, "ok");
  }

  for (const m of r.mensagens) {
    console.log("[whatsapp] recebida", JSON.stringify({
      wamid: m.wamid, tipo: m.tipo, opt_out: m.opt_out,
      // telefone e texto NÃO vão para o log: é dado de cliente e log de função fica
      // guardado na Vercel fora do nosso controle de retenção.
      tem_texto: Boolean(m.texto),
    }));
  }

  return texto(res, 200, "ok");
}
