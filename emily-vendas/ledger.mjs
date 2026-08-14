#!/usr/bin/env node
// ledger.mjs — registro append-only das aprovações da operação assistida.
//
// Por que um ledger e não uma tabela comum:
//   Na Fase 1 a promessa central para a Andreia é "nada sai sem alguém clicar". Uma promessa
//   dessas só vale se for AUDITÁVEL depois — inclusive contra nós mesmos. Então cada evento é
//   uma linha imutável, encadeada por hash: alterar ou apagar qualquer linha do meio quebra a
//   cadeia e `verificarCadeia()` acusa. Não é criptografia forte contra um atacante com acesso
//   ao arquivo (ele poderia reescrever tudo); é integridade contra edição acidental, bug e
//   "eu jurava que tinha aprovado".
//
// O que NUNCA entra aqui: nada que o scanner de PII reprove enquanto o preflight estiver
// reprovado. O gate é aplicado na escrita, não na leitura — dado errado não chega a existir.

import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exigirSomenteSintetico, validarAliasSintetico } from "./redaction.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const ARQ_LEDGER = join(ROOT, "aprovacoes.jsonl");
/**
 * Âncora externa: guarda `{total, ultimo_hash}` FORA do arquivo de eventos.
 *
 * Por que existe (auditoria do Sheldon Pai, 14/08): a cadeia de hash sozinha detecta edição de
 * uma linha do meio, mas NÃO detecta truncamento nem reescrita completa — bastava recalcular a
 * cadeia inteira e `verificar` dizia "ÍNTEGRA". A âncora obriga o adulterador a editar dois
 * arquivos de forma consistente. Continua NÃO sendo à prova de quem tem acesso ao disco, e isso
 * está dito com todas as letras no kit de operação: o que ela dá é detecção de acidente,
 * truncamento e edição descuidada — não prova criptográfica contra um atacante local.
 */
export const ARQ_ANCORA = join(ROOT, ".aprovacoes-ancora.json");
export const GENESIS = "0".repeat(64);

export const TIPOS_EVENTO = Object.freeze(["proposta_criada", "decisao_humana", "acao_agenda", "nota_operacional"]);
export const DECISOES = Object.freeze(["aprovada", "editada", "escalada", "descartada"]);

/**
 * JSON canônico (chaves ordenadas) — sem isso, o mesmo conteúdo geraria hashes diferentes.
 *
 * Regra crítica, descoberta rodando a ponte de verdade: uma chave com valor `undefined` tem de
 * ser tratada como AUSENTE, exatamente como o JSON.stringify faz ao gravar o arquivo. A primeira
 * versão serializava `undefined` como `null`; o hash era calculado com a chave e o arquivo era
 * gravado sem ela, então toda releitura acusava a cadeia como quebrada. Um verificador de
 * integridade que grita "adulterado" sem adulteração nenhuma é pior que não ter verificador:
 * ensina a ignorar o alarme. O canônico agora espelha a serialização real.
 */
export function canonico(valor) {
  if (valor === undefined || typeof valor === "function" || typeof valor === "symbol") return undefined;
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  // Arrays: JSON.stringify troca buraco/undefined por null — aqui também.
  if (Array.isArray(valor)) return `[${valor.map((v) => canonico(v) ?? "null").join(",")}]`;
  const pares = Object.keys(valor)
    .sort()
    .map((k) => [k, canonico(valor[k])])
    .filter(([, v]) => v !== undefined);
  return `{${pares.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",")}}`;
}

export function hashDe(hashAnterior, payload) {
  return createHash("sha256").update(`${hashAnterior}\n${canonico(payload) ?? "null"}`).digest("hex");
}

// ---------------------------------------------------------------- leitura
export function lerTudo(arquivo = ARQ_LEDGER) {
  if (!existsSync(arquivo)) return [];
  return readFileSync(arquivo, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((linha, i) => {
      try {
        return JSON.parse(linha);
      } catch (e) {
        throw new Error(`ledger corrompido na linha ${i + 1}: ${e.message}`);
      }
    });
}

/**
 * Revalida a cadeia inteira. Devolve { ok, total, quebras: [{seq, esperado, encontrado}] }.
 * É isto que transforma o ledger em prova, e não em log.
 */
function caminhoAncora(arquivo) {
  return arquivo === ARQ_LEDGER ? ARQ_ANCORA : `${arquivo}.ancora.json`;
}

export function lerAncora(arquivo = ARQ_LEDGER) {
  try {
    return JSON.parse(readFileSync(caminhoAncora(arquivo), "utf8"));
  } catch {
    return null;
  }
}

function gravarAncora(arquivo, total, ultimoHash) {
  writeFileSync(
    caminhoAncora(arquivo),
    JSON.stringify({ total, ultimo_hash: ultimoHash, atualizado_em: new Date().toISOString() }, null, 2),
  );
}

export function verificarCadeia(arquivo = ARQ_LEDGER) {
  const eventos = lerTudo(arquivo);
  const quebras = [];
  let anterior = GENESIS;
  eventos.forEach((ev, i) => {
    if (ev.hash_anterior !== anterior) {
      quebras.push({ seq: ev.seq ?? i, campo: "hash_anterior", esperado: anterior, encontrado: ev.hash_anterior });
    }
    const esperado = hashDe(ev.hash_anterior, ev.payload);
    if (ev.hash !== esperado) {
      quebras.push({ seq: ev.seq ?? i, campo: "hash", esperado, encontrado: ev.hash });
    }
    if (ev.seq !== i) {
      quebras.push({ seq: i, campo: "seq", esperado: i, encontrado: ev.seq });
    }
    anterior = ev.hash;
  });

  // Confronto com a âncora externa: pega truncamento, reescrita completa E append forjado.
  const ancora = lerAncora(arquivo);
  if (ancora) {
    if (eventos.length < ancora.total) {
      quebras.push({ seq: eventos.length, campo: "ancora.total", esperado: ancora.total, encontrado: eventos.length, explicacao: "eventos DESAPARECERAM do arquivo" });
    } else if (eventos.length === ancora.total && anterior !== ancora.ultimo_hash) {
      quebras.push({ seq: eventos.length, campo: "ancora.ultimo_hash", esperado: ancora.ultimo_hash, encontrado: anterior, explicacao: "arquivo foi reescrito inteiro" });
    } else if (eventos.length > ancora.total) {
      // O ataque mais provável de todos: apendar "a Andreia aprovou isto" com o hash recalculado
      // e não tocar na âncora. É exatamente a alegação que este ledger existe para defender, e
      // passava. Toda escrita legítima atualiza a âncora — se sobrou evento, ele não passou aqui.
      quebras.push({
        seq: ancora.total,
        campo: "ancora.total",
        esperado: ancora.total,
        encontrado: eventos.length,
        explicacao: `${eventos.length - ancora.total} evento(s) APARECERAM sem passar pelo registro`,
      });
    }
  }

  return {
    ok: quebras.length === 0,
    total: eventos.length,
    quebras,
    ultimo_hash: anterior,
    ancora: ancora ? { presente: true, total: ancora.total, atualizado_em: ancora.atualizado_em } : { presente: false },
  };
}

function ultimoHash(arquivo) {
  const eventos = lerTudo(arquivo);
  return eventos.length ? eventos[eventos.length - 1].hash : GENESIS;
}

// ---------------------------------------------------------------- escrita
/**
 * Grava um evento. `modoSintetico` liga o scanner de PII: enquanto o preflight estiver
 * REPROVADO, qualquer telefone, e-mail ou campo de paciente reprova a escrita inteira.
 */
export function registrar({ tipo, payload, modoSintetico = true, arquivo = ARQ_LEDGER, permitirAncoraDivergente = false }) {
  if (!TIPOS_EVENTO.includes(tipo)) throw new Error(`tipo de evento desconhecido: ${tipo}`);
  if (!payload || typeof payload !== "object") throw new Error("payload obrigatório");
  if (modoSintetico) exigirSomenteSintetico(payload);

  const eventos = lerTudo(arquivo);

  // A âncora é conferida ANTES de gravar. Sem isto, a próxima mensagem normal regravava a âncora
  // e APAGAVA o alarme de adulteração: o arquivo era truncado, `verificar` acusava, e um único
  // atendimento depois voltava a dizer "ÍNTEGRA" — a evidência sumia justamente porque a operação
  // continuou. Alarme que se apaga sozinho é pior que alarme nenhum.
  if (!permitirAncoraDivergente) {
    const estado = verificarCadeia(arquivo);
    if (!estado.ok) {
      throw new Error(
        `ledger com integridade QUEBRADA — gravação recusada para não apagar a evidência. ` +
          `Problemas: ${JSON.stringify(estado.quebras)}. ` +
          `Investigue e, se for o caso, rode: node ledger.mjs reancorar --confirmo "<seu nome>" "<motivo>"`,
      );
    }
  }

  const anterior = eventos.length ? eventos[eventos.length - 1].hash : GENESIS;
  const corpo = { tipo, ...payload, ts: payload.ts || new Date().toISOString() };
  const evento = {
    seq: eventos.length,
    hash_anterior: anterior,
    hash: hashDe(anterior, corpo),
    payload: corpo,
  };
  mkdirSync(dirname(arquivo), { recursive: true });
  appendFileSync(arquivo, `${JSON.stringify(evento)}\n`);
  gravarAncora(arquivo, eventos.length + 1, evento.hash);
  return evento;
}

// ---------------------------------------------------------------- operações de alto nível
/**
 * ID da proposta com LETRAS APENAS. Motivo real, descoberto em teste: identificadores com dígitos
 * casam com os detectores de telefone do redaction.mjs (um UUID tem `1234-5678`; uma sequência hex
 * pode ter 10 dígitos seguidos) e fazem o próprio ledger reprovar a gravação por PII inexistente.
 * A escolha é adaptar o ID, não afrouxar o scanner: um scanner agressivo custa um alfabeto;
 * um scanner frouxo custa dado de paciente.
 * 16 letras = 26^16 ≈ 4×10^22 combinações. Colisão não é preocupação aqui.
 */
export function novoId() {
  return Array.from(randomBytes(16), (b) => String.fromCharCode(97 + (b % 26))).join("");
}

export function novaProposta({ canal, alias, mensagem, decisao_motor, contexto = {}, modoSintetico = true, arquivo = ARQ_LEDGER }) {
  // Em modo sintético o identificador da pessoa tem de ser um alias artificial estrito. Sem isto,
  // "Larissa Mendes" entraria no ledger sem o scanner piscar — ele reconhece formatos, não nomes.
  if (modoSintetico && !validarAliasSintetico(alias)) {
    throw new Error(
      `alias "${alias}" recusado: em modo sintético use exatamente "Cliente Demo NN" ou "Paciente Demo NN". ` +
        "O scanner de PII não sabe reconhecer nome de pessoa — o formato do alias é a barreira.",
    );
  }
  const id = novoId();
  registrar({
    tipo: "proposta_criada",
    modoSintetico,
    arquivo,
    payload: { id, canal, alias, mensagem, decisao_motor, contexto },
  });
  return id;
}

/** Diferença legível entre o rascunho da Emily e o texto que o humano realmente aprovou. */
export function diffTexto(original, final) {
  const a = String(original || "");
  const b = String(final || "");
  if (a === b) return { alterado: false, chars_antes: a.length, chars_depois: b.length };
  return {
    alterado: true,
    chars_antes: a.length,
    chars_depois: b.length,
    texto_antes: a,
    texto_depois: b,
  };
}

/**
 * Nota do aprovador. Chama-se `motivo_da_decisao`, e não `observacao`, de propósito:
 * `observacao` é um dos nomes que o scanner do redaction.mjs trata como campo clínico livre —
 * e ele está certo, porque "observação" é onde as pessoas escrevem sobre o PACIENTE.
 * Este campo é sobre o RASCUNHO ("editei porque estava formal demais"), nunca sobre a cliente.
 * Fica limitado a 200 caracteres e o conteúdo continua passando pelo scanner de e-mail/telefone.
 */
const LIMITE_MOTIVO = 200;

export function registrarDecisao({
  id,
  decisao,
  aprovador,
  texto_original,
  texto_final,
  motivo_da_decisao = "",
  modoSintetico = true,
  arquivo = ARQ_LEDGER,
}) {
  if (!DECISOES.includes(decisao)) throw new Error(`decisão inválida: ${decisao}`);
  if (!aprovador || !String(aprovador).trim()) throw new Error("aprovador obrigatório — decisão anônima não é aprovação");
  if (!id) throw new Error("id da proposta obrigatório");
  const propostas = fila(arquivo).map((p) => p.id);
  if (!propostas.includes(id)) {
    throw new Error(`proposta ${id} não está pendente (inexistente ou já decidida) — o ledger recusa decisão duplicada`);
  }
  const motivo = String(motivo_da_decisao || "").trim().slice(0, LIMITE_MOTIVO);
  // Resolver o texto final ANTES de comparar. Aprovar sem mandar texto_final significa
  // "aprovo como está" — se o diff for feito contra o undefined cru, toda aprovação limpa
  // é contada como edição e a taxa de aprovação sem edição (a métrica que diz se a Emily
  // está boa) mente para baixo.
  const finalResolvido = decisao === "descartada" ? "" : String(texto_final ?? texto_original ?? "");
  return registrar({
    tipo: "decisao_humana",
    modoSintetico,
    arquivo,
    payload: {
      id,
      decisao,
      aprovador: String(aprovador).trim(),
      texto_final: finalResolvido,
      // Descarte não é edição: não existe texto aprovado para comparar.
      diff: decisao === "descartada" ? { alterado: false, descartado: true } : diffTexto(texto_original, finalResolvido),
      // Chave omitida quando vazia: sem nota, sem campo de texto livre no registro.
      ...(motivo ? { motivo_da_decisao: motivo } : {}),
      // Invariante repetida no registro: mesmo aprovada, a Fase 1 não envia nada sozinha.
      envio_automatico: false,
    },
  });
}

export function registrarAcaoAgenda({ id, resultado, detalhe = {}, modoSintetico = true, arquivo = ARQ_LEDGER }) {
  return registrar({
    tipo: "acao_agenda",
    modoSintetico,
    arquivo,
    payload: { id, resultado, detalhe },
  });
}

/**
 * Reancorar: única saída legítima quando a integridade quebra.
 *
 * Existe porque, sem ela, a saída seria editar à mão um dot-file escondido — exatamente o gesto
 * que a âncora deveria tornar suspeito. E porque o sistema foi entregue uma vez com o alarme
 * tocando e sem botão para desligá-lo direito.
 *
 * NÃO apaga nada: grava no próprio ledger um evento `nota_operacional` dizendo quem reancorou,
 * quando, por quê e qual era a divergência. Quem reancorar deixa marca permanente.
 */
export function reancorar({ aprovador, motivo, arquivo = ARQ_LEDGER, modoSintetico = true }) {
  if (!aprovador || !String(aprovador).trim()) throw new Error("reancorar exige um nome — reancoragem anônima não vale");
  if (!motivo || !String(motivo).trim()) throw new Error("reancorar exige um motivo escrito");
  const antes = verificarCadeia(arquivo);
  const evento = registrar({
    tipo: "nota_operacional",
    modoSintetico,
    arquivo,
    permitirAncoraDivergente: true,
    payload: {
      acao: "reancoragem",
      aprovador: String(aprovador).trim(),
      motivo: String(motivo).trim().slice(0, 300),
      divergencia_encontrada: antes.quebras,
      total_antes: antes.total,
    },
  });
  return { ok: true, evento: { seq: evento.seq, hash: evento.hash }, divergencia_registrada: antes.quebras };
}

// ---------------------------------------------------------------- consultas
/** Propostas ainda sem decisão humana — é isto que o painel mostra como fila. */
export function fila(arquivo = ARQ_LEDGER) {
  const eventos = lerTudo(arquivo);
  const propostas = new Map();
  for (const ev of eventos) {
    const p = ev.payload;
    if (p.tipo === "proposta_criada") propostas.set(p.id, { ...p, seq: ev.seq });
    if (p.tipo === "decisao_humana") propostas.delete(p.id);
  }
  return [...propostas.values()].sort((a, b) => a.seq - b.seq);
}

export function historico(arquivo = ARQ_LEDGER) {
  const eventos = lerTudo(arquivo);
  const porId = new Map();
  for (const ev of eventos) {
    const p = ev.payload;
    if (!p.id) continue;
    if (!porId.has(p.id)) porId.set(p.id, { id: p.id, eventos: [] });
    porId.get(p.id).eventos.push({ seq: ev.seq, ...p });
  }
  return [...porId.values()];
}

/** Números do dia para o kit de operação: quantas propostas, quantas aprovadas sem edição, etc. */
export function estatisticas(arquivo = ARQ_LEDGER) {
  const eventos = lerTudo(arquivo).map((e) => e.payload);
  const propostas = eventos.filter((e) => e.tipo === "proposta_criada");
  const decisoes = eventos.filter((e) => e.tipo === "decisao_humana");
  const porDecisao = Object.fromEntries(DECISOES.map((d) => [d, decisoes.filter((x) => x.decisao === d).length]));
  const editadas = decisoes.filter((d) => d.diff?.alterado).length;
  return {
    propostas: propostas.length,
    decididas: decisoes.length,
    pendentes: propostas.length - decisoes.length,
    por_decisao: porDecisao,
    editadas,
    // A métrica que interessa: com que frequência o rascunho da Emily serviu como estava.
    taxa_aprovacao_sem_edicao: decisoes.length ? Number(((decisoes.length - editadas) / decisoes.length).toFixed(3)) : null,
    aprovadores: [...new Set(decisoes.map((d) => d.aprovador))],
    cadeia: verificarCadeia(arquivo),
  };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "verificar") {
    const r = verificarCadeia();
    console.log(r.ok ? `Cadeia ÍNTEGRA — ${r.total} evento(s).` : `Cadeia QUEBRADA: ${JSON.stringify(r.quebras, null, 2)}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "fila") {
    console.log(JSON.stringify(fila(), null, 2));
  } else if (cmd === "stats") {
    console.log(JSON.stringify(estatisticas(), null, 2));
  } else if (cmd === "reancorar") {
    const args = process.argv.slice(3);
    if (!args.includes("--confirmo")) {
      console.error('Reancorar apaga o alarme de integridade e deixa marca permanente no ledger.');
      console.error('Uso: node ledger.mjs reancorar --confirmo "<seu nome>" "<motivo>"');
      process.exit(1);
    }
    const [nome, motivo] = args.filter((a) => a !== "--confirmo");
    try {
      const r = reancorar({ aprovador: nome, motivo });
      console.log(`Reancorado por ${nome}. Divergência registrada no evento #${r.evento.seq}.`);
      console.log(JSON.stringify(r.divergencia_registrada, null, 2));
    } catch (e) {
      console.error(`Erro: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('Comandos: verificar | fila | stats | reancorar --confirmo "<nome>" "<motivo>"');
  }
}
