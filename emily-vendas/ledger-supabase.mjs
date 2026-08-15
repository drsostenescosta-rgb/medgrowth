// ledger-supabase.mjs — o mesmo ledger append-only, em Postgres em vez de arquivo.
//
// POR QUE EXISTE
// Sostenes é nômade: fecha o notebook, viaja, não tem máquina ligada. O painel precisa rodar na
// nuvem, e serverless não tem disco — `aprovacoes.jsonl` simplesmente não existe lá.
//
// O QUE NÃO MUDA
// As funções puras (canonico, hashDe, diffTexto, novoId, GENESIS) são IMPORTADAS de ledger.mjs,
// não recopiadas. Se o hash fosse recalculado por código paralelo, as duas verificações poderiam
// divergir e a divergência apareceria como "adulteração" — exatamente o alarme falso que este
// arquivo existe para evitar. Um hash, um lugar.
//
// O QUE MUDA
// 1. Tudo é async (a rede está no meio).
// 2. As três garantias saíram da convenção e viraram restrição do banco:
//    - append-only: gatilho levanta exceção em UPDATE/DELETE
//    - cadeia: gatilho recusa insert cujo `hash_anterior` não bate com a âncora
//    - RLS: só quem está em `andreia_operadores` lê ou grava
//    Ou seja: mesmo um bug meu aqui não consegue reescrever histórico.
// 3. O cliente Supabase é criado com o JWT DA PESSOA, nunca com service_role. Se usasse a chave
//    de serviço, o RLS seria decorativo e "quem aprovou" viraria um campo de texto em vez de uma
//    identidade verificada.

import { createClient } from "@supabase/supabase-js";

import {
  DECISOES,
  GENESIS,
  TIPOS_EVENTO,
  canonico,
  diffTexto,
  hashDe,
  novoId,
} from "./ledger.mjs";
import { exigirSomenteSintetico, redigirSensiveis, validarAliasSintetico } from "./redaction.mjs";

const TABELA = "andreia_ledger";
const TABELA_ANCORA = "andreia_ancora";
const LIMITE_MOTIVO = 200;

/**
 * Constrói o ledger para UMA requisição, na identidade de quem está logado.
 *
 * `jwt` é o access_token do Supabase Auth vindo do painel. Sem ele não há gravação possível:
 * `registrado_por` é NOT NULL com default `auth.uid()`, então uma escrita sem identidade é
 * recusada pelo banco antes de qualquer regra nossa.
 */
export function ledgerSupabase({ url, anonKey, jwt }) {
  if (!url || !anonKey) throw new Error("ledger supabase exige url e anonKey");
  if (!jwt) throw new Error("ledger supabase exige o JWT do operador — gravação anônima não é aprovação");

  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  async function lerTudo() {
    const { data, error } = await sb
      .from(TABELA)
      .select("seq, tipo, payload, payload_canonico, hash_anterior, hash, criado_em")
      .order("seq", { ascending: true });
    if (error) throw new Error(`ledger: falha ao ler (${error.message})`);
    // `seq` do banco começa em 1 (identity); o ledger de arquivo começa em 0. A verificação usa a
    // POSIÇÃO, não o número, para as duas implementações concordarem.
    return (data || []).map((linha, i) => ({
      seq: i,
      seq_banco: linha.seq,
      hash_anterior: linha.hash_anterior,
      hash: linha.hash,
      payload: linha.payload,
      payload_canonico: linha.payload_canonico,
      criado_em: linha.criado_em,
    }));
  }

  async function lerAncora() {
    const { data, error } = await sb.from(TABELA_ANCORA).select("total, ultimo_hash, atualizado_em").maybeSingle();
    if (error) throw new Error(`ledger: falha ao ler a âncora (${error.message})`);
    return data || null;
  }

  /**
   * Revalida a cadeia inteira, com as mesmas três detecções da versão em arquivo:
   * evento que sumiu, arquivo reescrito por inteiro, e evento que apareceu sem passar pelo registro.
   */
  async function verificarCadeia() {
    const eventos = await lerTudo();
    const quebras = [];
    let anterior = GENESIS;

    eventos.forEach((ev, i) => {
      if (ev.hash_anterior !== anterior) {
        quebras.push({ seq: i, campo: "hash_anterior", esperado: anterior, encontrado: ev.hash_anterior });
      }
      // Confere sobre o TEXTO canônico gravado, não sobre o jsonb reimpresso pelo Postgres.
      // Um CHECK no banco garante que os dois representam o mesmo valor.
      const esperado = hashDe(ev.hash_anterior, JSON.parse(ev.payload_canonico));
      if (ev.hash !== esperado) {
        quebras.push({ seq: i, campo: "hash", esperado, encontrado: ev.hash });
      }
      anterior = ev.hash;
    });

    const ancora = await lerAncora();
    if (ancora) {
      if (eventos.length < ancora.total) {
        quebras.push({
          seq: eventos.length, campo: "ancora.total", esperado: ancora.total, encontrado: eventos.length,
          explicacao: "eventos DESAPARECERAM da tabela",
        });
      } else if (eventos.length === ancora.total && anterior !== ancora.ultimo_hash) {
        quebras.push({
          seq: eventos.length, campo: "ancora.ultimo_hash", esperado: ancora.ultimo_hash, encontrado: anterior,
          explicacao: "a tabela foi reescrita inteira",
        });
      } else if (eventos.length > ancora.total) {
        quebras.push({
          seq: ancora.total, campo: "ancora.total", esperado: ancora.total, encontrado: eventos.length,
          explicacao: `${eventos.length - ancora.total} evento(s) APARECERAM sem passar pelo registro`,
        });
      }
    }

    return {
      ok: quebras.length === 0,
      total: eventos.length,
      quebras,
      ultimo_hash: anterior,
      ancora: ancora
        ? { presente: true, total: Number(ancora.total), atualizado_em: ancora.atualizado_em }
        : { presente: false },
      armazenamento: "supabase",
    };
  }

  async function registrar({ tipo, payload, modoSintetico = true, redigir = false }) {
    if (!TIPOS_EVENTO.includes(tipo)) throw new Error(`tipo de evento desconhecido: ${tipo}`);
    if (!payload || typeof payload !== "object") throw new Error("payload obrigatório");
    if (redigir) payload = redigirSensiveis(payload);
    if (modoSintetico || redigir) exigirSomenteSintetico(payload);

    // Conferir a integridade ANTES de gravar, como na versão em arquivo: sem isso, o próximo
    // atendimento normal atualizaria a âncora e apagaria a evidência da adulteração.
    const estado = await verificarCadeia();
    if (!estado.ok) {
      throw new Error(
        "ledger com integridade QUEBRADA — gravação recusada para não apagar a evidência. "
        + `Problemas: ${JSON.stringify(estado.quebras)}`,
      );
    }

    const anterior = estado.ultimo_hash;
    const corpo = { tipo, ...payload, ts: payload.ts || new Date().toISOString() };
    const hash = hashDe(anterior, corpo);

    const { data, error } = await sb
      .from(TABELA)
      .insert({
        tipo,
        payload: corpo,
        payload_canonico: canonico(corpo),
        hash_anterior: anterior,
        hash,
      })
      .select("seq, hash")
      .single();

    if (error) {
      // O gatilho de cadeia devolve isto quando duas gravações correm juntas e a segunda aponta
      // para uma âncora que já andou. Não é adulteração: é corrida. A mensagem tem de distinguir.
      if (/cadeia quebrada/i.test(error.message)) {
        throw new Error(`gravação recusada pelo banco: ${error.message} (grave de novo; a âncora já mudou)`);
      }
      throw new Error(`ledger: falha ao gravar (${error.message})`);
    }
    return { seq: data.seq, hash: data.hash, hash_anterior: anterior, payload: corpo };
  }

  async function novaProposta({ canal, alias, mensagem, decisao_motor, contexto = {}, modoSintetico = true, redigir = false }) {
    if (modoSintetico && !validarAliasSintetico(alias)) {
      throw new Error(
        `alias "${alias}" recusado: em modo sintético use exatamente "Cliente Demo NN" ou "Paciente Demo NN".`,
      );
    }
    const id = novoId();
    await registrar({
      tipo: "proposta_criada",
      modoSintetico,
      redigir,
      payload: { id, canal, alias, mensagem, decisao_motor, contexto },
    });
    return id;
  }

  async function registrarDecisao({
    id, decisao, aprovador, texto_original, texto_final, motivo_da_decisao = "",
    modoSintetico = true, redigir = false,
  }) {
    if (!DECISOES.includes(decisao)) throw new Error(`decisão inválida: ${decisao}`);
    if (!aprovador || !String(aprovador).trim()) throw new Error("aprovador obrigatório — decisão anônima não é aprovação");
    if (!id) throw new Error("id da proposta obrigatório");

    const pendentes = (await fila()).map((p) => p.id);
    if (!pendentes.includes(id)) {
      throw new Error(`proposta ${id} não está pendente (inexistente ou já decidida) — o ledger recusa decisão duplicada`);
    }

    const motivo = String(motivo_da_decisao || "").trim().slice(0, LIMITE_MOTIVO);
    const finalResolvido = decisao === "descartada" ? "" : String(texto_final ?? texto_original ?? "");

    return registrar({
      tipo: "decisao_humana",
      modoSintetico,
      redigir,
      payload: {
        id,
        decisao,
        aprovador: String(aprovador).trim(),
        texto_final: finalResolvido,
        diff: decisao === "descartada" ? { alterado: false, descartado: true } : diffTexto(texto_original, finalResolvido),
        ...(motivo ? { motivo_da_decisao: motivo } : {}),
        envio_automatico: false,
      },
    });
  }

  async function registrarAcaoAgenda({ id, resultado, detalhe = {}, modoSintetico = true }) {
    return registrar({ tipo: "acao_agenda", modoSintetico, payload: { id, resultado, detalhe } });
  }

  async function fila() {
    const eventos = await lerTudo();
    const propostas = new Map();
    for (const ev of eventos) {
      const p = ev.payload;
      if (p.tipo === "proposta_criada") propostas.set(p.id, { ...p, seq: ev.seq });
      if (p.tipo === "decisao_humana") propostas.delete(p.id);
    }
    return [...propostas.values()].sort((a, b) => a.seq - b.seq);
  }

  async function historico() {
    const eventos = await lerTudo();
    const porId = new Map();
    for (const ev of eventos) {
      const p = ev.payload;
      if (!p.id) continue;
      if (!porId.has(p.id)) porId.set(p.id, { id: p.id, eventos: [] });
      porId.get(p.id).eventos.push({ seq: ev.seq, ...p });
    }
    return [...porId.values()];
  }

  async function estatisticas() {
    const eventos = (await lerTudo()).map((e) => e.payload);
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
      taxa_aprovacao_sem_edicao: decisoes.length ? Number(((decisoes.length - editadas) / decisoes.length).toFixed(3)) : null,
      aprovadores: [...new Set(decisoes.map((d) => d.aprovador))],
      cadeia: await verificarCadeia(),
    };
  }

  /** Quem é o operador logado, na allowlist. Null significa "não pode operar". */
  async function operadorAtual() {
    const { data, error } = await sb.from("andreia_operadores").select("nome, papel").maybeSingle();
    if (error) throw new Error(`ledger: falha ao ler o operador (${error.message})`);
    return data || null;
  }

  return {
    armazenamento: "supabase",
    lerTudo, lerAncora, verificarCadeia, registrar,
    novaProposta, registrarDecisao, registrarAcaoAgenda,
    fila, historico, estatisticas, operadorAtual,
  };
}
