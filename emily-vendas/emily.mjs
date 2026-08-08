#!/usr/bin/env node
// emily.mjs — motor de conversa da Emily Vendas (ClinicNow, fase Wizard-of-Oz)
//
// Uso:
//   node emily.mjs "<telefone>" "<mensagem do cliente>"
//   node emily.mjs --dry-run "<telefone>" "<mensagem>"     → responde sem gravar nada
//   node emily.mjs --texto "<telefone>" "<mensagem>"       → imprime SÓ a mensagem pronta (e copia p/ clipboard no macOS)
//   node emily.mjs --check                                 → health check do circuito (env, chave, config, knowledge)
//
// Circuito:
//   1. Monta contexto: system prompt v1 + 2 catálogos + playbook de persuasão + agenda real + histórico
//   2. Chama Claude (JSON estruturado: resposta_whatsapp, acao, estagio_funil, proximo_followup_dias, nota_interna)
//   3. Se acao=consultar_especialista → 2ª chamada com effort maior (especialista sênior, MESMOS catálogos) e funde a resposta
//      Se acao=escalar_humano        → alerta (escalacoes.log + notificação) e a conversa fica PAUSADA para a IA
//      Se acao=opt_out               → confirma, zera follow-up e o lead sai de qualquer cadência (silêncio total)
//   4. Registra tudo no Supabase (clinicnow_wa_conversas/_mensagens + clinicnow_leads) E no fallback local
//      (conversas/<telefone>.json). O runner NUNCA quebra por falta de banco.
//
// GATE DE PAUSA: conversa com ai_paused/opt-out NUNCA volta para a IA sozinha — nem aqui, nem no
// webhook (fase 2). Devolver ao circuito é decisão humana: `node funil.mjs retomar <telefone>`.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  KNOWLEDGE,
  ESTAGIOS,
  carregarEnv,
  sb,
  supabaseDisponivel,
  normalizarTelefone,
  lerConversaLocal,
  salvarConversaLocal,
  registrarEscalacao,
  notificarHumano,
} from "./lib.mjs";
import { proximosLivres } from "./agenda.mjs";

const ACOES = ["responder", "consultar_especialista", "escalar_humano", "opt_out"];
const MODELO = () => process.env.EMILY_MODEL || "claude-sonnet-4-5";
const MODELO_ESPECIALISTA = () => process.env.EMILY_MODEL_ESPECIALISTA || MODELO();
const MAX_HISTORICO = 30;

// ---------------------------------------------------------------- config da clínica (guard de go-live)
const CAMPOS_CONFIG = ["nome_clinica", "endereco_clinica", "nome_humano_responsavel", "tabela_precos"];

/** Valores neutros e seguros usados APENAS em --dry-run enquanto a entrevista E2-T1 não acontece. */
const FALLBACK_DRY_RUN = {
  nome_clinica: "nossa clínica",
  endereco_clinica: "(endereço confirmado pela equipe na mensagem de confirmação)",
  nome_humano_responsavel: "nossa equipe",
};

export function camposPendentesConfig(cfg) {
  return CAMPOS_CONFIG.filter((c) => String(cfg?.[c] || "").includes("[PREENCHER"));
}

/**
 * Carrega clinica-config.json com guard: campos "[PREENCHER" BLOQUEIAM qualquer execução real
 * (pré-condição de go-live, entrevista E2-T1). Em --dry-run, placeholders viram fallbacks neutros
 * para o modelo nunca ver (nem ecoar) texto de placeholder.
 */
function carregarConfigClinica({ dryRun }) {
  const cfg = JSON.parse(readFileSync(join(ROOT, "clinica-config.json"), "utf8"));
  const pendentes = camposPendentesConfig(cfg);
  if (!pendentes.length) return { cfg, pendentes };
  if (!dryRun) {
    throw new Error(
      `clinica-config.json ainda tem campos "[PREENCHER" (${pendentes.join(", ")}) — ` +
        `go-live BLOQUEADO até a entrevista E2-T1. Para ensaio/demonstração use --dry-run.`,
    );
  }
  const seguro = { ...cfg };
  for (const c of pendentes) if (FALLBACK_DRY_RUN[c]) seguro[c] = FALLBACK_DRY_RUN[c];
  return { cfg: seguro, pendentes };
}

// ---------------------------------------------------------------- contexto
function lerArquivoKnowledge(nome, obrigatorio = true) {
  const p = join(KNOWLEDGE, nome);
  if (!existsSync(p)) {
    if (obrigatorio) throw new Error(`arquivo de knowledge ausente: ${p}`);
    return null;
  }
  return readFileSync(p, "utf8");
}

function promptBaseEmily(cfg) {
  const bruto = lerArquivoKnowledge("system-prompt-emily-vendas-v1.md");
  const marcador = "## PROMPT (colar a partir daqui)";
  const i = bruto.indexOf(marcador);
  let prompt = i >= 0 ? bruto.slice(i + marcador.length) : bruto;
  prompt = prompt.replace(/\n---\n+\*Fim do prompt[\s\S]*$/, "").trim();

  return prompt
    .replaceAll("{{NOME_CLINICA}}", cfg.nome_clinica)
    .replaceAll("{{ENDERECO_CLINICA}}", cfg.endereco_clinica)
    .replaceAll("{{NOME_HUMANO_RESPONSAVEL}}", cfg.nome_humano_responsavel)
    .replaceAll("{{TABELA_PRECOS}}", cfg.tabela_precos)
    // A agenda real chega no bloco "CONTEXTO DINÂMICO DESTA CONVERSA" (fim do prompt);
    // aqui o token é substituído por uma referência explícita para não sobrar template pendurado.
    .replaceAll(
      "{{AGENDA_DISPONIVEL}}",
      'a lista AGENDA_DISPONIVEL do bloco "CONTEXTO DINÂMICO DESTA CONVERSA" no fim deste prompt',
    );
}

const CONTRATO_JSON = `
## FORMATO DE SAÍDA OBRIGATÓRIO (contrato com o sistema — o cliente nunca vê isto)

Responda SEMPRE com um único objeto JSON válido, sem markdown, sem crase, sem nenhum texto fora do JSON:

{
  "resposta_whatsapp": "mensagem pronta para colar no WhatsApp (2 a 4 frases, seguindo TODAS as regras acima)",
  "acao": "responder" | "consultar_especialista" | "escalar_humano" | "opt_out",
  "estagio_funil": "novo" | "conversando" | "avaliacao_agendada" | "compareceu" | "followup" | "perdido",
  "proximo_followup_dias": 0,
  "nota_interna": "nota curta de CRM: intenção do cliente, objeção, próxima tarefa"
}

Regras do contrato:
- "responder": caso normal.
- "consultar_especialista": a pergunta é tecnicamente difícil e uma resposta melhor aumentaria a chance de agendar a avaliação, SEM ferir nenhuma regra (ex.: dúvida detalhada sobre um procedimento do catálogo). Mesmo assim escreva em resposta_whatsapp a sua melhor tentativa.
- "escalar_humano": urgência médica, questão clínica, preço não tabelado insistente, desconto/negociação, reclamação, caso sensível — as regras 5 e 6. resposta_whatsapp deve ser a mensagem de transição para humano. Use proximo_followup_dias 0 (o humano assume a próxima ação).
- "opt_out": o cliente pediu para não receber mais mensagens (regra 7). resposta_whatsapp = confirmação breve e cordial, SEM contraproposta. proximo_followup_dias DEVE ser 0 — nenhum contato futuro.
- NUNCA escreva marcadores como [ESCALAR_HUMANO] ou [OPT_OUT] dentro de resposta_whatsapp — a sinalização é SEMPRE pelo campo "acao". O cliente recebe só texto limpo.
- Estilo Agendor: NENHUM lead fica sem estágio e sem próxima tarefa. proximo_followup_dias é um inteiro (0 = sem follow-up, ex.: avaliação já marcada para amanhã, escalação ou opt-out).
- A conversão-mestre é AGENDAR A AVALIAÇÃO. Ofereça apenas horários que constem na agenda real informada no contexto.`;

async function blocoDinamico() {
  let agendaTexto = "(agenda indisponível no momento — diga que vai verificar os horários com a equipe e confirme em seguida)";
  try {
    const livres = await proximosLivres(6);
    if (livres.length) {
      agendaTexto = livres.map((s) => `- ${s.label}`).join("\n");
    } else {
      agendaTexto = "(sem horários livres no período — ofereça deixar o contato para encaixe)";
    }
  } catch {
    /* mantém texto padrão */
  }
  const agora = new Date();
  return `## CONTEXTO DINÂMICO DESTA CONVERSA
Data/hora atual: ${agora.toLocaleString("pt-BR")}
AGENDA_DISPONIVEL (horários reais livres — só ofereça estes, 2 a 3 por vez):
${agendaTexto}`;
}

function montarSystem(dinamico, cfg) {
  const catalogo1 = lerArquivoKnowledge("procedimentos-estetica.md");
  const catalogo2 = lerArquivoKnowledge("emagrecimento-e-saude.md");
  // playbook-persuasao.md está sendo escrito em paralelo pelo setor de vendas — carrega se existir
  const playbook = lerArquivoKnowledge("playbook-persuasao.md", false);

  const estavel = [
    promptBaseEmily(cfg),
    "\n\n# CATÁLOGO 1 — PROCEDIMENTOS ESTÉTICOS (fonte exclusiva)\n\n",
    catalogo1,
    "\n\n# CATÁLOGO 2 — EMAGRECIMENTO E SAÚDE (fonte exclusiva)\n\n",
    catalogo2,
    playbook
      ? "\n\n# PLAYBOOK DE PERSUASÃO (como conduzir, nunca acima do compliance)\n\n" + playbook
      : "\n\n# PLAYBOOK DE PERSUASÃO\n(knowledge/playbook-persuasao.md ainda não disponível — use os roteiros dos catálogos.)",
    "\n\n",
    CONTRATO_JSON,
  ].join("");

  // Bloco estável com cache (catálogos são grandes); bloco dinâmico fora do cache.
  return [
    { type: "text", text: estavel, cache_control: { type: "ephemeral" } },
    { type: "text", text: dinamico },
  ];
}

// ---------------------------------------------------------------- histórico
async function carregarHistorico(telefone) {
  // O espelho local carrega as flags de pausa/opt-out mesmo quando o histórico vem do Supabase.
  const local = lerConversaLocal(telefone);
  const flagsLocais = {
    aiPausedLocal: Boolean(local?.ai_paused),
    optOut: Boolean(local?.opt_out),
    estagioLocal: local?.estagio || null,
  };

  // 1ª opção: Supabase (clinicnow_wa_conversas.phone → clinicnow_wa_mensagens)
  if (supabaseDisponivel()) {
    try {
      const conv = await sb(`clinicnow_wa_conversas?select=id,nome,ai_paused&phone=eq.${telefone}&limit=1`);
      if (conv?.length) {
        const msgs = await sb(
          `clinicnow_wa_mensagens?select=direction,content,timestamp&conversa_id=eq.${conv[0].id}&order=timestamp.asc&limit=${MAX_HISTORICO}`,
        );
        return {
          fonte: "supabase",
          conversaId: conv[0].id,
          nome: conv[0].nome || null,
          aiPaused: Boolean(conv[0].ai_paused) || flagsLocais.aiPausedLocal,
          optOut: flagsLocais.optOut,
          estagio: flagsLocais.estagioLocal,
          mensagens: (msgs || []).map((m) => ({ direction: m.direction, content: m.content })),
        };
      }
      return {
        fonte: "supabase",
        conversaId: null,
        nome: null,
        aiPaused: flagsLocais.aiPausedLocal,
        optOut: flagsLocais.optOut,
        estagio: flagsLocais.estagioLocal,
        mensagens: [],
      };
    } catch (e) {
      console.error(`[emily] aviso: histórico via Supabase falhou (${e.message}) — usando fallback local`);
    }
  }
  // Fallback local
  return {
    fonte: "local",
    conversaId: null,
    nome: local?.nome || null,
    aiPaused: flagsLocais.aiPausedLocal,
    optOut: flagsLocais.optOut,
    estagio: flagsLocais.estagioLocal,
    mensagens: (local?.mensagens || []).slice(-MAX_HISTORICO).map((m) => ({
      direction: m.direction,
      content: m.content,
    })),
  };
}

function historicoParaMessages(historico, mensagemAtual) {
  const messages = [];
  for (const m of historico.mensagens) {
    messages.push({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.content,
    });
  }
  messages.push({ role: "user", content: mensagemAtual });
  // A API aceita mensagens consecutivas do mesmo papel (são combinadas), mas a 1ª precisa ser user
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(início da conversa)" });
  return messages;
}

// ---------------------------------------------------------------- Anthropic
export async function chamarClaude({ model, system, messages, maxTokens = 1000, thinking = null }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY ausente (defina em emily-vendas/.env ou ~/.env)");
  }
  const body = { model, max_tokens: maxTokens, system, messages };
  if (thinking) body.thinking = thinking;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    throw new Error(
      "anthropic 401: a ANTHROPIC_API_KEY carregada é INVÁLIDA/expirada. " +
        "Gere uma chave nova em console.anthropic.com → API keys e atualize ~/.env (ou emily-vendas/.env, que prevalece). " +
        "Depois valide com: node emily.mjs --check",
    );
  }
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("modelo recusou a solicitação (stop_reason=refusal)");
  const texto = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { texto, usage: data.usage, stop_reason: data.stop_reason, model: data.model };
}

function extrairJson(texto) {
  const limpo = texto.replace(/```json|```/g, "").trim();
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini === -1 || fim <= ini) return null;
  try {
    return JSON.parse(limpo.slice(ini, fim + 1));
  } catch {
    return null;
  }
}

const RE_MARCADOR_ESCALAR = /\[\s*ESCALAR[_\s-]?HUMANO\s*\]/gi;
const RE_MARCADOR_OPTOUT = /\[\s*OPT[_\s-]?OUT\s*\]/gi;

/** Remove marcadores legados ([ESCALAR_HUMANO]/[OPT_OUT]) do texto ao cliente. */
function limparMarcadores(texto) {
  return String(texto || "")
    .replace(RE_MARCADOR_ESCALAR, "")
    .replace(RE_MARCADOR_OPTOUT, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

function sanearDecisao(bruta, textoBruto) {
  const parseOk = Boolean(bruta && typeof bruta === "object" && bruta.resposta_whatsapp);
  if (!parseOk) {
    // Sem JSON utilizável → caminho seguro: humano assume; texto bruto fica na nota p/ o operador.
    return {
      resposta_whatsapp:
        "Só um instante! Vou chamar alguém da equipe pra te ajudar direitinho, tá bom? 😊",
      acao: "escalar_humano",
      estagio_funil: "conversando",
      proximo_followup_dias: 0,
      nota_interna: `FALHA DE PARSE — modelo não retornou JSON utilizável. Texto bruto: ${String(
        textoBruto || "",
      ).slice(0, 300)}`,
    };
  }
  const d = bruta;
  const textoOriginal = String(d.resposta_whatsapp).trim();
  let acao = ACOES.includes(d.acao) ? d.acao : "responder";
  // Marcador no texto = sinalização legada do prompt → promove a ação e limpa o texto.
  if (RE_MARCADOR_OPTOUT.test(textoOriginal)) acao = "opt_out";
  else if (RE_MARCADOR_ESCALAR.test(textoOriginal) && acao !== "opt_out") acao = "escalar_humano";
  RE_MARCADOR_OPTOUT.lastIndex = 0;
  RE_MARCADOR_ESCALAR.lastIndex = 0;

  // Follow-up: silêncio (escalação/opt-out) NUNCA ganha follow-up por default —
  // um lead que pediu pausa não pode reaparecer como "vencido / prioridade do dia".
  const defaultFollowup = acao === "opt_out" || acao === "escalar_humano" ? 0 : 2;
  let followup = Number.isFinite(Number(d.proximo_followup_dias))
    ? Math.max(0, Math.round(Number(d.proximo_followup_dias)))
    : defaultFollowup;
  if (acao === "opt_out") followup = 0;

  return {
    resposta_whatsapp: limparMarcadores(textoOriginal),
    acao,
    estagio_funil: ESTAGIOS.includes(d.estagio_funil) ? d.estagio_funil : "conversando",
    proximo_followup_dias: followup,
    nota_interna: String(d.nota_interna || "").trim() || "(sem nota)",
  };
}

// ---------------------------------------------------------------- circuito de escalação: especialista
const SYSTEM_ESPECIALISTA = `Você é o(a) especialista sênior da clínica de estética e emagrecimento — a referência técnica interna para as perguntas difíceis que a assistente Emily (atendimento WhatsApp) não consegue responder com segurança.

Sua tarefa: receber a pergunta difícil do cliente, o rascunho da Emily e o contexto, e devolver a MELHOR resposta possível para o WhatsApp, na voz da Emily (calorosa, curta, 2 a 4 frases, no máximo 1 emoji, uma pergunta no máximo).

FONTE EXCLUSIVA: os dois catálogos anexos abaixo (procedimentos estéticos + emagrecimento e saúde) e a tabela de preços autorizada. O que não está neles você NÃO afirma — na dúvida, devolva acao "escalar_humano". Nenhum detalhe clínico pode ser inventado, por mais plausível que pareça.

REGRAS INEGOCIÁVEIS (as mesmas da Emily — nunca as viole, mesmo sendo especialista):
- Nenhum preço fora da tabela oficial; sem tabela → valores só na avaliação.
- Nenhuma promessa de resultado, prazo ou quilos; "resultados variam de pessoa para pessoa".
- Nenhum diagnóstico; contraindicação relatada → parar de vender e encaminhar para avaliação.
- Medicamento de prescrição (toxina botulínica, tirzepatida/semaglutida e similares): só em modo resposta, sem oferta, sem estoque, sem preço; converta SEMPRE para avaliação com profissional habilitado.
- Urgência médica ou caso sensível → não é seu papel: devolva acao "escalar_humano".
- A conversão-mestre é AGENDAR A AVALIAÇÃO.
- NUNCA escreva marcadores como [ESCALAR_HUMANO] dentro de resposta_whatsapp — sinalize só pelo campo "acao".

Responda SOMENTE com JSON válido:
{
  "resposta_whatsapp": "resposta final na voz da Emily",
  "nota_interna": "resumo técnico do raciocínio para o CRM (1-2 frases)",
  "acao": "responder" | "escalar_humano"
}`;

function montarSystemEspecialista(tabelaPrecos) {
  const catalogo1 = lerArquivoKnowledge("procedimentos-estetica.md");
  const catalogo2 = lerArquivoKnowledge("emagrecimento-e-saude.md");
  const playbook = lerArquivoKnowledge("playbook-persuasao.md", false);
  const estavel = [
    SYSTEM_ESPECIALISTA,
    "\n\n# FONTE EXCLUSIVA 1 — CATÁLOGO DE PROCEDIMENTOS ESTÉTICOS\n\n",
    catalogo1,
    "\n\n# FONTE EXCLUSIVA 2 — CATÁLOGO DE EMAGRECIMENTO E SAÚDE\n\n",
    catalogo2,
    playbook
      ? "\n\n# PLAYBOOK DE PERSUASÃO (referência de condução — compliance sempre acima)\n\n" + playbook
      : "",
    "\n\n# TABELA DE PREÇOS AUTORIZADA (única fonte de valores)\n\n",
    tabelaPrecos,
  ].join("");
  return [{ type: "text", text: estavel, cache_control: { type: "ephemeral" } }];
}

async function consultarEspecialista({ telefone, mensagem, decisaoEmily, historico, tabelaPrecos }) {
  const contexto = [
    `Telefone do cliente: ${telefone}`,
    `Pergunta difícil do cliente: """${mensagem}"""`,
    `Rascunho da Emily: """${decisaoEmily.resposta_whatsapp}"""`,
    `Nota interna da Emily: ${decisaoEmily.nota_interna}`,
    `Últimas mensagens da conversa:`,
    ...historico.mensagens.slice(-6).map((m) => `  ${m.direction === "in" ? "Cliente" : "Emily"}: ${m.content}`),
    ``,
    `Produza a melhor resposta final para o WhatsApp.`,
  ].join("\n");

  // Effort maior: extended thinking (claude-sonnet-4-5 usa thinking.enabled com budget_tokens)
  const { texto, usage } = await chamarClaude({
    model: MODELO_ESPECIALISTA(),
    system: montarSystemEspecialista(tabelaPrecos),
    messages: [{ role: "user", content: contexto }],
    maxTokens: 6000,
    thinking: { type: "enabled", budget_tokens: 4000 },
  });
  const bruta = extrairJson(texto) || {};
  return {
    resposta_whatsapp: limparMarcadores(bruta.resposta_whatsapp),
    nota_interna: String(bruta.nota_interna || "").trim(),
    acao: bruta.acao === "escalar_humano" ? "escalar_humano" : "responder",
    usage,
  };
}

// ---------------------------------------------------------------- registro (Supabase + local, nunca quebra)
async function registrarSupabase({ telefone, historico, mensagem, decisao, latenciaMs }) {
  if (!supabaseDisponivel()) return false;
  const pausar = decisao.acao === "escalar_humano" || decisao.acao === "opt_out";
  try {
    let conversaId = historico.conversaId;
    if (!conversaId) {
      const criada = await sb(`clinicnow_wa_conversas?on_conflict=phone`, {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=merge-duplicates" },
        body: { phone: telefone, intent_atual: decisao.estagio_funil, ai_paused: pausar },
      });
      conversaId = criada?.[0]?.id;
    } else {
      await sb(`clinicnow_wa_conversas?id=eq.${conversaId}`, {
        method: "PATCH",
        body: { intent_atual: decisao.estagio_funil, ai_paused: pausar },
      });
    }
    if (!conversaId) throw new Error("conversa sem id");

    await sb(`clinicnow_wa_mensagens`, {
      method: "POST",
      body: [
        { conversa_id: conversaId, direction: "in", content: mensagem },
        {
          conversa_id: conversaId,
          direction: "out",
          content: decisao.resposta_whatsapp,
          intent: `${decisao.acao}|${decisao.estagio_funil}`,
          model: MODELO(),
          latency_ms: latenciaMs,
        },
      ],
    });

    // Lead no funil (clinicnow_leads.estagio tem CHECK com exatamente estes estágios)
    const followupEm =
      decisao.proximo_followup_dias > 0
        ? new Date(Date.now() + decisao.proximo_followup_dias * 86400000).toISOString()
        : null;
    const proximaAcao =
      decisao.acao === "opt_out" ? "OPT-OUT confirmado — NÃO recontatar (nenhum disparo futuro)" : decisao.nota_interna;
    const leads = await sb(`clinicnow_leads?select=id&whatsapp=eq.${telefone}&limit=1`);
    if (leads?.length) {
      await sb(`clinicnow_leads?id=eq.${leads[0].id}`, {
        method: "PATCH",
        body: {
          estagio: decisao.estagio_funil,
          proxima_acao: proximaAcao,
          followup_em: followupEm,
        },
      });
    } else {
      await sb(`clinicnow_leads`, {
        method: "POST",
        body: {
          nome: historico.nome || `Lead WhatsApp ${telefone.slice(-4)}`,
          whatsapp: telefone,
          origem: "whatsapp",
          estagio: decisao.estagio_funil,
          proxima_acao: proximaAcao,
          followup_em: followupEm,
          consentimento_lgpd: false,
        },
      });
    }
    return true;
  } catch (e) {
    console.error(`[emily] aviso: registro no Supabase falhou (${e.message}) — fallback local mantém tudo`);
    return false;
  }
}

function registrarLocal({ telefone, historico, mensagem, decisao, latenciaMs }) {
  const agora = new Date().toISOString();
  const conversa = lerConversaLocal(telefone) || {
    telefone,
    nome: historico.nome || null,
    criado_em: agora,
    mensagens: [],
  };
  conversa.estagio = decisao.estagio_funil;
  conversa.proxima_acao = decisao.nota_interna;
  conversa.followup_em =
    decisao.proximo_followup_dias > 0
      ? new Date(Date.now() + decisao.proximo_followup_dias * 86400000).toISOString()
      : null;
  // Cliente respondeu → zera a cadência de reengajamento (playbook §8.1: resposta reinicia o ciclo)
  conversa.toques_reengajamento = 0;
  conversa.pausado = false;
  if (decisao.acao === "escalar_humano") {
    conversa.ai_paused = true; // gate: IA só volta com `funil.mjs retomar`
  }
  if (decisao.acao === "opt_out") {
    conversa.opt_out = true;
    conversa.ai_paused = true;
    conversa.followup_em = null;
    conversa.proxima_acao = "OPT-OUT confirmado — NÃO recontatar (nenhum disparo futuro)";
  }
  conversa.mensagens.push(
    { direction: "in", content: mensagem, ts: agora },
    {
      direction: "out",
      content: decisao.resposta_whatsapp,
      ts: agora,
      acao: decisao.acao,
      estagio: decisao.estagio_funil,
      nota_interna: decisao.nota_interna,
      model: MODELO(),
      latencia_ms: latenciaMs,
    },
  );
  salvarConversaLocal(conversa);
}

/** Mensagem recebida com IA pausada/opt-out: registra a ENTRADA (histórico íntegro), sem resposta automática. */
async function registrarEntradaPausada({ telefone, historico, mensagem }) {
  const agora = new Date().toISOString();
  const conversa = lerConversaLocal(telefone) || {
    telefone,
    nome: historico.nome || null,
    criado_em: agora,
    mensagens: [],
  };
  conversa.mensagens.push({ direction: "in", content: mensagem, ts: agora });
  salvarConversaLocal(conversa);
  if (supabaseDisponivel() && historico.conversaId) {
    try {
      await sb(`clinicnow_wa_mensagens`, {
        method: "POST",
        body: [{ conversa_id: historico.conversaId, direction: "in", content: mensagem }],
      });
    } catch (e) {
      console.error(`[emily] aviso: entrada pausada não espelhada no Supabase (${e.message})`);
    }
  }
}

// ---------------------------------------------------------------- pipeline principal (exportado p/ webhook.mjs)
export async function processarMensagem(telefoneBruto, mensagem, { dryRun = false } = {}) {
  const telefone = normalizarTelefone(telefoneBruto);
  if (!mensagem?.trim()) throw new Error("mensagem vazia");

  // Guard de go-live: config com "[PREENCHER" só roda em --dry-run (com fallbacks neutros)
  const { cfg, pendentes } = carregarConfigClinica({ dryRun });

  const historico = await carregarHistorico(telefone);

  // ---- GATE DE PAUSA (opt-out / escalado para humano) ----
  // A IA NÃO responde: registra a entrada, alerta o operador e devolve controle ao humano.
  if (historico.optOut || historico.aiPaused) {
    const motivo = historico.optOut ? "opt_out" : "pausada_para_humano";
    if (!dryRun) {
      await registrarEntradaPausada({ telefone, historico, mensagem });
      registrarEscalacao(
        "MSG_COM_IA_PAUSADA",
        telefone,
        `motivo: ${motivo} | mensagem: ${mensagem} | humano deve responder (retomar: node funil.mjs retomar ${telefone})`,
      );
    }
    return {
      resposta_whatsapp: "",
      acao: "nao_responder",
      estagio_funil: historico.estagio || "conversando",
      proximo_followup_dias: 0,
      nota_interna:
        motivo === "opt_out"
          ? "OPT-OUT ativo — NENHUMA resposta automática. Se o cliente voltou por vontade própria, o humano decide e pode reativar com `node funil.mjs retomar <tel> --cliente-voltou`."
          : "Conversa PAUSADA para humano (ai_paused) — responda manualmente; devolva à Emily com `node funil.mjs retomar <tel>`.",
      meta: {
        telefone,
        ia_pausada: true,
        motivo,
        dry_run: dryRun,
        gravado_supabase: false,
        gravado_local: !dryRun,
        config_pendente: pendentes.length ? pendentes : undefined,
      },
    };
  }

  const system = montarSystem(await blocoDinamico(), cfg);
  const messages = historicoParaMessages(historico, mensagem);

  const t0 = Date.now();
  const { texto, usage } = await chamarClaude({
    model: MODELO(),
    system,
    messages,
    maxTokens: 1000,
  });
  let decisao = sanearDecisao(extrairJson(texto), texto);
  let especialistaConsultado = false;

  // ---- CIRCUITO DE ESCALAÇÃO ----
  if (decisao.acao === "consultar_especialista") {
    especialistaConsultado = true;
    try {
      const esp = await consultarEspecialista({
        telefone,
        mensagem,
        decisaoEmily: decisao,
        historico,
        tabelaPrecos: cfg.tabela_precos,
      });
      if (esp.acao === "escalar_humano") {
        decisao.acao = "escalar_humano";
        decisao.proximo_followup_dias = 0;
        decisao.nota_interna = `Emily: ${decisao.nota_interna} | Especialista mandou escalar: ${esp.nota_interna}`;
      } else {
        if (esp.resposta_whatsapp) decisao.resposta_whatsapp = esp.resposta_whatsapp;
        decisao.acao = "responder";
        decisao.nota_interna = `Emily: ${decisao.nota_interna} | Especialista: ${esp.nota_interna || "(sem nota)"}`;
      }
      if (!dryRun) {
        registrarEscalacao("CONSULTA_ESPECIALISTA", telefone, `pergunta: ${mensagem} | nota: ${decisao.nota_interna}`);
      }
    } catch (e) {
      // especialista indisponível → mantém rascunho da Emily (nunca quebra)
      decisao.acao = "responder";
      decisao.nota_interna += ` | (especialista indisponível: ${e.message})`;
    }
  }

  if (decisao.acao === "escalar_humano") {
    decisao.proximo_followup_dias = 0; // humano assume — nada de follow-up automático empurrando recontato
    if (!dryRun) {
      await notificarHumano("ESCALAR_HUMANO", telefone, `mensagem: ${mensagem} | nota: ${decisao.nota_interna}`);
    }
    if (!decisao.resposta_whatsapp) {
      decisao.resposta_whatsapp =
        "Entendi! Vou chamar agora alguém da nossa equipe pra falar com você, tá bom? Já já te respondem por aqui. 😊";
    }
  }

  if (decisao.acao === "opt_out") {
    decisao.proximo_followup_dias = 0;
    decisao.estagio_funil = "perdido"; // estágio CHECK-safe; flag opt_out guarda o motivo real
    if (!dryRun) {
      registrarEscalacao("OPT_OUT", telefone, `mensagem: ${mensagem} | nota: ${decisao.nota_interna}`);
    }
    if (!decisao.resposta_whatsapp) {
      decisao.resposta_whatsapp =
        "Pode deixar! Não vou te mandar mais mensagens, tá? Obrigada pelo contato — e se um dia quiser retomar, é só chamar. 😊";
    }
  }

  const latenciaMs = Date.now() - t0;
  let gravadoSupabase = false;
  if (!dryRun) {
    gravadoSupabase = await registrarSupabase({ telefone, historico, mensagem, decisao, latenciaMs });
    registrarLocal({ telefone, historico, mensagem, decisao, latenciaMs });
  }

  return {
    ...decisao,
    meta: {
      telefone,
      modelo: MODELO(),
      especialista_consultado: especialistaConsultado,
      dry_run: dryRun,
      gravado_supabase: gravadoSupabase,
      gravado_local: !dryRun,
      latencia_ms: latenciaMs,
      tokens: usage ? { entrada: usage.input_tokens, saida: usage.output_tokens } : null,
      config_pendente: pendentes.length ? pendentes : undefined,
    },
  };
}

// ---------------------------------------------------------------- health check (--check)
async function healthCheck() {
  let falhas = 0;
  const ok = (s) => console.log(`  ✔ ${s}`);
  const aviso = (s) => console.log(`  – ${s}`);
  const falha = (s) => {
    falhas++;
    console.log(`  ✘ ${s}`);
  };

  console.log("Health check — Emily Vendas\n");

  for (const f of ["system-prompt-emily-vendas-v1.md", "procedimentos-estetica.md", "emagrecimento-e-saude.md"]) {
    existsSync(join(KNOWLEDGE, f)) ? ok(`knowledge/${f}`) : falha(`knowledge/${f} AUSENTE`);
  }
  existsSync(join(KNOWLEDGE, "playbook-persuasao.md"))
    ? ok("knowledge/playbook-persuasao.md")
    : aviso("knowledge/playbook-persuasao.md ausente (opcional)");

  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, "clinica-config.json"), "utf8"));
    const pendentes = camposPendentesConfig(cfg);
    if (pendentes.length) {
      aviso(
        `clinica-config.json com campos [PREENCHER: ${pendentes.join(", ")} — só --dry-run funciona (go-live bloqueado até E2-T1)`,
      );
    } else {
      ok("clinica-config.json completo");
    }
  } catch (e) {
    falha(`clinica-config.json inválido: ${e.message}`);
  }

  try {
    JSON.parse(readFileSync(join(ROOT, "agenda-config.json"), "utf8"));
    ok("agenda-config.json válido");
  } catch (e) {
    falha(`agenda-config.json inválido: ${e.message}`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    falha("ANTHROPIC_API_KEY ausente (emily-vendas/.env ou ~/.env)");
  } else {
    try {
      await chamarClaude({
        model: MODELO(),
        system: "Responda apenas: ok",
        messages: [{ role: "user", content: "ok?" }],
        maxTokens: 4,
      });
      ok(`ANTHROPIC_API_KEY válida (modelo ${MODELO()})`);
    } catch (e) {
      falha(`chamada Anthropic FALHOU: ${e.message}`);
    }
  }

  supabaseDisponivel()
    ? ok("Supabase configurado (espelhamento ligado)")
    : aviso("Supabase sem SUPABASE_SERVICE_KEY (modo 100% local — ok na fase 1)");

  console.log(
    falhas
      ? `\nResultado: ${falhas} falha(s) — o circuito NÃO está pronto para atender lead.`
      : "\nResultado: circuito pronto.",
  );
  process.exit(falhas ? 1 : 0);
}

// ---------------------------------------------------------------- CLI
async function cli() {
  carregarEnv();
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = flags.has("--dry-run");
  const modoTexto = flags.has("--texto");

  if (flags.has("--check")) {
    await healthCheck();
    return;
  }

  const [telefone, mensagem] = args;
  if (!telefone || !mensagem) {
    console.error('Uso: node emily.mjs [--dry-run] [--texto] "<telefone>" "<mensagem do cliente>"');
    console.error("     node emily.mjs --check");
    process.exit(1);
  }
  try {
    const resultado = await processarMensagem(telefone, mensagem, { dryRun });
    if (!modoTexto) {
      console.log(JSON.stringify(resultado, null, 2));
    } else {
      // Modo operador (persona B): só a mensagem pronta no stdout; status no stderr.
      if (resultado.resposta_whatsapp) process.stdout.write(resultado.resposta_whatsapp + "\n");
      console.error(
        `[emily] acao: ${resultado.acao} | estagio: ${resultado.estagio_funil} | followup: ${resultado.proximo_followup_dias}d`,
      );
      console.error(`[emily] nota: ${resultado.nota_interna}`);
      if (resultado.acao === "escalar_humano")
        console.error("[emily] ⚠ ESCALAR PARA HUMANO — envie a transição e ASSUMA a conversa (ver escalacoes.log)");
      if (resultado.acao === "opt_out")
        console.error("[emily] ⛔ OPT-OUT registrado — envie a confirmação e NUNCA recontate");
      if (resultado.meta?.ia_pausada)
        console.error("[emily] ⏸ IA pausada para este lead — nada foi gerado; o humano responde");
      if (process.platform === "darwin" && resultado.resposta_whatsapp) {
        try {
          const { spawn } = await import("node:child_process");
          const p = spawn("pbcopy");
          p.stdin.end(resultado.resposta_whatsapp);
          console.error("[emily] resposta copiada para o clipboard — é só colar no WhatsApp");
        } catch {
          /* melhor esforço */
        }
      }
    }
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cli();
}
