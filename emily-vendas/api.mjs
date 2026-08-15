#!/usr/bin/env node
// api.mjs — ponte HTTP local entre o motor (Node, tem as chaves) e o Painel de Aprovação (navegador).
//
// Por que existe: até hoje a Emily só falava por terminal (`node emily.mjs --texto ...`). A Andreia
// não abre terminal. Esta ponte é o mínimo que transforma o motor existente em algo que uma dona
// de clínica consegue operar — sem reescrever o motor e sem mudar nenhuma regra.
//
// O que esta ponte NUNCA faz:
//   - enviar mensagem para cliente (não existe rota de envio; o envio é humano, colando no WhatsApp);
//   - decidir sozinha (a decisão é sempre um POST /api/decisao com nome de aprovador);
//   - escrever no Agendor (o Agendor é fonte de verdade; aqui só se lê).
//
// Segurança (é localhost, mas localhost não é seguro por si só):
//   - escuta SÓ em 127.0.0.1 — nunca 0.0.0.0;
//   - Origin allowlist: um site malicioso aberto no mesmo navegador não consegue postar aqui;
//   - header obrigatório X-ClinicNow-Operador em toda rota que muda estado (força preflight CORS
//     e registra QUEM está operando);
//   - webhook do Agendor exige HMAC (agendor.mjs) — POST sem assinatura é 401.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { avaliarPreflight } from "./preflight.mjs";
import { proximosLivres } from "./interpretar-horarios.mjs";
import { decidir } from "./regras.mjs";
// Namespace, e não imports soltos: o ledger virou peça trocável. Em disco (aqui, no Mac) ou em
// Postgres (na nuvem, onde não existe disco). A mesma superfície nos dois — quem troca é quem
// chama `criarHandler`, e nenhuma rota sabe qual está em uso.
import * as ledgerArquivo from "./ledger.mjs";
import { assinaturaValida, configAgendor, gravarEspelho, lerCompromissos, lerEspelho } from "./agendor.mjs";
import { carregarEnv } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.CLINICNOW_API_PORT || 4791);
// Allowlist de origem. Local sempre; na nuvem, a origem do painel publicado entra por env.
// Vírgula separa mais de uma (preview da Vercel + produção, por exemplo). Continua allowlist:
// origem desconhecida leva 403 antes de qualquer rota.
const ORIGENS_PERMITIDAS = new Set([
  "http://localhost:5190",
  "http://127.0.0.1:5190",
  ...String(process.env.CLINICNOW_ORIGEM_EXTRA || "").split(",").map((o) => o.trim()),
].filter(Boolean));

/**
 * MODO OPERAÇÃO REAL. Desligado por padrão.
 *
 * Ligado (`CLINICNOW_MODO_OPERACAO=true`), o painel deixa de ser ensaio: aceita a mensagem real
 * da cliente e um apelido escolhido por quem opera. Em troca, TODO texto gravado passa pela
 * redação — telefone, e-mail, documento e data de nascimento viram marcador antes de tocar o
 * disco, e o ledger confere depois de redigir. Recusar a mensagem real tornaria o sistema
 * inutilizável, e sistema inutilizável vira planilha paralela, que é pior para a LGPD.
 *
 * O que continua aberto e está dito no painel: nome próprio não é detectável, e a política de
 * retenção (pendência 7.3) é da Andreia.
 */
const MODO_OPERACAO = String(process.env.CLINICNOW_MODO_OPERACAO || "").toLowerCase() === "true";

const DIR_CONFIG_PADRAO = join(homedir(), "Applications", "clinic-now-piloto-familia", "config");
function caminhoConfig(nome) {
  return process.env[`CLINICNOW_CONFIG_${nome.toUpperCase()}`] || join(process.env.CLINICNOW_CONFIG_DIR || DIR_CONFIG_PADRAO, `${nome}.json`);
}

// ---------------------------------------------------------------- configuração e gate
const PLACEHOLDER = /\[\s*PREENCHER\b/i;

function lerJson(caminho) {
  if (!existsSync(caminho)) return null;
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    return null;
  }
}

export function carregarConfiguracao() {
  return {
    clinica: lerJson(caminhoConfig("clinica-config")),
    agenda: lerJson(caminhoConfig("agenda-config")),
    operacao: lerJson(caminhoConfig("operacao-assistida")),
  };
}

function temPlaceholder(v) {
  if (typeof v === "string") return PLACEHOLDER.test(v);
  if (Array.isArray(v)) return v.some(temPlaceholder);
  if (v && typeof v === "object") return Object.values(v).some(temPlaceholder);
  return false;
}

/**
 * O gate é o coração da Fase 1: o preflight não é um lint que ninguém lê — ele MUDA o que a
 * Emily pode fazer. Enquanto reprovado, o painel opera em modo sintético e a Emily não oferece
 * horário, não menciona sinal e não usa tom "validado".
 */
export function calcularGate(cfg) {
  const erros = avaliarPreflight(cfg);
  const gradeDefinida = Boolean(cfg.agenda?.dias) && !temPlaceholder(cfg.agenda.dias)
    && Object.values(cfg.agenda.dias).some((faixas) => Array.isArray(faixas) && faixas.some((f) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(String(f))));
  // Tom validado ≠ política definida.
  //
  // Em 14/08 Sostenes definiu a POLÍTICA das três respostas (descobrir antes de precificar,
  // horário sai da agenda, o resto escala) e isso já é vinculante e está no motor. Mas quem
  // escreveu as PALAVRAS fomos nós. A voz é da Andreia, e só ela pode dizer que aquilo tem a
  // cara dela — por isso o gate depende de uma marca explícita dela, e não da mera existência
  // do campo. Ler "existe texto, então está validado" seria transformar rascunho nosso em voz
  // dela por descuido de código.
  const respostas = cfg.clinica?.voz?.respostas_modelo;
  const tomValidado = Boolean(respostas)
    && respostas.aprovado_pela_andreia === true
    && !temPlaceholder(respostas);
  return {
    preflight_aprovado: erros.length === 0,
    erros_preflight: erros,
    grade_definida: gradeDefinida,
    tom_validado: tomValidado,
    // Enquanto o preflight reprova, TUDO é sintético — a menos que a operação real esteja
    // explicitamente ligada, e aí a proteção deixa de ser "recusar" e passa a ser "redigir".
    modo_sintetico: erros.length > 0 && !MODO_OPERACAO,
    modo_operacao: MODO_OPERACAO,
    protecao_dados: MODO_OPERACAO
      ? "operação real: telefone, e-mail, documento e data são REDIGIDOS antes de gravar. Nome próprio não é detectável — evite sobrenome. Retenção (7.3) segue pendente."
      : "modo sintético: dado sensível é RECUSADO e só apelidos 'Cliente Demo NN' são aceitos.",
    pendencias_abertas: [
      !gradeDefinida && "2.3 — grade de horários semanais (AM/PM ambíguo)",
      !tomValidado && "6.5 — três respostas-modelo no tom da Andreia",
      temPlaceholder(cfg.operacao?.exemplos_para_avaliacao) && "9.1/9.2 — exemplos anonimizados",
      temPlaceholder(cfg.operacao?.retencao_de_registros) && "7.3 — política de retenção",
      temPlaceholder(cfg.operacao?.sinal_e_lista_de_espera) && "4.6 — sinal e lista de espera",
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------- polimento opcional pelo LLM
/**
 * Valida a reescrita do LLM antes de deixá-la virar o texto que vai para a cliente.
 *
 * "Se ele alucinar, a ação já estava decidida" é verdade e é insuficiente: a cliente lê as
 * PALAVRAS, não a ação. Um polimento que invente um horário, um preço ou uma promessa de
 * resultado causa dano mesmo com a ação certa. Então o polido só passa se não introduzir:
 *   - número que não existia no rascunho (horário, preço, quantidade de sessões);
 *   - símbolo de moeda novo;
 *   - promessa de resultado.
 * Falhou qualquer checagem → fica o texto da regra. Silenciosamente seguro, com motivo registrado.
 */
const PROMESSA = /\b(garant|assegur|com certeza vai|resultado garantido|vai resolver|fica perfeit|elimina de vez)/i;

/**
 * Vocabulário que viola um bloqueio SEM usar nenhum algarismo. Foi o furo da rodada 2: o
 * validador só sabia contar dígito, e passava "posso te encaixar amanhã de manhã, pode ser?",
 * "consigo sim encaixar você hoje à tarde" e "tem vaga sim, pode vir quando quiser".
 * Nenhuma tem número, moeda ou "garanto" — todas oferecem horário, que é exatamente o que a
 * pendência 2.3 proíbe. E a nossa própria voz escreve hora por extenso ("2 da tarde"), então
 * contar algarismo nunca ia bastar.
 */
const VOCAB_POR_BLOQUEIO = [
  {
    bloqueios: ["não afirmar disponibilidade", "não oferecer horário específico"],
    termos: [
      "encaixar", "encaixo", "te encaixo", "posso te", "consigo sim", "consigo te",
      "tem vaga", "tenho vaga", "tá livre", "esta livre", "está livre", "pode vir",
      "deixa comigo", "de manha", "de manhã", "a tarde", "à tarde", "de tarde", "de noite",
      "amanha", "amanhã", "hoje", "segunda", "terça", "terca", "quarta", "quinta", "sexta",
      "sabado", "sábado", "domingo", "meio-dia", "quando quiser", "que horas prefere",
    ],
  },
  {
    bloqueios: ["não mencionar valor de sinal", "não prometer lista de espera"],
    termos: ["sinal", "deposito", "depósito", "lista de espera", "reservar pagando"],
  },
  {
    bloqueios: ["nenhum valor fora do catálogo", "nenhum desconto", "desconto direto proibido"],
    termos: ["desconto", "promoção", "promocao", "condição especial", "mais barato", "cortesia"],
  },
  {
    bloqueios: ["nenhuma indicação de procedimento", "nenhum diagnóstico"],
    termos: ["recomendo", "indico", "você precisa de", "no seu caso", "o ideal pra você"],
  },
];

function contemTermo(texto, termo) {
  const n = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return new RegExp(`(^|[^a-z0-9])${n(termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(n(texto));
}

/**
 * @param {string} original  rascunho produzido pela regra
 * @param {string} polido    reescrita do LLM
 * @param {string[]} bloqueios  os bloqueios que a decisão carrega — o validador AGORA os lê
 */
export function validarPolimento(original, polido, bloqueios = []) {
  const numeros = (s) => (String(s).match(/\d+/g) || []).join(",");
  if (numeros(polido) !== numeros(original)) {
    return { ok: false, motivo: "polimento introduziu ou alterou números (horário, preço ou quantidade)" };
  }
  if (/[$€£]/.test(polido) && !/[$€£]/.test(original)) {
    return { ok: false, motivo: "polimento introduziu valor monetário que não estava no rascunho" };
  }
  if (PROMESSA.test(polido) && !PROMESSA.test(original)) {
    return { ok: false, motivo: "polimento introduziu promessa de resultado" };
  }
  if (polido.length > original.length * 2.5) {
    return { ok: false, motivo: "polimento ficou desproporcionalmente longo — provável alucinação" };
  }
  // O coração da checagem: se a decisão proíbe algo, a reescrita não pode reintroduzir por palavra.
  for (const grupo of VOCAB_POR_BLOQUEIO) {
    if (!grupo.bloqueios.some((b) => bloqueios.includes(b))) continue;
    for (const termo of grupo.termos) {
      if (contemTermo(polido, termo) && !contemTermo(original, termo)) {
        return { ok: false, motivo: `polimento reintroduziu "${termo}", que a decisão bloqueia` };
      }
    }
  }
  return { ok: true };
}

/**
 * O LLM NÃO decide — ele só reescreve o rascunho no tom certo, e a reescrita passa por
 * `validarPolimento`. Se a chave estiver inválida (é o caso hoje: 401) devolve o texto da regra
 * intacto e diz que não poliu. A operação não para.
 */
export async function polirTexto({ texto, decisao, cfg }) {
  if (!process.env.ANTHROPIC_API_KEY) return { texto, polido: false, motivo: "ANTHROPIC_API_KEY ausente" };
  try {
    const { chamarClaude } = await import("./emily.mjs");
    const voz = cfg.clinica?.voz || {};
    const system = [
      "Você reescreve UMA mensagem de WhatsApp no tom da clínica. Você NÃO decide nada:",
      "a ação já foi decidida por regra determinística e não pode mudar.",
      `Tom: ${voz.formalidade || "informal"}, ${voz.tamanho_mensagem || "curta"}.`,
      `Emojis permitidos: ${(voz.emojis_aprovados || []).join(" ")}.`,
      `Proibido: ${(voz.evitar || []).join("; ")}.`,
      "Não invente horário, preço, prazo, promessa de resultado ou informação clínica.",
      "Responda só com o texto final, sem aspas e sem comentário.",
    ].join("\n");
    const { texto: saida } = await chamarClaude({
      model: process.env.EMILY_MODEL || "claude-sonnet-4-5",
      system,
      messages: [{ role: "user", content: `Ação decidida: ${decisao.regra}\nRascunho: ${texto}` }],
      maxTokens: 300,
    });
    const limpo = String(saida || "").trim();
    if (!limpo) return { texto, polido: false, motivo: "resposta vazia" };
    const v = validarPolimento(texto, limpo, decisao?.bloqueios || []);
    // Reescrita reprovada não vira rascunho: fica o texto da regra e o motivo aparece no painel.
    if (!v.ok) return { texto, polido: false, motivo: `polimento REJEITADO — ${v.motivo}` };
    return { texto: limpo, polido: true };
  } catch (e) {
    return { texto, polido: false, motivo: e.message.slice(0, 200) };
  }
}

// ---------------------------------------------------------------- ocupações (Agendor → espelho → local)
export async function ocupacoesAtuais() {
  const espelho = lerEspelho();
  if (espelho.disponivel && !espelho.obsoleto) {
    return { fonte: "agendor_espelho", frescor_min: espelho.frescor_min, ocupacoes: espelho.compromissos };
  }
  const cfgAg = configAgendor();
  return {
    fonte: "indisponivel",
    motivo: espelho.disponivel ? `espelho obsoleto (${espelho.frescor_min} min)` : cfgAg.motivo || espelho.motivo,
    // Sem espelho fresco a lista vem vazia — e a regra 12 impede afirmar disponibilidade.
    ocupacoes: espelho.disponivel ? espelho.compromissos : [],
  };
}

// ---------------------------------------------------------------- HTTP
function json(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(texto);
}

function cors(req, res) {
  const origem = req.headers.origin;
  if (!origem) return true; // curl/local, sem navegador
  if (!ORIGENS_PERMITIDAS.has(origem)) return false;
  res.setHeader("Access-Control-Allow-Origin", origem);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-ClinicNow-Operador, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  return true;
}

async function corpoJson(req, limite = 64 * 1024) {
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > limite) throw new Error("corpo grande demais");
    partes.push(p);
  }
  const bruto = Buffer.concat(partes).toString("utf8");
  return { bruto, dados: bruto ? JSON.parse(bruto) : {} };
}

/**
 * @param agendaMarcar  executor de agenda (null = nenhuma ação real de agenda)
 * @param ledger        implementação do ledger. Padrão: arquivo. Na nuvem: `ledgerSupabase(...)`,
 *                      criado por requisição com o JWT de quem está logado.
 * @param aprovadorDe   como descobrir quem está operando. Padrão: o header do painel local.
 *                      Na nuvem, quem manda é a identidade autenticada, não um header digitável.
 */
export function criarHandler({
  agendaMarcar = null,
  ledger = ledgerArquivo,
  aprovadorDe = (req) => req.headers["x-clinicnow-operador"],
} = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);
    if (!cors(req, res)) return json(res, 403, { erro: "origem não permitida" });
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const cfg = carregarConfiguracao();
    const gate = calcularGate(cfg);

    try {
      // ---- estado geral: é o que o painel usa para se pintar de "modo sintético"
      if (req.method === "GET" && url.pathname === "/api/estado") {
        return json(res, 200, {
          clinica: cfg.clinica?.nome_clinica || null,
          gate,
          motor_llm: {
            chave_presente: Boolean(process.env.ANTHROPIC_API_KEY),
            // Não testamos a chave a cada request; o painel mostra "não verificada" e o
            // polimento degrada sozinho se ela estiver inválida.
            observacao: "A ação é sempre decidida por regra. O LLM só poliria o texto.",
          },
          agendor: { ...configAgendor(), token: undefined, espelho: lerEspelho() },
          ledger: await ledger.verificarCadeia(),
          estatisticas: await ledger.estatisticas(),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/fila") {
        return json(res, 200, { fila: await ledger.fila(), gate });
      }

      if (req.method === "GET" && url.pathname === "/api/historico") {
        return json(res, 200, { historico: await ledger.historico() });
      }

      // ---- nova mensagem → proposta (NÃO envia nada, NÃO mexe na agenda)
      if (req.method === "POST" && url.pathname === "/api/proposta") {
        const operador = await aprovadorDe(req);
        if (!operador) return json(res, 400, { erro: "header X-ClinicNow-Operador obrigatório" });
        const { dados } = await corpoJson(req);
        const { canal = "whatsapp", alias, mensagem, contexto = {} } = dados;
        if (!alias || !mensagem) return json(res, 400, { erro: "alias e mensagem são obrigatórios" });

        const oc = await ocupacoesAtuais();
        // Horários vindos da grade REAL dela. `confiavel` só é true com o espelho do Agendor
        // fresco — senão a Emily propõe, mas o painel manda conferir antes de aprovar.
        const confiavel = oc.fonte === "agendor_espelho";
        const livres = gate.grade_definida
          ? proximosLivres({ agenda: cfg.agenda || {}, ocupacoes: oc.ocupacoes, limite: 3, confiavel })
          : { horarios: [], confiavel: false, fonte: "grade pendente" };

        const decisao = decidir({
          mensagem,
          operacao: cfg.operacao || {},
          agenda: cfg.agenda || {},
          // `clinica` fornece os apelidos de serviço e alimenta a repergunta. Faltava aqui: os
          // cenários passavam e o único caminho real (a ponte) não — o ponto de extensão
          // documentado estava morto em produção.
          clinica: cfg.clinica || {},
          contexto: {
            ...contexto,
            ocupacoes: contexto.ocupacoes || oc.ocupacoes,
            horarios_livres: contexto.horarios_livres || livres.horarios,
            ocupacoes_confiaveis: confiavel,
          },
          gate,
        });

        const polimento = await polirTexto({ texto: decisao.resposta_sugerida, decisao, cfg });
        decisao.resposta_sugerida = polimento.texto;
        decisao.texto_polido_por_llm = polimento.polido;
        if (!polimento.polido) decisao.motivo_sem_polimento = polimento.motivo;
        decisao.origem_ocupacoes = { fonte: oc.fonte, motivo: oc.motivo, frescor_min: oc.frescor_min, horarios_de: livres.fonte };

        const id = await ledger.novaProposta({
          canal,
          alias,
          mensagem,
          decisao_motor: decisao,
          contexto,
          modoSintetico: gate.modo_sintetico,
          redigir: MODO_OPERACAO,
        });
        return json(res, 201, { id, decisao, gate });
      }

      // ---- decisão humana: o único caminho que faz qualquer coisa acontecer
      if (req.method === "POST" && url.pathname === "/api/decisao") {
        const operador = await aprovadorDe(req);
        if (!operador) return json(res, 400, { erro: "header X-ClinicNow-Operador obrigatório" });
        const { dados } = await corpoJson(req);
        const { id, decisao, texto_final, texto_original, motivo_da_decisao } = dados;

        const pendente = (await ledger.fila()).find((p) => p.id === id);
        if (!pendente) return json(res, 404, { erro: "proposta não está pendente" });

        const evento = await ledger.registrarDecisao({
          id,
          decisao,
          aprovador: String(operador),
          texto_original: texto_original ?? pendente.decisao_motor?.resposta_sugerida,
          texto_final,
          motivo_da_decisao,
          modoSintetico: gate.modo_sintetico,
          redigir: MODO_OPERACAO,
        });

        // Ação de agenda só acontece com decisão "aprovada" E ação proposta do tipo marcar.
        let agendaResultado = null;
        const acao = pendente.decisao_motor?.acao_agenda;
        if (decisao === "aprovada" && acao?.tipo === "marcar") {
          if (!gate.preflight_aprovado) {
            agendaResultado = { ok: false, motivo: "preflight reprovado — agenda real bloqueada (fail-closed)" };
          } else if (typeof agendaMarcar === "function") {
            try {
              agendaResultado = { ok: true, item: await agendaMarcar(acao) };
            } catch (e) {
              agendaResultado = { ok: false, motivo: e.message };
            }
          } else {
            agendaResultado = { ok: false, motivo: "executor de agenda não configurado" };
          }
          await ledger.registrarAcaoAgenda({ id, resultado: agendaResultado.ok ? "executada" : "bloqueada", detalhe: agendaResultado, modoSintetico: gate.modo_sintetico });
        }

        return json(res, 200, {
          ok: true,
          evento: { seq: evento.seq, hash: evento.hash },
          agenda: agendaResultado,
          // Repetido na resposta para o painel poder exibir: aprovar ≠ enviar.
          lembrete: "Mensagem aprovada NÃO foi enviada. Copie e cole no WhatsApp — o envio é humano na Fase 1.",
        });
      }

      // ---- webhook do Agendor: escuta assinada, só atualiza o espelho
      if (req.method === "POST" && url.pathname === "/webhooks/agendor") {
        const { bruto } = await corpoJson(req);
        const segredo = process.env.AGENDOR_WEBHOOK_SECRET;
        if (!assinaturaValida({ corpoBruto: bruto, assinatura: req.headers["x-clinicnow-signature"], segredo })) {
          return json(res, 401, { erro: "assinatura inválida" });
        }
        const r = await lerCompromissos({});
        if (r.disponivel) gravarEspelho(r.compromissos);
        return json(res, 200, { ok: true, ressincronizado: r.disponivel, motivo: r.motivo });
      }

      if (req.method === "GET" && url.pathname === "/api/ledger/verificar") {
        return json(res, 200, await ledger.verificarCadeia());
      }

      return json(res, 404, { erro: "rota desconhecida" });
    } catch (e) {
      return json(res, 500, { erro: e.message });
    }
  };
}

// ---------------------------------------------------------------- boot
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  carregarEnv();
  const { marcar } = await import("./agenda.mjs");
  const servidor = createServer(criarHandler({ agendaMarcar: (acao) => marcar(acao) }));
  // 127.0.0.1 explícito: nunca expor esta ponte na rede.
  servidor.listen(PORTA, "127.0.0.1", () => {
    const cfg = carregarConfiguracao();
    const gate = calcularGate(cfg);
    console.log(`[api] ponte de aprovação em http://127.0.0.1:${PORTA}`);
    console.log(`[api] clínica: ${cfg.clinica?.nome_clinica || "(config não encontrada)"}`);
    console.log(`[api] preflight: ${gate.preflight_aprovado ? "APROVADO" : `REPROVADO (${gate.erros_preflight.length} problema(s))`}`);
    console.log(`[api] modo: ${MODO_OPERACAO ? "OPERAÇÃO REAL (texto redigido antes de gravar)" : "SINTÉTICO (dado real é recusado)"}`);
    if (gate.pendencias_abertas.length) console.log(`[api] pendências: ${gate.pendencias_abertas.join(" | ")}`);
  });
}
