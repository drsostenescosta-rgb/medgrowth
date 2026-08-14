import test from "node:test";
import assert from "node:assert/strict";
import { avaliarPreflight } from "../preflight.mjs";

function valido() {
  return {
    clinica: {
      nome_clinica: "Clínica Exemplo",
      endereco_clinica: "Rua Exemplo, 1",
      nome_humano_responsavel: "Andreia",
      tabela_precos: "Consultar responsável",
    },
    agenda: {
      duracao_min: 60,
      buffer_min: 10,
      antecedencia_horas: 2,
      fonte_verdade: "agenda_local_validada",
      fuso_horario: "America/New_York",
      dias: { seg: ["10:30-20:00"], dom: [] },
    },
    operacao: {
      modo: "assistido",
      responsavel_escalacao: "Andreia",
      regras: {
        confirmacao: { exige_confirmacao_explicita: true, reconfirma_termos_ambiguos: true },
        cancelamento: { nao_remove_sem_confirmacao_explicita: true, revisao_humana_obrigatoria: true },
        transparencia: { identifica_como_assistente: true },
      },
      automacao: { envio_automatico: false },
      revisao_humana_obrigatoria: true,
      escalonamento: { topicos: ["clinico", "urgencia", "pessoal", "preco_nao_autorizado"] },
      shadow_sintetico: {
        habilitado: true,
        revisor_humano: "Andreia",
        simulacoes: ["novo_pedido", "conflito", "confirmacao_ambigua", "cancelamento", "escalacao_clinica"],
      },
      servicos: [
        {
          id: "avaliacao",
          politica_operacional: {
            duracao_min: 60,
            buffer_min: 10,
            requer_confirmacao_explicita: true,
            escalar_se_duvida: true,
          },
        },
      ],
    },
  };
}

function codigos(config) {
  return avaliarPreflight(config).map((item) => item.codigo);
}

test("aprova configuração completa para operação assistida", () => {
  assert.deepEqual(avaliarPreflight(valido()), []);
});

test("reprova placeholders em toda a configuração", () => {
  const config = valido();
  config.clinica.nome_clinica = "Clínica [PREENCHER]";
  config.agenda.fonte_verdade = "[PREENCHER agenda]";
  config.operacao.responsavel_escalacao = "[PREENCHER responsável]";
  config.operacao.servicos[0].id = "[PREENCHER serviço]";
  assert.ok(codigos(config).includes("PLACEHOLDER_ENCONTRADO"));
});

test("reprova clínica vazia sem caminho verde", () => {
  const config = valido();
  config.clinica = {};
  const encontrados = codigos(config);
  assert.equal(encontrados.filter((codigo) => codigo === "CAMPO_CLINICA_INVALIDO").length, 3);
});

test("reprova duração, buffer e faixa de agenda inválidos", () => {
  const config = valido();
  config.agenda.duracao_min = 10;
  config.agenda.buffer_min = -1;
  delete config.agenda.fonte_verdade;
  config.agenda.fuso_horario = "Fuso/Falso";
  config.agenda.dias.seg = ["20:00-10:00"];
  const encontrados = codigos(config);
  assert.ok(encontrados.includes("DURACAO_INVALIDA"));
  assert.ok(encontrados.includes("BUFFER_INVALIDO"));
  assert.ok(encontrados.includes("FONTE_VERDADE_AUSENTE"));
  assert.ok(encontrados.includes("FUSO_HORARIO_INVALIDO"));
  assert.ok(encontrados.includes("FAIXA_INVALIDA"));
  assert.ok(encontrados.includes("AGENDA_SEM_FAIXA_ATIVA"));
});

test("reprova ausência do responsável e regras de confirmação e cancelamento", () => {
  const config = valido();
  config.operacao.responsavel_escalacao = "";
  config.operacao.regras.confirmacao.reconfirma_termos_ambiguos = false;
  delete config.operacao.regras.cancelamento;
  const encontrados = codigos(config);
  assert.ok(encontrados.includes("RESPONSAVEL_AUSENTE"));
  assert.ok(encontrados.includes("CONFIRMACAO_INCOMPLETA"));
  assert.ok(encontrados.includes("CANCELAMENTO_INCOMPLETO"));
});

test("reprova serviço sem política operacional", () => {
  const config = valido();
  config.operacao.servicos = [{ id: "drenagem" }];
  assert.ok(codigos(config).includes("POLITICA_SERVICO_AUSENTE"));
});

test("reprova ids de serviço vazios e duplicados", () => {
  const config = valido();
  const politica = valido().operacao.servicos[0].politica_operacional;
  config.operacao.servicos = [
    { id: "", politica_operacional: politica },
    { id: "avaliacao", politica_operacional: politica },
    { id: "AVALIACAO", politica_operacional: politica },
  ];
  const encontrados = codigos(config);
  assert.ok(encontrados.includes("ID_SERVICO_INVALIDO"));
  assert.ok(encontrados.includes("ID_SERVICO_DUPLICADO"));
});

test("reprova transparência, envio automático e revisão humana ausente", () => {
  const config = valido();
  config.operacao.regras.transparencia.identifica_como_assistente = false;
  config.operacao.automacao.envio_automatico = true;
  config.operacao.revisao_humana_obrigatoria = false;
  const encontrados = codigos(config);
  assert.ok(encontrados.includes("TRANSPARENCIA_INCOMPLETA"));
  assert.ok(encontrados.includes("ENVIO_AUTOMATICO_NAO_BLOQUEADO"));
  assert.ok(encontrados.includes("REVISAO_HUMANA_AUSENTE"));
});

test("reprova tópicos de escalada e gate shadow sintético incompletos", () => {
  const config = valido();
  config.operacao.escalonamento.topicos = ["clinico"];
  config.operacao.shadow_sintetico = { habilitado: true, revisor_humano: "", simulacoes: ["novo_pedido"] };
  const encontrados = codigos(config);
  assert.ok(encontrados.includes("ESCALONAMENTO_INCOMPLETO"));
  assert.ok(encontrados.includes("SHADOW_SINTETICO_INCOMPLETO"));
});

test("configuração parcial não abre caminho fail-open", () => {
  const encontrados = codigos({ clinica: {}, agenda: { dias: {} }, operacao: {} });
  assert.ok(encontrados.length > 0);
  assert.ok(encontrados.includes("AGENDA_SEM_FAIXA_ATIVA"));
  assert.ok(encontrados.includes("SHADOW_SINTETICO_INCOMPLETO"));
});
