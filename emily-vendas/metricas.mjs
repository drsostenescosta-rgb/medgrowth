#!/usr/bin/env node
// metricas.mjs — instrumentação do go/no-go (PRD §5 / jornada §6)
//
// Uso:
//   node metricas.mjs            → métricas dos últimos 7 dias
//   node metricas.mjs --dias 28  → janela de 28 dias (as 4 semanas do teste com a mãe)
//
// Fontes: conversas/<tel>.json (espelho local, sempre presente), agenda.json e escalacoes.log.
// Nada aqui chama modelo nem grava — só lê e calcula. O veredito da semana 4 sai deste script,
// não de contagem manual em JSONs.
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ARQ_AGENDA_LOCAL, ARQ_ESCALACOES, carregarEnv, listarConversasLocais } from "./lib.mjs";

function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
}

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

async function rodar() {
  carregarEnv();
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--dias");
  const dias = idx >= 0 ? Number(argv[idx + 1]) || 7 : 7;
  const corte = Date.now() - dias * 86400000;
  const semanas = Math.max(dias / 7, 1);

  const conversas = listarConversasLocais();
  const naJanela = (ts) => ts && new Date(ts).getTime() >= corte;

  // Conversas com atividade na janela
  const ativas = conversas.filter((c) => (c.mensagens || []).some((m) => naJanela(m.ts)));
  const escaladas = ativas.filter((c) =>
    (c.mensagens || []).some((m) => m.direction === "out" && naJanela(m.ts) && (m.acao === "escalar_humano" || m.acao === "opt_out")),
  );
  const resolvidasSemHumano = ativas.length - escaladas.length;
  const pctSemHumano = ativas.length ? (100 * resolvidasSemHumano) / ativas.length : null;

  // Latência do motor (registrada por mensagem out). ATENÇÃO fase 1: isto mede o MOTOR;
  // o tempo total até o cliente inclui o operador colar a resposta (janela-alvo < 1 min).
  const latencias = conversas
    .flatMap((c) => c.mensagens || [])
    .filter((m) => m.direction === "out" && naJanela(m.ts) && Number.isFinite(m.latencia_ms))
    .map((m) => m.latencia_ms);
  const latMediana = mediana(latencias);

  // Agendamentos
  let agenda = [];
  if (existsSync(ARQ_AGENDA_LOCAL)) {
    try {
      agenda = JSON.parse(readFileSync(ARQ_AGENDA_LOCAL, "utf8"));
    } catch {
      agenda = [];
    }
  }
  const criadosJanela = agenda.filter((a) => naJanela(a.criado_em) && a.status !== "cancelada");
  const confirmadosJanela = agenda.filter((a) => naJanela(a.criado_em) && a.status === "confirmada");
  const confirmadosPorSemana = confirmadosJanela.length / semanas;

  // No-show (parcial): agendamentos passados × leads marcados "compareceu" no funil
  const hoje = new Date().toISOString().slice(0, 10);
  const passados = agenda.filter((a) => a.data < hoje && a.status !== "cancelada");
  const compareceram = conversas.filter((c) => c.estagio === "compareceu").length;

  // Escalações e opt-outs (log + flags)
  const contagemLog = {};
  if (existsSync(ARQ_ESCALACOES)) {
    for (const linha of readFileSync(ARQ_ESCALACOES, "utf8").split("\n")) {
      const partes = linha.split(" | ");
      if (partes.length < 3) continue;
      if (new Date(partes[0]).getTime() < corte) continue;
      contagemLog[partes[1]] = (contagemLog[partes[1]] || 0) + 1;
    }
  }
  const optOuts = conversas.filter((c) => c.opt_out).length;

  const status = (ok, parcial = false) => (parcial ? "◐ medir manual" : ok ? "✔ ok" : "✘ abaixo");

  console.log(`\n══════ MÉTRICAS EMILY VENDAS — últimos ${dias} dia(s) (go/no-go PRD §5) ══════\n`);
  console.log(
    `  % conversas resolvidas sem humano  ${pctSemHumano == null ? "—" : pctSemHumano.toFixed(0) + "%"}  (meta ≥ 60%)  ` +
      (pctSemHumano == null ? "◐ sem dados" : status(pctSemHumano >= 60)) +
      `  [${resolvidasSemHumano}/${ativas.length} conversas ativas]`,
  );
  console.log(
    `  Tempo de resposta mediano (motor)  ${fmtMs(latMediana)}  (meta total < 1 min na fase 1)  ` +
      (latMediana == null ? "◐ sem dados" : status(latMediana < 60000)) +
      `  [${latencias.length} respostas; somar o tempo do operador colar]`,
  );
  console.log(
    `  Agendamentos confirmados/semana    ${confirmadosPorSemana.toFixed(1)}  (meta ≥ 10/semana)  ` +
      status(confirmadosPorSemana >= 10) +
      `  [${confirmadosJanela.length} confirmados; ${criadosJanela.length} criados na janela]`,
  );
  console.log(
    `  Taxa de no-show                    ${passados.length ? `${compareceram} compareceram / ${passados.length} agendamentos passados` : "—"}  ` +
      `◐ parcial [marque presença com: node funil.mjs mover <tel> compareceu]`,
  );
  console.log(`  Escalações na janela (numerador da taxa de escalada):`);
  const tipos = Object.keys(contagemLog);
  if (!tipos.length) console.log(`      (nenhuma escalação registrada)`);
  for (const t of tipos) console.log(`      ${t}: ${contagemLog[t]}`);
  console.log(
    `      Taxa de escalada CORRETA = 100% exige revisão humana do denominador (conversas fora de escopo):\n` +
      `      revise escalacoes.log × conversas da semana — qualquer fora-de-escopo NÃO escalado = no-go.`,
  );
  console.log(`  Opt-outs ativos                    ${optOuts}  (alta = revisar cadências — jornada §6)`);
  console.log(
    `\n  Medição manual obrigatória da semana: horas economizadas (auto-relato da mãe vs baseline 16–24h; meta ≥ 50%)\n` +
      `  e NPS da mãe (0–10 + "o que quase te fez desistir?"; meta ≥ 8). Sem estas duas não há go.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await rodar();
}
