#!/usr/bin/env node
// webhook.mjs — webhook WhatsApp Cloud API (fase 2). IMPLEMENTADO, MAS DESLIGADO.
//
// Por que desligado: PRD §7/§8 — automação só liga depois que a fase manual (Wizard-of-Oz)
// validar o roteiro, e SOMENTE via Cloud API oficial (API não-oficial = risco de ban, VETADO).
//
// PRÉ-CONDIÇÕES PARA LIGAR (o servidor RECUSA subir sem elas):
//   1. Concluir verificação Meta Business + acesso à WhatsApp Cloud API (E1-T3)
//   2. clinica-config.json SEM campos "[PREENCHER" (entrevista E2-T1) — o motor recusa fora de --dry-run
//   3. Gate de eval aprovado: `node eval.mjs` com [SEG] = 100% (E2-T4)
//   4. .env: WEBHOOK_ENABLED=true, WEBHOOK_VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
//      WHATSAPP_APP_SECRET (validação de assinatura X-Hub-Signature-256 — OBRIGATÓRIA) e
//      ALERTA_WEBHOOK_URL (notificação imediata de urgência à dona — OBRIGATÓRIA, jornada H2)
//   5. Expor este servidor (túnel/Vercel function equivalente) e cadastrar a URL no painel Meta
//   6. Descomentar o envio real em `enviarWhatsApp` abaixo (revisão humana antes disso!)
//
// Segurança implementada:
//   - Todo POST tem a assinatura HMAC-SHA256 (X-Hub-Signature-256, app secret do Meta) verificada
//     sobre o corpo bruto; assinatura ausente/errada → 401, nada é processado (anti-forja/anti-injection).
//   - Conversa com ai_paused/opt-out: o processarMensagem NÃO gera resposta (gate no motor) e este
//     webhook NÃO envia nada — o humano é notificado e assume.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { carregarEnv, registrarEscalacao, notificarHumano } from "./lib.mjs";
import { processarMensagem } from "./emily.mjs";

carregarEnv();

if (process.env.WEBHOOK_ENABLED !== "true") {
  console.log(
    [
      "webhook.mjs está DESLIGADO por padrão (fase Wizard-of-Oz).",
      "A operação de hoje é: mensagem chega no WhatsApp → operador cola no emily.mjs → revisa → cola de volta.",
      "Para ligar a fase 2 (Cloud API oficial), cumpra TODAS as pré-condições do cabeçalho deste arquivo.",
    ].join("\n"),
  );
  process.exit(0);
}

// ---- Gates de pré-condição (fase 2 não sobe sem segurança e sem canal de alerta) ----
if (!process.env.WHATSAPP_APP_SECRET) {
  console.error(
    "[webhook] ERRO: WHATSAPP_APP_SECRET ausente. Sem o app secret não dá para validar a assinatura " +
      "X-Hub-Signature-256 do Meta — qualquer POST forjado viraria mensagem processada. NÃO vou subir assim.",
  );
  process.exit(1);
}
if (!process.env.ALERTA_WEBHOOK_URL) {
  console.error(
    "[webhook] ERRO: ALERTA_WEBHOOK_URL ausente. A jornada (H2) exige notificação IMEDIATA à dona em " +
      "urgência médica — uma linha de log não é supervisão humana. Configure um webhook de alerta " +
      "(Slack/Discord/etc.) antes de ligar a fase 2.",
  );
  process.exit(1);
}

const PORTA = Number(process.env.WEBHOOK_PORT || 3789);

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o app secret). */
function assinaturaValida(req, corpoBruto) {
  const header = req.headers["x-hub-signature-256"];
  if (!header || !header.startsWith("sha256=")) return false;
  const esperada = createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(corpoBruto).digest("hex");
  const recebida = header.slice("sha256=".length);
  if (recebida.length !== esperada.length) return false;
  try {
    return timingSafeEqual(Buffer.from(recebida, "hex"), Buffer.from(esperada, "hex"));
  } catch {
    return false;
  }
}

async function enviarWhatsApp(telefone, texto) {
  // ---- ENVIO REAL (desativado de propósito na fase 2 inicial) ----
  // const res = await fetch(
  //   `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
  //   {
  //     method: "POST",
  //     headers: {
  //       Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify({
  //       messaging_product: "whatsapp",
  //       to: telefone,
  //       type: "text",
  //       text: { body: texto },
  //     }),
  //   },
  // );
  // if (!res.ok) throw new Error(`cloud api ${res.status}: ${await res.text()}`);
  console.log(`[webhook] RESPOSTA SUGERIDA para ${telefone} (envio real comentado):\n${texto}`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);

  // Verificação do webhook (GET do painel Meta)
  if (req.method === "GET" && url.pathname === "/webhook") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (modo === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      res.writeHead(200).end(challenge);
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  // Mensagens recebidas (POST da Cloud API)
  if (req.method === "POST" && url.pathname === "/webhook") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const corpoBruto = Buffer.concat(chunks);

      // ---- GATE DE ASSINATURA: POST sem HMAC válido não é do Meta → descartado, nada processado ----
      if (!assinaturaValida(req, corpoBruto)) {
        registrarEscalacao("WEBHOOK_ASSINATURA_INVALIDA", "-", `origem: ${req.socket.remoteAddress || "?"}`);
        res.writeHead(401).end();
        return;
      }

      res.writeHead(200).end("EVENT_RECEIVED"); // responde já; processamento segue async
      try {
        const payload = JSON.parse(corpoBruto.toString("utf8"));
        const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!msg || msg.type !== "text") return;
        const telefone = msg.from;
        const texto = msg.text?.body || "";
        console.log(`[webhook] mensagem de ${telefone}: ${texto}`);
        const resultado = await processarMensagem(telefone, texto);

        // ---- GATE DE PAUSA: conversa escalada/opt-out → NADA é enviado automaticamente ----
        if (resultado.meta?.ia_pausada || !resultado.resposta_whatsapp) {
          console.log(`[webhook] ⏸ IA pausada para ${telefone} (${resultado.meta?.motivo || "sem resposta"}) — humano assume`);
          await notificarHumano(
            "MSG_COM_IA_PAUSADA",
            telefone,
            `mensagem recebida com IA pausada: ${texto} | ${resultado.nota_interna}`,
          );
          return;
        }

        await enviarWhatsApp(telefone, resultado.resposta_whatsapp);
        if (resultado.acao === "escalar_humano") {
          // notificação imediata (webhook de alerta + notificação local) — não espera painel
          await notificarHumano("ESCALAR_HUMANO_FASE2", telefone, `mensagem: ${texto} | nota: ${resultado.nota_interna}`);
          console.log(`[webhook] ⚠ conversa ${telefone} marcada para HUMANO (alerta enviado; ver escalacoes.log)`);
        }
        if (resultado.acao === "opt_out") {
          console.log(`[webhook] ⛔ opt-out registrado para ${telefone} — nenhum contato futuro`);
        }
      } catch (e) {
        console.error(`[webhook] erro no processamento: ${e.message}`);
        registrarEscalacao("ERRO_WEBHOOK", "-", e.message);
      }
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORTA, () => {
  console.log(`[webhook] ouvindo em http://localhost:${PORTA}/webhook (Cloud API oficial, assinatura obrigatória)`);
});
