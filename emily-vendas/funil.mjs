#!/usr/bin/env node
// funil.mjs — board do funil estilo Agendor no terminal
//
// Uso:
//   node funil.mjs                          → imprime o board por estágio
//   node funil.mjs mover <telefone> <estagio>
//   node funil.mjs toque <telefone>         → registra um toque de reengajamento (ciclo D1/D3/D7 com teto)
//   node funil.mjs retomar <telefone>       → devolve a conversa à Emily (limpa pausa; opt-out exige --cliente-voltou)
//
// Estágios (mesmo CHECK de clinicnow_leads.estagio):
//   novo | conversando | avaliacao_agendada | compareceu | followup | perdido
// Estados transversais (flags locais + ai_paused no Supabase): pausado (D7/escalado) e opt_out.
//
// Fontes: Supabase clinicnow_leads + fallback/espelho local (conversas/*.json).
// Princípio Agendor: todo lead tem estágio + próxima ação + follow-up com data;
// follow-up vencido aparece em destaque.
// Teto anti-spam (playbook §1.4/§8.1): máx. 2 toques de venda (D1, D3); o 3º contato é o D7 de
// pausa respeitosa — depois dele, silêncio total até o cliente voltar. Lead pausado/opt-out NUNCA
// aparece como "prioridade do dia".
import { pathToFileURL } from "node:url";
import {
  ESTAGIOS,
  carregarEnv,
  sb,
  supabaseDisponivel,
  normalizarTelefone,
  lerConversaLocal,
  salvarConversaLocal,
  listarConversasLocais,
} from "./lib.mjs";

const COR = {
  reset: "\x1b[0m",
  negrito: "\x1b[1m",
  cinza: "\x1b[90m",
  vermelho: "\x1b[31m",
  amarelo: "\x1b[33m",
  verde: "\x1b[32m",
  ciano: "\x1b[36m",
};

const TITULO_ESTAGIO = {
  novo: "🆕 NOVO",
  conversando: "💬 CONVERSANDO",
  avaliacao_agendada: "📅 AVALIAÇÃO AGENDADA",
  compareceu: "✅ COMPARECEU",
  followup: "🔁 FOLLOW-UP",
  perdido: "🗑  PERDIDO",
};

const MAX_TOQUES_VENDA = 2; // D1 e D3; o 3º contato é o D7 (encerramento, não é venda)

async function carregarLeads() {
  const porTelefone = new Map();

  // 1) Supabase (quando disponível)
  if (supabaseDisponivel()) {
    try {
      const linhas = await sb(
        `clinicnow_leads?select=nome,whatsapp,estagio,proxima_acao,followup_em,criado_em&order=criado_em.asc&limit=500`,
      );
      for (const l of linhas || []) {
        if (!l.whatsapp) continue;
        porTelefone.set(normalizarTelefone(l.whatsapp), {
          telefone: normalizarTelefone(l.whatsapp),
          nome: l.nome,
          estagio: ESTAGIOS.includes(l.estagio) ? l.estagio : "novo",
          proxima_acao: l.proxima_acao || "(definir próxima ação)",
          followup_em: l.followup_em,
          opt_out: false,
          ai_paused: false,
          pausado: false,
          toques: 0,
          fonte: "supabase",
        });
      }
    } catch (e) {
      console.error(`${COR.cinza}[funil] aviso: Supabase indisponível (${e.message}) — usando só o local${COR.reset}`);
    }
  }

  // 2) Local (fallback e fonte fresca da fase Wizard-of-Oz) — local prevalece
  //    (é no local que vivem as flags opt_out/ai_paused/pausado e o contador de toques)
  for (const c of listarConversasLocais()) {
    porTelefone.set(c.telefone, {
      telefone: c.telefone,
      nome: c.nome || `Lead WhatsApp ${c.telefone.slice(-4)}`,
      estagio: ESTAGIOS.includes(c.estagio) ? c.estagio : "novo",
      proxima_acao: c.proxima_acao || "(definir próxima ação)",
      followup_em: c.followup_em || null,
      opt_out: Boolean(c.opt_out),
      ai_paused: Boolean(c.ai_paused),
      pausado: Boolean(c.pausado),
      toques: Number(c.toques_reengajamento) || 0,
      fonte: porTelefone.has(c.telefone) ? "supabase+local" : "local",
    });
  }

  return [...porTelefone.values()];
}

function formatarFollowup(followupEm) {
  if (!followupEm) return `${COR.cinza}sem follow-up marcado${COR.reset}`;
  const data = new Date(followupEm);
  const rotulo = data.toLocaleDateString("pt-BR");
  if (data < new Date()) {
    return `${COR.vermelho}${COR.negrito}⚠ FOLLOW-UP VENCIDO (${rotulo})${COR.reset}`;
  }
  return `${COR.verde}follow-up ${rotulo}${COR.reset}`;
}

const emSilencio = (l) => l.opt_out || l.ai_paused || l.pausado;

async function imprimirBoard() {
  const leads = await carregarLeads();
  console.log(`\n${COR.negrito}${COR.ciano}══════ FUNIL EMILY VENDAS — ClinicNow ══════${COR.reset}`);
  if (!leads.length) {
    console.log(`${COR.cinza}Nenhum lead ainda. Rode o emily.mjs com uma conversa real para popular o funil.${COR.reset}\n`);
    return;
  }

  const ativos = leads.filter((l) => !emSilencio(l));
  const silenciados = leads.filter(emSilencio);

  // Vencidos: só leads ativos; teto anti-spam separa "recontatar" de "encerrar com D7"
  const vencidos = ativos.filter((l) => l.followup_em && new Date(l.followup_em) < new Date());
  const seteDias = 7 * 86400000;
  const recontatar = vencidos.filter((l) => l.toques < MAX_TOQUES_VENDA && Date.now() - new Date(l.followup_em) < seteDias);
  const encerrar = vencidos.filter((l) => l.toques >= MAX_TOQUES_VENDA || Date.now() - new Date(l.followup_em) >= seteDias);

  if (recontatar.length) {
    console.log(`${COR.vermelho}${COR.negrito}\n⚠ ${recontatar.length} follow-up(s) VENCIDO(S) — prioridade do dia:${COR.reset}`);
    for (const l of recontatar) {
      console.log(
        `  ${COR.vermelho}→ ${l.nome} (${l.telefone}): ${l.proxima_acao} ${COR.cinza}[toques ${l.toques}/${MAX_TOQUES_VENDA} — registre com: node funil.mjs toque ${l.telefone}]${COR.reset}`,
      );
    }
  }
  if (encerrar.length) {
    console.log(
      `${COR.amarelo}${COR.negrito}\n⏳ ${encerrar.length} lead(s) no TETO ANTI-SPAM (2 toques de venda ou 7+ dias) — próximo contato é o D7 de pausa respeitosa, NÃO é venda:${COR.reset}`,
    );
    for (const l of encerrar) {
      console.log(
        `  ${COR.amarelo}→ ${l.nome} (${l.telefone}): enviar D7 (encerramento digno do playbook §8.2) e pausar: node funil.mjs toque ${l.telefone}${COR.reset}`,
      );
    }
  }

  for (const estagio of ESTAGIOS) {
    const doEstagio = ativos.filter((l) => l.estagio === estagio);
    console.log(`\n${COR.negrito}${TITULO_ESTAGIO[estagio]} (${doEstagio.length})${COR.reset}`);
    if (!doEstagio.length) {
      console.log(`  ${COR.cinza}—${COR.reset}`);
      continue;
    }
    for (const l of doEstagio) {
      console.log(`  • ${COR.negrito}${l.nome}${COR.reset} ${COR.cinza}(${l.telefone}, ${l.fonte})${COR.reset}`);
      console.log(`    próxima ação: ${l.proxima_acao}`);
      console.log(`    ${formatarFollowup(l.followup_em)}`);
    }
  }

  if (silenciados.length) {
    console.log(`\n${COR.negrito}⏸ PAUSADO / OPT-OUT (${silenciados.length}) — NÃO recontatar${COR.reset}`);
    for (const l of silenciados) {
      const motivo = l.opt_out
        ? "OPT-OUT (sagrado — nenhum disparo, nunca)"
        : l.ai_paused
          ? "escalado para humano (retomar: node funil.mjs retomar " + l.telefone + ")"
          : "ciclo D1/D3/D7 encerrado — silêncio até o cliente voltar";
      console.log(`  • ${l.nome} ${COR.cinza}(${l.telefone})${COR.reset} — ${motivo}`);
    }
  }

  console.log(
    `\n${COR.cinza}Comandos: node funil.mjs mover <tel> <${ESTAGIOS.join("|")}> | toque <tel> | retomar <tel> [--cliente-voltou]${COR.reset}\n`,
  );
}

async function mover(telefoneBruto, estagio) {
  const telefone = normalizarTelefone(telefoneBruto);
  if (!ESTAGIOS.includes(estagio)) {
    throw new Error(`estágio inválido "${estagio}". Use: ${ESTAGIOS.join(" | ")}`);
  }
  let mexeu = false;

  // local
  const conversa = lerConversaLocal(telefone);
  if (conversa) {
    conversa.estagio = estagio;
    salvarConversaLocal(conversa);
    mexeu = true;
  }

  // Supabase
  if (supabaseDisponivel()) {
    try {
      const leads = await sb(`clinicnow_leads?select=id&whatsapp=eq.${telefone}&limit=1`);
      if (leads?.length) {
        await sb(`clinicnow_leads?id=eq.${leads[0].id}`, { method: "PATCH", body: { estagio } });
        mexeu = true;
      }
    } catch (e) {
      console.error(`${COR.cinza}[funil] aviso: não espelhado no Supabase (${e.message})${COR.reset}`);
    }
  }

  if (!mexeu) throw new Error(`lead ${telefone} não encontrado (nem local, nem Supabase)`);
  console.log(`Lead ${telefone} movido para ${COR.negrito}${estagio}${COR.reset}`);
}

/** Registra um toque de reengajamento respeitando o teto D1/D3/D7 do playbook (§1.4/§8.1). */
async function toque(telefoneBruto) {
  const telefone = normalizarTelefone(telefoneBruto);
  const conversa = lerConversaLocal(telefone);
  if (!conversa) throw new Error(`lead ${telefone} não encontrado no espelho local`);
  if (conversa.opt_out) throw new Error(`lead ${telefone} está em OPT-OUT — nenhum contato é permitido`);
  if (conversa.pausado) {
    throw new Error(`lead ${telefone} já está PAUSADO (D7 enviado) — silêncio até o cliente voltar`);
  }

  const toques = (Number(conversa.toques_reengajamento) || 0) + 1;
  conversa.toques_reengajamento = toques;

  if (toques <= MAX_TOQUES_VENDA) {
    // D1 (toque 1) → próximo em +2d (D3); D3 (toque 2) → próximo em +4d (D7)
    const dias = toques === 1 ? 2 : 4;
    conversa.followup_em = new Date(Date.now() + dias * 86400000).toISOString();
    conversa.proxima_acao =
      toques === 1
        ? "Toque D1 enviado — se seguir sem resposta, D3 (conteúdo de valor, playbook §8.2)"
        : "Toque D3 enviado — ÚLTIMO toque de venda; se seguir sem resposta, o próximo contato é o D7 de encerramento";
    salvarConversaLocal(conversa);
    console.log(
      `Toque ${toques}/${MAX_TOQUES_VENDA} registrado para ${telefone}. Próximo follow-up: ${new Date(conversa.followup_em).toLocaleDateString("pt-BR")}` +
        (toques === MAX_TOQUES_VENDA ? ` ${COR.amarelo}(atenção: o próximo contato é o D7 — encerramento, não venda)${COR.reset}` : ""),
    );
  } else {
    // 3º contato = D7: pausa respeitosa e fim do ciclo — silêncio digno
    conversa.pausado = true;
    conversa.followup_em = null;
    conversa.proxima_acao = "Ciclo D1/D3/D7 encerrado (D7 enviado) — silêncio até o cliente voltar";
    salvarConversaLocal(conversa);
    console.log(
      `${COR.amarelo}D7 registrado para ${telefone} — lead PAUSADO. Nenhum novo contato de venda até o cliente voltar.${COR.reset}`,
    );
  }
}

/** Devolve a conversa à Emily (decisão humana). Opt-out só com --cliente-voltou (o cliente pediu para retomar). */
async function retomar(telefoneBruto, flags) {
  const telefone = normalizarTelefone(telefoneBruto);
  const conversa = lerConversaLocal(telefone);
  if (!conversa) throw new Error(`lead ${telefone} não encontrado no espelho local`);
  if (conversa.opt_out && !flags.includes("--cliente-voltou")) {
    throw new Error(
      `lead ${telefone} está em OPT-OUT. Só retome se o CLIENTE pediu para voltar — nesse caso rode: ` +
        `node funil.mjs retomar ${telefone} --cliente-voltou`,
    );
  }
  conversa.ai_paused = false;
  conversa.pausado = false;
  conversa.toques_reengajamento = 0;
  if (flags.includes("--cliente-voltou")) conversa.opt_out = false;
  salvarConversaLocal(conversa);

  if (supabaseDisponivel()) {
    try {
      await sb(`clinicnow_wa_conversas?phone=eq.${telefone}`, { method: "PATCH", body: { ai_paused: false } });
    } catch (e) {
      console.error(`${COR.cinza}[funil] aviso: ai_paused não espelhado no Supabase (${e.message})${COR.reset}`);
    }
  }
  console.log(`Conversa de ${telefone} devolvida à Emily (pausa limpa${flags.includes("--cliente-voltou") ? ", opt-out removido a pedido do cliente" : ""}).`);
}

async function cli() {
  carregarEnv();
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "mover") {
      const [telefone, estagio] = args;
      if (!estagio) throw new Error("uso: node funil.mjs mover <telefone> <estagio>");
      await mover(telefone, estagio);
    } else if (cmd === "toque") {
      const [telefone] = args;
      if (!telefone) throw new Error("uso: node funil.mjs toque <telefone>");
      await toque(telefone);
    } else if (cmd === "retomar") {
      const [telefone] = args;
      if (!telefone) throw new Error("uso: node funil.mjs retomar <telefone> [--cliente-voltou]");
      await retomar(telefone, args.slice(1));
    } else {
      await imprimirBoard();
    }
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cli();
}
