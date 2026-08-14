#!/usr/bin/env node
// Workbench local, determinístico e estritamente sintético. Não chama rede, env, LLM ou canais.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { avaliarPreflight } from "./preflight.mjs";
import { exigirSomenteSintetico } from "./redaction.mjs";
import { normalizarTimestampISO, resultadoSeguro, validarSchemaSintetico, VEREDITO_MAXIMO } from "./shadow-policy.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(ROOT, ".shadow-reports");
const LATEST = "shadow-workbench-latest.json";
const VERSAO = "shadow-workbench.v1";
const DIAS = Object.freeze({ Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab", Sun: "dom" });

function lerJson(caminho) { return JSON.parse(readFileSync(caminho, "utf8")); }
function hashDe(dados) { return createHash("sha256").update(JSON.stringify(dados)).digest("hex"); }

function minutos(horario) {
  const [hora, minuto] = horario.split(":").map(Number);
  return hora * 60 + minuto;
}

function partesNoFuso(instante, fuso) {
  const formatador = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatador.formatToParts(new Date(instante)).filter((parte) => parte.type !== "literal").map((parte) => [parte.type, parte.value]));
}

function validarOffsetDoFuso(valor, fuso, caminho) {
  const literal = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(valor);
  const local = partesNoFuso(Date.parse(valor), fuso);
  const observadas = [local.year, local.month, local.day, local.hour, local.minute, local.second];
  if (!literal || literal.slice(1).some((parte, indice) => parte !== observadas[indice])) throw new Error(`INVARIANTE_FUSO_DIVERGENTE:${caminho}`);
}

function politicaEfetiva(config) {
  const politica = config.operacao.servicos[0].politica_operacional;
  return {
    duracao_min: Math.max(config.agenda.duracao_min, politica.duracao_min),
    buffer_min: Math.max(config.agenda.buffer_min, politica.buffer_min),
  };
}

function janelaDoSlot(inicio, config, caminho) {
  const inicioNormalizado = normalizarTimestampISO(inicio, caminho);
  validarOffsetDoFuso(inicio, config.agenda.fuso_horario, caminho);
  const politica = politicaEfetiva(config);
  const inicioMs = Date.parse(inicio);
  const fimAtendimentoMs = inicioMs + politica.duracao_min * 60_000;
  const fimBufferMs = fimAtendimentoMs + politica.buffer_min * 60_000;
  const localInicio = partesNoFuso(inicioMs, config.agenda.fuso_horario);
  const localFim = partesNoFuso(fimBufferMs, config.agenda.fuso_horario);
  const dia = DIAS[localInicio.weekday];
  const mesmaData = localInicio.year === localFim.year && localInicio.month === localFim.month && localInicio.day === localFim.day;
  const inicioMin = Number(localInicio.hour) * 60 + Number(localInicio.minute);
  const fimMin = Number(localFim.hour) * 60 + Number(localFim.minute);
  const faixa = mesmaData ? config.agenda.dias[dia].find((item) => {
    const [faixaInicio, faixaFim] = item.split("-");
    return inicioMin >= minutos(faixaInicio) && fimMin <= minutos(faixaFim);
  }) : undefined;
  if (!faixa) throw new Error(`INVARIANTE_SLOT_FORA_FAIXA:${caminho}`);
  return {
    inicio: inicioNormalizado,
    fim_atendimento: new Date(fimAtendimentoMs).toISOString(),
    fim_com_buffer: new Date(fimBufferMs).toISOString(),
    inicio_ms: inicioMs,
    fim_com_buffer_ms: fimBufferMs,
    duracao_min: politica.duracao_min,
    buffer_min: politica.buffer_min,
    dia,
    faixa,
  };
}

function conflitaComOcupacao(janela, ocupacao, bufferMin) {
  const ocupadoInicio = Date.parse(ocupacao.inicio);
  const ocupadoFimComBuffer = Date.parse(ocupacao.fim) + bufferMin * 60_000;
  return janela.inicio_ms < ocupadoFimComBuffer && janela.fim_com_buffer_ms > ocupadoInicio;
}

function validarAlternativas(alternativas, config, cenario) {
  if (alternativas.length !== 2) throw new Error(`INVARIANTE_SLOTS_INVALIDA:${cenario}`);
  const politica = politicaEfetiva(config);
  return alternativas.map((inicio, indice) => {
    const janela = janelaDoSlot(inicio, config, `${cenario}.alternativas_sinteticas[${indice}]`);
    if (config.agenda.ocupacoes_sinteticas.some((ocupado) => conflitaComOcupacao(janela, ocupado, politica.buffer_min))) {
      throw new Error(`INVARIANTE_SLOT_OCUPADO:${cenario}:${inicio}`);
    }
    return janela.inicio;
  });
}

function provaAgenda(agenda, hashAntes, ocupacoesAntes) {
  const hashDepois = hashDe(agenda);
  const ocupacoesDepois = agenda.ocupacoes_sinteticas.length;
  return {
    hash_antes: hashAntes,
    hash_depois: hashDepois,
    ocupacoes_antes: ocupacoesAntes,
    ocupacoes_depois: ocupacoesDepois,
    estado_inalterado: hashAntes === hashDepois,
    sem_dupla_reserva: hashAntes === hashDepois && ocupacoesAntes === ocupacoesDepois,
  };
}

function avaliarCaso(caso, config) {
  const { agenda } = config;
  const hashAntes = hashDe(agenda);
  const ocupacoesAntes = agenda.ocupacoes_sinteticas.length;
  const politica = politicaEfetiva(config);
  switch (caso.tipo) {
    case "novo_pedido": {
      janelaDoSlot(caso.horario_solicitado, config, `${caso.id}.horario_solicitado`);
      const alternativas = validarAlternativas(caso.alternativas_sinteticas, config, caso.id);
      return resultadoSeguro({
        cenario: caso.id,
        decisao: "RASCUNHO_PARA_REVISAO",
        motivo: "Novo pedido gera exatamente duas opções locais; não envia nem reserva.",
        alternativas_sinteticas: alternativas,
        estado_agenda: provaAgenda(agenda, hashAntes, ocupacoesAntes),
        invariantes: { exatamente_dois_slots: caso.alternativas_sinteticas.length === 2 },
      });
    }
    case "conflito": {
      const janelaSolicitada = janelaDoSlot(caso.horario_solicitado, config, `${caso.id}.horario_solicitado`);
      const temConflito = agenda.ocupacoes_sinteticas.some((ocupado) => conflitaComOcupacao(janelaSolicitada, ocupado, politica.buffer_min));
      if (!temConflito) throw new Error("INVARIANTE_CONFLITO_AUSENTE: o cenário de conflito deve realmente sobrepor uma ocupação sintética");
      const alternativas = validarAlternativas(caso.alternativas_sinteticas, config, caso.id);
      const estadoAgenda = provaAgenda(agenda, hashAntes, ocupacoesAntes);
      if (!estadoAgenda.sem_dupla_reserva) throw new Error("INVARIANTE_AGENDA_MUTADA:conflito");
      return resultadoSeguro({
        cenario: caso.id,
        decisao: "BLOQUEAR_E_OFERECER_ALTERNATIVAS",
        motivo: "Conflito detectado; bloqueia a solicitação e oferece duas alternativas sintéticas.",
        alternativas_sinteticas: alternativas,
        estado_agenda: estadoAgenda,
        invariantes: { conflito_detectado: true, conflito_considera_buffer: true, exatamente_dois_slots: alternativas.length === 2, sem_dupla_reserva: true },
      });
    }
    case "confirmacao_ambigua":
      return resultadoSeguro({ cenario: caso.id, decisao: "PEDIR_CONFIRMACAO_EXPLICITA", motivo: "Termo ambíguo não confirma horário nem consentimento.", status_operacional: "aguardando_confirmacao_explicita", estado_agenda: provaAgenda(agenda, hashAntes, ocupacoesAntes), invariantes: { confirmacao_registrada: false, aguardando_confirmacao: true } });
    case "cancelamento":
      return resultadoSeguro({
        cenario: caso.id,
        decisao: "MANTER_AGENDAMENTO_E_ESCALAR",
        motivo: "Cancelamento ambíguo preserva o horário e aguarda confirmação explícita.",
        etapas: ["manter_agendamento", "pedir_confirmacao_cancelamento", "aguardar_confirmacao_explicita"],
        status_operacional: "aguardando_confirmacao_cancelamento",
        proxima_transicao_condicional: { se: "confirmacao_cancelamento_explicita", entao: "cancelamento_pendente_revisao" },
        estado_agenda: provaAgenda(agenda, hashAntes, ocupacoesAntes),
        invariantes: { cancelamento_nao_executado: true },
      });
    case "escalacao_clinica":
      return resultadoSeguro({ cenario: caso.id, decisao: "PAUSAR_E_ESCALAR", motivo: "Dúvida clínica exige responsável humano; nenhuma orientação é gerada.", status_operacional: "pausado_aguardando_responsavel", acoes_bloqueadas: ["followup", "upsell"], estado_agenda: provaAgenda(agenda, hashAntes, ocupacoesAntes), invariantes: { resposta_clinica_gerada: false, followup_gerado: false, upsell_gerado: false } });
    default:
      throw new Error(`CENARIO_DESCONHECIDO:${caso.tipo}`);
  }
}

export function executarWorkbench({ operacao, casos, timestamp = new Date().toISOString() }) {
  exigirSomenteSintetico(operacao);
  exigirSomenteSintetico(casos);
  validarSchemaSintetico(operacao, casos);
  const timestampNormalizado = normalizarTimestampISO(timestamp, "relatorio.timestamp");
  exigirSomenteSintetico({ timestamp: timestampNormalizado });
  const erros = avaliarPreflight(operacao);
  if (erros.length) throw new Error(`PREFLIGHT_REPROVADO:${erros.map((erro) => erro.codigo).join(",")}`);
  const resultados = casos.casos.map((caso) => avaliarCaso(caso, operacao));
  const base = {
    versao: VERSAO,
    hash_entrada: hashDe({ operacao, casos }),
    timestamp: timestampNormalizado,
    ambiente: "LOCAL_SINTETICO",
    resultados,
    revisao_humana: "PENDENTE",
    revisao_humana_concluida: false,
    atestacao_humana: null,
    veredito: VEREDITO_MAXIMO,
  };
  return { ...base, hash_relatorio: hashDe(base) };
}

export function criarAtestacaoHumana({ relatorio, hash_atestado, revisor, decisao, confirmacao, timestamp = new Date().toISOString() }) {
  if (!relatorio || typeof relatorio !== "object") throw new Error("ATESTACAO_RELATORIO_INVALIDO");
  const { hash_relatorio: hashRegistrado, ...conteudoRelatorio } = relatorio;
  if (hashDe(conteudoRelatorio) !== hashRegistrado) throw new Error("ATESTACAO_RELATORIO_ADULTERADO");
  if (hashRegistrado !== hash_atestado) throw new Error("ATESTACAO_HASH_DIVERGENTE");
  if (relatorio.revisao_humana !== "PENDENTE" || relatorio.revisao_humana_concluida !== false) throw new Error("ATESTACAO_ESTADO_INVALIDO");
  if (typeof revisor !== "string" || !revisor.trim() || /(?:^|[\s_-])(?:auto|automatico|automático|workbench|sistema|ia|ai|bot|agent)(?:$|[\s_-])/i.test(revisor)) throw new Error("ATESTACAO_AUTOAPROVACAO_PROIBIDA");
  if (confirmacao !== "REVISAO_HUMANA_CONFIRMADA") throw new Error("ATESTACAO_CONFIRMACAO_HUMANA_AUSENTE");
  if (!["APROVADO_PARA_PROXIMA_ETAPA", "REPROVADO"].includes(decisao)) throw new Error("ATESTACAO_DECISAO_INVALIDA");
  const timestampNormalizado = normalizarTimestampISO(timestamp, "atestacao.timestamp");
  exigirSomenteSintetico({ timestamp: timestampNormalizado });
  return { versao: "shadow-attestation.v1", natureza: "AUTODECLARACAO_LOCAL_NAO_AUTENTICADA", hash_relatorio: hash_atestado, revisor: revisor.trim(), decisao, timestamp: timestampNormalizado };
}

export function resolverSaida(args = [], existe = existsSync, inspecionar = (caminho) => {
  const stat = lstatSync(caminho);
  return { symlink: stat.isSymbolicLink(), nlink: stat.nlink };
}) {
  let nome = LATEST;
  let recebeuSaida = false;
  let novoRelatorio = false;
  for (let indice = 0; indice < args.length; indice += 1) {
    const arg = args[indice];
    if (arg === "--saida" && !recebeuSaida) {
      recebeuSaida = true;
      nome = args[indice + 1];
      indice += 1;
      if (!nome) throw new Error("--saida requer um nome de arquivo");
    } else if (arg === "--novo-relatorio" && !novoRelatorio) {
      novoRelatorio = true;
    } else {
      throw new Error(`ARGUMENTO_INVALIDO:${arg}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(nome)) throw new Error("SAIDA_FORA_DIRETORIO_PROTEGIDO");
  if (nome !== LATEST && !novoRelatorio) throw new Error("NOVO_RELATORIO_EXIGE_FLAG_EXPLICITA");
  if (nome === LATEST && novoRelatorio) throw new Error("FLAG_NOVO_NAO_PERMITIDA_PARA_LATEST");
  const caminho = join(REPORTS_DIR, nome);
  if (existe(REPORTS_DIR) && inspecionar(REPORTS_DIR).symlink) throw new Error("DIRETORIO_RELATORIOS_SYMLINK_PROIBIDO");
  if (nome !== LATEST && existe(caminho)) throw new Error("RELATORIO_EXISTENTE_NAO_SOBRESCRITO");
  if (existe(caminho)) {
    const estado = inspecionar(caminho);
    if (estado.symlink) throw new Error("SAIDA_SYMLINK_PROIBIDA");
    if (estado.nlink > 1) throw new Error("SAIDA_HARDLINK_PROIBIDA");
  }
  return { caminho, sobrescrever: nome === LATEST };
}

export function escreverRelatorio({ caminho, sobrescrever }, conteudo) {
  if (!sobrescrever) {
    writeFileSync(caminho, conteudo, { encoding: "utf8", flag: "wx" });
    return;
  }
  const temporario = join(REPORTS_DIR, `.shadow-workbench-latest.${process.pid}.tmp`);
  let criado = false;
  try {
    writeFileSync(temporario, conteudo, { encoding: "utf8", flag: "wx" });
    criado = true;
    renameSync(temporario, caminho);
  } catch (erro) {
    if (criado && existsSync(temporario)) unlinkSync(temporario);
    throw erro;
  }
}

export function executarCli(args = process.argv.slice(2)) {
  const operacaoPath = join(ROOT, "fixtures", "shadow-operacao.v1.json");
  const casosPath = join(ROOT, "fixtures", "shadow-casos.v1.json");
  try {
    const { caminho, sobrescrever } = resolverSaida(args);
    const relatorio = executarWorkbench({ operacao: lerJson(operacaoPath), casos: lerJson(casosPath) });
    mkdirSync(REPORTS_DIR, { recursive: true });
    escreverRelatorio({ caminho, sobrescrever }, `${JSON.stringify(relatorio, null, 2)}\n`);
    console.log(`WORKBENCH CONCLUIDO: ${caminho}`);
    console.log(`VEREDITO: ${relatorio.veredito}; REVISAO HUMANA: ${relatorio.revisao_humana}; CONCLUIDA: ${relatorio.revisao_humana_concluida}`);
    return 0;
  } catch (erro) {
    console.error(`WORKBENCH REPROVADO: ${erro.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = executarCli();
