// /api/ledger/verificar — dois segmentos.
//
// Descoberto testando a nuvem: o catch-all [...rota] da Vercel NÃO pegou caminho aninhado
// (/api/ledger/verificar deu 404 enquanto /api/estado deu 200). Em vez de confiar no catch-all,
// cada caminho aninhado ganha seu arquivo. É explícito e não depende de comportamento que já
// falhou uma vez em produção.
export { default } from "../_ponte.mjs";
