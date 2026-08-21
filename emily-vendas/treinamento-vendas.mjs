import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const CURRICULO_PATH = join(ROOT, "..", "knowledge", "curriculo-vendas-120.csv");

export function lerCurriculo(texto = readFileSync(CURRICULO_PATH, "utf8")) {
  const [cabecalho, ...linhas] = texto.trim().split(/\r?\n/);
  const colunas = cabecalho.split(",");
  return linhas.filter(Boolean).map((linha) => Object.fromEntries(colunas.map((c, i) => [c, linha.split(",")[i] || ""])));
}

export function resumoTreinamento(itens = lerCurriculo()) {
  const porStatus = {};
  const porCompetencia = {};
  for (const item of itens) {
    porStatus[item.status_fonte] = (porStatus[item.status_fonte] || 0) + 1;
    porCompetencia[item.competencia] = (porCompetencia[item.competencia] || 0) + 1;
  }
  return {
    total_referencias: itens.length,
    por_status: porStatus,
    por_competencia: porCompetencia,
    afirmacao_permitida: "currículo em curadoria",
    afirmacao_proibida: "Emily domina 120 livros",
  };
}

export function validarCurriculo(itens = lerCurriculo()) {
  const ids = new Set();
  const erros = [];
  if (itens.length < 100) erros.push("currículo precisa conter pelo menos 100 referências");
  for (const item of itens) {
    if (!item.id || ids.has(item.id)) erros.push(`id ausente ou duplicado: ${item.id || "vazio"}`);
    ids.add(item.id);
    if (!item.titulo || !item.autores || !item.status_fonte) erros.push(`metadados incompletos: ${item.id}`);
    if (!/^(catalogado|fichado|aplicado|validado|obsoleto)$/.test(item.status_fonte)) erros.push(`status inválido: ${item.id}`);
  }
  return { ok: erros.length === 0, erros, resumo: resumoTreinamento(itens) };
}
