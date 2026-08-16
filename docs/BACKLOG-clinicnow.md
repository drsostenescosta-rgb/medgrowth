# BACKLOG — ClinicNow v1

**Data:** 07/08/2026 · **Fonte de fatos:** reunião de mentoria 07/08/2026 (Iago), benchmarks e ativos verificados em 07/08 · **Regra:** Sprint 1 = só P0 e termina com **teste real com a mãe rodando**.

Legenda: prioridade **P0** (Sprint 1 — bloqueia o teste) / **P1** (durante ou logo após o teste) / **P2** (só depois do go). Esforço **S** (≤ meio dia) / **M** (1–2 dias) / **L** (3+ dias).

---

## Épico E1 — Canal WhatsApp

| ID | Task | Prio | Esf | Depende de | Justificativa |
|---|---|---|---|---|---|
| E1-T1 | Ativar WhatsApp Business (app comum) no número da clínica com perfil comercial, horário e mensagem de saudação da Emily | P0 | S | — | Mentor: MVP sem tecnologia complexa; Cloudia validou WhatsApp-first com 1.500+ clínicas — o canal é este |
| E1-T2 | Definir janela de operação assistida (ex.: 8h–20h, resposta < 1 min) e quem opera (fundador) no ciclo 1 | P0 | S | E1-T1 | Resposta lenta é dor nº 1 do segmento (benchmark); sem SLA definido o teste não mede nada |
| E1-T3 | Iniciar verificação Meta Business + solicitar acesso WhatsApp Cloud API (dia 1, em paralelo) | P0 | S | — | Burocracia leva 1–3 semanas (mapeada no Farol/ESPECIFICACAO-BACKEND.md); começar já para não bloquear a fase 2 |
| E1-T4 | Webhook `/api/whatsapp-clinicnow` (Vercel): recebe mensagem → Claude com system prompt → responde → grava em `clinicnow_wa_conversas`/`clinicnow_wa_mensagens` | P1 | M | E1-T3, E2-T2, E3-T1 | Automação só liga após roteiro validado na fase manual (decisão de stack do PRD); padrão serverless já documentado no Farol — reuso, não invenção |
| E1-T5 | Template Meta de confirmação de véspera (mensagem ativa) submetido para aprovação | P1 | S | E1-T3 | No-show é dor nº 1 (benchmark); Doctoralia/iClinic só fazem lembrete — aqui o lembrete conversa e remarca |
| ~~E1-T6~~ | ~~API não-oficial (Evolution/Baileys) para acelerar~~ | VETADO | — | — | Risco de banir o número real da clínica da mãe (PRD §7) — dano direto ao negócio dela |

## Épico E2 — Cérebro da Emily: system prompt v1 + avaliação

| ID | Task | Prio | Esf | Depende de | Justificativa |
|---|---|---|---|---|---|
| E2-T1 | Entrevista de descoberta com a mãe: procedimentos, preços tabelados, regras de agenda, perguntas frequentes reais, o que NUNCA responder | P0 | S | — | Ciclo Descobre → Define (reunião 07/08); o prompt é escrito a partir da operação real, não de suposição |
| E2-T2 | System prompt v1 da Emily (agendamento estética): tom, apresentação como assistente virtual, procedimentos/horários, fluxo agendar/remarcar/confirmar, regras de escalada (clínico, preço não tabelado, reclamação, desconto = humano) | P0 | M | E2-T1 | Reunião 07/08: system prompt é crítico e subestimado — cada mudança altera comportamento e conversão. Guarda-corpos herdados do clinic-now-maritime-agent (handoff humano, disclosure, anti-injection) |
| E2-T3 | Versionar prompts em `medgrowth/prompts/` no git com changelog (uma mudança por commit, nunca editar em produção) | P0 | S | E2-T2 | Mentor martelou: trabalho contínuo — sem versionamento não há como correlacionar mudança de prompt com mudança de conversão |
| E2-T4 | **Suite de avaliação do prompt**: 20–30 casos reais (da entrevista E2-T1 + conversas do teste) com resposta esperada; script roda a suite contra o prompt e marca pass/fail antes de qualquer mudança entrar no ar | P0 | M | E2-T2 | Exigência explícita do mentor na reunião 07/08. Casos de segurança (pergunta clínica, pedido de desconto, emergência) têm que passar 100% |
| E2-T5 | Rotina de iteração semanal: conversas que falharam viram novos casos da suite → ajusta prompt → roda suite → publica | P1 | S | E2-T4, E5-T2 | Feedback real > produto perfeito (reunião); fecha o loop Constrói → Testa → Descobre |

## Épico E3 — Fluxo de agendamento no Supabase existente

| ID | Task | Prio | Esf | Depende de | Justificativa |
|---|---|---|---|---|---|
| E3-T1 | Modelar o agendamento nas tabelas existentes: conversa em `clinicnow_wa_conversas`/`_mensagens`, lead em `clinicnow_leads`, consulta em `docgrow_consultas`, confirmação em `docgrow_followups`; documentar o mapeamento em `docs/` | P0 | S | — | Tabelas já existem com RLS no Supabase sosmed — verificado em 07/08 (0 linhas, prontas). Criar schema novo seria desperdício |
| E3-T2 | Carga da agenda real da mãe (horários de atendimento, bloqueios, duração por procedimento) — planilha ou tela mínima, o que for mais rápido | P0 | S | E2-T1 | Emily só pode ofertar horário que existe; dado vem da operação real (Descobre) |
| E3-T3 | Registro manual padronizado no ciclo 1: operador registra cada agendamento/conversa do dia no Supabase (form simples ou SQL assistido) | P0 | S | E3-T1 | Fase low-tech do mentor: o dado precisa nascer no banco desde o dia 1 para as métricas do PRD §5 serem calculáveis |
| E3-T4 | Na fase automática: função de agendamento chamada pela Emily (checa disponibilidade → cria `docgrow_consultas` → agenda confirmação de véspera em `docgrow_followups`) | P1 | M | E1-T4, E3-T2 | Automatiza o que a fase manual validou; anti no-show é a dor nº 1 (benchmark) |

## Épico E4 — Painel mínimo de conversas

| ID | Task | Prio | Esf | Depende de | Justificativa |
|---|---|---|---|---|---|
| E4-T1 | Estender `clinicnow/painel.html` (já existe com login Supabase): lista de conversas com status (em andamento / agendou / precisa_humano) + mensagens + agendamentos da semana | P0 | M | E3-T1 | Ativo existente (github.io/clinicnow/painel.html) — estender custa M, criar do zero custaria L. US-5 do PRD |
| E4-T2 | Alerta de `precisa_humano` (badge no painel + notificação simples por WhatsApp para a dona) | P1 | S | E4-T1 | Escalada correta é métrica de segurança não negociável (PRD §5); alerta fecha o ciclo do handoff |
| E4-T3 | Mini-dashboard das métricas do teste (conversas resolvidas %, agendamentos/semana, tempo de resposta) direto das tabelas | P1 | M | E3-T3 | As metas go/no-go do PRD §5 precisam ser lidas sem apuração manual na semana 4 |

## Épico E5 — Protocolo do teste com a mãe

| ID | Task | Prio | Esf | Depende de | Justificativa |
|---|---|---|---|---|---|
| E5-T1 | Roteiro do teste: onboarding da mãe (o que a Emily faz e não faz), divulgação do número, janela de 4 semanas, papéis (quem opera, quem supervisiona) | P0 | S | E2-T2 | Decisão da reunião 07/08: testar com a mãe antes de qualquer lançamento — o teste é o entregável do Sprint 1 |
| E5-T2 | Instrumento de feedback semanal: nota 0–10 + "o que quase te fez desistir?" + horas gastas com agendamento na semana (vs baseline 16–24h) | P0 | S | E5-T1 | Baseline 2–3 dias/semana veio da reunião; sem medição semanal padronizada a economia de horas vira achismo |
| E5-T3 | Critérios go/no-go documentados e acordados ANTES do início (os do PRD §5) | P0 | S | E5-T1 | Feedback real > produto perfeito só funciona com critério definido antes — senão todo resultado "parece bom" |
| E5-T4 | Retro do ciclo na semana 4: decisão go/no-go registrada + lista do que entra no próximo ciclo Descobre | P1 | S | E5-T2, E5-T3 | Fecha o ciclo Descobre → Define → Constrói → Testa da mentoria |

## Épico E6 — LGPD e consentimento

| ID | Task | Prio | Esf | Depende de | Justificativa |
|---|---|---|---|---|---|
| E6-T1 | Primeira mensagem da Emily com disclosure: assistente virtual + finalidade (agendamento) + como falar com humano | P0 | S | E2-T2 | LGPD (transparência) + princípio já adotado na Lia/Farol e no clinic-now-sales-lab; interesse em procedimento estético tangencia dado de saúde |
| E6-T2 | Termo simples com a clínica (a mãe): quais dados a Emily coleta, onde ficam (Supabase São Paulo, RLS), retenção e descarte | P0 | S | — | Mesmo em família, o teste usa dados reais de pacientes reais — o hábito de compliance começa no cliente 1 |
| E6-T3 | Checklist LGPD da v1: minimização (só nome/telefone/procedimento/horário), sem uso secundário dos dados, acesso restrito, plano de exclusão sob pedido | P0 | S | E3-T1 | Risco mapeado no PRD §7; barato agora (S), caro depois |
| E6-T4 | Arquivar o consentimento gravado da voz clonada do fundador junto aos docs do projeto | P1 | S | — | Reunião 07/08: voz clonada exige consentimento gravado — já obtido; arquivar antes que se perca. Voz é etapa 2, o papel não |

---

## Sprint 1 (P0) — "teste real com a mãe rodando"

Ordem de execução sugerida (≈ 1 semana de trabalho + 4 semanas de teste):

1. **Dia 1:** E1-T3 (verificação Meta — relógio de 1–3 semanas começa a contar) + E2-T1 (entrevista com a mãe) + E6-T2 (termo)
2. **Dias 2–3:** E2-T2 → E2-T3 → E2-T4 (prompt v1 + versionamento + suite de avaliação passando)
3. **Dias 3–4:** E3-T1 + E3-T2 + E3-T3 (mapeamento no Supabase + agenda real + registro padronizado) · E1-T1 + E1-T2 (canal no ar com SLA)
4. **Dia 5:** E4-T1 (painel) + E6-T1 + E6-T3 (disclosure e checklist) + E5-T1/T2/T3 (protocolo fechado)
5. **Semana 2 em diante:** teste rodando; P1 (webhook E1-T4, agendamento automático E3-T4, template E1-T5, dashboard E4-T3, iteração de prompt E2-T5) entra conforme a verificação Meta liberar e o roteiro manual validar.

**Definição de pronto do Sprint 1:** a mãe divulgou o número, pacientes reais conversam com a Emily (operação assistida), cada conversa vira linha no Supabase, o painel mostra tudo, e o feedback semanal está sendo coletado contra critérios go/no-go escritos.

---

## Anti-backlog — o que NÃO fazer agora (e por quê)

| Não fazer | Por quê |
|---|---|
| **Voz (Emily falada, telefone)** | Decisão da mentoria: texto primeiro. Assort Health (US$ 120M) valida a categoria mas prova que voz é etapa 2 — exige latência, telefonia e prompt maduro. Os ativos (ElevenLabs, voice-lab pt/en, consentimento gravado) estão guardados e não expiram |
| **Upsell em tempo real na consulta** | É a visão, não a v1. Depende de histórico de pacientes e confiança da clínica que só o caso de uso 1 gera. Vender antes de agendar bem = perder a testadora |
| **Multi-clínica / multi-tenant** | Uma clínica, a da mãe. Generalizar schema, auth e onboarding antes do primeiro go é o clássico produto perfeito sem feedback real — o oposto do combinado na reunião |
| **App próprio / telas para paciente** | O paciente já tem o app: WhatsApp (canal validado pela Cloudia com 1.500+ clínicas). Cada tela nova é atrito e semana perdida |
| **Reescrever/robustecer o backend para "aguentar produção"** | Dúvida levantada na reunião e respondida pelo mentor: MVP pode ser sem tecnologia complexa. Produção da v1 = 1 clínica; o Supabase existente sobra. Robustez entra quando houver 2ª clínica pagante |
| **Mídia paga / lançamento / site de vendas** | Testar com a mãe antes de qualquer lançamento (decisão explícita 07/08). Tráfego antes do go queima lead e reputação |
| **Integração com Doctoralia/iClinic/agendas externas** | A clínica-teste não usa; benchmark mostra que eles são lembrete, não venda — integrá-los agora não ataca a dor |

---

*Regra de manutenção: task nova só entra com justificativa citando fonte (reunião, benchmark ou ativo). Sem fonte, vai para o Descobre do próximo ciclo.*

---

## E7 — Radar de Oportunidades (predição de compra) — registrado 2026-08-11, proposto por Sostenes

**Tese:** o CRM projeta oportunidades por cliente: janela de renovação do procedimento + ponte de cross-sell do catálogo + score de propensão transparente. "Cliente agendado para {{data}} → oferecer {{servico}} → score A/B/C com motivo escrito."

**Gate de entrada:** SÓ inicia após o teste com a clínica-piloto passar no go/no-go (anti-backlog vigente: sem upsell antes disso).

- **E7-T1 [P2/S]** `knowledge/janelas-renovacao.md`: intervalo de recompra por procedimento (toxina 3-4m, preenchimento 9-12m, limpeza 45-60d, pacotes sessão N+1, HIFEM ciclo de manutenção) com fonte clínica — alimenta a cadência de follow-up JÁ existente. *Pode ser escrito antes do gate: é conhecimento, não feature.*
- **E7-T2 [P2/M]** `radar.mjs`: para cada lead do funil, calcular oportunidades = janelas vencendo + pontes do catálogo + score heurístico (recência, frequência, comparecimento, estágio) com o PORQUÊ; board "oportunidades da semana" no funil.
- **E7-T3 [P2/S]** Emily consome o radar: no follow-up da cadência, a mensagem cita a oportunidade com motivo verdadeiro ("faz 3 meses do seu botox…"). Sem pressão; compliance de sempre.
- **E7-T4 [P2/M — pós ~100 desfechos]** Calibração: regressão sobre ofereceu→fechou por perfil; score vira probabilidade % real. PROIBIDO exibir % antes da calibração (precisão-fake).
- **LGPD:** predição usa só dados coletados com consentimento no próprio funil; nada de inferência sensível fora do escopo do atendimento.
