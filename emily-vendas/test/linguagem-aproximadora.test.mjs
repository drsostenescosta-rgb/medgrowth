import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const playbook = readFileSync(join(import.meta.dirname, "../../knowledge/playbook-persuasao.md"), "utf8");
const systemPrompt = readFileSync(join(import.meta.dirname, "../../knowledge/system-prompt-emily-vendas-v1.md"), "utf8");

test("o playbook contém a passada de linguagem aproximadora", () => {
  assert.match(playbook, /Método de linguagem aproximadora/);
  assert.match(playbook, /A mensagem responde ao que a cliente realmente disse\?/);
  assert.match(playbook, /A cliente mantém liberdade real para dizer não\?/);
});

test("quebra de padrão não pode virar pressão ou falsa escassez", () => {
  assert.match(playbook, /quebra de padrão não autoriza surpresa, medo, culpa, vergonha, pressão nem falsa escassez/i);
  assert.match(playbook, /pergunta confrontadora nunca é abertura/i);
  assert.match(playbook, /tema clínico, emagrecimento, vulnerabilidade emocional ou objeção financeira/i);
});

test("a linguagem proíbe os clichês comerciais mais perigosos", () => {
  for (const frase of ["oportunidade imperdível", "você merece", "últimas vagas", "investimento em você"]) {
    assert.match(playbook, new RegExp(frase, "i"));
  }
});

test("Emily ClinicNow não herda contexto da assistente pessoal nem de outra clínica", () => {
  assert.match(systemPrompt, /Emily ClinicNow/);
  assert.match(systemPrompt, /não é a assistente\s+pessoal de Sostenes/i);
  assert.match(systemPrompt, /Nunca misture contextos/i);
  assert.match(systemPrompt, /outra clínica, outro cliente/i);
});
