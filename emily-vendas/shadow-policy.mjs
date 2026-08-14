export const VEREDITO_MAXIMO = "APTO_PARA_REVISAO_HUMANA";
export const TIPOS_OBRIGATORIOS = Object.freeze([
  "novo_pedido",
  "conflito",
  "confirmacao_ambigua",
  "cancelamento",
  "escalacao_clinica",
]);

export const ACOES_PROIBIDAS = new Set([
  "enviar_mensagem",
  "reservar_horario",
  "remover_agendamento",
  "integrar_canal",
]);

function falhar(codigo, caminho, mensagem) {
  throw new Error(`${codigo}:${caminho}: ${mensagem}`);
}

function objetoExato(valor, caminho, obrigatorias) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) falhar("SCHEMA_TIPO_INVALIDO", caminho, "objeto esperado");
  const permitidas = new Set(obrigatorias);
  for (const chave of Object.keys(valor)) if (!permitidas.has(chave)) falhar("SCHEMA_CHAVE_DESCONHECIDA", `${caminho}.${chave}`, "chave não permitida");
  for (const chave of obrigatorias) if (!Object.hasOwn(valor, chave)) falhar("SCHEMA_CAMPO_AUSENTE", `${caminho}.${chave}`, "campo obrigatório ausente");
}

function listaExata(valor, caminho, tamanho) {
  if (!Array.isArray(valor) || valor.length !== tamanho) falhar("SCHEMA_LISTA_INVALIDA", caminho, `lista deve conter exatamente ${tamanho} item(ns)`);
}

function texto(valor, caminho, padrao = null) {
  if (typeof valor !== "string" || !valor.trim() || valor.length > 120 || /[\r\n]/.test(valor)) falhar("SCHEMA_TEXTO_INVALIDO", caminho, "texto curto de uma linha esperado");
  if (padrao && !padrao.test(valor)) falhar("SCHEMA_TEXTO_INVALIDO", caminho, "valor fora do formato permitido");
}

function enumExato(valor, caminho, esperado) {
  if (valor !== esperado) falhar("SCHEMA_ENUM_INVALIDO", caminho, `valor deve ser ${esperado}`);
}

export function normalizarTimestampISO(valor, caminho = "timestamp") {
  texto(valor, caminho, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(valor);
  if (!match) falhar("SCHEMA_TIMESTAMP_INVALIDO", caminho, "timestamp ISO inválido");
  const [, ano, mes, dia, hora, minuto, segundo, milissegundo = "000", zona, sinal, offsetHora = "00", offsetMinuto = "00"] = match;
  const offsetH = Number(offsetHora);
  const offsetM = Number(offsetMinuto);
  if (offsetH > 14 || offsetM > 59 || (offsetH === 14 && offsetM !== 0)) falhar("SCHEMA_TIMESTAMP_INVALIDO", caminho, "offset fora do intervalo válido");
  const instante = new Date(valor);
  if (!Number.isFinite(instante.getTime())) falhar("SCHEMA_TIMESTAMP_INVALIDO", caminho, "timestamp inválido");
  const deslocamento = zona === "Z" ? 0 : (sinal === "+" ? 1 : -1) * (offsetH * 60 + offsetM);
  const local = new Date(instante.getTime() + deslocamento * 60_000);
  const partes = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()];
  const esperadas = [Number(ano), Number(mes), Number(dia), Number(hora), Number(minuto), Number(segundo), Number(milissegundo)];
  if (partes.some((parte, indice) => parte !== esperadas[indice])) falhar("SCHEMA_TIMESTAMP_INVALIDO", caminho, "data ou hora inexistente");
  return instante.toISOString();
}

function timestamp(valor, caminho) {
  normalizarTimestampISO(valor, caminho);
}

function validarCaso(caso, indice) {
  const caminho = `casos.casos[${indice}]`;
  if (!caso || typeof caso !== "object" || Array.isArray(caso)) falhar("SCHEMA_TIPO_INVALIDO", caminho, "objeto esperado");
  if (!TIPOS_OBRIGATORIOS.includes(caso.tipo)) falhar("SCHEMA_TIPO_CENARIO_INVALIDO", `${caminho}.tipo`, "tipo obrigatório desconhecido");
  enumExato(caso.id, `${caminho}.id`, caso.tipo);
  switch (caso.tipo) {
    case "novo_pedido":
    case "conflito":
      objetoExato(caso, caminho, ["id", "tipo", "intencao", "horario_solicitado", "alternativas_sinteticas"]);
      enumExato(caso.intencao, `${caminho}.intencao`, "solicitar_horario");
      timestamp(caso.horario_solicitado, `${caminho}.horario_solicitado`);
      listaExata(caso.alternativas_sinteticas, `${caminho}.alternativas_sinteticas`, 2);
      caso.alternativas_sinteticas.forEach((slot, slotIndice) => timestamp(slot, `${caminho}.alternativas_sinteticas[${slotIndice}]`));
      if (new Set(caso.alternativas_sinteticas).size !== 2) falhar("SCHEMA_SLOT_DUPLICADO", `${caminho}.alternativas_sinteticas`, "os dois slots devem ser diferentes");
      break;
    case "confirmacao_ambigua":
      objetoExato(caso, caminho, ["id", "tipo", "intencao", "termo"]);
      enumExato(caso.intencao, `${caminho}.intencao`, "aceite_ambiguo");
      enumExato(caso.termo, `${caminho}.termo`, "ta_bom");
      break;
    case "cancelamento":
      objetoExato(caso, caminho, ["id", "tipo", "intencao", "termo"]);
      enumExato(caso.intencao, `${caminho}.intencao`, "cancelamento_ambiguo");
      enumExato(caso.termo, `${caminho}.termo`, "talvez_cancelar");
      break;
    case "escalacao_clinica":
      objetoExato(caso, caminho, ["id", "tipo", "intencao", "categoria"]);
      enumExato(caso.intencao, `${caminho}.intencao`, "duvida_clinica");
      enumExato(caso.categoria, `${caminho}.categoria`, "clinico");
      break;
  }
}

function validarAgenda(agenda) {
  objetoExato(agenda, "operacao.agenda", ["duracao_min", "buffer_min", "antecedencia_horas", "fonte_verdade", "fuso_horario", "dias", "ocupacoes_sinteticas"]);
  objetoExato(agenda.dias, "operacao.agenda.dias", ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]);
  enumExato(agenda.fonte_verdade, "operacao.agenda.fonte_verdade", "fixture_sintetica_local");
  enumExato(agenda.fuso_horario, "operacao.agenda.fuso_horario", "America/New_York");
  for (const [dia, faixas] of Object.entries(agenda.dias)) {
    if (!Array.isArray(faixas)) falhar("SCHEMA_TIPO_INVALIDO", `operacao.agenda.dias.${dia}`, "lista esperada");
    faixas.forEach((faixa, indice) => texto(faixa, `operacao.agenda.dias.${dia}[${indice}]`, /^\d{2}:\d{2}-\d{2}:\d{2}$/));
  }
  if (!Array.isArray(agenda.ocupacoes_sinteticas)) falhar("SCHEMA_TIPO_INVALIDO", "operacao.agenda.ocupacoes_sinteticas", "lista esperada");
  agenda.ocupacoes_sinteticas.forEach((ocupacao, indice) => {
    const caminho = `operacao.agenda.ocupacoes_sinteticas[${indice}]`;
    objetoExato(ocupacao, caminho, ["inicio", "fim"]);
    timestamp(ocupacao.inicio, `${caminho}.inicio`);
    timestamp(ocupacao.fim, `${caminho}.fim`);
    if (Date.parse(ocupacao.inicio) >= Date.parse(ocupacao.fim)) falhar("SCHEMA_INTERVALO_INVALIDO", caminho, "fim deve ser posterior ao início");
  });
}

function validarOperacaoInterna(config, tiposCasos) {
  const caminho = "operacao.operacao";
  objetoExato(config, caminho, ["modo", "responsavel_escalacao", "regras", "automacao", "revisao_humana_obrigatoria", "escalonamento", "shadow_sintetico", "servicos"]);
  objetoExato(config.regras, `${caminho}.regras`, ["confirmacao", "cancelamento", "transparencia"]);
  objetoExato(config.regras.confirmacao, `${caminho}.regras.confirmacao`, ["exige_confirmacao_explicita", "reconfirma_termos_ambiguos"]);
  objetoExato(config.regras.cancelamento, `${caminho}.regras.cancelamento`, ["nao_remove_sem_confirmacao_explicita", "revisao_humana_obrigatoria"]);
  objetoExato(config.regras.transparencia, `${caminho}.regras.transparencia`, ["identifica_como_assistente"]);
  objetoExato(config.automacao, `${caminho}.automacao`, ["envio_automatico"]);
  objetoExato(config.escalonamento, `${caminho}.escalonamento`, ["topicos"]);
  objetoExato(config.shadow_sintetico, `${caminho}.shadow_sintetico`, ["habilitado", "revisor_humano", "simulacoes"]);
  enumExato(config.modo, `${caminho}.modo`, "assistido");
  enumExato(config.responsavel_escalacao, `${caminho}.responsavel_escalacao`, "Responsavel Shadow");
  if (config.automacao.envio_automatico !== false || config.revisao_humana_obrigatoria !== true) falhar("SCHEMA_GATE_INVALIDO", caminho, "envio deve ser false e revisão humana obrigatória");
  listaExata(config.escalonamento.topicos, `${caminho}.escalonamento.topicos`, 4);
  const topicosObrigatorios = ["clinico", "urgencia", "pessoal", "preco_nao_autorizado"];
  if (new Set(config.escalonamento.topicos).size !== 4 || topicosObrigatorios.some((topico) => !config.escalonamento.topicos.includes(topico))) falhar("SCHEMA_TOPICOS_INVALIDOS", `${caminho}.escalonamento.topicos`, "tópicos devem ser exatamente os quatro permitidos");
  if (config.shadow_sintetico.habilitado !== true) falhar("SCHEMA_GATE_INVALIDO", `${caminho}.shadow_sintetico.habilitado`, "deve ser true");
  enumExato(config.shadow_sintetico.revisor_humano, `${caminho}.shadow_sintetico.revisor_humano`, "Responsavel Shadow");
  listaExata(config.shadow_sintetico.simulacoes, `${caminho}.shadow_sintetico.simulacoes`, TIPOS_OBRIGATORIOS.length);
  const simulacoes = config.shadow_sintetico.simulacoes;
  if (new Set(simulacoes).size !== TIPOS_OBRIGATORIOS.length || TIPOS_OBRIGATORIOS.some((tipo) => !simulacoes.includes(tipo))) falhar("SCHEMA_SIMULACOES_INVALIDAS", `${caminho}.shadow_sintetico.simulacoes`, "as cinco simulações devem ser únicas e obrigatórias");
  if (tiposCasos.some((tipo) => !simulacoes.includes(tipo)) || simulacoes.some((tipo) => !tiposCasos.includes(tipo))) falhar("SCHEMA_SIMULACOES_DIVERGENTES", `${caminho}.shadow_sintetico.simulacoes`, "simulações devem corresponder aos casos");
  listaExata(config.servicos, `${caminho}.servicos`, 1);
  config.servicos.forEach((servico, indice) => {
    const servicoPath = `${caminho}.servicos[${indice}]`;
    objetoExato(servico, servicoPath, ["id", "politica_operacional"]);
    enumExato(servico.id, `${servicoPath}.id`, "sessao_padrao");
    objetoExato(servico.politica_operacional, `${servicoPath}.politica_operacional`, ["duracao_min", "buffer_min", "requer_confirmacao_explicita", "escalar_se_duvida"]);
  });
}

export function validarSchemaSintetico(operacao, casos) {
  objetoExato(casos, "casos", ["versao", "sintetico", "casos"]);
  enumExato(casos.versao, "casos.versao", "shadow-casos.v1");
  if (casos.sintetico !== true) falhar("SCHEMA_SINTETICO_AUSENTE", "casos.sintetico", "deve ser true");
  listaExata(casos.casos, "casos.casos", TIPOS_OBRIGATORIOS.length);
  casos.casos.forEach(validarCaso);
  const tipos = casos.casos.map((caso) => caso.tipo);
  const ids = casos.casos.map((caso) => caso.id);
  if (new Set(tipos).size !== TIPOS_OBRIGATORIOS.length || TIPOS_OBRIGATORIOS.some((tipo) => !tipos.includes(tipo))) falhar("SCHEMA_CENARIOS_INVALIDOS", "casos.casos", "exija exatamente os cinco tipos, sem duplicata ou extra");
  if (new Set(ids).size !== ids.length) falhar("SCHEMA_IDS_DUPLICADOS", "casos.casos", "IDs devem ser únicos");

  objetoExato(operacao, "operacao", ["versao", "sintetico", "clinica", "agenda", "operacao"]);
  enumExato(operacao.versao, "operacao.versao", "shadow-operacao.v1");
  if (operacao.sintetico !== true) falhar("SCHEMA_SINTETICO_AUSENTE", "operacao.sintetico", "deve ser true");
  objetoExato(operacao.clinica, "operacao.clinica", ["nome_clinica", "endereco_clinica", "nome_humano_responsavel"]);
  enumExato(operacao.clinica.nome_clinica, "operacao.clinica.nome_clinica", "Clinica Demonstracao Sintetica");
  enumExato(operacao.clinica.endereco_clinica, "operacao.clinica.endereco_clinica", "Local Ficticio 100");
  enumExato(operacao.clinica.nome_humano_responsavel, "operacao.clinica.nome_humano_responsavel", "Responsavel Shadow");
  validarAgenda(operacao.agenda);
  validarOperacaoInterna(operacao.operacao, tipos);
  const politica = operacao.operacao.servicos[0].politica_operacional;
  if (operacao.agenda.duracao_min !== politica.duracao_min || operacao.agenda.buffer_min !== politica.buffer_min) falhar("SCHEMA_POLITICA_DIVERGENTE", "operacao.agenda", "duração e buffer devem coincidir com a política do serviço sintético");
}

export function resultadoSeguro({ cenario, decisao, motivo, acao_proposta = "nenhuma", alternativas_sinteticas, estado_agenda, etapas, status_operacional, proxima_transicao_condicional, acoes_bloqueadas, invariantes }) {
  if (ACOES_PROIBIDAS.has(acao_proposta)) throw new Error(`Ação proibida no shadow sintético: ${acao_proposta}`);
  const resultado = { cenario, decisao, motivo, acao_proposta, envio_realizado: false, reserva_realizada: false, remocao_realizada: false, revisao_humana: "PENDENTE", revisao_humana_concluida: false, veredito: VEREDITO_MAXIMO };
  if (alternativas_sinteticas) resultado.alternativas_sinteticas = alternativas_sinteticas;
  if (estado_agenda) resultado.estado_agenda = estado_agenda;
  if (etapas) resultado.etapas = etapas;
  if (status_operacional) resultado.status_operacional = status_operacional;
  if (proxima_transicao_condicional) resultado.proxima_transicao_condicional = proxima_transicao_condicional;
  if (acoes_bloqueadas) resultado.acoes_bloqueadas = acoes_bloqueadas;
  if (invariantes) resultado.invariantes = invariantes;
  return resultado;
}
