# Aprendizado de vendas — Emily Clinic Now

Atualizado em: 2026-08-17  
Domínio: produto Clinic Now  
Estado: base inicial; atualização semanal por evidência operacional

## Limite de contexto

Este arquivo pertence exclusivamente à Emily Atendimento/Clinic Now.

É proibido importar ou registrar:

- memória pessoal ou estado da Emily Secretaria Executiva;
- e-mails, calendário, finanças, família, relacionamentos, viagens ou imigração de Sostenes;
- histórico clínico, exames, fotos, medicações ou conversas integrais de pacientes;
- nome, telefone, e-mail ou outro identificador direto de lead/paciente.

Dados operacionais entram apenas agregados ou desidentificados. Contatos permanecem no banco do produto, com hash e acesso restrito.

## Objetivo comercial vigente

Converter conversas autorizadas em avaliações ou demonstrações agendadas, sem diagnóstico, recomendação clínica, promessa de resultado, preço inventado, pressão ou envio autônomo não autorizado.

## Fontes autorizadas

- `system-prompt-emily-vendas-v1.md`;
- `playbook-persuasao.md`;
- `procedimentos-estetica.md`;
- `emagrecimento-e-saude.md`;
- `eval-casos-v1.md`;
- `../emily-vendas/README.md`;
- `../emily-vendas/regras.mjs`;
- `../emily-vendas/voz.mjs`;
- `../emily-vendas/funil.mjs`;
- `../emily-vendas/agenda.mjs`;
- `../emily-vendas/metricas.mjs`;
- `../emily-vendas/ledger.mjs`;
- `../emily-vendas/eval.mjs`;
- materiais de operação assistida em `../emily-vendas/docs/`;
- B2B: `../../clinic-now-maritime-agent/docs/sales-playbook.md` e `../../clinic-now-access/`.

## Conhecimento confirmado nos artefatos

- Conversão-mestre B2C: agendar avaliação.
- Operação atual descrita: Wizard-of-Oz/assistida, com aprovação humana na Fase A.
- A regra determinística escolhe a ação; o modelo redige dentro dos limites.
- Ações: responder, reperguntar/consultar, escalar ou bloquear/opt-out.
- Cadência documentada: D1/D3 e D7 de encerramento, com teto anti-spam.
- Opt-out pausa IA e remove o lead de novas cadências.
- Mudanças devem passar pelos evals; segurança exige 100%.

Isso comprova desenho local, não conversão real, receita, satisfação ou implantação integral.

## Loop semanal

1. Ler somente deltas desde a última revisão.
2. Coletar métricas agregadas, feedback humano e casos desidentificados.
3. Separar fato, interpretação, hipótese e contradição.
4. Escolher no máximo uma melhoria comercial.
5. Converter em regra candidata, ajuste de playbook ou caso de eval.
6. Testar antes/depois e bloquear regressão de segurança.
7. Exigir aprovação humana antes de produção ou contato externo.
8. Atualizar cobertura, fontes, evidência e próxima ação neste arquivo.

## Placar

- cobertura atual: artefatos-base identificados; execução real ainda não auditada neste ciclo;
- métricas reais: não verificadas;
- objeções recorrentes: não verificadas;
- taxa de avaliação/demonstração agendada: não verificada;
- taxa de escalação: não verificada;
- opt-outs: não verificados;
- resultado atual dos evals: precisa ser executado e registrado;
- próxima ação: primeiro ciclo semanal somente leitura e desidentificado.

## Exportação entre as duas Emilys

Somente princípios abstratos e sanitizados podem sair deste domínio, por exemplo: “uma pergunta por mensagem reduziu ambiguidade no conjunto avaliado”. Nunca exportar quem disse, conteúdo da conversa, identificador, dado clínico ou dado da clínica.

Contexto pessoal nunca entra no produto. Dados do produto nunca entram na memória pessoal.
