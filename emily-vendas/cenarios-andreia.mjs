#!/usr/bin/env node
// cenarios-andreia.mjs — runner dos cinco cenários críticos do piloto da Andreia.
//
// Diferença para o shadow-workbench.mjs (que já existia e continua valendo):
//   o workbench valida o SCHEMA de uma simulação sintética genérica (novo_pedido, conflito,
//   confirmacao_ambigua, cancelamento, escalacao_clinica). Este runner valida a DECISÃO do motor
//   de regras contra a configuração REAL da Andreia, nos cinco casos que Sostenes levantou com
//   ela na entrevista. Um checa a forma; o outro checa o julgamento.
//
// Nada aqui envia mensagem, toca agenda ou grava ledger. É leitura + decisão + conferência.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { decidir, norm } from "./regras.mjs";
import { escanearDadosSensiveis } from "./redaction.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const ARQ_CENARIOS = join(ROOT, "fixtures", "cenarios-andreia.v1.json");
const DIR_CONFIG = process.env.CLINICNOW_CONFIG_DIR
  || join(homedir(), "Applications", "clinic-now-piloto-familia", "config");

export function carregarCenarios(arquivo = ARQ_CENARIOS) {
  const dados = JSON.parse(readFileSync(arquivo, "utf8"));
  if (dados.sintetico !== true) throw new Error("fixture sem marca sintetico:true — recusada");
  return dados;
}

export function carregarConfigAndreia(dir = DIR_CONFIG) {
  const ler = (n) => {
    const p = join(dir, `${n}.json`);
    if (!existsSync(p)) throw new Error(`configuração ausente: ${p}`);
    return JSON.parse(readFileSync(p, "utf8"));
  };
  return { clinica: ler("clinica-config"), agenda: ler("agenda-config"), operacao: ler("operacao-assistida") };
}

/**
 * O gate usado nos cenários reflete a realidade de hoje: grade PENDENTE e tom PENDENTE.
 * Deixar isso explícito é o ponto — os cenários provam o comportamento COM as pendências abertas,
 * que é o estado em que o piloto realmente está.
 */
export const GATE_HOJE = Object.freeze({
  preflight_aprovado: false,
  grade_definida: false,
  tom_validado: false,
  modo_sintetico: true,
});

export function rodarCenario(cenario, cfg, gate = GATE_HOJE) {
  const decisao = decidir({
    mensagem: cenario.mensagem,
    operacao: cfg.operacao,
    agenda: cfg.agenda,
    clinica: cfg.clinica,
    contexto: { agora: "2026-08-14T18:00:00.000Z", ...cenario.contexto },
    gate,
  });

  const e = cenario.esperado;
  const falhas = [];

  if (decisao.acao !== e.acao) falhas.push(`ação: esperado "${e.acao}", obtido "${decisao.acao}"`);
  if (decisao.regra !== e.regra) falhas.push(`regra: esperada "${e.regra}", obtida "${decisao.regra}"`);
  if (e.acao_agenda_tipo && decisao.acao_agenda?.tipo !== e.acao_agenda_tipo) {
    falhas.push(`ação de agenda: esperada "${e.acao_agenda_tipo}", obtida "${decisao.acao_agenda?.tipo}"`);
  }
  if (e.relacao && decisao.relacao !== e.relacao) {
    falhas.push(`relação: esperada "${e.relacao}", obtida "${decisao.relacao}"`);
  }

  // Invariante de VOZ para todo cenário: hora de 24h (13:00–23:59) é linguagem de sistema.
  // A clínica é em Massachusetts — a cliente lê "2 da tarde", não "14:00".
  const hora24 = /\b(1[3-9]|2[0-3]):[0-5]\d\b/.exec(decisao.resposta_sugerida);
  if (hora24) falhas.push(`texto usa hora de 24h ("${hora24[0]}") — deveria ser hora falada`);

  const texto = norm(decisao.resposta_sugerida);

  // Checagem mais dura que uma lista de palavras: enquanto a grade está PENDENTE, a mensagem
  // não pode conter NENHUM horário concreto ("14h", "14:00", "às 10"). É o erro que mais
  // custaria caro — prometer um horário que a Andreia não tem.
  if (e.nao_pode_oferecer_horario) {
    const horario = /\b\d{1,2}\s*(?:h\b|:\d{2}\b|hrs?\b)/i.exec(decisao.resposta_sugerida);
    if (horario) falhas.push(`texto oferece horário concreto ("${horario[0]}") com a grade PENDENTE`);
  }

  for (const proibido of e.nao_pode_conter || []) {
    if (texto.includes(norm(proibido))) falhas.push(`texto contém termo proibido: "${proibido}"`);
  }
  for (const exigido of e.deve_conter || []) {
    if (!texto.includes(norm(exigido))) falhas.push(`texto não contém o exigido: "${exigido}"`);
  }
  for (const inv of e.invariantes || []) {
    if (!decisao.bloqueios.includes(inv)) falhas.push(`invariante ausente nos bloqueios: "${inv}"`);
  }

  // Invariantes que valem para TODOS os cenários da Fase 1.
  if (decisao.requer_aprovacao_humana !== true) falhas.push("requer_aprovacao_humana deveria ser true");
  if (decisao.envio_automatico !== false) falhas.push("envio_automatico deveria ser false");
  if (decisao.tom_validado !== false) falhas.push("tom_validado deveria ser false enquanto a pendência 6.5 estiver aberta");

  return { id: cenario.id, titulo: cenario.titulo, decisao, falhas, ok: falhas.length === 0 };
}

export function rodarTodos({ arquivo = ARQ_CENARIOS, dirConfig = DIR_CONFIG, gate = GATE_HOJE } = {}) {
  const fixture = carregarCenarios(arquivo);
  const cfg = carregarConfigAndreia(dirConfig);

  // A fixture inteira passa pelo scanner de PII antes de rodar: se algum dado real
  // vazou para dentro dela, o runner falha fechado em vez de "só rodar".
  const achados = escanearDadosSensiveis(fixture.cenarios.map((c) => ({ msg: c.mensagem, ctx: c.contexto })));
  const resultados = fixture.cenarios.map((c) => rodarCenario(c, cfg, gate));
  return {
    versao: fixture.versao,
    sintetico: true,
    pii_achados: achados,
    total: resultados.length,
    aprovados: resultados.filter((r) => r.ok).length,
    resultados,
    // Nenhum relatório deste runner autoriza go-live. Ele autoriza SHADOW.
    veredito: "APTO_PARA_REVISAO_HUMANA",
  };
}

/**
 * Exporta a fila que o Painel de Aprovação mostra na demo. É o motor de regras REAL decidindo
 * — a demo não tem resposta escrita à mão em lugar nenhum; ela é uma gravação desta execução.
 * Regerar: `npm run shadow:andreia -- --exportar <caminho>`.
 */
export function exportarParaPainel({ arquivo = ARQ_CENARIOS, dirConfig = DIR_CONFIG } = {}) {
  const fixture = carregarCenarios(arquivo);
  const cfg = carregarConfigAndreia(dirConfig);
  const r = rodarTodos({ arquivo, dirConfig });
  return {
    _gerado_por: "medgrowth/emily-vendas/cenarios-andreia.mjs",
    _aviso: "Fila de DEMO: 100% sintética, gerada pelo motor de regras. Nenhuma cliente real, nenhuma mensagem real.",
    gerado_em: fixture._agora_simulado,
    clinica: cfg.clinica?.nome_clinica || null,
    modo_sintetico: true,
    envio_automatico: false,
    servicos: (cfg.operacao?.servicos || []).map((s) => ({
      nome: s.nome_publico,
      preco_usd: s.preco_usd,
      duracao_min: s.politica_operacional?.duracao_min,
      buffer_min: s.politica_operacional?.buffer_min,
      exige_avaliacao_previa: Boolean(s.politica_operacional?.exige_avaliacao_previa),
    })),
    fila: fixture.cenarios.map((c, i) => ({
      id: `demo-${c.id}`,
      canal: "whatsapp",
      alias: c.alias,
      primeiro_nome: c.contexto?.primeiro_nome || null,
      atendimentos_anteriores: c.contexto?.atendimentos_anteriores ?? 0,
      titulo: c.titulo,
      porque_importa: c.porque_importa,
      mensagem: c.mensagem,
      decisao_motor: r.resultados[i].decisao,
    })),
  };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const iExport = args.indexOf("--exportar");
  if (iExport !== -1) {
    const destino = args[iExport + 1];
    if (!destino) {
      console.error("uso: node cenarios-andreia.mjs --exportar <caminho.json>");
      process.exit(1);
    }
    const dados = exportarParaPainel();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, JSON.stringify(dados, null, 2) + "\n");
    console.log(`Fila de demo exportada (${dados.fila.length} itens) → ${destino}`);
    process.exit(0);
  }

  const r = rodarTodos();
  console.log(`\nCinco cenários críticos — ${r.versao} (100% sintético)\n`);
  for (const item of r.resultados) {
    const marca = item.ok ? "✔" : "✘";
    console.log(`${marca} ${item.id} — ${item.titulo}`);
    console.log(`    regra:  ${item.decisao.regra}`);
    console.log(`    ação:   ${item.decisao.acao}  |  agenda: ${item.decisao.acao_agenda.tipo}`);
    console.log(`    motivo: ${item.decisao.motivo}`);
    console.log(`    texto:  ${item.decisao.resposta_sugerida.replace(/\n/g, " ⏎ ").slice(0, 120)}…`);
    if (item.decisao.bloqueios.length) console.log(`    bloqueios: ${item.decisao.bloqueios.join(" · ")}`);
    for (const f of item.falhas) console.log(`    ✘ ${f}`);
    console.log("");
  }
  if (r.pii_achados.length) console.log(`⚠ PII na fixture: ${JSON.stringify(r.pii_achados)}`);
  console.log(`Resultado: ${r.aprovados}/${r.total} cenários com o comportamento esperado.`);
  console.log(`Veredito: ${r.veredito} — não autoriza dado real nem envio automático.\n`);
  process.exit(r.aprovados === r.total && r.pii_achados.length === 0 ? 0 : 1);
}
