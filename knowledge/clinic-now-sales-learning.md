# Aprendizado de vendas — Emily Clinic Now

Atualizado em: 2026-08-21
Domínio: produto Clinic Now
Estado: baseline semanal estabelecido; nenhuma regra promovida

## Limite de contexto

Este arquivo pertence exclusivamente à Emily Atendimento/Clinic Now.

**Identidade canônica:** o nome desta agente é **Emily ClinicNow**. Ela é a secretária digital
configurável das clínicas clientes. Ela não é, não consulta e não herda contexto da Emily
Secretária Executiva pessoal de Sostenes.

É proibido importar ou registrar:

- memória pessoal ou estado da Emily Secretaria Executiva;
- e-mails, calendário, finanças, família, relacionamentos, viagens ou imigração de Sostenes;
- histórico clínico, exames, fotos, medicações ou conversas integrais de pacientes;
- nome, telefone, e-mail ou outro identificador direto de lead/paciente.

Dados operacionais entram apenas agregados ou desidentificados. Contatos permanecem no banco do produto, com hash e acesso restrito.

Cada clínica fornece seu próprio pacote de configuração: identidade, responsável humano,
serviços, preços autorizados, horários, idiomas, tom, políticas e escaladas. Personalidade
configurável não autoriza compartilhar memória, conversa, prompt preenchido ou dado entre clínicas.

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

## Ciclo semanal — 2026-08-21

### Cobertura e fontes alteradas

- **[FATO] Corte do ciclo:** como esta é a primeira execução da automação e não havia memória
  anterior, não existe delta temporal integralmente comprovável. O ciclo analisou os diffs atuais
  contra o `HEAD` do `medgrowth` (`56e451700863cde1eca26e1e67929579a142c15c`) e criou o
  baseline de saída para a próxima execução.
- **[FATO] Deltas B2C lidos:** `system-prompt-emily-vendas-v1.md` ganhou uma fronteira explícita
  entre a Emily ClinicNow, outras clínicas e qualquer contexto do fundador;
  `playbook-persuasao.md` ganhou a seção de linguagem aproximadora e quebra ética de padrão.
- **[FATO] Verificação de ausência de mudança:** `git log` desde 2026-08-17 e `git status` nos
  caminhos exatos não apontaram commits ou modificações nos catálogos, `eval-casos-v1.md`, motor
  listado em `../emily-vendas/` ou
  `../../clinic-now-maritime-agent/docs/sales-playbook.md` (`HEAD`
  `378073f338a2fe9beb0fc608b812759d98c1dd7d`; hash do arquivo
  `8c135af5e34e29049a68914912e05e8dcb3bb02c`). Esses arquivos não foram relidos como conteúdo.
- **[FATO — incidente sanitizado de firewall]:** durante a triagem inaugural, dois artefatos não
  rastreados de `../../clinic-now-access/` foram abertos antes da exclusão preventiva e continham
  contexto fora do domínio permitido. A leitura foi interrompida, o conteúdo foi descartado e
  nenhum detalhe, nome ou identificador entrou neste aprendizado. Próximos ciclos devem consultar
  apenas metadados desse caminho até existir fonte B2B sanitizada e explicitamente delimitada.
- **Baseline de saída:** hashes de working tree
  `system-prompt-emily-vendas-v1.md=191560c85fea70477be2088f04e82af0ca6442db` e
  `playbook-persuasao.md=0303299868351ddd43a20c6d579f9b6e61d920e6`; demais caminhos
  autorizados rastreados permanecem referenciados pelos `HEADs` acima.

### Evidência e métricas agregadas

- **Operação real:** não acessada; conversas, contatos, métricas de produção e ledger real não
  foram lidos.
- **Shadow sintético executado localmente:** comando `node --input-type=module` importou somente
  `regras.mjs` e leu `fixtures/shadow-casos.v1.json` e `fixtures/shadow-operacao.v1.json`, sem
  escrita, ambiente de produção ou rede. Resultado agregado reproduzido neste ciclo: 5 cenários e
  6/6 invariantes booleanos — fixtures sintéticas identificadas, conflito de agenda bloqueado,
  novo pedido sem falso conflito, confirmação explícita exigida, cancelamento com revisão humana
  e envio automático desligado.
- **Eval oficial:** não executado. O caminho atual pode carregar ambiente, I/O e juiz-modelo; não
  foi possível provar, dentro do escopo autorizado, que a execução seria local, sem escrita e sem
  rede.
- **Métricas comerciais reais:** taxa de avaliação/demonstração, conversão por etapa, escaladas e
  opt-outs continuam **não verificadas**. Não usar `0` como substituto de dado ausente.

### Objeções desidentificadas

- Nenhuma amostra operacional autorizada foi encontrada neste ciclo. Os temas de hesitação,
  preço, confiança e implantação presentes no playbook são desenho de resposta, não frequência
  observada nem evidência de cliente.

### Falhas e contradições

- Houve uma violação processual do firewall na triagem inicial da fonte B2B ampla; o incidente foi
  contido sem incorporar seu conteúdo. A correção preventiva é bloquear leitura de conteúdo desse
  caminho e permitir apenas metadados até delimitação sanitizada.
- O playbook reforça configuração por clínica, mas o novo texto contém um nome humano fixo em um
  exemplo. Isso conflita com o isolamento multiclínica; exemplos configuráveis devem usar apenas
  placeholders antes de qualquer promoção.
- “Um movimento por mensagem” e “uma pergunta e um próximo passo” podem ser interpretados como
  duas cargas persuasivas na mesma mensagem. O próximo passo deve permanecer operacional e, em
  caso `[SEG]`, ser proteção, opt-out ou escalada — nunca agendamento.
- Não existe, no escopo seguro deste ciclo, um exportador comprovadamente agregado e sanitizado
  para métricas reais; por isso não houve comparação comercial antes/depois.

### Placar atual do artefato, não da operação

- clareza: 2/3 — decisão e limites estão explícitos, mas exigem leitura do ciclo completo;
- completude: 1/3 — faltam métricas operacionais e o eval oficial;
- acionabilidade: 2/3 — há candidata, gate e próximo teste, ainda sem harness aprovado;
- consistência: 1/3 — permanecem o nome fixo e a ambiguidade entre movimento e próximo passo;
- segurança: 2/3 — guardrails e bloqueio de promoção estão explícitos, sem validação operacional.

Gargalo dominante: falta de evidência comparável e sanitizada para distinguir melhoria de copy de
mera preferência de estilo.

### Decisão

Não promover a nova linguagem a regra operacional. Manter **uma única melhoria candidata** neste
ciclo: novo caso de eval/shadow pareado para testar a seção de linguagem aproximadora.

### Por que

**[INFERÊNCIA]** O texto novo pode reduzir sensação de roteiro e preservar liberdade de recusa,
mas o ciclo só confirmou desenho e invariantes shadow de agenda/controle. Não há evidência de que
melhore agendamentos, qualidade percebida ou segurança em conversas reais.

### Como verificar

Comparar, nas mesmas entradas sintéticas congeladas de abertura e hesitação, (A) prompt-base e
(B) prompt-base + nova seção. Avaliação humana cega mede aderência ao detalhe dito, naturalidade,
liberdade real de dizer não e clareza do próximo passo. Promoção exige simultaneamente:

1. comparação antes/depois registrada;
2. `[SEG]` em 100%;
3. zero caso existente mudando de aprovado para reprovado e zero regressão material em preço,
   medicamento, LGPD, urgência, vulnerabilidade e opt-out;
4. critério de superioridade ou não inferioridade comercial definido antes do teste;
5. ausência de nomes fixos ou vazamento entre clínicas;
6. aprovação humana explícita.

### Risco/limite

O resultado shadow não prova execução real, conversão, satisfação, implantação nem economia de
tempo. Nenhuma mensagem foi enviada, nenhuma cadência ou produção foi alterada e nenhum dado
clínico foi exposto.

**Exceção sanitizada de task hygiene:** o arquivamento reversível desta task foi solicitado e a
consulta de confirmação também, mas nenhuma das duas operações retornou recibo dentro das esperas
limitadas. O efeito permanece não verificado e não será repetido automaticamente neste ciclo.

### Próxima ação

No próximo ciclo, executar o teste pareado em harness comprovadamente local e sem escrita/rede,
registrar somente o agregado antes/depois e manter a candidata em experimento se qualquer gate
ficar sem evidência.
