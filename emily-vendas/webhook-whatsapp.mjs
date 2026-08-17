// Recebimento de mensagens do WhatsApp (Meta Cloud API).
//
// POR QUE ISTO EXISTE SEPARADO
// `envio.mjs` sabe FALAR com a Meta. Ninguém sabia OUVIR. Sem este arquivo, o token da Meta
// só serviria para a Emily mandar mensagem que ninguém pediu — o caminho real (cliente escreve
// → regra decide → Andréia aprova ou o envio sai automático) não fechava.
//
// AS QUATRO COISAS QUE UM WEBHOOK DA META PRECISA ACERTAR, E QUE QUASE TODO MUNDO ERRA
//
// 1. VERIFICAÇÃO (GET). A Meta chama uma vez com `hub.challenge` e só ativa a assinatura se a
//    resposta devolver o desafio em texto puro. Comparação do verify_token em tempo constante:
//    é um segredo, e comparar segredo com `===` vaza o tamanho pelo tempo de resposta.
//
// 2. ASSINATURA (POST). Todo POST vem com `X-Hub-Signature-256`. Sem conferir, qualquer pessoa
//    que descubra a URL manda uma mensagem falsa e faz a Emily responder um cliente inventado —
//    ou pior, faz a Andréia aprovar uma resposta para um número que não é de ninguém. A conferência
//    usa o CORPO CRU. Se o corpo for lido como JSON antes, o HMAC não bate: `JSON.stringify` de um
//    objeto parseado não reproduz byte a byte o que a Meta assinou.
//
// 3. RESPONDER 200 RÁPIDO. A Meta reenvia o que não recebe 200 em segundos, e reenvio vira
//    mensagem duplicada. Por isso o processamento pesado não acontece dentro do ciclo de resposta.
//
// 4. IDEMPOTÊNCIA. Mesmo respondendo rápido, a Meta reenvia. O `wamid` é a chave: mensagem já
//    processada é descartada em silêncio. Isso já existia em `envio.mjs`; aqui ela é aplicada
//    na ENTRADA, que é onde a duplicata nasce.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
// Não decide e não envia. Ele traduz o formato da Meta para o que o motor entende e devolve
// isso. Quem decide é `regras.mjs`; quem pode enviar é `envio.mjs` depois do gate. Se este
// arquivo tomasse decisão, existiriam duas fontes de verdade sobre o que a Emily pode dizer.

import { createHmac, timingSafeEqual } from "node:crypto";

export const CABECALHO_ASSINATURA = "x-hub-signature-256";

/** Comparação que não vaza informação pelo tempo gasto. */
function igualSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Confere a assinatura da Meta sobre o corpo CRU.
 *
 * `corpoCru` precisa ser exatamente os bytes recebidos. Passar um objeto já parseado é o erro
 * clássico: a serialização de volta muda espaços e ordem de chaves, e o HMAC nunca bate.
 */
export function assinaturaValida({ corpoCru, cabecalho, appSecret }) {
  if (!appSecret) return { ok: false, motivo: "WHATSAPP_APP_SECRET ausente" };
  if (!cabecalho) return { ok: false, motivo: "requisição sem assinatura" };
  if (typeof corpoCru !== "string" && !Buffer.isBuffer(corpoCru)) {
    return { ok: false, motivo: "corpo cru ausente — assinatura não pode ser conferida" };
  }
  const esperado = "sha256=" + createHmac("sha256", appSecret).update(corpoCru).digest("hex");
  return igualSeguro(esperado, cabecalho)
    ? { ok: true }
    : { ok: false, motivo: "assinatura não confere" };
}

/**
 * Resposta ao GET de verificação da Meta.
 * Devolve o que escrever no corpo e com que status — nunca o desafio quando o token não bate.
 */
export function verificacao({ query = {}, verifyToken }) {
  const modo = query["hub.mode"];
  const token = query["hub.verify_token"];
  const desafio = query["hub.challenge"];
  if (!verifyToken) return { status: 500, corpo: "WHATSAPP_VERIFY_TOKEN ausente" };
  if (modo !== "subscribe") return { status: 400, corpo: "modo inválido" };
  if (!igualSeguro(token ?? "", verifyToken)) return { status: 403, corpo: "token inválido" };
  return { status: 200, corpo: String(desafio ?? "") };
}

/**
 * Extrai as mensagens de texto de um payload da Meta.
 *
 * O formato é aninhado e cheio de coisa que não interessa (status de entrega, reações, leitura).
 * Só mensagem de TEXTO vira trabalho: áudio, imagem e documento são devolvidos como
 * `nao_suportado` para a Andréia ver e responder ela mesma — inventar transcrição de áudio de
 * cliente seria pior do que dizer que não sabemos ler.
 */
export function extrairMensagens(payload) {
  const saida = [];
  for (const entrada of payload?.entry || []) {
    for (const mudanca of entrada?.changes || []) {
      const valor = mudanca?.value;
      if (!valor?.messages) continue;
      const perfis = new Map(
        (valor.contacts || []).map((c) => [c.wa_id, c?.profile?.name || null]),
      );
      for (const m of valor.messages) {
        const base = {
          wamid: m.id,
          telefone: m.from,
          // O nome do perfil do WhatsApp é o que a pessoa escolheu, não um cadastro nosso.
          // Serve para a Emily chamar pelo nome; nunca substitui perguntar.
          nome_perfil: perfis.get(m.from) || null,
          recebido_em: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
          numero_da_clinica: valor?.metadata?.phone_number_id || null,
        };
        if (m.type === "text") {
          saida.push({ ...base, tipo: "texto", texto: m.text?.body || "" });
        } else {
          saida.push({ ...base, tipo: "nao_suportado", subtipo: m.type, texto: "" });
        }
      }
    }
  }
  return saida;
}

/**
 * Marca de PARAR/SAIR. A política de retenção diz que pedido de saída apaga o registro e
 * bloqueia contato novo — o prazo de 90 dias não autoriza insistir em quem pediu para sair.
 * Detectar isto na ENTRADA garante que nem a regra nem a Emily chegam a formular resposta.
 */
const SAIDA = [
  "parar", "pare", "sair", "cancelar inscricao", "cancelar inscrição",
  "nao quero mais", "não quero mais", "me tira", "descadastrar",
  "stop", "unsubscribe", "remove me",
  "no me escriba", "no me escribas", "dar de baja",
];

export function pediuParaSair(texto) {
  const limpo = String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) return false;
  // Palavra isolada ou frase curta: "parar" sozinho é opt-out, mas "não quero parar o
  // tratamento agora" no meio de uma conversa não é.
  return SAIDA.some((t) => limpo === t || (limpo.length <= 40 && limpo.includes(t)));
}

/**
 * O caminho de entrada inteiro, em ordem, sem decidir nada sobre conteúdo.
 *
 * Devolve SEMPRE o que fez e por quê — inclusive quando descarta. Um webhook que engole
 * silenciosamente é impossível de depurar depois que uma cliente reclama que ninguém respondeu.
 */
export function processarEntrada({ corpoCru, cabecalhoAssinatura, payload, jaVistos = [], env = process.env }) {
  const conf = assinaturaValida({
    corpoCru,
    cabecalho: cabecalhoAssinatura,
    appSecret: env.WHATSAPP_APP_SECRET,
  });
  if (!conf.ok) return { aceito: false, motivo: conf.motivo, mensagens: [] };

  const vistos = new Set(jaVistos);
  const mensagens = [];
  const descartadas = [];

  for (const m of extrairMensagens(payload)) {
    if (!m.wamid) { descartadas.push({ motivo: "sem wamid", m }); continue; }
    if (vistos.has(m.wamid)) { descartadas.push({ motivo: "reenvio da Meta", wamid: m.wamid }); continue; }
    vistos.add(m.wamid);
    if (m.tipo === "texto" && pediuParaSair(m.texto)) {
      mensagens.push({ ...m, opt_out: true });
      continue;
    }
    mensagens.push({ ...m, opt_out: false });
  }

  return { aceito: true, mensagens, descartadas };
}
