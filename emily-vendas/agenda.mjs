#!/usr/bin/env node
// agenda.mjs — agendamento simples da clínica (grade configurável + docgrow_consultas com fallback local)
//
// Uso:
//   node agenda.mjs livres [dias]                                        → horários livres
//   node agenda.mjs marcar <telefone> "<nome>" "<procedimento>" <AAAA-MM-DD> <HH:MM>
//   node agenda.mjs confirmar <telefone> <AAAA-MM-DD>                    → confirma agendamento
//   node agenda.mjs listar [dias]                                        → próximos agendamentos
//
// Fonte de verdade na fase Wizard-of-Oz: agenda.json local (sempre gravado).
// Supabase (docgrow_consultas) é espelhado quando SUPABASE_SERVICE_KEY + DOCGROW_PROFILE_ID existem.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  ARQ_AGENDA_LOCAL,
  carregarEnv,
  sb,
  supabaseDisponivel,
  normalizarTelefone,
  lerConversaLocal,
  salvarConversaLocal,
  hojeISO,
} from "./lib.mjs";

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

function config() {
  return JSON.parse(readFileSync(join(ROOT, "agenda-config.json"), "utf8"));
}

// ---------------------------------------------------------------- armazenamento local
function lerAgendaLocal() {
  if (!existsSync(ARQ_AGENDA_LOCAL)) return [];
  try {
    return JSON.parse(readFileSync(ARQ_AGENDA_LOCAL, "utf8"));
  } catch {
    return [];
  }
}

function salvarAgendaLocal(itens) {
  writeFileSync(ARQ_AGENDA_LOCAL, JSON.stringify(itens, null, 2));
}

// ---------------------------------------------------------------- grade e ocupação
function slotsDoDia(dataISO, cfg) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  const faixas = cfg.dias[DIAS_SEMANA[data.getDay()]] || [];
  const slots = [];
  for (const faixa of faixas) {
    const [ini, fim] = faixa.split("-");
    let [h, m] = ini.split(":").map(Number);
    const [hF, mF] = fim.split(":").map(Number);
    while (h * 60 + m + cfg.duracao_min <= hF * 60 + mF) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      m += cfg.duracao_min;
      h += Math.floor(m / 60);
      m %= 60;
    }
  }
  return slots;
}

async function chavesOcupadas(cfg) {
  const ocupadas = new Set();
  // 1) local (sempre)
  for (const item of lerAgendaLocal()) {
    if (item.status !== "cancelada") ocupadas.add(`${item.data}T${item.hora}`);
  }
  // 2) Supabase (melhor esforço — nunca quebra)
  if (supabaseDisponivel()) {
    try {
      const linhas = await sb(
        `docgrow_consultas?select=inicio,status&inicio=gte.${hojeISO()}&status=neq.cancelada&limit=500`,
      );
      for (const l of linhas || []) {
        const d = new Date(l.inicio);
        const p = (n) => String(n).padStart(2, "0");
        ocupadas.add(
          `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`,
        );
      }
    } catch (e) {
      console.error(`[agenda] aviso: Supabase indisponível para leitura (${e.message}) — usando só agenda local`);
    }
  }
  return ocupadas;
}

/** Próximos horários livres — usado pelo emily.mjs para injetar agenda real no prompt. */
export async function proximosLivres(limite = 6, dias = null) {
  const cfg = config();
  const horizonte = dias || cfg.horizonte_dias;
  const ocupadas = await chavesOcupadas(cfg);
  const minimo = new Date(Date.now() + cfg.antecedencia_horas * 3600 * 1000);
  const livres = [];
  for (let i = 0; i < horizonte && livres.length < limite; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dataISO = hojeISO(d);
    for (const hora of slotsDoDia(dataISO, cfg)) {
      if (livres.length >= limite) break;
      const [h, m] = hora.split(":").map(Number);
      const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      if (inicio < minimo) continue;
      if (ocupadas.has(`${dataISO}T${hora}`)) continue;
      livres.push({
        data: dataISO,
        hora,
        label: `${DIAS_SEMANA[inicio.getDay()]} ${dataISO.slice(8, 10)}/${dataISO.slice(5, 7)} às ${hora}`,
      });
    }
  }
  return livres;
}

// ---------------------------------------------------------------- marcar / confirmar / listar
export async function marcar({ telefone, nome, procedimento, data, hora }) {
  telefone = normalizarTelefone(telefone);
  const cfg = config();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
    throw new Error("use data AAAA-MM-DD e hora HH:MM");
  }
  if (!slotsDoDia(data, cfg).includes(hora)) {
    throw new Error(`${data} ${hora} está fora da grade de atendimento da clínica`);
  }
  // Mesmo filtro temporal de proximosLivres: nada no passado, nada dentro da antecedência mínima.
  {
    const [ano, mes, dia] = data.split("-").map(Number);
    const [h, m] = hora.split(":").map(Number);
    const inicio = new Date(ano, mes - 1, dia, h, m);
    const agora = new Date();
    if (inicio <= agora) {
      throw new Error(`${data} ${hora} já passou — agendamento em data/hora passada não existe`);
    }
    const minimo = new Date(agora.getTime() + cfg.antecedencia_horas * 3600 * 1000);
    if (inicio < minimo) {
      throw new Error(
        `${data} ${hora} fere a antecedência mínima de ${cfg.antecedencia_horas}h da clínica ` +
          `(agenda-config.json). Use \`node agenda.mjs livres\` para ver horários válidos.`,
      );
    }
  }
  const ocupadas = await chavesOcupadas(cfg);
  if (ocupadas.has(`${data}T${hora}`)) {
    throw new Error(`${data} ${hora} já está ocupado`);
  }

  const item = {
    telefone,
    nome,
    procedimento,
    data,
    hora,
    status: "agendada",
    origem: "emily-vendas",
    criado_em: new Date().toISOString(),
    supabase_id: null,
  };

  // Supabase (melhor esforço): docgrow_consultas exige profile_id (FK docgrow_profiles)
  if (supabaseDisponivel() && process.env.DOCGROW_PROFILE_ID) {
    try {
      const profileId = process.env.DOCGROW_PROFILE_ID;
      // paciente: procura por whatsapp; cria se não existir
      let pacienteId = null;
      const achados = await sb(
        `docgrow_pacientes?select=id&whatsapp=eq.${telefone}&profile_id=eq.${profileId}&limit=1`,
      );
      if (achados?.length) {
        pacienteId = achados[0].id;
      } else {
        const criado = await sb(`docgrow_pacientes`, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: { profile_id: profileId, nome, whatsapp: telefone, origem: "whatsapp" },
        });
        pacienteId = criado?.[0]?.id || null;
      }
      const inicio = new Date(`${data}T${hora}:00`);
      const fim = new Date(inicio.getTime() + cfg.duracao_min * 60000);
      const consulta = await sb(`docgrow_consultas`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          profile_id: profileId,
          paciente_id: pacienteId,
          inicio: inicio.toISOString(),
          fim: fim.toISOString(),
          tipo: "presencial",
          status: "agendada",
        },
      });
      item.supabase_id = consulta?.[0]?.id || null;
    } catch (e) {
      console.error(`[agenda] aviso: falha ao gravar no Supabase (${e.message}) — mantido só no local`);
    }
  } else if (supabaseDisponivel()) {
    console.error("[agenda] aviso: DOCGROW_PROFILE_ID ausente — agendamento gravado apenas localmente");
  }

  const itens = lerAgendaLocal();
  itens.push(item);
  salvarAgendaLocal(itens);

  // Agenda → funil (US-3/N6: a dor nº 1 é no-show — o lembrete não pode depender de memória):
  // move o lead para avaliacao_agendada e cria a tarefa de lembrete de véspera com data.
  await sincronizarFunilAposMarcar(item);
  return item;
}

/**
 * Sincroniza o funil depois de marcar: estágio avaliacao_agendada + próxima tarefa
 * "lembrete de véspera + confirmar presença" com followup_em datado (local + Supabase, nunca quebra).
 * Lembrete de agendamento confirmado é mensagem OPERACIONAL — permitido mesmo em cadência pausada
 * (playbook §1.4), mas nunca para opt-out sem decisão humana.
 */
async function sincronizarFunilAposMarcar(item) {
  const proxima =
    `Lembrete de véspera + confirmar presença — ${item.procedimento} em ${item.data} às ${item.hora} ` +
    `(node agenda.mjs confirmar ${item.telefone} ${item.data}); no dia: lembrete 2h antes`;
  const vespera = new Date(`${item.data}T09:00:00`);
  vespera.setDate(vespera.getDate() - 1);
  const followupEm = (vespera > new Date() ? vespera : new Date()).toISOString();

  // local (espelho do funil na fase Wizard-of-Oz)
  try {
    const agora = new Date().toISOString();
    const conversa = lerConversaLocal(item.telefone) || {
      telefone: item.telefone,
      nome: item.nome,
      criado_em: agora,
      mensagens: [],
    };
    conversa.nome = conversa.nome || item.nome;
    conversa.estagio = "avaliacao_agendada";
    conversa.proxima_acao = proxima;
    conversa.followup_em = followupEm;
    salvarConversaLocal(conversa);
  } catch (e) {
    console.error(`[agenda] aviso: funil local não atualizado (${e.message})`);
  }

  // Supabase clinicnow_leads (melhor esforço)
  if (supabaseDisponivel()) {
    try {
      const leads = await sb(`clinicnow_leads?select=id&whatsapp=eq.${item.telefone}&limit=1`);
      if (leads?.length) {
        await sb(`clinicnow_leads?id=eq.${leads[0].id}`, {
          method: "PATCH",
          body: { estagio: "avaliacao_agendada", proxima_acao: proxima, followup_em: followupEm },
        });
      } else {
        await sb(`clinicnow_leads`, {
          method: "POST",
          body: {
            nome: item.nome,
            whatsapp: item.telefone,
            origem: "whatsapp",
            estagio: "avaliacao_agendada",
            proxima_acao: proxima,
            followup_em: followupEm,
            consentimento_lgpd: false,
          },
        });
      }
    } catch (e) {
      console.error(`[agenda] aviso: funil não espelhado no Supabase (${e.message})`);
    }
  }
}

export async function confirmar(telefone, data) {
  telefone = normalizarTelefone(telefone);
  const itens = lerAgendaLocal();
  const alvo = itens.find(
    (i) => i.telefone === telefone && i.data === data && i.status !== "cancelada",
  );
  if (!alvo) throw new Error(`nenhum agendamento de ${telefone} em ${data}`);
  alvo.status = "confirmada";
  salvarAgendaLocal(itens);
  if (alvo.supabase_id && supabaseDisponivel()) {
    try {
      await sb(`docgrow_consultas?id=eq.${alvo.supabase_id}`, {
        method: "PATCH",
        body: { status: "confirmada" },
      });
    } catch (e) {
      console.error(`[agenda] aviso: confirmação não espelhada no Supabase (${e.message})`);
    }
  }
  return alvo;
}

export async function listar(dias = 7) {
  const limite = hojeISO(new Date(Date.now() + dias * 86400000));
  return lerAgendaLocal()
    .filter((i) => i.data >= hojeISO() && i.data <= limite && i.status !== "cancelada")
    .sort((a, b) => `${a.data}T${a.hora}`.localeCompare(`${b.data}T${b.hora}`));
}

// ---------------------------------------------------------------- CLI
async function cli() {
  carregarEnv();
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "livres") {
      const livres = await proximosLivres(10, args[0] ? Number(args[0]) : null);
      if (!livres.length) return console.log("Nenhum horário livre no período.");
      console.log("Horários livres:");
      for (const s of livres) console.log(`  ${s.label}`);
    } else if (cmd === "marcar") {
      const [telefone, nome, procedimento, data, hora] = args;
      if (!hora) {
        throw new Error('uso: node agenda.mjs marcar <telefone> "<nome>" "<procedimento>" <AAAA-MM-DD> <HH:MM>');
      }
      const item = await marcar({ telefone, nome, procedimento, data, hora });
      console.log(
        `Agendado: ${item.nome} — ${item.procedimento} — ${item.data} ${item.hora}` +
          (item.supabase_id ? ` (Supabase ${item.supabase_id})` : " (somente local)"),
      );
    } else if (cmd === "confirmar") {
      const [telefone, data] = args;
      if (!data) throw new Error("uso: node agenda.mjs confirmar <telefone> <AAAA-MM-DD>");
      const item = await confirmar(telefone, data);
      console.log(`Confirmado: ${item.nome} — ${item.data} ${item.hora}`);
    } else if (cmd === "listar") {
      const itens = await listar(args[0] ? Number(args[0]) : 7);
      if (!itens.length) return console.log("Nenhum agendamento no período.");
      for (const i of itens) {
        console.log(`  ${i.data} ${i.hora} — ${i.nome} (${i.procedimento}) [${i.status}] ${i.telefone}`);
      }
    } else {
      console.log("Comandos: livres [dias] | marcar <tel> \"<nome>\" \"<proc>\" <data> <hora> | confirmar <tel> <data> | listar [dias]");
    }
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cli();
}
