// Função serverless da Vercel — a mesma ponte de aprovação, agora na nuvem.
//
// POR QUE EXISTE
// Sostenes é nômade: fecha o notebook, viaja, não tem máquina ligada. A ponte local
// (127.0.0.1:4791) morria junto com o Mac dele. Aqui ela roda sem depender de máquina nenhuma.
//
// O QUE MUDA EM RELAÇÃO À LOCAL — e o que NÃO muda
// Muda o armazenamento (Postgres em vez de arquivo) e a identidade (login de verdade em vez de
// um nome digitado num header). NÃO muda nenhuma regra: é literalmente o mesmo `criarHandler`
// de api.mjs, com o mesmo motor. Se as regras vivessem em dois lugares, um dia divergiriam, e a
// versão que a cliente vê seria a errada.
//
// Duas invariantes que sobrevivem à mudança de ambiente:
//   1. Não existe rota de envio. Aprovar continua sendo diferente de enviar.
//   2. Quem grava é a pessoa logada, sob RLS. A chave service_role NÃO é usada aqui — se fosse,
//      o RLS viraria enfeite e "quem aprovou" viraria um campo de texto em vez de uma identidade.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { criarHandler } from "../api.mjs";
import { ledgerSupabase } from "../ledger-supabase.mjs";

// Cópia das três configs da clínica, empacotada junto com a função (a Vercel não enxerga o
// repositório do piloto). Regenerada por `npm run config:sync` — nunca editada aqui.
process.env.CLINICNOW_CONFIG_DIR ||= join(dirname(fileURLToPath(import.meta.url)), "..", "config-piloto");

const URL_SUPABASE = process.env.SUPABASE_URL;
const CHAVE_ANON = process.env.SUPABASE_ANON_KEY;

function responder(res, status, corpo) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(JSON.stringify(corpo));
}

export default async function handler(req, res) {
  if (!URL_SUPABASE || !CHAVE_ANON) {
    // Fail-closed: sem banco configurado a função não degrada para "modo demo". Degradar aqui
    // significaria mostrar fila falsa para quem acha que está operando de verdade.
    return responder(res, 500, { erro: "SUPABASE_URL e SUPABASE_ANON_KEY não configuradas no ambiente" });
  }

  // O preflight do CORS precisa passar ANTES da autenticação: o navegador manda OPTIONS sem
  // Authorization, e responder 401 nele quebraria o painel com uma mensagem de erro errada.
  const semAuth = req.method === "OPTIONS";

  const cabecalho = String(req.headers.authorization || "");
  const jwt = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (!semAuth && !jwt) {
    return responder(res, 401, { erro: "faça login: esta ponte não aceita requisição sem identidade" });
  }

  let ledger = null;
  let operador = null;
  if (!semAuth) {
    try {
      ledger = ledgerSupabase({ url: URL_SUPABASE, anonKey: CHAVE_ANON, jwt });
      operador = await ledger.operadorAtual();
    } catch (e) {
      return responder(res, 401, { erro: `sessão inválida: ${e.message}` });
    }
    // A allowlist é a resposta 7.2 da Andreia ("somente Andreia e Sostenes") virada código.
    // Estar logado no Supabase não basta: é preciso estar em andreia_operadores.
    if (!operador) {
      return responder(res, 403, { erro: "sua conta não está autorizada a operar esta clínica" });
    }
  }

  const executar = criarHandler({
    ledger,
    // Na nuvem o aprovador NÃO é um header digitável: é o nome que está na allowlist, ligado ao
    // usuário autenticado. Assim "quem aprovou" no ledger é uma identidade, não uma alegação.
    aprovadorDe: () => operador?.nome || "",
  });

  return executar(req, res);
}
