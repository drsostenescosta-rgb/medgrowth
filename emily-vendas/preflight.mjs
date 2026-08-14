#!/usr/bin/env node
// Preflight determinístico do Kit de Operação Assistida Andreia.
// Não conecta serviços externos, não lê .env e não processa dados de pacientes.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIAS = new Set(["seg", "ter", "qua", "qui", "sex", "sab", "dom"]);
const PLACEHOLDER = /\[\s*PREENCHER\b/i;

function erro(codigo, caminho, mensagem) {
  return { codigo, caminho, mensagem };
}

function temPlaceholder(valor) {
  if (typeof valor === "string") return PLACEHOLDER.test(valor);
  if (Array.isArray(valor)) return valor.some(temPlaceholder);
  if (valor && typeof valor === "object") return Object.values(valor).some(temPlaceholder);
  return false;
}

function minutos(hora) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hora));
  if (!match) return null;
  const [, h, m] = match;
  return Number(h) < 24 && Number(m) < 60 ? Number(h) * 60 + Number(m) : null;
}

function validarFaixas(dias, erros) {
  let temFaixaAtiva = false;
  if (!dias || typeof dias !== "object" || Array.isArray(dias)) {
    erros.push(erro("AGENDA_DIAS_INVALIDOS", "agenda.dias", "dias deve ser um objeto com as faixas por dia."));
    return temFaixaAtiva;
  }
  for (const [dia, faixas] of Object.entries(dias)) {
    if (!DIAS.has(dia)) erros.push(erro("DIA_INVALIDO", `agenda.dias.${dia}`, "dia da semana não reconhecido."));
    if (!Array.isArray(faixas)) {
      erros.push(erro("FAIXAS_INVALIDAS", `agenda.dias.${dia}`, "faixas deve ser uma lista."));
      continue;
    }
    let fimAnterior = -1;
    for (const [indice, faixa] of faixas.entries()) {
      const partes = String(faixa).split("-");
      const inicio = minutos(partes[0]);
      const fim = minutos(partes[1]);
      const caminho = `agenda.dias.${dia}[${indice}]`;
      if (partes.length !== 2 || inicio === null || fim === null || inicio >= fim) {
        erros.push(erro("FAIXA_INVALIDA", caminho, "use HH:MM-HH:MM com fim posterior ao início."));
      } else if (inicio < fimAnterior) {
        erros.push(erro("FAIXA_SOBREPOSTA", caminho, "as faixas do dia não podem se sobrepor."));
      } else {
        temFaixaAtiva = true;
      }
      if (fim !== null) fimAnterior = Math.max(fimAnterior, fim);
    }
  }
  return temFaixaAtiva;
}

function inteiroNaoNegativo(valor) {
  return Number.isInteger(valor) && valor >= 0;
}

function validarAgenda(agenda, erros) {
  if (!agenda || typeof agenda !== "object") {
    erros.push(erro("AGENDA_AUSENTE", "agenda", "configuração da agenda ausente ou inválida."));
    return;
  }
  if (!Number.isInteger(agenda.duracao_min) || agenda.duracao_min < 15 || agenda.duracao_min > 240) {
    erros.push(erro("DURACAO_INVALIDA", "agenda.duracao_min", "duração deve ser um inteiro entre 15 e 240 minutos."));
  }
  if (!inteiroNaoNegativo(agenda.buffer_min)) {
    erros.push(erro("BUFFER_INVALIDO", "agenda.buffer_min", "buffer_min deve ser um inteiro maior ou igual a zero."));
  }
  if (typeof agenda.fonte_verdade !== "string" || !agenda.fonte_verdade.trim()) {
    erros.push(erro("FONTE_VERDADE_AUSENTE", "agenda.fonte_verdade", "defina a fonte de verdade da agenda antes de sugerir horários."));
  }
  if (typeof agenda.fuso_horario !== "string" || !agenda.fuso_horario.trim()) {
    erros.push(erro("FUSO_HORARIO_AUSENTE", "agenda.fuso_horario", "defina o fuso horário IANA da clínica."));
  } else {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: agenda.fuso_horario });
    } catch {
      erros.push(erro("FUSO_HORARIO_INVALIDO", "agenda.fuso_horario", "use um fuso horário IANA válido, por exemplo America/New_York."));
    }
  }
  if (!inteiroNaoNegativo(agenda.antecedencia_horas)) {
    erros.push(erro("ANTECEDENCIA_INVALIDA", "agenda.antecedencia_horas", "antecedencia_horas deve ser um inteiro maior ou igual a zero."));
  }
  if (!validarFaixas(agenda.dias, erros)) {
    erros.push(erro("AGENDA_SEM_FAIXA_ATIVA", "agenda.dias", "cadastre pelo menos uma faixa ativa e válida."));
  }
}

function validarOperacao(operacao, erros) {
  if (!operacao || typeof operacao !== "object") {
    erros.push(erro("OPERACAO_AUSENTE", "operacao", "arquivo de operação assistida ausente ou inválido."));
    return;
  }
  if (operacao.modo !== "assistido") {
    erros.push(erro("MODO_NAO_ASSISTIDO", "operacao.modo", "o piloto deve permanecer em modo assistido."));
  }
  if (typeof operacao.responsavel_escalacao !== "string" || !operacao.responsavel_escalacao.trim()) {
    erros.push(erro("RESPONSAVEL_AUSENTE", "operacao.responsavel_escalacao", "defina quem recebe escalações."));
  }
  const confirmacao = operacao.regras?.confirmacao;
  if (
    !confirmacao ||
    confirmacao.exige_confirmacao_explicita !== true ||
    confirmacao.reconfirma_termos_ambiguos !== true
  ) {
    erros.push(erro("CONFIRMACAO_INCOMPLETA", "operacao.regras.confirmacao", "exija confirmação explícita e reconfirmação de termos ambíguos."));
  }
  const cancelamento = operacao.regras?.cancelamento;
  if (
    !cancelamento ||
    cancelamento.nao_remove_sem_confirmacao_explicita !== true ||
    cancelamento.revisao_humana_obrigatoria !== true
  ) {
    erros.push(erro("CANCELAMENTO_INCOMPLETO", "operacao.regras.cancelamento", "proíba remoção sem confirmação e exija revisão humana."));
  }
  if (operacao.regras?.transparencia?.identifica_como_assistente !== true) {
    erros.push(erro("TRANSPARENCIA_INCOMPLETA", "operacao.regras.transparencia", "a cliente deve saber que está falando com uma assistente."));
  }
  if (operacao.automacao?.envio_automatico !== false) {
    erros.push(erro("ENVIO_AUTOMATICO_NAO_BLOQUEADO", "operacao.automacao.envio_automatico", "envio automático deve permanecer false nesta fatia."));
  }
  if (operacao.revisao_humana_obrigatoria !== true) {
    erros.push(erro("REVISAO_HUMANA_AUSENTE", "operacao.revisao_humana_obrigatoria", "toda mensagem e ação exige revisão humana."));
  }
  const topicosObrigatorios = ["clinico", "urgencia", "pessoal", "preco_nao_autorizado"];
  const topicos = operacao.escalonamento?.topicos;
  if (!Array.isArray(topicos) || topicosObrigatorios.some((topico) => !topicos.includes(topico))) {
    erros.push(erro("ESCALONAMENTO_INCOMPLETO", "operacao.escalonamento.topicos", `inclua: ${topicosObrigatorios.join(", ")}.`));
  }
  const shadow = operacao.shadow_sintetico;
  const simulacoesObrigatorias = ["novo_pedido", "conflito", "confirmacao_ambigua", "cancelamento", "escalacao_clinica"];
  if (
    !shadow ||
    shadow.habilitado !== true ||
    typeof shadow.revisor_humano !== "string" ||
    !shadow.revisor_humano.trim() ||
    !Array.isArray(shadow.simulacoes) ||
    simulacoesObrigatorias.some((simulacao) => !shadow.simulacoes.includes(simulacao))
  ) {
    erros.push(erro("SHADOW_SINTETICO_INCOMPLETO", "operacao.shadow_sintetico", `exija revisor humano e simulações: ${simulacoesObrigatorias.join(", ")}.`));
  }
  if (!Array.isArray(operacao.servicos) || operacao.servicos.length === 0) {
    erros.push(erro("SERVICOS_AUSENTES", "operacao.servicos", "cadastre ao menos um serviço com política operacional."));
    return;
  }
  const ids = new Set();
  for (const [indice, servico] of operacao.servicos.entries()) {
    const caminho = `operacao.servicos[${indice}]`;
    const politica = servico?.politica_operacional;
    const id = typeof servico?.id === "string" ? servico.id.trim() : "";
    if (!id || PLACEHOLDER.test(id)) {
      erros.push(erro("ID_SERVICO_INVALIDO", `${caminho}.id`, "id de serviço deve ser texto não vazio e não-placeholder."));
    } else {
      const idNormalizado = id.toLowerCase();
      if (ids.has(idNormalizado)) {
        erros.push(erro("ID_SERVICO_DUPLICADO", `${caminho}.id`, "ids de serviço devem ser únicos."));
      }
      ids.add(idNormalizado);
    }
    if (!politica || typeof politica !== "object") {
      erros.push(erro("POLITICA_SERVICO_AUSENTE", caminho, "todo serviço precisa de política operacional."));
      continue;
    }
    if (!Number.isInteger(politica.duracao_min) || politica.duracao_min < 15 || politica.duracao_min > 240) {
      erros.push(erro("DURACAO_SERVICO_INVALIDA", `${caminho}.politica_operacional.duracao_min`, "duração do serviço deve estar entre 15 e 240 minutos."));
    }
    if (!inteiroNaoNegativo(politica.buffer_min)) {
      erros.push(erro("BUFFER_SERVICO_INVALIDO", `${caminho}.politica_operacional.buffer_min`, "buffer do serviço deve ser inteiro maior ou igual a zero."));
    }
    if (politica.requer_confirmacao_explicita !== true || politica.escalar_se_duvida !== true) {
      erros.push(erro("POLITICA_SERVICO_INCOMPLETA", `${caminho}.politica_operacional`, "o serviço deve exigir confirmação explícita e escalação em caso de dúvida."));
    }
  }
}

/** Retorna uma lista vazia somente quando a configuração é segura para a operação assistida. */
export function avaliarPreflight({ clinica, agenda, operacao }) {
  const erros = [];
  if (!clinica || typeof clinica !== "object") {
    erros.push(erro("CLINICA_AUSENTE", "clinica", "configuração da clínica ausente ou inválida."));
  } else {
    for (const campo of ["nome_clinica", "endereco_clinica", "nome_humano_responsavel"]) {
      const valor = clinica[campo];
      if (typeof valor !== "string" || !valor.trim() || PLACEHOLDER.test(valor)) {
        erros.push(erro("CAMPO_CLINICA_INVALIDO", `clinica.${campo}`, "preencha com texto não-placeholder antes da operação."));
      }
    }
  }
  for (const [nome, config] of Object.entries({ clinica, agenda, operacao })) {
    if (temPlaceholder(config)) {
      erros.push(erro("PLACEHOLDER_ENCONTRADO", nome, "substitua todos os campos [PREENCHER] antes da operação."));
    }
  }
  validarAgenda(agenda, erros);
  validarOperacao(operacao, erros);
  return erros;
}

function lerJson(caminho, nome) {
  if (!existsSync(caminho)) throw new Error(`${nome} não encontrado: ${caminho}`);
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch (cause) {
    throw new Error(`${nome} contém JSON inválido: ${cause.message}`);
  }
}

function caminhoArg(args, nome, padrao) {
  const indice = args.indexOf(nome);
  return indice === -1 ? padrao : args[indice + 1];
}

export function executarCli(args = process.argv.slice(2)) {
  const clinicaPath = caminhoArg(args, "--clinica", join(ROOT, "clinica-config.json"));
  const agendaPath = caminhoArg(args, "--agenda", join(ROOT, "agenda-config.json"));
  const operacaoPath = caminhoArg(args, "--operacao", join(ROOT, "operacao-assistida.json"));
  let dados;
  try {
    dados = {
      clinica: lerJson(clinicaPath, "configuração da clínica"),
      agenda: lerJson(agendaPath, "configuração da agenda"),
      operacao: lerJson(operacaoPath, "configuração da operação assistida"),
    };
  } catch (e) {
    console.error(`PRE-FLIGHT REPROVADO: ${e.message}`);
    return 1;
  }
  const erros = avaliarPreflight(dados);
  if (erros.length) {
    console.error(`PRE-FLIGHT REPROVADO (${erros.length} problema(s))`);
    for (const item of erros) console.error(`- [${item.codigo}] ${item.caminho}: ${item.mensagem}`);
    return 1;
  }
  console.log("PRE-FLIGHT APROVADO: apto SOMENTE para shadow sintético revisado por humano; NÃO autoriza dados reais, integração de canais ou go-live.");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = executarCli();
}
