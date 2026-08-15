// envio.mjs — envio REAL pela WhatsApp Cloud API, com as travas que o envio automático exige.
//
// MUDANÇA DE FASE (15/08/2026, decisão de Sostenes)
// A Fase 1 não enviava nada: a Emily propunha, a Andreia aprovava e colava. Sostenes:
// "não quero isso, quero em ação, foi isso que prometi; mensagem enviada automaticamente".
// Então o envio passa a existir. O que NÃO muda é quem decide o quê:
//
//     regra que RESPONDE  → a Emily manda sozinha
//     regra que ESCALA    → continua indo para a Andreia, e nada sai
//
// Essa linha não é conservadorismo: é a mesma classificação que o motor já calcula em toda
// mensagem (`acao`). Dúvida clínica, intercorrência de pós-op, urgência, valor fora da tabela e
// cancelamento tardio de sexta/sábado são `escalar` — e escalar significa que nenhuma resposta
// automática existe para aquele caso. Mandar sozinho o que a regra classificou como decisão da
// Andreia seria inventar autorização que ela não deu.
//
// POR QUE A IDEMPOTÊNCIA É O CORAÇÃO DESTE ARQUIVO
// A dor #5 da entrevista é literal: o agendador anterior "chegou a repetir mensagem muitas vezes;
// foi desativado". Com humano no meio, repetir é chato. Sem humano, repetir é um loop mandando
// dez mensagens para a mesma cliente às onze da noite — e o piloto acaba naquele minuto.
//
// E não é hipótese: **a Meta REENVIA o webhook** quando não recebe 200 rápido. Sem deduplicação
// por id da mensagem recebida, a primeira lentidão do banco vira mensagem duplicada. Três travas,
// em ordem de custo:
//   1. dedup por `wamid` — a mesma mensagem recebida nunca é processada duas vezes;
//   2. dedup por conteúdo — o mesmo texto para o mesmo contato não sai duas vezes na janela;
//   3. teto por contato — nenhuma cliente recebe mais que N mensagens por hora, aconteça o que for.

import { createHash } from "node:crypto";

const API_VERSAO = "v21.0";

/** Ações que a Emily pode enviar sozinha. O resto vai para a Andreia. */
export const ACOES_AUTOENVIAVEIS = Object.freeze(["responder", "reperguntar_confirmacao"]);

/** Teto duro por contato. Existe para transformar bug em silêncio, não em enxurrada. */
export const LIMITE_POR_CONTATO_HORA = 4;

/** Janela em que um texto idêntico para o mesmo contato é considerado repetição. */
export const JANELA_REPETICAO_MIN = 180;

export function chaveConteudo(telefone, texto) {
  const normalizado = String(texto || "").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(`${telefone}\n${normalizado}`).digest("hex").slice(0, 32);
}

/**
 * A decisão pode ser enviada sozinha?
 *
 * Devolve sempre um motivo legível — quando o envio NÃO acontece, a Andreia precisa entender
 * por quê sem abrir código, e o motivo vai para o ledger.
 */
export function podeAutoenviar({ decisao, gate = {}, config = {} }) {
  if (config.envio_automatico !== true) {
    return { ok: false, motivo: "envio automático desligado na configuração" };
  }
  if (!decisao || !ACOES_AUTOENVIAVEIS.includes(decisao.acao)) {
    return { ok: false, motivo: `ação "${decisao?.acao}" é decisão da Andreia — a Emily não envia` };
  }
  if (decisao.alertas?.length) {
    // Alerta existe justamente para o humano olhar. Enviar por cima de um alerta é ignorá-lo.
    return { ok: false, motivo: `a decisão veio com alerta (${decisao.alertas[0]}) — vai para a Andreia` };
  }
  if (!gate.preflight_aprovado) {
    return { ok: false, motivo: "preflight reprovado — fail-closed, nada sai sozinho" };
  }
  if (!gate.tom_validado) {
    // Enquanto a Andreia não tiver lido as frases, o texto é rascunho nosso. Rascunho nosso pode
    // ir para a tela dela; não pode ir para a cliente sem ninguém ter lido.
    return { ok: false, motivo: "tom ainda não validado pela Andreia (pendência 6.5)" };
  }
  return { ok: true, motivo: "regra de resposta, com preflight e tom aprovados" };
}

/**
 * Trava de repetição. `historico` é a lista de envios recentes, vinda do ledger:
 * [{ telefone, chave_conteudo, ts }]
 */
export function verificarRepeticao({ telefone, texto, historico = [], agora = new Date() }) {
  const chave = chaveConteudo(telefone, texto);
  const t = agora.getTime();
  const doContato = historico.filter((h) => h.telefone === telefone);

  const igual = doContato.find(
    (h) => h.chave_conteudo === chave && t - new Date(h.ts).getTime() < JANELA_REPETICAO_MIN * 60_000,
  );
  if (igual) {
    return { ok: false, motivo: `texto idêntico já enviado para este contato em ${igual.ts}`, chave };
  }

  const naUltimaHora = doContato.filter((h) => t - new Date(h.ts).getTime() < 60 * 60_000).length;
  if (naUltimaHora >= LIMITE_POR_CONTATO_HORA) {
    return {
      ok: false,
      motivo: `teto de ${LIMITE_POR_CONTATO_HORA} mensagens/hora atingido para este contato`,
      chave,
    };
  }

  return { ok: true, chave };
}

/** A mensagem recebida já foi processada? A Meta reenvia webhook; sem isto, retentativa duplica. */
export function jaProcessado(wamid, processados = []) {
  if (!wamid) return false;
  return processados.includes(wamid);
}

/**
 * Envia de verdade. Só é chamada depois de `podeAutoenviar` e `verificarRepeticao` aprovarem —
 * a função não repete essas checagens porque quem as pula está pulando de propósito, e o teste
 * cobre a ordem. O que ela faz é falar com a Meta e devolver o resultado sem inventar sucesso.
 */
export async function enviarWhatsApp({ telefone, texto, config = {}, fetchImpl = fetch }) {
  const token = config.token || process.env.WHATSAPP_TOKEN;
  const numeroId = config.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !numeroId) {
    return { ok: false, motivo: "WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID ausentes" };
  }

  const url = `https://graph.facebook.com/${API_VERSAO}/${numeroId}/messages`;
  let resposta;
  try {
    resposta = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: telefone,
        type: "text",
        text: { preview_url: false, body: texto },
      }),
    });
  } catch (e) {
    return { ok: false, motivo: `falha de rede ao falar com a Meta: ${e.message}` };
  }

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    return { ok: false, motivo: `Meta recusou (${resposta.status}): ${corpo?.error?.message || "sem detalhe"}`, corpo };
  }
  return { ok: true, wamid: corpo?.messages?.[0]?.id || null, corpo };
}

/**
 * O caminho completo, na ordem certa. Devolve o que aconteceu e POR QUÊ, sempre — inclusive
 * quando não envia. Quem chama registra isso no ledger.
 */
export async function despacharResposta({
  decisao,
  telefone,
  gate = {},
  config = {},
  historico = [],
  agora = new Date(),
  fetchImpl = fetch,
}) {
  const permissao = podeAutoenviar({ decisao, gate, config });
  if (!permissao.ok) return { enviado: false, etapa: "politica", ...permissao };

  const texto = decisao.resposta_sugerida;
  if (!texto || !String(texto).trim()) {
    return { enviado: false, etapa: "texto", ok: false, motivo: "resposta vazia — nada a enviar" };
  }

  const repeticao = verificarRepeticao({ telefone, texto, historico, agora });
  if (!repeticao.ok) return { enviado: false, etapa: "repeticao", ...repeticao };

  const envio = await enviarWhatsApp({ telefone, texto, config, fetchImpl });
  if (!envio.ok) return { enviado: false, etapa: "meta", ...envio, chave_conteudo: repeticao.chave };

  return {
    enviado: true,
    etapa: "meta",
    ok: true,
    motivo: permissao.motivo,
    wamid: envio.wamid,
    chave_conteudo: repeticao.chave,
  };
}
