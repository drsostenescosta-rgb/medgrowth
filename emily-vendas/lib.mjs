#!/usr/bin/env node
// lib.mjs — utilidades compartilhadas do circuito Emily Vendas
// (env, Supabase REST com fallback, armazenamento local, telefone, log de escalação)
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE = join(ROOT, "..", "knowledge");
export const DIR_CONVERSAS = join(ROOT, "conversas");
export const ARQ_AGENDA_LOCAL = join(ROOT, "agenda.json");
export const ARQ_ESCALACOES = join(ROOT, "escalacoes.log");

export const ESTAGIOS = [
  "novo",
  "conversando",
  "avaliacao_agendada",
  "compareceu",
  "followup",
  "perdido",
];

// ---------------------------------------------------------------- env
function carregarEnvDe(caminho) {
  if (!existsSync(caminho)) return;
  for (const line of readFileSync(caminho, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/** Carrega .env local primeiro; ~/.env como fallback (é lá que vive a ANTHROPIC_API_KEY real). */
export function carregarEnv() {
  carregarEnvDe(join(ROOT, ".env"));
  carregarEnvDe(join(homedir(), ".env"));
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = "https://yaqphldowpshhrtvvfaq.supabase.co";
  }
}

// ---------------------------------------------------------------- Supabase REST (nunca quebra o runner)
export function supabaseDisponivel() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

/**
 * Chamada REST ao Supabase. Lança erro em falha — quem chama decide o fallback.
 * A service key NUNCA é logada nem impressa.
 */
export async function sb(caminho, { method = "GET", body, headers = {} } = {}) {
  if (!supabaseDisponivel()) throw new Error("supabase_indisponivel");
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${caminho}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status} ${caminho}: ${(await res.text()).slice(0, 300)}`);
  }
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

// ---------------------------------------------------------------- telefone
export function normalizarTelefone(t) {
  const dig = String(t || "").replace(/\D/g, "");
  if (!dig) throw new Error(`telefone inválido: "${t}"`);
  return dig;
}

// ---------------------------------------------------------------- histórico local (fallback e espelho)
export function caminhoConversa(telefone) {
  return join(DIR_CONVERSAS, `${normalizarTelefone(telefone)}.json`);
}

export function lerConversaLocal(telefone) {
  const p = caminhoConversa(telefone);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function salvarConversaLocal(conversa) {
  mkdirSync(DIR_CONVERSAS, { recursive: true });
  conversa.atualizado_em = new Date().toISOString();
  writeFileSync(caminhoConversa(conversa.telefone), JSON.stringify(conversa, null, 2));
}

export function listarConversasLocais() {
  if (!existsSync(DIR_CONVERSAS)) return [];
  return readdirSync(DIR_CONVERSAS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(DIR_CONVERSAS, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- log de escalação
export function registrarEscalacao(tipo, telefone, detalhe) {
  const linha = `${new Date().toISOString()} | ${tipo} | ${telefone} | ${String(detalhe)
    .replace(/\s+/g, " ")
    .slice(0, 500)}\n`;
  appendFileSync(ARQ_ESCALACOES, linha);
}

/**
 * Notificação IMEDIATA ao humano responsável (jornada §4.2/H2: "não espera o painel ser aberto").
 * Sempre grava em escalacoes.log; além disso, melhor esforço e sem quebrar o fluxo:
 *  - ALERTA_WEBHOOK_URL (Slack/Discord/qualquer webhook de alerta): POST JSON { text }
 *  - macOS: notificação de sistema via osascript (útil na fase Wizard-of-Oz com o operador no Mac)
 * A fase 2 (webhook WhatsApp) EXIGE ALERTA_WEBHOOK_URL configurada — ver gate em webhook.mjs.
 * NUNCA loga valores de chaves.
 */
export async function notificarHumano(tipo, telefone, detalhe) {
  registrarEscalacao(tipo, telefone, detalhe);
  const texto = `[Emily Vendas] ${tipo} — lead ${telefone}: ${String(detalhe).replace(/\s+/g, " ").slice(0, 300)}`;
  if (process.env.ALERTA_WEBHOOK_URL) {
    try {
      await fetch(process.env.ALERTA_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: texto }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.error(`[alerta] aviso: webhook de alerta falhou (${e.message}) — escalacoes.log mantém o registro`);
    }
  }
  if (process.platform === "darwin") {
    try {
      const { execFile } = await import("node:child_process");
      execFile(
        "osascript",
        ["-e", `display notification ${JSON.stringify(texto.slice(0, 140))} with title "Emily Vendas — HUMANO AGORA"`],
        () => {},
      );
    } catch {
      /* melhor esforço — o log já garante o registro */
    }
  }
}

// ---------------------------------------------------------------- data/hora
export function hojeISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function horaHM(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
