#!/usr/bin/env node
// agendor.mjs — espelho SOMENTE LEITURA da agenda do Agendor.
//
// Decisão de produto (docs/decisoes/2026-08-14-fonte-de-verdade-agenda-agendor.md, opção C):
//   O Agendor CONTINUA sendo a fonte de verdade. A Andreia não troca de ferramenta no meio do
//   piloto — trocar a ferramenta da dona na primeira semana é o jeito mais rápido de matar o
//   piloto. O ClinicNow LÊ e ESCUTA; ele não escreve e não decide.
//
// Estado da verificação (honesto):
//   ✔ Verificado por documentação pública: autenticação por header `Authorization: Token <uuid>`;
//     base v3 em https://api.agendor.com.br/v3; assinatura de webhook por POST em
//     https://api.agendor.com.br/integrations/subscriptions com { target_url, event }.
//   ✘ NÃO verificado: o caminho exato de LEITURA de compromissos/tarefas e o formato da resposta.
//     Sem um token real não dá para confirmar, e chutar endpoint é exatamente o tipo de suposição
//     que este piloto proíbe. Por isso existe o comando `descobrir`: com o token na mão, ele
//     sonda os candidatos, informa qual respondeu 200 e grava o formato real em
//     `.agendor/descoberta.json`. Só depois disso a leitura é ligada.
//
// FLAG: tudo aqui fica desligado sem AGENDOR_ENABLED=true E AGENDOR_TOKEN presente.
// Sem token o módulo NÃO trava o piloto: devolve { disponivel:false, motivo } e a operação
// segue no modo "a Emily não afirma disponibilidade" (que já é a regra vigente).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const DIR_AGENDOR = join(ROOT, ".agendor");
export const ARQ_ESPELHO = join(DIR_AGENDOR, "espelho.json");
export const ARQ_DESCOBERTA = join(DIR_AGENDOR, "descoberta.json");

export const BASE_V3 = "https://api.agendor.com.br/v3";
export const URL_SUBSCRIPTIONS = "https://api.agendor.com.br/integrations/subscriptions";

/** Candidatos a endpoint de leitura, na ordem em que o `descobrir` vai sondar. */
export const CANDIDATOS_LEITURA = [
  "/tasks",
  "/tasks?per_page=10",
  "/users/tasks",
  "/deals/tasks",
  "/activities",
  "/events",
];

// ---------------------------------------------------------------- flag e configuração
export function configAgendor(env = process.env, { arquivoDescoberta = ARQ_DESCOBERTA } = {}) {
  const ligado = String(env.AGENDOR_ENABLED || "").toLowerCase() === "true";
  const token = env.AGENDOR_TOKEN || "";
  // `AGENDOR_ENDPOINT_TAREFAS: ""` explícito significa "ignore a descoberta em disco" — é o que
  // permite testar o caminho "ainda não descoberto" sem depender do estado da máquina.
  const endpoint = Object.hasOwn(env, "AGENDOR_ENDPOINT_TAREFAS")
    ? env.AGENDOR_ENDPOINT_TAREFAS
    : lerEndpointDescoberto(arquivoDescoberta);
  if (!ligado) return { disponivel: false, motivo: "AGENDOR_ENABLED não é true — integração desligada por padrão." };
  if (!token) return { disponivel: false, motivo: "AGENDOR_TOKEN ausente. Andreia precisa gerar o token em Agendor → Configurações → Integrações → API." };
  if (!endpoint) {
    return {
      disponivel: false,
      motivo: "Endpoint de leitura ainda não confirmado. Rode `node agendor.mjs descobrir` com o token para sondar e gravar o caminho real.",
    };
  }
  return { disponivel: true, token, endpoint, base: env.AGENDOR_BASE || BASE_V3 };
}

function lerEndpointDescoberto(arquivo = ARQ_DESCOBERTA) {
  try {
    return JSON.parse(readFileSync(arquivo, "utf8")).endpoint_escolhido || null;
  } catch {
    return null;
  }
}

function cabecalhos(token) {
  // Formato documentado publicamente pelo Agendor. O token NUNCA é logado.
  return { Authorization: `Token ${token}`, "Content-Type": "application/json" };
}

// ---------------------------------------------------------------- leitura
/**
 * Lê compromissos do Agendor e devolve no formato interno { inicio, fim, titulo, externo_id }.
 * Nunca lança: falha de rede devolve { disponivel:false }, porque a indisponibilidade do CRM
 * não pode derrubar o painel de aprovação — ela só proíbe afirmar disponibilidade.
 */
export async function lerCompromissos({ desde, ate, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = configAgendor(env);
  if (!cfg.disponivel) return { disponivel: false, motivo: cfg.motivo, compromissos: [] };
  const url = new URL(cfg.base + cfg.endpoint);
  if (desde) url.searchParams.set("since", desde);
  if (ate) url.searchParams.set("until", ate);
  try {
    const res = await fetchImpl(url.toString(), { headers: cabecalhos(cfg.token), signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { disponivel: false, motivo: `Agendor respondeu ${res.status}. Conferir token e plano da conta.`, compromissos: [] };
    }
    const bruto = await res.json();
    return { disponivel: true, compromissos: normalizarCompromissos(bruto), bruto_amostra: amostra(bruto) };
  } catch (e) {
    return { disponivel: false, motivo: `Falha de rede ao ler o Agendor: ${e.message}`, compromissos: [] };
  }
}

/**
 * Converte a resposta do Agendor no formato interno. Tolerante a variações de nome de campo
 * porque o formato exato ainda não foi verificado com token real — mas NUNCA inventa horário:
 * item sem data utilizável é descartado e contabilizado em `ignorados`.
 */
export function normalizarCompromissos(bruto) {
  const lista = Array.isArray(bruto) ? bruto : bruto?.data || bruto?.items || bruto?.results || [];
  const compromissos = [];
  let ignorados = 0;
  for (const item of lista) {
    const inicioBruto = item.start_date || item.startDate || item.due_date || item.dueDate || item.date || item.inicio;
    const fimBruto = item.end_date || item.endDate || item.fim;
    const inicio = dataValida(inicioBruto);
    if (!inicio) {
      ignorados++;
      continue;
    }
    const fim = dataValida(fimBruto) || new Date(new Date(inicio).getTime() + 60 * 60_000).toISOString();
    compromissos.push({
      externo_id: String(item.id ?? item.uuid ?? ""),
      inicio,
      fim,
      titulo: String(item.text || item.title || item.description || "compromisso").slice(0, 120),
      fonte: "agendor",
    });
  }
  compromissos.ignorados = ignorados;
  return compromissos;
}

function dataValida(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function amostra(bruto) {
  const lista = Array.isArray(bruto) ? bruto : bruto?.data || bruto?.items || bruto?.results || [];
  return lista.slice(0, 1);
}

// ---------------------------------------------------------------- espelho local
export function gravarEspelho(compromissos) {
  mkdirSync(DIR_AGENDOR, { recursive: true });
  const conteudo = { atualizado_em: new Date().toISOString(), total: compromissos.length, compromissos };
  writeFileSync(ARQ_ESPELHO, JSON.stringify(conteudo, null, 2));
  return conteudo;
}

/**
 * Espelho lido pelo painel. `frescor_min` diz há quanto tempo foi atualizado — o painel usa isso
 * para NÃO afirmar disponibilidade com espelho velho (dado velho é pior que dado ausente).
 */
export function lerEspelho() {
  if (!existsSync(ARQ_ESPELHO)) return { disponivel: false, motivo: "Espelho do Agendor nunca foi sincronizado.", compromissos: [] };
  try {
    const e = JSON.parse(readFileSync(ARQ_ESPELHO, "utf8"));
    const frescorMin = (Date.now() - new Date(e.atualizado_em).getTime()) / 60_000;
    return { disponivel: true, ...e, frescor_min: Math.round(frescorMin), obsoleto: frescorMin > 15 };
  } catch (e) {
    return { disponivel: false, motivo: `Espelho ilegível: ${e.message}`, compromissos: [] };
  }
}

// ---------------------------------------------------------------- webhook (escuta)
/**
 * Valida a assinatura do webhook. O Agendor não documenta publicamente um esquema de assinatura,
 * então o receptor exige um segredo COMPARTILHADO NOSSO (AGENDOR_WEBHOOK_SECRET) no header
 * X-ClinicNow-Signature: sem ele, o endpoint recusa. Aceitar POST não autenticado seria abrir
 * uma porta para qualquer um mexer no espelho da agenda dela.
 */
export function assinaturaValida({ corpoBruto, assinatura, segredo }) {
  if (!segredo || !assinatura) return false;
  const esperado = createHmac("sha256", segredo).update(corpoBruto).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(assinatura).replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Assina um webhook no Agendor (ação de escrita na conta dela — exige confirmação humana). */
export async function assinarWebhook({ target_url, event, env = process.env, fetchImpl = fetch }) {
  const cfg = configAgendor(env);
  if (!cfg.disponivel) return { ok: false, motivo: cfg.motivo };
  const res = await fetchImpl(URL_SUBSCRIPTIONS, {
    method: "POST",
    headers: cabecalhos(cfg.token),
    body: JSON.stringify({ target_url, event }),
  });
  const texto = await res.text();
  return { ok: res.ok, status: res.status, resposta: texto.slice(0, 400) };
}

// ---------------------------------------------------------------- descoberta
/**
 * Sonda os candidatos com o token real e grava o que respondeu 200. É o passo que substitui
 * o chute: nenhum endpoint entra em produção sem ter respondido aqui.
 */
export async function descobrir({ env = process.env, fetchImpl = fetch, arquivo = ARQ_DESCOBERTA } = {}) {
  const token = env.AGENDOR_TOKEN;
  if (!token) return { ok: false, motivo: "AGENDOR_TOKEN ausente — nada a sondar." };
  const base = env.AGENDOR_BASE || BASE_V3;
  const tentativas = [];
  for (const caminho of CANDIDATOS_LEITURA) {
    try {
      const res = await fetchImpl(base + caminho, { headers: cabecalhos(token), signal: AbortSignal.timeout(8000) });
      const corpo = res.ok ? await res.text() : "";
      tentativas.push({
        caminho,
        status: res.status,
        ok: res.ok,
        amostra: corpo.slice(0, 300),
      });
    } catch (e) {
      tentativas.push({ caminho, status: null, ok: false, erro: e.message });
    }
  }
  const escolhido = tentativas.find((t) => t.ok)?.caminho || null;
  mkdirSync(dirname(arquivo), { recursive: true });
  const rel = { sondado_em: new Date().toISOString(), base, tentativas, endpoint_escolhido: escolhido };
  writeFileSync(arquivo, JSON.stringify(rel, null, 2));
  return { ok: Boolean(escolhido), ...rel };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd] = process.argv.slice(2);
  const { carregarEnv } = await import("./lib.mjs");
  carregarEnv();
  if (cmd === "descobrir") {
    const r = await descobrir();
    console.log(JSON.stringify(r, null, 2));
    console.log(r.ok ? `\n✔ Endpoint de leitura: ${r.endpoint_escolhido}` : "\n✘ Nenhum candidato respondeu 200 — ver tentativas acima.");
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "sync") {
    const r = await lerCompromissos({});
    if (!r.disponivel) {
      console.error(`Agendor indisponível: ${r.motivo}`);
      process.exit(1);
    }
    const e = gravarEspelho(r.compromissos);
    console.log(`Espelho atualizado: ${e.total} compromisso(s) em ${ARQ_ESPELHO}`);
  } else if (cmd === "status") {
    console.log(JSON.stringify({ config: { ...configAgendor(), token: undefined }, espelho: lerEspelho() }, null, 2));
  } else {
    console.log("Comandos: descobrir | sync | status");
  }
}
