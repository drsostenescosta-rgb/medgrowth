#!/usr/bin/env node
// voz.mjs — como a clínica FALA. Separado das regras de propósito:
// a regra decide o que pode ser dito; a voz decide como se diz.
//
// Correção de rumo pedida por Sostenes em 14/08/2026, com três pontos concretos:
//
//   1. Ninguém diz o nome completo do serviço duas vezes. Diz "drenagem", "modeladora",
//      "dreno detox". Repetir "Drenagem linfática" em toda mensagem soa a formulário.
//   2. "às 14:00" é hora de sistema. A clínica é em Massachusetts: a cliente lê e fala
//      "2 da tarde". Escrever 14:00 para uma cliente nos EUA é errado duas vezes — soa a robô
//      E força ela a converter na cabeça.
//   3. O tom evolui. Quem está na terceira sessão não quer ser tratada como lead novo.
//
// Nada aqui inventa a voz da Andreia: as três mensagens-modelo dela (pendência 6.5) continuam
// PENDENTES e `tom_validado` continua false. Isto só conserta a mecânica do idioma — abreviação,
// hora falada e temperatura — para o rascunho não sair robótico enquanto ela não manda as dela.

// ---------------------------------------------------------------- nomes curtos
/**
 * Como as clientes chamam cada serviço. Sobrescrevível pela configuração da clínica
 * (`clinica-config.json` → voz.apelidos_servico), porque cada clínica tem o seu jeito.
 */
export const APELIDO_PADRAO = Object.freeze({
  "drenagem linfatica": "drenagem",
  "drenagem linfática": "drenagem",
  "pos-operatorio": "pós",
  "pós-operatório": "pós",
  "massoterapia masculina": "massagem",
  "massagem modeladora": "modeladora",
  "dreno detox": "dreno detox",
  "limpeza de pele": "limpeza",
});

function chave(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** "Drenagem linfática" → "drenagem". Serviço desconhecido volta como veio (nunca inventa apelido). */
export function apelidoServico(nome, config = {}) {
  if (!nome) return null;
  const mapa = { ...APELIDO_PADRAO, ...(config?.voz?.apelidos_servico || {}) };
  const direto = mapa[nome] || mapa[chave(nome)];
  if (direto) return direto;
  const achado = Object.entries(mapa).find(([k]) => chave(k) === chave(nome));
  return achado ? achado[1] : nome;
}

// ---------------------------------------------------------------- hora falada
const DIA_CURTO = { Sun: "domingo", Mon: "segunda", Tue: "terça", Wed: "quarta", Thu: "quinta", Fri: "sexta", Sat: "sábado" };

function partesNoFuso(iso, fuso) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return {
    dia: DIA_CURTO[p.weekday] || null,
    hora: Number(p.hour) % 24,
    minuto: Number(p.minute),
    data: `${p.year}-${p.month}-${p.day}`,
  };
}

/**
 * "2 da tarde", "10 e meia da manhã", "meio-dia", "7 da noite".
 * É assim que a cliente fala — e é assim que ela confere se o horário está certo.
 */
export function horaFalada(iso, fuso = "America/New_York") {
  const { hora, minuto } = partesNoFuso(iso, fuso);
  if (hora === 12 && minuto === 0) return "meio-dia";
  if (hora === 0 && minuto === 0) return "meia-noite";

  // Corte em 19h: em português 6 da tarde é normal, 7 já é noite. Errar isso soa estranho
  // justamente no fim do dia, que é quando ela mais marca.
  const periodo = hora < 12 ? "da manhã" : hora < 19 ? "da tarde" : "da noite";
  const h12 = hora % 12 === 0 ? 12 : hora % 12;
  if (minuto === 0) return `${h12} ${periodo}`;
  if (minuto === 30) return `${h12} e meia ${periodo}`;
  if (minuto === 15) return `${h12} e quinze ${periodo}`;
  return `${h12}:${String(minuto).padStart(2, "0")} ${periodo}`;
}

/**
 * Rótulo completo do compromisso, do jeito que sai numa conversa de WhatsApp:
 *   hoje  → "hoje às 2 da tarde"
 *   amanhã→ "amanhã, 2 da tarde"
 *   resto → "quarta, 2 da tarde"
 * "quarta-feira, às 14 horas" é linguagem de secretária eletrônica — não sai daqui.
 */
export function rotuloQuando(iso, { fuso = "America/New_York", agora = new Date().toISOString() } = {}) {
  if (!iso) return null;
  const alvo = partesNoFuso(iso, fuso);
  const hoje = partesNoFuso(agora, fuso);
  const amanha = partesNoFuso(new Date(new Date(agora).getTime() + 86_400_000).toISOString(), fuso);
  const hora = horaFalada(iso, fuso);
  if (alvo.data === hoje.data) return `hoje às ${hora}`;
  if (alvo.data === amanha.data) return `amanhã, ${hora}`;
  return `${alvo.dia}, ${hora}`;
}

// ---------------------------------------------------------------- temperatura da relação
/**
 * A partir de quantas sessões a cliente deixa de ser "nova".
 * Andreia respondeu que cliente nova exige mais explicação e recorrente é mais direta;
 * o corte em 3 vem do pedido de Sostenes ("mais de duas ou três sessões já é outra relação").
 */
export function nivelRelacao(atendimentosAnteriores = 0) {
  const n = Number(atendimentosAnteriores) || 0;
  if (n === 0) return "nova";
  if (n < 3) return "conhecida";
  return "de_casa";
}

/**
 * Abertura da mensagem conforme a relação. Com o primeiro nome quando existe.
 * Nova     → acolhe e se apresenta (a transparência da regra 7 mora aqui).
 * Conhecida→ cumprimenta pelo nome, sem se reapresentar.
 * De casa  → direto, íntimo o suficiente para não parecer atendimento.
 */
export function abertura(nivel, primeiroNome = null) {
  const nome = primeiroNome ? `, ${primeiroNome}` : "";
  return {
    nova: `Oi${nome}! Aqui é a Emily, ajudo a Andreia com a agenda 🙋‍♀️`,
    conhecida: `Oi${nome}!`,
    de_casa: `Oi${nome}! 😘`,
  }[nivel] || `Oi${nome}!`;
}

/**
 * Fechamento. Depende de DUAS coisas, não de uma:
 *   - o quanto a cliente é de casa (menos cerimônia);
 *   - o que acabou de acontecer na conversa.
 * "Te espero!" só pode sair quando existe horário confirmado. Fechar com "te espero" logo
 * depois de a cliente cancelar é o tipo de detalhe que denuncia que quem escreveu foi um robô.
 */
export const SITUACOES = Object.freeze(["aguardando_resposta", "confirmado", "informacao", "encerrado", "pergunta"]);

export function fechamento(nivel, situacao = "informacao") {
  const tabela = {
    aguardando_resposta: {
      nova: "Assim que ela me responder eu te aviso, tá bom? ✨",
      conhecida: "Já te aviso 😘",
      de_casa: "Já te falo 😘",
    },
    confirmado: {
      nova: "Te espero! Qualquer dúvida é só me chamar ✨",
      conhecida: "Te espero 😘",
      de_casa: "Te espero! 😘",
    },
    informacao: {
      nova: "Qualquer dúvida é só me chamar por aqui, tá bom? ✨",
      conhecida: "Qualquer coisa me chama 😘",
      de_casa: "Qualquer coisa me chama 😘",
    },
    encerrado: { nova: "", conhecida: "", de_casa: "" },
    // Mensagem que TERMINA perguntando não leva fecho nenhum.
    //
    // Pego rodando a nuvem de verdade: a pergunta de descoberta saiu como "…me conta o que você
    // tá querendo melhorar? (…) Assim que ela me responder eu te aviso, tá bom?" — duas frases
    // que se contradizem, porque a Emily acabou de perguntar e não há nada sendo esperado da
    // Andreia. Mesmo o fecho neutro ("qualquer dúvida me chama") atropela: quem faz uma pergunta
    // quer resposta, e não mais três linhas. Silêncio é o fecho certo aqui.
    pergunta: { nova: "", conhecida: "", de_casa: "" },
  };
  return (tabela[situacao] || tabela.informacao)[nivel] ?? tabela.informacao.conhecida;
}

/**
 * Monta a mensagem final: abertura + corpo + fechamento, sem linha em branco sobrando
 * e sem repetir emoji (duas carinhas na mesma mensagem já soa exagerado).
 */
export function montar({ nivel = "conhecida", primeiroNome = null, corpo, comAbertura = true, situacao = "informacao" }) {
  const partes = [];
  if (comAbertura) partes.push(abertura(nivel, primeiroNome));
  // Os corpos são escritos em minúscula para encaixar depois de "Oi, Bia!"; como toda abertura
  // termina em "!" ou emoji, a frase seguinte começa maiúscula.
  const miolo = String(corpo || "").trim();
  partes.push(comAbertura ? miolo.charAt(0).toUpperCase() + miolo.slice(1) : miolo);
  partes.push(fechamento(nivel, situacao));
  let texto = partes.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  // Dedup de emoji repetido na mesma mensagem.
  const vistos = new Set();
  texto = texto.replace(/\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu, (e) => {
    if (vistos.has(e)) return "";
    vistos.add(e);
    return e;
  });
  texto = texto.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  // O dedup pode ter tirado o emoji que TERMINAVA a frase ("Já te falo 😘" → "Já te falo"),
  // deixando um fragmento sem pontuação na tela. Fecha a frase em vez de entregar pela metade.
  return terminarFrase(texto);
}

const FIM_DE_FRASE = /[.!?…]$/u;

/** Garante que a mensagem termine em pontuação ou emoji — nunca pendurada. */
export function terminarFrase(texto) {
  const t = String(texto || "").trim();
  if (!t) return t;
  if (FIM_DE_FRASE.test(t)) return t;
  // Termina em emoji? Então já está fechada visualmente.
  if (/\p{Extended_Pictographic}(?:️)?$/u.test(t)) return t;
  return `${t}.`;
}
