// Rotas de um segmento: /api/estado, /api/fila, /api/historico, /api/proposta, /api/decisao.
// O roteamento de verdade está dentro de criarHandler (api.mjs); estes arquivos só existem
// porque a Vercel resolve função por caminho de arquivo.
export { default } from "./_ponte.mjs";
