#!/usr/bin/env node
// Copia as três configs da clínica para dentro de emily-vendas, para irem no pacote da função
// serverless. A Vercel só empacota o que está sob a raiz do projeto, e a fonte de verdade mora
// em outro repositório (clinic-now-piloto-familia).
//
// Regra: `config-piloto/` é GERADO. Ninguém edita lá. Se alguém editar, a próxima sincronização
// sobrescreve — e é por isso que cada arquivo leva um `_gerado_por` avisando.
//
// Por que copiar em vez de importar: manter a fonte única onde ela já está (o repositório do
// piloto, que é o que a Andreia e o preflight enxergam) e não duplicar decisão. O que se duplica
// aqui é só o transporte.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(AQUI, "..", "config-piloto");
const ORIGEM = process.env.CLINICNOW_CONFIG_DIR
  || join(homedir(), "Applications", "clinic-now-piloto-familia", "config");

const ARQUIVOS = ["clinica-config.json", "agenda-config.json", "operacao-assistida.json"];

if (!existsSync(ORIGEM)) {
  console.error(`Configuração não encontrada em ${ORIGEM}`);
  console.error("Defina CLINICNOW_CONFIG_DIR ou clone clinic-now-piloto-familia.");
  process.exit(1);
}

mkdirSync(DESTINO, { recursive: true });

for (const nome of ARQUIVOS) {
  const de = join(ORIGEM, nome);
  if (!existsSync(de)) {
    console.error(`FALTA: ${de}`);
    process.exit(1);
  }
  const conteudo = JSON.parse(readFileSync(de, "utf8"));
  conteudo._gerado_por = "emily-vendas/scripts/sincronizar-config.mjs — copia para o deploy. NAO editar aqui; edite em clinic-now-piloto-familia/config.";
  writeFileSync(join(DESTINO, nome), `${JSON.stringify(conteudo, null, 2)}\n`);
  console.log(`ok  ${nome}`);
}

console.log(`\n${ARQUIVOS.length} arquivo(s) sincronizados de ${ORIGEM}`);
console.log("Rode isto SEMPRE antes de publicar a API, senão a nuvem opera com config velha.");
