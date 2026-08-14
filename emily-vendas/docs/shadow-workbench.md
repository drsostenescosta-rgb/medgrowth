# Workbench shadow sintético

Este workbench é uma simulação local e determinística. Ele **não** usa canais, LLM, rede, variáveis de ambiente, dados reais ou credenciais.

## Executar

```bash
npm run shadow:workbench
```

O relatório fica em `emily-vendas/.shadow-reports/shadow-workbench-latest.json`, que é ignorado pelo Git. Apenas esse arquivo `latest` pode ser sobrescrito.

Para preservar outro relatório dentro da mesma pasta, use um nome simples e a autorização explícita de criação:

```bash
npm run shadow:workbench -- --saida auditoria-001.json --novo-relatorio
```

Caminhos absolutos, subdiretórios, travessia com `..`, symlinks, hardlinks e sobrescrita de relatórios nomeados são rejeitados. A atualização do arquivo `latest` usa arquivo temporário novo e `rename` atômico dentro da mesma pasta. O veredito máximo é `APTO_PARA_REVISAO_HUMANA`; ele nunca autoriza envio, reserva, remoção, integração ou operação real.

## Cenários cobertos

1. Novo pedido: gera só rascunho com exatamente dois slots fictícios válidos.
2. Conflito: usa duração mais buffer, bloqueia, oferece duas alternativas e prova que a agenda não mudou.
3. “Tá bom”: permanece `aguardando_confirmacao_explicita`, sem registrar confirmação.
4. Cancelamento ambíguo: permanece `aguardando_confirmacao_cancelamento`; apenas uma confirmação explícita posterior permite criar `cancelamento_pendente_revisao`.
5. Dúvida clínica: fica `pausado_aguardando_responsavel`, sem resposta clínica, follow-up ou upsell.

Todo slot precisa pertencer a um dia e faixa ativos no fuso da clínica. Duração e buffer da agenda devem coincidir com a política sintética do serviço; o cálculo de conflito inclui o buffer do novo slot e da ocupação existente.

Qualquer campo PII, e-mail, telefone ou campo clínico livre interrompe o processo. Use apenas as fixtures estruturadas e fictícias.

O relatório sempre nasce com `revisao_humana=PENDENTE`, `revisao_humana_concluida=false` e `atestacao_humana=null`. A função de atestação exige o hash exato do relatório e uma confirmação humana explícita; revisores identificados como sistema, bot, IA ou workbench são rejeitados. Nenhuma atestação é gerada automaticamente pelo comando.

Uma atestação é somente uma `AUTODECLARACAO_LOCAL_NAO_AUTENTICADA`: não comprova identidade, cargo ou revisão externa. Os únicos enums aceitos são `APROVADO_PARA_PROXIMA_ETAPA` e `REPROVADO`; mesmo a primeira opção não autoriza go-live, canais ou dados reais.
