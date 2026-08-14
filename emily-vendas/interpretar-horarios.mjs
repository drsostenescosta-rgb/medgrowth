#!/usr/bin/env node
// interpretar-horarios.mjs — resolve AM/PM de horário informado por gente, sem chutar.
//
// Origem (decisão de Sostenes, 14/08/2026): a Andreia respondeu a grade como qualquer pessoa
// responde — "2:00 às 8:00", "10:30 às 3:00". A primeira versão tratou isso como ambíguo e
// derrubou o preflight. Sostenes apontou o óbvio: uma clínica de estética não atende às 2 da
// manhã. "2 horas" numa clínica é 2 da tarde, e não existe outra leitura.
//
// A diferença entre INTERPRETAR e CHUTAR, que é o que mantém a doutrina fail-closed de pé:
//   interpretar = aplicar uma regra determinística que ou resolve de forma ÚNICA, ou não resolve;
//   chutar      = escolher a leitura mais provável quando mais de uma sobrevive.
//
// Aqui só o primeiro acontece. As quatro leituras possíveis (AM/AM, AM/PM, PM/AM, PM/PM) são
// testadas contra três restrições de realidade. Se exatamente UMA sobrevive, ela é adotada e o
// motivo fica registrado. Se sobrar mais de uma — ou nenhuma — o campo continua PENDENTE e
// derruba o preflight, exatamente como antes.

/** Nenhuma clínica de estética abre antes das 6h nem fecha depois das 22h. */
export const JANELA_PLAUSIVEL = { inicio: 6 * 60, fim: 22 * 60 };
/** Um turno de atendimento tem no mínimo 2h e no máximo 14h. */
export const DURACAO_PLAUSIVEL = { min: 2 * 60, max: 14 * 60 };

export function paraMinutos(h, m) {
  return h * 60 + m;
}

export function paraHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "2:00", "10:30", "8h", "14" → {h, m} ou null. */
export function lerHora(bruto) {
  const t = String(bruto || "").trim().toLowerCase().replace(/\s/g, "");
  const m = /^(\d{1,2})(?:[:h.](\d{2}))?h?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/**
 * Candidatos AM/PM para uma hora escrita sem período.
 * 12 e 0 são âncoras: "12 horas" é meio-dia e "0 hora" é meia-noite — nenhum dos dois muda de
 * lado. Só 1–11 têm duas leituras possíveis.
 */
export function candidatosDeHora({ h, m }) {
  if (h === 0) return [paraMinutos(0, m)];
  if (h === 12) return [paraMinutos(12, m)];
  if (h > 12) return [paraMinutos(h, m)]; // já veio em 24h, não há o que interpretar
  return [paraMinutos(h, m), paraMinutos(h + 12, m)];
}

/**
 * Interpreta uma faixa escrita por gente ("2:00 às 8:00") e devolve:
 *   { ok: true, faixa: "14:00-20:00", motivo, leituras_descartadas }
 *   { ok: false, motivo, candidatos }  ← continua PENDENTE, não vira palpite
 */
export function interpretarFaixa(bruto, { janela = JANELA_PLAUSIVEL, duracao = DURACAO_PLAUSIVEL } = {}) {
  const partes = String(bruto || "")
    .toLowerCase()
    .split(/\s*(?:as|às|a|até|ate|-|—|–)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length !== 2) {
    return { ok: false, motivo: `não consegui separar início e fim em "${bruto}"`, candidatos: [] };
  }

  const ini = lerHora(partes[0]);
  const fim = lerHora(partes[1]);
  if (!ini || !fim) {
    return { ok: false, motivo: `hora ilegível em "${bruto}"`, candidatos: [] };
  }

  const validos = [];
  const descartados = [];
  for (const a of candidatosDeHora(ini)) {
    for (const b of candidatosDeHora(fim)) {
      const rotulo = `${paraHHMM(a)}-${paraHHMM(b)}`;
      if (a >= b) {
        descartados.push({ leitura: rotulo, por_que: "fim não é depois do início" });
        continue;
      }
      if (a < janela.inicio || b > janela.fim) {
        descartados.push({ leitura: rotulo, por_que: `fora da janela plausível ${paraHHMM(janela.inicio)}–${paraHHMM(janela.fim)}` });
        continue;
      }
      const dur = b - a;
      if (dur < duracao.min || dur > duracao.max) {
        descartados.push({ leitura: rotulo, por_que: `turno de ${(dur / 60).toFixed(1)}h fora do plausível` });
        continue;
      }
      validos.push({ leitura: rotulo, inicio: a, fim: b });
    }
  }

  if (validos.length === 1) {
    return {
      ok: true,
      faixa: validos[0].leitura,
      motivo: `"${bruto}" só tem uma leitura possível numa clínica: ${validos[0].leitura}`,
      leituras_descartadas: descartados,
    };
  }
  if (validos.length === 0) {
    return { ok: false, motivo: `nenhuma leitura plausível para "${bruto}"`, candidatos: descartados };
  }
  // Mais de uma leitura sobrevive → é ambiguidade DE VERDADE. Continua pendente.
  return {
    ok: false,
    motivo: `"${bruto}" tem ${validos.length} leituras plausíveis (${validos.map((v) => v.leitura).join(" ou ")}) — só a Andreia resolve`,
    candidatos: validos,
  };
}

/**
 * Aplica um bloqueio fixo (ex.: academia 07:30–10:00) sobre uma faixa já interpretada.
 * Devolve as sobras. Bloqueio no meio parte a faixa em duas.
 */
export function subtrairBloqueio(faixa, bloqueio) {
  const [a, b] = faixa.split("-").map((x) => { const p = lerHora(x); return paraMinutos(p.h, p.m); });
  const [x, y] = bloqueio.split("-").map((s) => { const p = lerHora(s); return paraMinutos(p.h, p.m); });
  if (y <= a || x >= b) return [faixa];
  const sobras = [];
  if (x > a) sobras.push(`${paraHHMM(a)}-${paraHHMM(x)}`);
  if (y < b) sobras.push(`${paraHHMM(y)}-${paraHHMM(b)}`);
  return sobras;
}

/**
 * Interpreta a semana inteira.
 * @param {object} respostas  { seg: "2:00 as 8:00", ... } como ela respondeu
 * @param {object} opcoes     { bloqueios: ["07:30-10:00"], duracaoMinimaSlot }
 */
export function interpretarSemana(respostas, { bloqueios = [] } = {}) {
  const dias = {};
  const registro = [];
  const pendentes = [];

  for (const [dia, bruto] of Object.entries(respostas)) {
    if (!bruto || /^\s*(fechado|nao|não|-)\s*$/i.test(String(bruto))) {
      dias[dia] = [];
      registro.push({ dia, resposta: bruto ?? "(vazio)", resultado: "fechado" });
      continue;
    }
    const r = interpretarFaixa(bruto);
    if (!r.ok) {
      dias[dia] = [`[PREENCHER — PENDENTE-CONFIRMAR: ${r.motivo}]`];
      pendentes.push({ dia, motivo: r.motivo });
      registro.push({ dia, resposta: bruto, resultado: "PENDENTE", motivo: r.motivo });
      continue;
    }
    let faixas = [r.faixa];
    for (const bloqueio of bloqueios) {
      faixas = faixas.flatMap((f) => subtrairBloqueio(f, bloqueio));
    }
    dias[dia] = faixas;
    registro.push({
      dia,
      resposta: bruto,
      interpretado: r.faixa,
      apos_bloqueios: faixas,
      motivo: r.motivo,
    });
  }

  return { dias, registro, pendentes, ok: pendentes.length === 0 };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [entrada] = process.argv.slice(2);
  if (!entrada) {
    console.log('Uso: node interpretar-horarios.mjs "2:00 as 8:00"');
    process.exit(1);
  }
  console.log(JSON.stringify(interpretarFaixa(entrada), null, 2));
}

// ---------------------------------------------------------------- grade → horários concretos
// Converter "quarta, 10:30-20:00" em instantes reais exige o fuso da clínica: a Andreia está em
// Massachusetts e o servidor pode estar em qualquer lugar. Fazer isso com `new Date(...)` local
// erra por horas — e horário errado numa confirmação é exatamente o que gera no-show.

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

function offsetMinutos(fuso, instante) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (comoUTC - instante.getTime()) / 60_000;
}

/** Hora LOCAL da clínica → instante ISO em UTC. Duas passadas resolvem a virada do horário de verão. */
export function instanteLocal(ano, mes, dia, hh, mm, fuso) {
  const ingenuo = Date.UTC(ano, mes - 1, dia, hh, mm);
  let palpite = ingenuo;
  for (let i = 0; i < 2; i++) palpite = ingenuo - offsetMinutos(fuso, new Date(palpite)) * 60_000;
  return new Date(palpite).toISOString();
}

function partesLocais(instante, fuso) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(instante).map((x) => [x.type, x.value]));
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { ano: +p.year, mes: +p.month, dia: +p.day, diaSemana: DIAS_SEMANA[idx] };
}

/**
 * Próximos horários livres reais, respeitando grade, duração + buffer, antecedência e ocupações.
 *
 * `ocupacoes` vem do espelho do Agendor. Enquanto o espelho estiver desligado a lista chega
 * vazia — e é por isso que quem chama recebe `confiavel:false` e o painel manda conferir no
 * Agendor antes de aprovar. Oferecer horário sem ler a agenda dela é apostar, e apostar aqui
 * significa marcar duas clientes no mesmo lugar.
 */
export function proximosLivres({ agenda, agora = new Date().toISOString(), ocupacoes = [], limite = 3, confiavel = false }) {
  const fuso = agenda.fuso_horario || "America/New_York";
  const duracao = Number(agenda.duracao_min) || 50;
  const buffer = Number(agenda.buffer_min) || 10;
  const passo = duracao + buffer;
  const minimo = new Date(agora).getTime() + (Number(agenda.antecedencia_horas) || 0) * 3_600_000;
  const horizonte = Number(agenda.horizonte_dias) || 14;

  const livres = [];
  for (let i = 0; i <= horizonte && livres.length < limite; i++) {
    const base = new Date(new Date(agora).getTime() + i * 86_400_000);
    const { ano, mes, dia, diaSemana } = partesLocais(base, fuso);
    for (const faixa of agenda.dias?.[diaSemana] || []) {
      if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(String(faixa))) continue; // faixa pendente: ignora
      const [ini, fim] = faixa.split("-");
      const [hI, mI] = ini.split(":").map(Number);
      const [hF, mF] = fim.split(":").map(Number);
      for (let t = hI * 60 + mI; t + duracao <= hF * 60 + mF; t += passo) {
        if (livres.length >= limite) break;
        const inicio = instanteLocal(ano, mes, dia, Math.floor(t / 60), t % 60, fuso);
        if (new Date(inicio).getTime() < minimo) continue;
        const termina = new Date(new Date(inicio).getTime() + passo * 60_000).toISOString();
        const bate = ocupacoes.some((o) => new Date(inicio) < new Date(o.fim) && new Date(o.inicio) < new Date(termina));
        if (!bate) livres.push(inicio);
      }
    }
  }
  return { horarios: livres, confiavel, fonte: confiavel ? "espelho do Agendor" : "somente a grade (agenda dela NÃO foi lida)" };
}
