# PRD — ClinicNow v1

**Data:** 07/08/2026 · **Autor:** PM (com base na reunião de mentoria de 07/08/2026 com Iago) · **Status:** aprovado para execução do Sprint 1

---

## 1. Visão

ClinicNow é o sistema de gestão de atendimento para clínicas de estética e saúde: funil de vendas integrado a agendamento e CRM, com a assistente **Emily** (WhatsApp e, futuramente, voz) respondendo pacientes, confirmando retornos e convertendo leads — incluindo, na visão completa, sugestão de upsell em tempo real durante a consulta (ex.: Botox → preenchimento).

**A v1 não é a visão. A v1 é UM caso de uso:** Emily por **texto no WhatsApp** fazendo **agendamento** para **uma clínica de estética** — a clínica da mãe do fundador. Decisão explícita da mentoria de 07/08: um caso de uso primeiro, testar com a mãe antes de qualquer lançamento, feedback real > produto perfeito. Ciclo de trabalho: **Descobre → Define → Constrói → Testa**.

## 2. Problema

- **Fato validado (reunião 07/08):** a clínica perde **2–3 dias/semana** de trabalho em agendamento manual — responder WhatsApp, negociar horário, confirmar, remarcar, cobrar retorno. Em horas: ~16–24h/semana de uma pessoa.
- **Dores nº 1 do segmento (benchmark):** taxa de **no-show** e **resposta lenta** ao lead. Lead de estética que não recebe resposta em minutos agenda na concorrente.
- **Gap de mercado (benchmark):** Doctoralia e iClinic fazem *lembrete*; nenhum faz *venda/conversão* pela conversa. Cloudia (BR) tem **1.500+ clínicas** com abordagem WhatsApp-first — o canal está validado. Assort Health levantou **US$ 120M** com voz para clínicas — a categoria está validada, mas mostra que voz é etapa 2, não 1.

## 3. ICP e personas

**ICP v1:** clínica de **estética** pequena (1–5 profissionais), dona-operadora, WhatsApp como canal principal de captação e agendamento, agenda em papel/planilha/app simples. Ticket por procedimento médio-alto (botox, preenchimento, limpeza de pele, laser), receita dependente de retorno recorrente.

**Ambiente de teste nº 1:** a clínica da mãe do fundador (decisão da mentoria — acesso total, feedback honesto, risco comercial zero).

### Persona A — Dona da clínica ("a mãe")
- Faz de tudo: atende, agenda, cobra, responde WhatsApp entre procedimentos.
- Dor: mensagens acumulam durante os atendimentos; responde à noite; perde lead por demora; retornos não confirmados viram buraco na agenda.
- O que ela quer: "alguém que responda na hora e encha minha agenda sem eu precisar olhar o celular".
- O que ela NÃO quer: aprender sistema novo complicado. O sucesso é ela *não* precisar usar tela nenhuma — a Emily trabalha onde a paciente já está (WhatsApp).

### Persona B — Recepção (quando existe)
- Alterna balcão, telefone e WhatsApp; agendamento manual é a maior fatia do dia (as 2–3 dias/semana do problema).
- Passa a ser a **supervisora** da Emily: acompanha o painel, assume conversas escaladas, confirma exceções.

### Persona C — Paciente/lead
- Mulher 25–55, chega por Instagram/indicação, chama no WhatsApp fora do horário comercial, decide rápido, esquece consulta se ninguém confirmar.

## 4. Caso de uso 1 — Agendamento por texto no WhatsApp

Emily responde no WhatsApp da clínica, entende o pedido, oferece horários reais, confirma o agendamento, registra tudo, e **escala para humano** quando sai do escopo.

### User stories e critérios de aceite

**US-1 — Agendar**
> Como paciente, quero mandar "quero marcar limpeza de pele" e sair da conversa com horário confirmado, sem esperar a clínica abrir.

Aceite:
- Emily responde em < 1 min (fase manual assistida) / < 15 s (fase automatizada).
- Emily identifica o procedimento, oferece 2–3 horários reais da agenda, confirma a escolha e envia resumo (procedimento, dia, hora, endereço).
- O agendamento fica registrado (Supabase) e visível para a dona.
- Se o procedimento exige avaliação prévia, Emily agenda *avaliação*, não o procedimento.

**US-2 — Remarcar/cancelar**
> Como paciente, quero remarcar ou cancelar pela mesma conversa.

Aceite: Emily localiza o agendamento existente, oferece novos horários ou cancela, e o registro é atualizado — nunca duplicado.

**US-3 — Confirmação de retorno**
> Como dona, quero que a Emily confirme os agendamentos de amanhã automaticamente para reduzir no-show.

Aceite: véspera → mensagem de confirmação; resposta "sim" marca confirmado; "não posso" abre fluxo de remarcação; sem resposta → sinalizado no painel para ação humana.

**US-4 — Escalar para humano**
> Como dona, quero que perguntas fora do escopo (preço não tabelado, questão clínica, reclamação, negociação) venham para mim, não sejam respondidas pela IA.

Aceite: Emily responde "vou chamar a [nome] para te ajudar com isso", marca a conversa como `precisa_humano` no painel e **não inventa** resposta. Zero orientação clínica, zero desconto, zero promessa de resultado.

**US-5 — Supervisionar**
> Como dona/recepção, quero ver todas as conversas e agendamentos num painel simples e assumir qualquer conversa quando quiser.

Aceite: painel lista conversas (com status: em andamento / agendou / precisa_humano), mensagens completas e agendamentos da semana. Base já existe em `clinicnow/painel.html`.

**US-6 — Transparência**
> Como paciente, tenho o direito de saber que falo com uma assistente virtual.

Aceite: Emily se apresenta como assistente digital da clínica na primeira interação (princípio já adotado na Lia/Farol e no clinic-now-sales-lab).

## 5. Métricas de sucesso do teste com a mãe

Janela: **4 semanas** de operação real. Baseline: 2–3 dias/semana (~16–24h) de agendamento manual.

| Métrica | Como medir | Meta go |
|---|---|---|
| % conversas resolvidas sem humano | conversas encerradas com agendamento/resposta completa ÷ total (via `clinicnow_wa_conversas`) | ≥ 60% na semana 4 |
| Tempo de resposta mediano | timestamp mensagem paciente → resposta Emily | < 1 min (manual) / < 15 s (auto) |
| Agendamentos confirmados/semana via Emily | registros criados pela Emily com status confirmado | ≥ 10/semana na semana 4 |
| Horas economizadas/semana | auto-relato da mãe (pergunta padronizada semanal) vs baseline 16–24h | ≥ 50% de redução |
| Taxa de no-show | faltas ÷ agendados, antes vs depois da confirmação automática | queda mensurável (dor nº 1 do benchmark) |
| Taxa de escalada correta | conversas fora de escopo corretamente marcadas `precisa_humano` ÷ total fora de escopo | 100% (métrica de segurança — não negociável) |
| NPS da mãe | nota 0–10 semanal + "o que quase te fez desistir esta semana?" | ≥ 8 na semana 4 |

**Go/no-go:** metas de segurança (escalada 100%) e satisfação (NPS ≥ 8) são obrigatórias; das demais, ≥ 3 de 5. No-go → voltar ao ciclo Descobre com os aprendizados, não empilhar features.

## 6. Fora de escopo da v1 (explícito, decidido na mentoria)

- **Voz** (Emily falada) — categoria validada pelo Assort Health (US$ 120M), mas é etapa 2. Os ativos (agente ElevenLabs no site, voice-lab pt/en com consentimento gravado do fundador) ficam prontos esperando.
- **Upsell em tempo real na consulta** — depende de confiança e dados de histórico que só o caso de uso 1 vai gerar.
- **Multi-clínica / multi-tenant** — uma clínica. Generalizar antes de validar é o erro clássico.
- **App próprio / novas telas para o paciente** — o paciente já tem o app: WhatsApp.
- **Pagamentos, marketing, funil de mídia paga** — nada antes do teste com a mãe passar.

## 7. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **System prompt** — cada mudança altera comportamento E conversão; é trabalho contínuo e subestimado (alerta explícito do mentor) | Emily agenda errado, responde mal, ou vende menos | Suite de avaliação com casos reais ANTES de cada mudança de prompt (épico E2 do backlog); versionar prompts no git; nunca editar prompt direto em produção |
| **LGPD** — nome, telefone e interesse em procedimento estético são dados pessoais (e sensíveis quando tocam saúde) | Multa, quebra de confiança | Aviso de assistente virtual + finalidade na 1ª mensagem; dados no Supabase São Paulo com RLS (já configurado); retenção definida; sem uso de dados para nada além do agendamento; consentimento da clínica documentado |
| **WhatsApp API não-oficial** (Baileys/Evolution etc.) | **Banimento do número real da clínica da mãe** — dano direto ao negócio dela | Não usar API não-oficial no número da clínica, nunca. Caminho: fase manual assistida (sem API) → Cloud API oficial |
| Burocracia Meta (verificação de negócio, 1–3 semanas — já mapeada no Farol) | Atraso da automação | Iniciar verificação no dia 1, em paralelo à fase manual |
| Backend atual aguentar produção (dúvida levantada na reunião) | Sobre-engenharia ou quebra | Resposta do mentor incorporada: MVP pode ser sem tecnologia complexa — a fase 1 é operação manual assistida, o backend só entra quando o roteiro estiver validado |
| Dependência de uma única testadora (mãe) | Feedback enviesado | Aceito conscientemente na v1; segunda clínica só após go |

## 8. Decisão de stack

### Fase 1 (semana 1) — Low-tech de validação, como o mentor sugeriu
**WhatsApp Business comum (número da clínica) + operador humano (fundador) respondendo com a Emily no Claude (system prompt v1) + registro das conversas no Supabase/planilha.** Estilo "Wizard of Oz".

- Prós: no ar em dias; valida roteiro, tom e system prompt com conversas reais antes de escrever integração; zero risco de ban; zero custo de infra; cada conversa vira caso da suite de avaliação.
- Contras: não testa latência automática; exige disciplina do operador (janela de resposta < 1 min em horário definido); não escala — e não precisa: é 1 clínica por 1–2 semanas.

### Fase 2 (semanas 2–4) — Automação com o que já existe
**WhatsApp Cloud API (oficial, Meta) + webhook (função serverless Vercel, mesmo padrão já especificado no Farol/SosMed) + Claude (Anthropic API) + Supabase `sosmed` existente** — tabelas `clinicnow_leads`, `clinicnow_wa_conversas`, `clinicnow_wa_mensagens` **já criadas com RLS** (verificado em 07/08), agendamentos nas tabelas `docgrow_consultas`/`docgrow_followups` já existentes.

- Prós: oficial (sem risco de ban), auditável, reaproveita ~80% da infra existente (Supabase provisionado, padrão de serverless documentado em `ESPECIFICACAO-BACKEND.md` do Farol, painel `clinicnow/painel.html` pronto para estender), custo baixo em volume de 1 clínica.
- Contras: verificação Meta demora 1–3 semanas (por isso começa no dia 1); exige número dedicado ou migração do número da clínica para a Cloud API (decisão com a mãe); templates de mensagem ativa (confirmação de véspera) precisam de aprovação da Meta; mais peças = mais pontos de falha — só liga depois que a fase 1 validar o roteiro.

### Descartado
- **API não-oficial:** risco de banimento do número real da clínica. Vetado (ver riscos).
- **Plataforma pronta (ex.: assinar a própria Cloudia):** resolveria o agendamento, mas não constrói o ativo (system prompt, dados de conversão, upsell futuro) que é o produto ClinicNow. Serve como benchmark, não como stack.

## 9. Ativos existentes reaproveitados

| Ativo | Onde | Papel na v1 |
|---|---|---|
| Protótipo funil/CRM | `~/Applications/medgrowth` + `github.io/clinicnow/app.html` | CRM e cockpit pós-teste (P1) |
| Agenda/pacientes | `~/Applications/farol` (app.html, Supabase) | referência de fluxo de agenda + espec. de backend |
| Supabase `sosmed` (yaqphldowpshhrtvvfaq, São Paulo) | tabelas `clinicnow_*` (criadas, 0 linhas, RLS) + `docgrow_consultas`/`followups` | banco da v1 — nada novo a provisionar |
| Painel | `github.io/clinicnow/painel.html` | base do painel de conversas |
| Agente ElevenLabs Emily + voice-lab pt/en (consentimento gravado) | site + `~/Applications/emily-voice-lab` | guardado para etapa 2 (voz) |
| Persona/guarda-corpos Emily | `clinic-now-maritime-agent` (consent gate, handoff humano, disclosure de assistente virtual) | insumo direto do system prompt v1 |

---

*Documento vivo: atualizar após cada ciclo Descobre → Define → Constrói → Testa.*
