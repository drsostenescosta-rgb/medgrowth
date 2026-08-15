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

function escapar(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Casa TERMO INTEIRO (palavra ou expressão), nunca pedaço de outra palavra.
 *
 * Isto já foi busca por substring, e o Sheldon Pai derrubou a entrega por causa disso: o termo
 * "er " (de emergency room) casava dentro de "fazer ", "anteriores e", "mulher " — e transformava
 * "posso fazer drenagem?" em urgência médica. Substring em lista de vocabulário é uma fábrica de
 * falso positivo silencioso: cada termo curto novo envenena todas as mensagens.
 */
function contem(alvo, termos) {
  const t = norm(alvo);
  return termos.some((termo) => new RegExp(`(^|[^a-z0-9])${escapar(norm(termo))}([^a-z0-9]|$)`).test(t));
}

/** Mesmo casamento; o nome existe para deixar a intenção explícita em quem chama. */
function contemPalavra(alvo, palavras) {
  return contem(alvo, palavras);
}

// ---------------------------------------------------------------- vocabulário das regras
// Cada lista corresponde a um item das "Regras invioláveis" de config/clinica-andreia.md.
// Manter aqui, e não no prompt, é o que torna a regra auditável.

const OPT_OUT = ["parar", "sair", "nao quero mais receber", "me tira da lista", "stop", "unsubscribe"];

// Urgência em pt/en/es. A clínica atende nos três idiomas: um alerta de sangramento escrito em
// inglês não pode cair no caminho silencioso só porque os detectores nasceram em português.
const URGENCIA = [
  "urgente", "urgencia", "emergencia", "socorro", "pelo amor de deus",
  "muita dor", "dor forte", "nao aguento", "sangrando", "sangramento",
  "febre", "passando mal", "hospital", "pronto socorro",
  // inglês
  "emergency", "urgent", "bleeding", "a lot of pain", "severe pain", "so much pain",
  "can't stand", "cant stand", "fever", "help me", "emergency room", "hurts so",
  // espanhol
  "sangrado", "mucho dolor", "fiebre", "ayuda", "no aguanto",
];

// Sinais de intercorrência (regra 6). Divididos em DOIS níveis porque o alarme vermelho só vale
// enquanto for raro: `temSinalCorporal` disparava em adjetivo de cor solto e gritava PRIORIDADE
// ALTA para "comprei uma bolsa roxa" e "o sofá da recepção é vermelho". Seis falsos em dez.
// A terceira bolsa roxa da semana ensina a Andreia a ignorar a faixa — e aí o pus de verdade
// passa batido. É a mesma lição do verificador que acusa adulteração sem adulteração nenhuma.

// FORTE: não existe uso inocente. Dispara sozinho.
const SINAL_FORTE = [
  "pus", "secrecao", "secrecoes", "deiscencia", "necrose", "infeccionou", "infeccao",
  "abriu o ponto", "ponto abriu", "abriu o corte", "cheiro ruim", "seroma",
  "discharge", "infected", "infection", "necrosis", "infeccion",
];

// FRACO: só é sinal com referência ao corpo por perto (ou com serviço de pós-operatório).
// Sozinhos descrevem vestido, sofá, bolsa e luz de máquina.
const SINAL_FRACO = [
  // Formas verbais junto com as adjetivas: "meu tornozelo inchou" é a mesma queixa de
  // "meu tornozelo tá inchado", e faltava.
  "inchado", "inchada", "inchaco", "inchacao", "inchou", "inchando", "inchar", "incha",
  "vermelho", "vermelha", "vermelhidao", "avermelhado", "avermelhada",
  "roxo", "roxa", "endurecido", "endurecida", "hematoma", "fibrose", "drenando",
  "liquido", "líquido", "saindo algo", "ardendo", "latejando",
  "swollen", "swelling", "redness", "hinchado", "hinchada", "enrojecimiento",
];

// O que faz um adjetivo virar relato clínico: estar falando do próprio corpo.
// A lista sozinha nunca fica completa — faltavam pé, mão e tornozelo, que numa clínica de
// drenagem linfática são A queixa. Por isso a lista é só metade da regra; a outra metade é a
// PRIMEIRA PESSOA logo abaixo, que cobre a cauda longa sem depender de eu lembrar "panturrilha".
const REFERENCIA_CORPORAL = [
  "barriga", "abdome", "abdomen", "perna", "pernas", "braco", "bracos", "costas",
  "gluteo", "gluteos", "bumbum", "coxa", "coxas", "cintura", "flanco", "pele",
  "cicatriz", "ponto", "pontos", "corte", "local", "lugar", "regiao", "area",
  "seio", "seios", "mama", "mamas", "umbigo", "dreno", "curativo",
  "pe", "pes", "mao", "maos", "tornozelo", "tornozelos", "joelho", "joelhos",
  "rosto", "pescoco", "panturrilha", "canela", "dedo", "dedos", "virilha",
  "axila", "quadril", "ombro", "olho", "olhos", "corpo",
  "meu corpo", "minha pele", "onde fiz", "onde operei",
];

// Falar de si na primeira pessoa + um sinal já é relato corporal, mesmo sem a parte do corpo
// estar na lista: "tô com o pé inchado", "amanheci com a mão dura".
const PRIMEIRA_PESSOA = [
  "meu", "minha", "meus", "minhas", "to com", "tô com", "estou com",
  "fiquei com", "ficou", "amanheci", "acordei com", "senti", "tá doendo", "ta doendo",
];

// ...exceto quando a primeira pessoa se refere claramente a um objeto. "meu carro é vermelho"
// não é queixa clínica, e o alarme vermelho só serve enquanto for raro.
const OBJETO_NAO_CORPO = [
  "carro", "bolsa", "vestido", "roupa", "blusa", "calca", "sapato", "sofa", "parede",
  "luz", "maquina", "celular", "casa", "cabelo", "unha", "esmalte", "pacote", "caixa",
  "porta", "tapete", "almofada", "toalha", "lencol", "signo",
];
const POS_OP_CONTEXTO = ["pos operatorio", "pos-operatorio", "pos op", "cirurgia", "operei", "lipo", "abdominoplastia", "protese"];

// Pergunta clínica individualizada: pedir diagnóstico, indicação ou conduta para o próprio corpo.
const CLINICO = [
  "flacidez ou gordura", "e gordura ou", "e flacidez ou", "qual e o meu caso",
  "o que eu tenho", "serve pro meu caso", "resolve o meu problema",
  "posso fazer mesmo tendo", "tenho contraindicacao", "contraindicacao",
  "quantas sessoes eu preciso", "vai resolver", "diagnostico",
  // Condições que mudam a conduta. Antes só a frase exata "posso fazer gravida" casava, então
  // "to esperando bebe, pode fazer massagem?" passava como lead comercial. Agora é a CONDIÇÃO
  // que dispara, escrita de qualquer jeito.
  "gravida", "gravidez", "gestante", "esperando bebe", "esperando nene", "esperando um bebe",
  "amamentando", "amamentacao", "pregnant", "embarazada",
  "anticoagulante", "trombose", "diabetes", "quimioterapia", "marcapasso",
  "tenho cancer", "com cancer", "cancer de mama", "tratei cancer", "tive cancer",
  "hipertensa", "pressao alta", "alergia", "alergica", "epilepsia", "lupus",
  "menor de idade", "tenho 16 anos", "tenho 17 anos", "minha filha de",
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
  // Formas de desmarcar que não usam a palavra "cancelar" — "amanhã não vou dar, desculpa".
  "nao vou dar", "nao vai dar", "nao da pra ir", "nao dá pra ir", "nao posso ir",
  "nao poderei", "nao vou aparecer", "nao consigo mais", "nao deu pra ir", "nao vou hoje",
  // Sem termos em inglês/espanhol aqui: o portão de idioma dispara ANTES desta regra, então
  // "cancel" e "cancelar mi cita" nunca chegariam — vocabulário nascido morto engana quem lê.
];

const ATRASO = ["atrasada", "atrasado", "vou chegar tarde", "estou a caminho mas", "vou me atrasar", "atraso"];

// "espera" solto saía do ar: casava dentro de "esperando bebê" e transformava gestante em lead.
const ENCAIXE = ["encaixe", "encaixar", "tem vaga", "abriu vaga", "lista de espera", "da pra hoje", "consegue hoje", "tem hoje"];

/**
 * Negação que inverte a intenção de agendar. Sem isto, "amanhã não vou dar" casava "amanha"
 * em PEDIDO_HORARIO e a Emily respondia "que bom que você quer marcar" para quem estava
 * desmarcando — o pior tipo de erro, porque é simpático e está lendo a pessoa ao contrário.
 */
const NEGACAO_DE_AGENDAMENTO = [
  "nao vou", "nao posso", "nao da", "nao dá", "nao consigo", "nao vai dar", "nao deu",
  "nao poderei", "nao quero mais", "nao rola", "can't", "cant make", "won't be able",
];

// Pedido EXPLÍCITO de horário: sobrevive a uma negação na mesma frase.
const PEDIDO_EXPLICITO = [
  "que horas", "tem horario", "qual horario", "tem disponibilidade", "tem vaga",
  "quero marcar", "quero agendar", "posso marcar", "da pra marcar", "quero remarcar para",
  "tem outro horario", "tem algum horario", "consegue outro",
];

// Pedido IMPLÍCITO: só citar um dia já sugere agendamento, mas uma negação por perto inverte.
const PEDIDO_HORARIO = [
  ...PEDIDO_EXPLICITO, "disponivel", "agendar",
  "amanha", "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo",
];

// Sem "how much" aqui: era o único termo estrangeiro numa regra que RESPONDE. Numa frase curta
// ("how much?") a margem do portão de idioma não é alcançada e a cliente recebia a tabela de
// preços em português. Fora da lista, a frase curta cai no default e escala — que é o que a
// configuração dela manda fazer com idioma não identificado.
const PRECO = ["quanto custa", "qual o valor", "qual valor", "preco", "quanto e", "quanto fica", "valores", "tabela"];

const SINAL = ["sinal", "deposito", "adiantamento", "pagar antes", "reservar pagando"];

const LISTA_ESPERA = ["lista de espera", "fila de espera", "me avisa se abrir", "avisa se vagar", "me avisa se desmarcar"];

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
  // Os corpos terminam ANTES do "já te aviso": esse pedaço vem do fecho, conforme a relação.
  // Dizer as duas coisas ("já te retorno com a resposta dela. Já te falo.") soa a mensagem
  // automática mal montada — foi o que a auditoria pegou na tela.
  escalar_cancelamento: "entendi. Vou falar com a Andreia sobre esse horário.",
  escalar_atraso: "já avisei a Andreia que você tá a caminho.",
  // "já tá ocupado", e não "já tá com outra cliente": a agenda de uma cliente não é assunto de
  // outra. Confirmar que existe alguém naquele horário já é contar mais do que devia.
  escalar_encaixe_conflito: "esse horário já tá ocupado, então não consigo confirmar por aqui. Vou perguntar pra Andreia se dá pra encaixar.",
  escalar_horario_pendente: "que bom que você quer marcar 💆🏼‍♀️ Vou confirmar os horários com a Andreia.",
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
  // Todas estas TERMINAM perguntando à cliente. Fecho depois de pergunta atropela a pergunta —
  // e no caso do fecho "aguardando_resposta" chega a mentir ("já te aviso" sem nada a avisar).
  // Descoberto com a mensagem saindo inteira pela API na nuvem, não em teste unitário.
  "COM.PRECO_DESCOBERTA": "pergunta",
  "COM.PRECO_SERVICO": "pergunta",
  "COM.SEM_LISTA_DE_ESPERA": "pergunta",
  "AGENDA.PROPOR_HORARIO": "pergunta",
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

/**
 * A cliente nomeou um serviço do catálogo na mensagem? Devolve o serviço ou null.
 *
 * Existe para a regra de preço: sem saber DE QUE serviço se fala, não há preço a dar — há uma
 * pergunta a fazer. Casa nome público, nome em inglês, apelido falado ("drenagem") e o id.
 */
export function servicoMencionado(texto, operacao = {}, clinica = {}) {
  const servicos = Array.isArray(operacao.servicos) ? operacao.servicos : [];
  return servicos.find((s) => contem(texto, nomesDoServico(s, clinica))) || null;
}

/**
 * Todos os jeitos de nomear um serviço. Inclui a variante com hífen E com espaço porque o id
 * vem como "pos-operatorio" e a cliente escreve "pós operatório" — e o casador trata hífen como
 * fronteira de palavra, então uma forma não encontra a outra.
 */
function nomesDoServico(s, clinica = {}) {
  const brutos = [s.nome_publico, s.nome_en, apelidoServico(s.nome_publico, clinica), s.id].filter(Boolean);
  const nomes = new Set();
  for (const bruto of brutos) {
    const n = String(bruto);
    nomes.add(n);
    nomes.add(n.replace(/-/g, " "));
  }
  return [...nomes];
}

/** O serviço da cliente é pós-operatório? Basta isso para um sinal fraco virar relato clínico. */
function servicoEhPosOp(contexto = {}) {
  return contem(contexto.servico || "", ["pos-operatorio", "pos operatorio", "pos op", "pos"]);
}

/**
 * Há sinal corporal preocupante na mensagem?
 * FORTE dispara sozinho. FRACO exige referência ao corpo (ou serviço de pós-op) — senão
 * "comprei uma bolsa roxa" acende o alarme vermelho e o alarme deixa de significar alguma coisa.
 */
export function temSinalCorporal(msg, contexto = {}) {
  if (contem(msg, SINAL_FORTE)) return true;
  if (!contem(msg, SINAL_FRACO)) return false;
  if (contem(msg, REFERENCIA_CORPORAL)) return true;
  if (Boolean(contexto.pos_operatorio) || servicoEhPosOp(contexto)) return true;
  // Cauda longa: primeira pessoa + sinal, desde que não esteja falando de um objeto.
  return contem(msg, PRIMEIRA_PESSOA) && !contem(msg, OBJETO_NAO_CORPO);
}

/**
 * É intercorrência de pós-op? Exige sinal + contexto de pós-op — que pode vir da mensagem, do
 * histórico da cliente OU do serviço que ela faz. Antes só olhava `contexto.pos_operatorio`,
 * um campo que nada no sistema preenchia: a regra mais grave era a mais difícil de disparar,
 * num negócio em que pós-operatório é o serviço de US$ 100.
 */
export function ehIntercorrenciaPosOp(msg, contexto = {}) {
  if (!temSinalCorporal(msg, contexto)) return false;
  return contem(msg, POS_OP_CONTEXTO) || Boolean(contexto.pos_operatorio) || servicoEhPosOp(contexto);
}

// ---------------------------------------------------------------- idioma
// A configuração dela manda: "responder no idioma em que a cliente escreveu; se não der para
// identificar, escalar em vez de escolher". Isso estava escrito na config e não existia no código.
// Detector deliberadamente simples e conservador: só afirma "é português" quando tem prova.
// Marcadores DISTINTIVOS. Duas disciplinas aprendidas na marra:
//   1. casamento por palavra inteira (senão "esperando" conta como o inglês "and");
//   2. nada de palavra que exista nos dois idiomas — "for", "para", "por favor" e "no" são
//      armadilhas: "sim, se for de manhã" era classificado como inglês por causa de "for".
// Disciplina desta lista, aprendida em duas rodadas de auditoria:
//   1. casamento por palavra inteira (senão "esperando" conta como o inglês "and");
//   2. NENHUM token que exista também em português. Foi assim que `"do"` — uma das palavras mais
//      comuns do português — entrou na lista de inglês e passou a escalar "qual o valor do pós?",
//      "o preço do pacote mudou?", "tá saindo um liquido do lugar". Nove em vinte mensagens
//      normais iam para a Andreia com um motivo que ela sabe que é falso, e regra que mente
//      perde a autoridade inteira do painel.
// Tokens banidos por ambiguidade pt/en/es: do, am, is, are, esta, una, no, para, por favor, for.
const MARCADORES = {
  pt: ["nao", "voce", "vc", "obrigada", "obrigado", "ola", "bom dia", "boa tarde", "boa noite",
    "quero", "posso", "preciso", "horario", "amanha", "hoje", "meu", "minha", "pra", "pro",
    "tudo bem", "sim", "que", "uma", "muito", "estou", "tenho", "fazer", "dia", "voces",
    "sao", "entao", "tambem", "ja", "aqui", "isso", "seu", "sua", "ele", "ela", "valor",
    "preco", "quanto", "onde", "quando", "qual", "com", "dos", "das", "pelo", "pela"],
  en: ["the", "you", "your", "i'm", "could", "please", "thanks", "thank", "appointment",
    "tomorrow", "today", "how much", "my", "with", "what", "when", "there", "it's",
    "can", "will", "would", "need", "want", "have", "book", "schedule", "available", "does"],
  es: ["gracias", "usted", "manana", "hoy", "quiero", "necesito", "cita", "cuanto", "puedo",
    "buenos dias", "buenas tardes", "muy", "tengo", "hacer", "los", "las",
    "cuesta", "drenaje", "tambien", "ustedes", "quisiera", "quisiera saber", "el masaje"],
};

// Para AFIRMAR idioma estrangeiro é preciso evidência, não um token solto.
const PLACAR_MINIMO_IDIOMA = 2;
const MARGEM_MINIMA_IDIOMA = 2;

/**
 * Devolve "pt" | "en" | "es" | null. `null` significa "não sei" e, pela regra dela, pode virar
 * escalada — mas só quando a mensagem for longa o bastante para que "não sei" seja informação
 * (ver o portão em `decidir`). Mensagens curtas caem no fluxo normal.
 */
export function detectarIdioma(msg) {
  const t = norm(msg);
  if (!t) return null;
  const pontos = Object.fromEntries(
    Object.entries(MARCADORES).map(([lang, termos]) => [lang, termos.filter((termo) => contem(t, [termo])).length]),
  );
  const ordenado = Object.entries(pontos).sort((a, b) => b[1] - a[1]);
  const [melhor, placar] = ordenado[0];
  const [, segundo] = ordenado[1];
  // Um token solto não basta: exige placar mínimo E margem mínima sobre o segundo colocado.
  // Sem isto, uma única palavra ambígua decidia o idioma de uma frase inteira.
  if (placar < PLACAR_MINIMO_IDIOMA) return null;
  if (placar - segundo < MARGEM_MINIMA_IDIOMA) return null;
  return melhor;
}

/**
 * Tentativa de manipulação do assistente. A regra 6 dela lista isso como motivo de escalada
 * e não estava implementado. Não é que a injeção "funcione" — a ação já é decidida por regra e
 * tudo passa por aprovação humana — mas quem aprova precisa VER que a mensagem tentou.
 */
const MANIPULACAO = [
  "ignore as instrucoes", "ignore as instruções", "ignore previous", "ignore all previous",
  "desconsidere", "esqueca as regras", "esqueça as regras", "voce agora e", "você agora é",
  "system prompt", "prompt do sistema", "finja que", "aja como se", "pretend you",
  "nova instrucao", "nova instrução", "override",
];

export function ehTentativaDeManipulacao(msg) {
  return contem(msg, MANIPULACAO);
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

/**
 * Marcadores de condição. "sim, se for de manhã" NÃO é confirmação: é uma contraproposta.
 * Tratar como "sim" seco marcava a tarde para quem só pode de manhã — e isso vira no-show.
 */
const CONDICIONAL = ["se for", "se der", "se puder", "se tiver", "desde que", "so se", "só se",
  "contanto", "mas so", "mas só", "depende", "talvez", "acho que", "if it", "only if"];

export function ehCondicional(msg) {
  return contem(msg, CONDICIONAL);
}

export function classificarConfirmacao(msg, operacao) {
  const regras = operacao?.regras?.confirmacao || {};
  const aceitos = (regras.aceitos || CONFIRMA_EXPLICITA_PADRAO).map(norm);
  const naoAceitos = (regras.nao_aceitos || CONFIRMA_AMBIGUA_PADRAO).map(norm);
  const t = norm(msg);
  if (!t) return "vazia";
  if (SO_EMOJI.test(String(msg).trim())) return "ambigua";
  // Condição vence o "sim": confirmação condicional é ambígua, sempre.
  if (ehCondicional(t)) return "ambigua";
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
  // Sinal corporal sem contexto de pós-op ("minha barriga tá inchada e vermelha desde ontem").
  // Antes isto caía no default silencioso. Sinal no corpo de alguém nunca é caso de "não sei":
  // é escalada com prioridade, mesmo que a gente não saiba se ela operou.
  if (temSinalCorporal(texto, ctx)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R6.SINAL_CLINICO",
      motivo: "Relato de sinal no corpo (inchaço, vermelhidão, secreção) sem contexto conhecido. Escala com prioridade — a Emily não classifica gravidade.",
      corpo: CORPO.escalar_pos_op,
      bloqueios: ["nenhuma orientação clínica", "nenhuma remarcação automática"],
      alertas: ["PRIORIDADE ALTA — avisar Andreia agora"],
    });
  }

  // ---- 2b. PORTÃO DE IDIOMA. A config dela manda responder no idioma da cliente e escalar
  // quando não der para identificar. Os detectores comerciais abaixo são só em português, então
  // deixar uma mensagem em inglês seguir adiante produziria resposta em português para o caso
  // errado — foi assim que "I have diabetes, can I do the massage? how much is it?" recebia a
  // tabela de preços. Vem DEPOIS da urgência de propósito: segurança antes de idioma.
  {
    const idioma = ctx.idioma || detectarIdioma(texto);
    // Escala por idioma SOMENTE com detecção positiva de outro idioma. "Não sei" não é prova de
    // idioma estrangeiro: a primeira versão escalava por ausência de sinal e mandava "quanto custa
    // a drenagem?" para a Andreia. Quem cobre o texto indecifrável é o default fail-closed lá
    // embaixo, que também escala — só que pelo motivo certo.
    // `idioma_identificado: false` continua sendo um override explícito de quem chama.
    const forcado = ctx.idioma_identificado === false;
    if (forcado || (idioma && idioma !== "pt")) {
      return resultado({
        ...base,
        acao: "escalar",
        regra: "IDIOMA.NAO_IDENTIFICADO",
        motivo: idioma
          ? `Mensagem parece estar em "${idioma}". A Emily só tem regras validadas em português — quem responde é a Andreia.`
          : "Não foi possível identificar o idioma com segurança. A regra manda escalar em vez de escolher.",
        corpo: CORPO.escalar_idioma,
        bloqueios: ["não responder em idioma sem regras validadas", "não traduzir preço nem regra por conta própria"],
      });
    }
  }

  // ---- 2c. tentativa de manipulação (regra 6). Precede as regras comerciais: uma mensagem que
  // tenta reprogramar a assistente não é atendida, é mostrada para o humano.
  if (ehTentativaDeManipulacao(texto)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "R6.TENTATIVA_MANIPULACAO",
      motivo: "A mensagem contém instrução dirigida ao assistente (tentativa de manipulação). Escalada para revisão humana; nada é executado a partir do texto da cliente.",
      corpo: CORPO.escalar_padrao,
      bloqueios: ["não seguir instrução vinda da mensagem", "não confirmar horário a partir deste texto"],
      alertas: ["Possível tentativa de manipulação — leia a mensagem inteira antes de aprovar"],
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
  // A negação veta o pedido implícito ("amanhã não vou dar" não é querer marcar), mas NÃO veta
  // um pedido explícito na mesma frase: "não posso de manhã, tem horário à tarde?" continua
  // sendo um pedido de horário. Veto cego mandava isso para o default silencioso.
  const pedidoExplicito = contem(texto, PEDIDO_EXPLICITO);
  const pedeHorario = pedidoExplicito
    || (!contem(texto, NEGACAO_DE_AGENDAMENTO) && (contem(texto, PEDIDO_HORARIO) || contem(texto, ENCAIXE)));
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

  // ---- 11a. lista de espera: DECIDIDO em 14/08/2026 — não existe.
  //
  // Sostenes: "não vai ter lista de espera; só se for em relação ao horário, ela vai tentar
  // encaixar ou falar com as clientes que estão naquele horário e tentar manejar".
  // Ou seja: no lugar de uma fila anônima, um remanejo caso a caso, decidido pela Andreia.
  // A Emily não promete fila, não promete aviso automático e não fala com a outra cliente por
  // conta própria — ela oferece o caminho real e passa a decisão para a Andreia.
  if (contem(texto, LISTA_ESPERA)) {
    return resultado({
      ...base,
      acao: "responder",
      regra: "COM.SEM_LISTA_DE_ESPERA",
      motivo:
        "Lista de espera não existe (decisão 14/08). O caminho real é remanejo caso a caso, "
        + "e quem decide remanejar é a Andreia.",
      corpo:
        "lista de espera a gente não tem, pra não te deixar na dúvida esperando. "
        + "Mas me fala qual horário você queria que eu vejo com a Andreia se dá pra ajeitar.",
      acao_agenda: { tipo: "coletar_preferencia", detalhe: "Registrar o horário desejado. Nada reservado." },
      bloqueios: [
        "não prometer fila nem aviso automático",
        "não afirmar que o horário vai abrir",
        "não falar com a outra cliente sem decisão da Andreia",
      ],
    });
  }

  // ---- 11b. sinal: não existe política. Sostenes decidiu a lista de espera em 14/08 e não
  // falou de sinal — silêncio não é "sim" nem "não". Então a Emily nunca menciona sinal e
  // escala se perguntarem. Comportamento totalmente definido; deixou de ser pendência aberta.
  if (contem(texto, SINAL)) {
    return resultado({
      ...base,
      acao: "escalar",
      regra: "COM.SINAL_SEM_POLITICA",
      motivo: "Não existe política de sinal. A Emily não cobra, não promete e não inventa valor.",
      corpo: CORPO.escalar_sinal,
      bloqueios: ["não mencionar valor de sinal", "não cobrar nada antecipado"],
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
    // Enquanto o espelho do Agendor estiver desligado, estes horários vêm da GRADE dela, não da
    // AGENDA dela: são horários em que ela costuma atender, não horários que sabemos estar livres.
    // Oferecer sem ter lido a agenda é apostar, e a aposta aqui custa duas clientes no mesmo
    // horário. Então a Emily propõe (que é o valor do piloto) e quem aprova é avisado de conferir.
    const cega = ctx.ocupacoes_confiaveis !== true;
    return resultado({
      ...base,
      acao: "responder",
      regra: "AGENDA.PROPOR_HORARIO",
      motivo: cega
        ? "Pedido de horário com grade confirmada, mas SEM leitura da agenda real (espelho do Agendor desligado). Os horários vêm da grade — confira no Agendor antes de aprovar."
        : "Pedido de horário com grade confirmada e agenda lida. Horários livres reais.",
      corpo: lista ? `tenho ${lista}. Qual fica melhor pra você?` : CORPO.escalar_horario_pendente,
      acao_agenda: { tipo: "propor_horario", opcoes, fonte: cega ? "grade" : "agendor" },
      bloqueios: [
        "todos os serviços exigem avaliação prévia — agendar a AVALIAÇÃO, não o procedimento",
        ...(cega ? ["conferir no Agendor antes de aprovar — a agenda real não foi lida"] : []),
      ],
      alertas: cega ? ["Horários vêm da grade, não da agenda — CONFIRA no Agendor antes de aprovar"] : [],
    });
  }

  // ---- 13. preço: DESCOBERTA ANTES DO VALOR (decisão de Sostenes, 14/08/2026)
  //
  // A regra anterior despejava a tabela inteira na primeira pergunta. Sostenes vetou:
  // "sempre primeiro perguntando e validando a cliente com as regras de venda, antes de passar
  // qualquer tipo de preço; tentando entender ao máximo o que a cliente precisa".
  //
  // Então o preço tem duas portas, e a primeira é uma pergunta:
  //   a) não sei do que ela precisa  → pergunto (nenhum valor sai)
  //   b) sei o serviço               → dou o valor DAQUELE serviço, da tabela, e só dele
  // A tabela completa nunca é despejada: cardápio é o site, atendimento é conversa.
  if (contem(texto, PRECO)) {
    const servicos = Array.isArray(operacao.servicos) ? operacao.servicos : [];
    if (!servicos.length) {
      return resultado({
        ...base,
        acao: "escalar",
        regra: "COM.PRECO_SEM_CATALOGO",
        motivo: "Pergunta de preço sem catálogo carregado na configuração. A Emily não inventa valor.",
        corpo: CORPO.escalar_desconto,
        bloqueios: ["nenhum valor sem catálogo"],
        alertas: ["Catálogo vazio na configuração — escalar"],
      });
    }

    // O serviço pode vir da própria mensagem, do cadastro da cliente, ou de o humano ter
    // conversado e marcado a descoberta como feita no painel.
    const doTexto = servicoMencionado(texto, operacao, clinica);
    const doContexto = ctx.servico
      ? servicos.find((s) => contem(String(ctx.servico), nomesDoServico(s, clinica))) || null
      : null;
    const servico = doTexto || doContexto;

    if (!servico && ctx.descoberta_feita !== true) {
      return resultado({
        ...base,
        acao: "responder",
        regra: "COM.PRECO_DESCOBERTA",
        motivo:
          "Pergunta de preço SEM saber o que a cliente precisa. Regra de venda: descobrir primeiro, "
          + "precificar depois. Nenhum valor sai nesta mensagem.",
        corpo:
          "me conta rapidinho o que você tá querendo melhorar? "
          + "Assim eu já te falo certinho o que a Andreia indica pro seu caso e quanto fica.",
        acao_agenda: { tipo: "nenhuma", detalhe: "Descoberta em andamento — nada agendado." },
        bloqueios: [
          "NENHUM valor nesta mensagem",
          "não listar a tabela de serviços",
          "não prometer resultado",
        ],
        alertas: [
          "Descoberta: se a cliente já disse do que precisa, marque `descoberta_feita` antes de aprovar",
        ],
      });
    }

    // Descoberta feita mas serviço ainda não identificado: quem escolhe o procedimento é a
    // Andreia (todos exigem avaliação prévia), não a Emily e não a cliente.
    if (!servico) {
      return resultado({
        ...base,
        acao: "escalar",
        regra: "COM.PRECO_SERVICO_INDEFINIDO",
        motivo:
          "Descoberta feita, mas o serviço certo ainda não está definido — e indicar procedimento "
          + "é avaliação clínica, que é da Andreia.",
        corpo: CORPO.escalar_clinico,
        bloqueios: ["não indicar procedimento", "não dar valor sem serviço definido"],
      });
    }

    const apelido = apelidoServico(servico.nome_publico, clinica);
    return resultado({
      ...base,
      acao: "responder",
      regra: "COM.PRECO_SERVICO",
      motivo: `Serviço identificado (${servico.id}). Valor do catálogo autorizado, só deste serviço.`,
      corpo:
        `${apelido} fica US$ ${servico.preco_usd}, sessão de ${servico.politica_operacional?.duracao_min} min. `
        + "Antes a Andreia faz uma avaliação com você, pra ver se é mesmo o melhor pro seu caso. "
        + "Quer que eu veja um horário?",
      bloqueios: [
        "nenhum valor fora do catálogo",
        "nenhum desconto",
        "não listar os outros serviços",
      ],
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

/**
 * Pedido de remanejo — a mensagem que vai para a cliente que JÁ TEM o horário.
 *
 * Substitui a lista de espera (decisão de Sostenes, 14/08/2026): quando alguém quer um horário
 * ocupado, a Andreia decide se vale perguntar à cliente daquele horário se ela topa mudar.
 *
 * O tom foi especificado por ele e é o ponto inteiro da funcionalidade: "sempre com tom de
 * realmente saber que não está incomodando e que a cliente realmente pode [dizer não]". Por isso
 * a mensagem faz três coisas, nesta ordem:
 *   1. deixa explícito que o horário dela está garantido — a pergunta não é um aviso de mudança;
 *   2. oferece uma alternativa concreta, não um "quando você puder";
 *   3. termina dando permissão de recusar, sem pedir justificativa.
 *
 * O que ela NUNCA faz: dizer que outra pessoa quer o horário (a agenda de uma cliente não é
 * assunto de outra), insinuar urgência, ou tratar silêncio como aceite.
 *
 * Não envia nada: devolve rascunho para o Painel de Aprovação, como todo o resto da Fase 1.
 */
export function mensagemRemanejo({
  primeiro_nome = null,
  servico = null,
  horario_atual = null,
  horario_alternativo = null,
  atendimentos_anteriores = 0,
  clinica = {},
  agenda = {},
  agora = new Date(),
} = {}) {
  const fuso = agenda.fuso_horario || clinica.fuso_horario || "America/New_York";
  const nivel = nivelRelacao(atendimentos_anteriores);
  const apelido = servico ? apelidoServico(servico, clinica) : null;
  const atual = horario_atual ? rotuloQuando(horario_atual, { fuso, agora }) : null;
  const alternativo = horario_alternativo ? rotuloQuando(horario_alternativo, { fuso, agora }) : null;

  // Sem horário alternativo real não há pedido a fazer: perguntar "pode mudar?" sem dizer para
  // quando é empurrar o problema para a cliente. Fail-closed, como o resto do motor.
  if (!atual || !alternativo) {
    return {
      acao: "bloquear",
      regra: "AGENDA.REMANEJO_SEM_ALTERNATIVA",
      motivo: "Remanejo exige o horário atual E uma alternativa concreta. Sem os dois, não há pedido a enviar.",
      resposta_sugerida: null,
      requer_aprovacao_humana: true,
      envio_automatico: false,
      bloqueios: ["não pedir mudança sem oferecer horário concreto"],
    };
  }

  const corpo =
    `seu horário${apelido ? ` de ${apelido}` : ""} de ${atual} tá garantido, viu? `
    + `Só queria te perguntar uma coisa: por acaso ${alternativo} ficaria bom pra você também? `
    + "Se ficar, eu ajeito aqui. Se não ficar, não tem problema nenhum, fica como está";

  return {
    acao: "responder",
    regra: "AGENDA.REMANEJO_PEDIDO",
    motivo:
      "Pedido de remanejo caso a caso, no lugar de lista de espera. Só sai com aprovação da Andreia, "
      + "e o horário atual permanece ocupado até a cliente aceitar de forma explícita.",
    resposta_sugerida: montar({ nivel, primeiroNome: primeiro_nome, corpo, situacao: "aguardando_resposta" }),
    acao_agenda: { tipo: "nenhuma", detalhe: "O horário atual PERMANECE dela até aceitar explicitamente." },
    relacao: nivel,
    requer_aprovacao_humana: true,
    envio_automatico: false,
    bloqueios: [
      "não dizer que outra cliente quer o horário",
      "não criar urgência nem pressionar",
      "silêncio NÃO é aceite",
      "'tá bom' NÃO é aceite — vale a mesma regra da confirmação",
      "só mover a agenda depois de um sim explícito",
    ],
  };
}

export const CORPOS = CORPO;
