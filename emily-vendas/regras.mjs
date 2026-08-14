#!/usr/bin/env node
// regras.mjs — motor de decisão DETERMINÍSTICO da operação assistida (Fase 1).
//
// Por que existe, se emily.mjs já chama o Claude:
//   As regras invioláveis da Andreia ("confirmação só com sim explícito", "conflito bloqueia",
//   "dúvida clínica escala") não são preferências de redação — são decisões de segurança.
//   Um LLM pode redigir melhor; ele NÃO pode ser a autoridade sobre elas, porque não há como
//   provar que ele nunca vai decidir diferente. Então a divisão é:
//
//       REGRA decide a AÇÃO   (aqui, testável, offline, sem chave)
//       VOZ   escolhe as PALAVRAS (voz.mjs — abreviação, hora falada, temperatura)
//       LLM   pode POLIR o texto (api.mjs, opcional; a ação nunca muda)
//
//   Se o LLM cair, a operação continua. Se o LLM alucinar, a ação já estava decidida.
//
// Este arquivo é PURO: não lê disco, não faz rede, não grava nada. Tudo entra por parâmetro.

import { apelidoServico, horaFalada, montar, nivelRelacao, rotuloQuando } from "./voz.mjs";

// ---------------------------------------------------------------- normalização
/** Minúsculas sem acento — os detectores comparam sempre nesta forma. */
export function norm(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function contem(alvo, termos) {
  const t = norm(alvo);
  return termos.some((termo) => t.includes(norm(termo)));
}

/** Casa palavra inteira — evita que "ok" dispare dentro de "okinawa". */
function contemPalavra(alvo, palavras) {
  const t = norm(alvo);
  return palavras.some((p) => new RegExp(`(^|[^a-z0-9])${norm(p)}([^a-z0-9]|$)`).test(t));
}

// ---------------------------------------------------------------- vocabulário das regras
// Cada lista corresponde a um item das "Regras invioláveis" de config/clinica-andreia.md.
// Manter aqui, e não no prompt, é o que torna a regra auditável.

const OPT_OUT = ["parar", "sair", "nao quero mais receber", "me tira da lista", "stop", "unsubscribe"];

const URGENCIA = [
  "urgente", "urgencia", "emergencia", "socorro", "pelo amor de deus",
  "muita dor", "dor forte", "nao aguento", "sangrando", "sangramento",
  "febre", "passando mal", "hospital", "pronto socorro", "emergency",
];

// Sinais de intercorrência de pós-operatório: regra 6 manda escalar QUALQUER um.
const POS_OP_SINAL = [
  "inchado", "inchaco", "inchacao", "vermelho", "vermelhidao", "quente",
  "pus", "secrecao", "abriu o ponto", "ponto abriu", "deiscencia",
  "seroma", "fibrose", "endurecido", "roxo", "hematoma", "necrose",
  "cheiro ruim", "infeccionou", "infeccao", "drenando",
];
const POS_OP_CONTEXTO = ["pos operatorio", "pos-operatorio", "pos op", "cirurgia", "operei", "lipo", "abdominoplastia", "protese"];

// Pergunta clínica individualizada: pedir diagnóstico, indicação ou conduta para o próprio corpo.
const CLINICO = [
  "flacidez ou gordura", "e gordura ou", "e flacidez ou", "qual e o meu caso",
  "o que eu tenho", "serve pro meu caso", "resolve o meu problema",
  "posso fazer mesmo tendo", "tenho contraindicacao", "contraindicacao",
  "posso fazer gravida", "estou gravida", "amamentando",
  "tomo anticoagulante", "tenho trombose", "tenho diabetes", "tenho cancer",
  "quantas sessoes eu preciso", "vai resolver", "diagnostico",
];

const MISTA_FLACIDEZ_GORDURA = {
  a: ["flacidez", "flacida", "pele solta", "sobra de pele"],
  b: ["gordura", "gordurinha", "localizada", "banha"],
};

const PESSOAL = [
  "falar com a andreia", "falar com a dona", "falar direto com ela",
  "quem esta falando", "voce e robo", "e um robo", "e uma pessoa",
  "chama a andreia", "quero falar com ela", "assunto pessoal",
];

const DESCONTO = [
  "desconto", "cupom", "promocao", "mais barato", "abaixa", "faz por",
  "parcelar", "parcela", "condicao especial", "consegue melhorar o preco", "ultimo preco",
];
// Único benefício autorizado (resposta 3.6) — perguntar por ele NÃO é pedir desconto.
const PACOTE_AUTORIZADO = ["pacote", "10 sessoes", "dez sessoes"];

const CANCELAMENTO = [
  "cancelar", "desmarcar", "nao vou poder", "nao consigo ir", "nao vou conseguir",
  "preciso remarcar", "remarcar", "mudar meu horario", "adiar", "transferir meu horario",
];

const ATRASO = ["atrasada", "atrasado", "vou chegar tarde", "estou a caminho mas", "vou me atrasar", "atraso"];

const ENCAIXE = ["encaixe", "encaixar", "tem vaga", "abriu vaga", "lista de espera", "espera", "da pra hoje", "consegue hoje", "tem hoje"];

const PEDIDO_HORARIO = [
  "que horas", "tem horario", "qual horario", "tem disponibilidade", "disponivel",
  "quero marcar", "quero agendar", "posso marcar", "da pra marcar", "agendar",
  "amanha", "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo",
];

const PRECO = ["quanto custa", "qual o valor", "qual valor", "preco", "quanto e", "quanto fica", "how much", "valores", "tabela"];

const SINAL = ["sinal", "deposito", "adiantamento", "pagar antes", "reservar pagando"];

// Alegação bloqueada (regra 9) — qualquer variação de resultado numérico do EMSzero.
const EMSZERO = ["emszero", "ems zero", "ms zero", "emzero"];
const ALEGACAO_CALORIA = ["caloria", "calorias", "queima", "equivale a", "abdominais", "dias de exercicio", "emagrece", "perde peso", "perder peso"];

const CONFIRMA_EXPLICITA_PADRAO = ["sim", "confirmo", "confirmado", "pode confirmar", "confirmar"];
const CONFIRMA_AMBIGUA_PADRAO = ["ta bom", "tá bom", "ta bem", "ok", "okay", "blz", "beleza", "certo", "isso", "uhum", "aham", "perfeito", "otimo", "ótimo", "legal", "show", "combinado"];
const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+$/u;

// ---------------------------------------------------------------- tempo (puro)
export function minutosDeHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function sobrepoe(aIni, aFim, bIni, bFim) {
  return new Date(aIni).getTime() < new Date(bFim).getTime() && new Date(bIni).getTime() < new Date(aFim).getTime();
}

/**
 * Conflito determinístico: duração + buffer contra as ocupações informadas.
 * A regra 2 diz "conflito bloqueia" — não existe caminho que devolva "agendar mesmo assim".
 */
export function conflitosEm({ inicio, duracaoMin, bufferMin = 0, ocupacoes = [] }) {
  const ini = new Date(inicio).getTime();
  if (!Number.isFinite(ini)) return [];
  const fim = new Date(ini + (Number(duracaoMin) + Number(bufferMin)) * 60_000).toISOString();
  return ocupacoes.filter((o) => sobrepoe(new Date(ini).toISOString(), fim, o.inicio, o.fim));
}

/** Horas entre agora e o compromisso — negativo quando o compromisso já passou. */
export function horasAte(agora, quando) {
  return (new Date(quando).getTime() - new Date(agora).getTime()) / 3_600_000;
}

/** Dia da semana no fuso da clínica. Sem isso, "sexta" vira o dia errado perto da meia-noite. */
export function diaDaSemana(instante, fuso = "America/New_York") {
  const nome = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: fuso }).format(new Date(instante));
  return { Sun: "dom", Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab" }[nome] || null;
}

export function ehAmanha(agora, quando, fuso = "America/New_York") {
  if (!quando) return false;
  const dia = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return dia(quando) === dia(new Date(new Date(agora).getTime() + 86_400_000));
}

// ---------------------------------------------------------------- repergunta da Andreia
// A repergunta-padrão dela traz "amanhã" FIXO:
//   "...posso considerar confirmado seu horario de [servico], amanha as [hora]?"
// Injetar um rótulo de dia dentro disso produziria "amanha as quarta às 14:00" — frase quebrada
// e, pior, uma afirmação FALSA sobre o dia. Mensagem de confirmação que erra o dia é justamente
// o que gera no-show, a dor nº 1 dela. Então: mantemos o texto dela quando está certo e
// corrigimos o trecho quando estaria errado.
const RE_AMANHA_HORA = /amanh[ãa]\s+[àa]s?\s+\[hora\]/i;

export function renderRepergunta(template, contexto = {}, config = {}) {
  const fuso = contexto.fuso || "America/New_York";
  const agora = contexto.agora || new Date().toISOString();
  const servico = apelidoServico(contexto.servico, config) || "seu atendimento";
  const rotulo = contexto.horario_alvo ? rotuloQuando(contexto.horario_alvo, { fuso, agora }) : (contexto.rotulo_horario || "o horário combinado");

  let texto = String(template).replace("[servico]", servico);
  if (contexto.horario_alvo && ehAmanha(agora, contexto.horario_alvo, fuso)) {
    // É mesmo amanhã: o "amanhã" dela fica, e entra só a hora falada ("2 da tarde").
    return texto.replace("[hora]", horaFalada(contexto.horario_alvo, fuso));
  }
  if (RE_AMANHA_HORA.test(texto)) return texto.replace(RE_AMANHA_HORA, rotulo);
  return texto.replace("[hora]", rotulo);
}

// ---------------------------------------------------------------- corpos de mensagem
// Só o MIOLO. A saudação e o fecho entram por voz.mjs conforme a relação da cliente —
// é isso que faz a terceira sessão soar diferente da primeira.
const CORPO = {
  escalar_clinico: "essa é uma dúvida que quem responde é a Andreia, porque depende de te ver de pertinho. Já vou passar pra ela.",
  escalar_urgencia: "vou chamar a Andreia agora. Se for algo urgente de saúde, procura atendimento médico sem esperar, tá?",
  escalar_pos_op: "isso aí a Andreia precisa ver com você, e ela vai querer saber agora. Já estou passando pra ela.",
  escalar_pessoal: "claro, já estou chamando a Andreia pra falar com você.",
  escalar_desconto: "sobre valor quem fala é a Andreia mesmo. Já passei pra ela.",
  escalar_cancelamento: "entendi. Vou falar com a Andreia sobre esse horário e já te retorno com a resposta dela.",
  escalar_atraso: "já avisei a Andreia que você tá a caminho.",
  escalar_encaixe_conflito: "esse horário já tá com outra cliente, então não consigo confirmar por aqui. Vou perguntar pra Andreia se dá pra encaixar e te aviso.",
  escalar_horario_pendente: "que bom que você quer marcar 💆🏼‍♀️ Vou confirmar com a Andreia e já te trago as opções.",
  escalar_sinal: "sobre isso quem confirma é a Andreia. Já passei pra ela.",
  escalar_idioma: "vou chamar a Andreia pra te responder direitinho.",
  escalar_padrao: "vou confirmar isso com a Andreia e já te respondo.",
  opt_out: "tudo bem! Não te mando mais mensagem por aqui. Se um dia quiser voltar, é só chamar.",
};

// ---------------------------------------------------------------- resultado
/**
 * Que tipo de fecho cada regra pede. Isto existe porque o fecho errado desmente a mensagem:
 * "Te espero!" logo depois de uma cliente cancelar, ou um "qualquer dúvida me chama ✨"
 * depois de um relato de intercorrência, entregam na hora que quem escreveu foi uma máquina.
 */
const SITUACAO_POR_REGRA = {
  "R1.CONFIRMACAO_EXPLICITA": "confirmado",
  "LGPD.OPT_OUT": "encerrado",
  "R6.URGENCIA": "encerrado",
  "R6.INTERCORRENCIA_POS_OP": "encerrado",
  "R9.ALEGACAO_BLOQUEADA": "informacao",
  "COM.PRECO_CATALOGO": "informacao",
  "AGENDA.PROPOR_HORARIO": "informacao",
};

function resultado({
  acao,
  regra,
  motivo,
  corpo,
  textoLiteral = null,
  acao_agenda = { tipo: "nenhuma" },
  bloqueios = [],
  gate,
  contexto = {},
  config = {},
  alertas = [],
}) {
  const nivel = nivelRelacao(contexto.atendimentos_anteriores);
  // Default "aguardando_resposta": a maioria das regras escala, e escalar significa
  // que a cliente está esperando a Andreia — o fecho tem de dizer isso.
  const situacao = SITUACAO_POR_REGRA[regra] || "aguardando_resposta";
  const texto = textoLiteral
    ?? montar({ nivel, primeiroNome: contexto.primeiro_nome || null, corpo, situacao });

  return {
    acao,
    regra,
    motivo,
    resposta_sugerida: texto,
    acao_agenda,
    bloqueios,
    alertas,
    relacao: nivel,
    // Invariantes da Fase 1 — nenhum caminho deste arquivo pode mudá-las.
    requer_aprovacao_humana: true,
    envio_automatico: false,
    // Tom só vira "validado" quando a pendência 6.5 for respondida pela Andreia.
    tom_validado: Boolean(gate?.tom_validado),
    preflight_aprovado: Boolean(gate?.preflight_aprovado),
  };
}

// ---------------------------------------------------------------- detectores (testáveis um a um)
export function ehOptOut(msg) {
  return contemPalavra(msg, OPT_OUT);
}

export function ehUrgencia(msg) {
  return contem(msg, URGENCIA);
}

export function ehIntercorrenciaPosOp(msg, contexto = {}) {
  if (!contem(msg, POS_OP_SINAL)) return false;
  return contem(msg, POS_OP_CONTEXTO) || Boolean(contexto.pos_operatorio);
}

export function ehDuvidaClinica(msg) {
  if (contem(msg, CLINICO)) return true;
  // Dúvida mista: cita flacidez E gordura = pedido de indicação individualizada.
  return contem(msg, MISTA_FLACIDEZ_GORDURA.a) && contem(msg, MISTA_FLACIDEZ_GORDURA.b);
}

export function ehAlegacaoBloqueada(msg) {
  return contem(msg, EMSZERO) && contem(msg, ALEGACAO_CALORIA);
}

export function ehPedidoDeDesconto(msg) {
  if (!contem(msg, DESCONTO)) return false;
  return !contem(msg, PACOTE_AUTORIZADO);
}

export function classificarConfirmacao(msg, operacao) {
  const regras = operacao?.regras?.confirmacao || {};
  const aceitos = (regras.aceitos || CONFIRMA_EXPLICITA_PADRAO).map(norm);
  const naoAceitos = (regras.nao_aceitos || CONFIRMA_AMBIGUA_PADRAO).map(norm);
  const t = norm(msg);
  if (!t) return "vazia";
  if (SO_EMOJI.test(String(msg).trim())) return "ambigua";
  if (contemPalavra(t, aceitos)) return "explicita";
  if (contemPalavra(t, naoAceitos) || contemPalavra(t, CONFIRMA_AMBIGUA_PADRAO)) return "ambigua";
  return "nenhuma";
}

// ---------------------------------------------------------------- a decisão
/**
 * Decide a ação para UMA mensagem recebida. Ordem = severidade: o caminho mais seguro ganha.
 * O default é ESCALAR — quando a regra não sabe, ela não inventa (regra 8).
 *
 * @param {object} p
 * @param {string} p.mensagem   texto recebido da cliente
 * @param {object} p.operacao   operacao-assistida.json
 * @param {object} p.agenda     agenda-config.json
 * @param {object} p.clinica    clinica-config.json (fornece apelidos de serviço)
 * @param {object} p.contexto   { agora, fuso, primeiro_nome, atendimentos_anteriores,
 *                                aguardando_confirmacao, servico, horario_alvo, ocupacoes, ... }
 * @param {object} p.gate       { preflight_aprovado, grade_definida, tom_validado }
 */
export function decidir({ mensagem, operacao = {}, agenda = {}, clinica = {}, contexto = {}, gate = {} }) {
  const agora = contexto.agora || new Date().toISOString();
  const fuso = contexto.fuso || agenda.fuso_horario || "America/New_York";
  const ctx = { ...contexto, agora, fuso };
  const texto = String(mensagem || "");
  const base = { gate, contexto: ctx, config: clinica };

  // ---- 0. mensagem vazia: nunca responder no escuro.
  // Exceção: se estamos esperando confirmação, mensagem ilegível é exatamente o caso
  // "silêncio não confirma nada" da regra 1 — cai na repergunta, não na escalada.
  if (!texto.trim() && !ctx.aguardando_confirmacao) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R8.NAO_SABE",
      motivo: "Mensagem vazia ou não legível — a Emily não supõe intenção.",
      corpo: CORPO.escalar_padrao,
    });
  }

  // ---- 1. opt-out (LGPD): precede qualquer venda
  if (ehOptOut(texto)) {
    return resultado({
      ...base,
      acao: "responder",
      regra: "LGPD.OPT_OUT",
      motivo: "Cliente pediu para parar de receber mensagens. Registrar e não recontatar.",
      corpo: CORPO.opt_out,
      bloqueios: ["nenhuma cadência futura", "nenhuma contraproposta"],
    });
  }

  // ---- 2. urgência e intercorrência de pós-op: escalada imediata (regra 6)
  if (ehIntercorrenciaPosOp(texto, ctx)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R6.INTERCORRENCIA_POS_OP",
      motivo: "Sinal de intercorrência de pós-operatório. Escalada imediata, sem orientação clínica.",
      corpo: CORPO.escalar_pos_op,
      bloqueios: ["nenhuma orientação clínica", "nenhuma remarcação automática"],
      alertas: ["PRIORIDADE ALTA — avisar Andreia agora"],
    });
  }
  if (ehUrgencia(texto)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R6.URGENCIA",
      motivo: "Urgência relatada. Escalada imediata; a Emily não avalia gravidade.",
      corpo: CORPO.escalar_urgencia,
      bloqueios: ["nenhuma orientação clínica"],
      alertas: ["PRIORIDADE ALTA — avisar Andreia agora"],
    });
  }

  // ---- 3. pergunta clínica individualizada (regra 6) — inclui a dúvida mista
  if (ehDuvidaClinica(texto)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R6.DUVIDA_CLINICA",
      motivo: "Pergunta clínica individualizada (indicação/conduta). Só a Andreia responde, após avaliação.",
      corpo: CORPO.escalar_clinico,
      bloqueios: ["nenhuma indicação de procedimento", "nenhum diagnóstico", "nenhuma promessa de resultado"],
    });
  }

  // ---- 4. quer falar com a dona (regra 6 + transparência da regra 7)
  if (contem(texto, PESSOAL)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R6.PESSOAL",
      motivo: "Cliente pediu falar com a Andreia ou questionou quem responde.",
      corpo: CORPO.escalar_pessoal,
      bloqueios: ["a Emily nunca finge ser a Andreia"],
    });
  }

  // ---- 5. alegação bloqueada do EMSzero (regra 9)
  if (ehAlegacaoBloqueada(texto)) {
    const aprovada = operacao?.regras?.conteudo_bloqueado?.[0]?.descricao_aprovada
      || "O EMSzero é uma máquina de tonificação muscular que trabalha três áreas em uma sessão: abdômen, posterior e glúteos.";
    return resultado({
      ...base,
      acao: "responder",
      regra: "R9.ALEGACAO_BLOQUEADA",
      motivo: "Pergunta sobre calorias/resultado do EMSzero. Só a descrição aprovada pode sair; o número segue bloqueado.",
      corpo: `${aprovada} Sobre resultado, quem avalia direitinho é a Andreia na avaliação ✨`,
      bloqueios: ["proibido citar calorias", "proibido equivalência com exercício", "proibido promessa de resultado"],
    });
  }

  // ---- 6. desconto fora da regra
  if (ehPedidoDeDesconto(texto)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "COM.DESCONTO",
      motivo: "Pedido de condição comercial fora do único benefício autorizado (pacote 10 pagando 9).",
      corpo: CORPO.escalar_desconto,
      bloqueios: ["desconto direto proibido"],
    });
  }

  // ---- 7. cancelamento / remarcação (regras 3 e 5)
  if (contem(texto, CANCELAMENTO)) {
    const alvo = ctx.horario_alvo;
    const horas = alvo ? horasAte(agora, alvo) : null;
    const dia = alvo ? diaDaSemana(alvo, fuso) : null;
    const antecedencia = Number(operacao?.regras?.cancelamento?.antecedencia_minima_horas ?? 24);
    const tardio = horas !== null && horas < antecedencia;
    const diaSensivel = dia === "sex" || dia === "sab";

    return resultado({
      ...base,
      acao: "escalar",
      regra: tardio && diaSensivel ? "R5.CANCELAMENTO_TARDIO_SEX_SAB" : "R3.CANCELAMENTO",
      motivo: tardio && diaSensivel
        ? `Cancelamento com ${horas.toFixed(1)}h de antecedência (< ${antecedencia}h) em ${dia}. Regra 5: falar com Andreia ANTES de remarcar.`
        : tardio
          ? `Cancelamento com ${horas.toFixed(1)}h de antecedência (< ${antecedencia}h). Revisão da Andreia obrigatória.`
          : "Pedido de cancelamento/remarcação. Regra 3: nada é movido sem confirmação explícita e revisão humana.",
      corpo: CORPO.escalar_cancelamento,
      acao_agenda: { tipo: "nenhuma", detalhe: "O horário atual PERMANECE ocupado até a Andreia decidir." },
      bloqueios: ["não remover o horário", "não oferecer troca automática", "não liberar a vaga"],
      alertas: tardio && diaSensivel ? ["Horário premium (sex/sáb) com cancelamento tardio"] : [],
    });
  }

  // ---- 8. atraso (regra 4)
  if (contem(texto, ATRASO)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R4.ATRASO",
      motivo: "Cliente avisou atraso. Regra 4: avisar Andreia; a Emily não remarca nem libera o horário.",
      corpo: CORPO.escalar_atraso,
      bloqueios: ["não remarcar", "não liberar o horário"],
    });
  }

  // ---- 9. confirmação: explícita confirma; qualquer outra coisa REPERGUNTA (regra 1)
  if (ctx.aguardando_confirmacao) {
    const tipo = classificarConfirmacao(texto, operacao);
    if (tipo === "explicita") {
      // Mesmo com "sim", conflito bloqueia (regra 2) — confirmação não vence a agenda.
      const conflitos = ctx.horario_alvo
        ? conflitosEm({
            inicio: ctx.horario_alvo,
            duracaoMin: ctx.duracao_min ?? agenda.duracao_min ?? 50,
            bufferMin: ctx.buffer_min ?? agenda.buffer_min ?? 10,
            ocupacoes: ctx.ocupacoes || [],
          })
        : [];
      if (conflitos.length) {
        return resultado({
          ...base,
          acao: "bloquear",
          regra: "R2.CONFLITO",
          motivo: `O horário confirmado conflita com ${conflitos.length} compromisso(s). Bloqueado — não existe "agendar mesmo assim".`,
          corpo: CORPO.escalar_encaixe_conflito,
          acao_agenda: { tipo: "bloqueada_por_conflito", conflitos },
          bloqueios: ["não criar dupla marcação", "não mover a outra cliente"],
        });
      }
      const quando = ctx.horario_alvo ? rotuloQuando(ctx.horario_alvo, { fuso, agora }) : "no horário combinado";
      return resultado({
        ...base,
        acao: "responder",
        regra: "R1.CONFIRMACAO_EXPLICITA",
        motivo: 'Confirmação explícita recebida ("sim"/"confirmo"). Ação de agenda proposta para aprovação.',
        // O "te espero" vem do fecho (situacao: confirmado). Aqui é só o registro do que ficou
        // combinado — repetir os dois soa a mensagem automática mal montada.
        corpo: `tá tudo certo então ✅ Fica marcado ${quando}.`,
        acao_agenda: {
          tipo: "marcar",
          inicio: ctx.horario_alvo || null,
          servico: ctx.servico || null,
          detalhe: "Proposta — só entra na agenda depois do clique de aprovação.",
        },
      });
    }
    // ambígua, vazia ou nenhuma → REPERGUNTA. Silêncio e "tá bom" não confirmam nada.
    const template = operacao?.regras?.confirmacao?.repergunta_padrao
      || "Só para confirmar direitinho: posso considerar confirmado seu horário de [servico], [hora]? Responde sim ou não, por favor 😘";
    return resultado({
      ...base,
      acao: "reperguntar_confirmacao",
      regra: "R1.CONFIRMACAO_AMBIGUA",
      motivo: `Resposta classificada como "${tipo}" — não confirma. Regra 1 exige "sim" ou "confirmo" explícito.`,
      // Texto literal: a repergunta é a frase da Andreia, não leva saudação nem fecho por cima.
      textoLiteral: renderRepergunta(template, ctx, clinica),
      acao_agenda: { tipo: "nenhuma", detalhe: "Horário segue NÃO confirmado." },
      bloqueios: ["não marcar como confirmado", "não contar como presença garantida"],
    });
  }

  // ---- 10. encaixe / horário: conflito bloqueia antes de qualquer oferta (regra 2)
  const pedeHorario = contem(texto, PEDIDO_HORARIO) || contem(texto, ENCAIXE);
  if (pedeHorario && ctx.horario_alvo) {
    const conflitos = conflitosEm({
      inicio: ctx.horario_alvo,
      duracaoMin: ctx.duracao_min ?? agenda.duracao_min ?? 50,
      bufferMin: ctx.buffer_min ?? agenda.buffer_min ?? 10,
      ocupacoes: ctx.ocupacoes || [],
    });
    if (conflitos.length) {
      return resultado({
        ...base,
        acao: "bloquear",
        regra: "R2.CONFLITO",
        motivo: `Horário pedido conflita com ${conflitos.length} compromisso(s). A Emily não desmarca ninguém para abrir vaga.`,
        corpo: CORPO.escalar_encaixe_conflito,
        acao_agenda: { tipo: "bloqueada_por_conflito", conflitos },
        bloqueios: ["não mover outra cliente", "não criar dupla marcação", "encaixe só com decisão da Andreia"],
        alertas: ["Pedido de encaixe em horário ocupado — decisão é da Andreia"],
      });
    }
  }

  // ---- 11. sinal / lista de espera: pendência 4.6 aberta → não prometer nada
  if (contem(texto, SINAL) || contem(texto, ["lista de espera"])) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "PEND.4_6_SINAL_LISTA_ESPERA",
      motivo: "Regra de sinal e lista de espera está PENDENTE-CONFIRMAR (4.6). A Emily não promete nem cobra.",
      corpo: CORPO.escalar_sinal,
      bloqueios: ["não mencionar valor de sinal", "não prometer lista de espera"],
    });
  }

  // ---- 12. pedido de horário sem grade confirmada: pendência 2.3 aberta
  if (pedeHorario) {
    if (!gate.grade_definida) {
      return resultado({
        ...base,
        acao: "escalar",
        regra: "PEND.2_3_GRADE_HORARIOS",
        motivo: "Cliente quer marcar, mas a grade está PENDENTE-CONFIRMAR (2.3). A Emily coleta a preferência e devolve para a Andreia.",
        corpo: CORPO.escalar_horario_pendente,
        acao_agenda: { tipo: "coletar_preferencia", detalhe: "Registrar o horário desejado, sem confirmar." },
        bloqueios: ["não afirmar disponibilidade", "não oferecer horário específico"],
      });
    }
    const opcoes = (ctx.horarios_livres || []).slice(0, 3);
    const lista = opcoes.map((h) => rotuloQuando(h, { fuso, agora })).join(" ou ");
    return resultado({
      ...base,
      acao: "responder",
      regra: "AGENDA.PROPOR_HORARIO",
      motivo: "Pedido de horário com grade confirmada. Propor horários livres reais para aprovação.",
      corpo: lista ? `tenho ${lista}. Qual fica melhor pra você?` : CORPO.escalar_horario_pendente,
      acao_agenda: { tipo: "propor_horario", opcoes },
      bloqueios: ["todos os serviços exigem avaliação prévia — agendar a AVALIAÇÃO, não o procedimento"],
    });
  }

  // ---- 13. preço: catálogo autorizado responde; avaliação prévia é obrigatória
  if (contem(texto, PRECO)) {
    const servicos = Array.isArray(operacao.servicos) ? operacao.servicos : [];
    const tabela = servicos
      .map((s) => `${apelidoServico(s.nome_publico, clinica)} — US$ ${s.preco_usd} (${s.politica_operacional?.duracao_min}min)`)
      .join("\n");
    return resultado({
      ...base,
      acao: "responder",
      regra: "COM.PRECO_CATALOGO",
      motivo: "Pergunta de preço respondida com o catálogo autorizado. Nenhum valor fora da tabela.",
      corpo: tabela
        ? `os valores são:\n${tabela}\n\nTodos passam por uma avaliação antes, pra Andreia ver o que é melhor pra você. Quer que eu veja um horário?`
        : CORPO.escalar_padrao,
      bloqueios: ["nenhum valor fora do catálogo", "nenhum desconto"],
      alertas: servicos.length ? [] : ["Catálogo vazio na configuração — escalar"],
    });
  }

  // ---- 14. idioma não identificado: escalar em vez de escolher
  if (ctx.idioma_identificado === false) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "IDIOMA.NAO_IDENTIFICADO",
      motivo: "Não foi possível identificar o idioma da cliente. A regra manda escalar em vez de escolher.",
      corpo: CORPO.escalar_idioma,
    });
  }

  // ---- 15. default FAIL-CLOSED: quando a regra não sabe, o humano assume (regra 8)
  return resultado({
    ...base,
    acao: "escalar",
    regra: "R8.NAO_SABE",
    motivo: "Nenhuma regra determinística cobre esta mensagem. A Emily não inventa resposta nem prazo.",
    corpo: CORPO.escalar_padrao,
    bloqueios: ["não inventar resposta", "não inventar prazo"],
  });
}

export const CORPOS = CORPO;
