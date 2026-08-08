# Emily Vendas — circuito executável (ClinicNow, fase Wizard-of-Oz)

Motor de conversa + agenda + funil da **Emily**, assistente de WhatsApp da clínica de estética e
emagrecimento (ICP: a clínica da mãe do fundador — PRD `../docs/PRD-clinicnow.md`).

**Conversão-mestre: AGENDAR A AVALIAÇÃO.** Nada de preço fora da tabela oficial, nada de link de
pagamento, nada de promessa de resultado. Compliance completo no system prompt
(`../knowledge/system-prompt-emily-vendas-v1.md`) e nos 2 catálogos de `../knowledge/`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `emily.mjs` | Motor de conversa: contexto → Claude (JSON) → circuito de escalação → registro. `--texto` (modo operador), `--check` (health check) |
| `agenda.mjs` | Agenda: `livres`, `marcar`, `confirmar`, `listar` (grade em `agenda-config.json`); `marcar` move o lead p/ `avaliacao_agendada` e cria a tarefa de lembrete de véspera |
| `funil.mjs` | Board do funil estilo Agendor + `mover`, `toque` (cadência D1/D3/D7 com teto anti-spam) e `retomar` (devolve conversa pausada à Emily) |
| `eval.mjs` | **Runner executável** da suite `../knowledge/eval-casos-v1.md` (gate [SEG] = 100%) |
| `metricas.mjs` | Métricas do go/no-go (PRD §5): % sem humano, latência mediana, confirmados/semana, escalações, opt-outs |
| `webhook.mjs` | WhatsApp Cloud API fase 2 — **implementado e DESLIGADO**; só sobe com assinatura Meta + canal de alerta (ver pré-condições) |
| `lib.mjs` | Env, Supabase REST com fallback, armazenamento local, log de escalação, notificação imediata ao humano |
| `clinica-config.json` | Nome/endereço/responsável/tabela de preços → preenchem os placeholders do prompt. **Campos `[PREENCHER` bloqueiam execução real** (só `--dry-run` roda) |
| `agenda-config.json` | Grade de horários da clínica (dias, faixas, duração, antecedência) |
| `conversas/<tel>.json` | Histórico local (fallback quando o Supabase está indisponível) — **não commitado (LGPD)** |
| `agenda.json` | Agendamentos locais — **não commitado (LGPD)** |
| `escalacoes.log` | Alertas de escalação p/ humano e consultas ao especialista — **não commitado** |

## Setup (1 minuto)

```bash
cd ~/Applications/medgrowth/emily-vendas
cp .env.example .env        # já existe um .env pré-preenchido
# ANTHROPIC_API_KEY vazia no .env local → o circuito usa a de ~/.env (o .env local prevalece).
# A chave precisa ser VÁLIDA — valide o setup ANTES de atender qualquer lead:
node emily.mjs --check      # testa chave (detecta 401), config, knowledge e agenda
# Para espelhar no Supabase: preencher SUPABASE_SERVICE_KEY (e DOCGROW_PROFILE_ID p/ agenda)
```

> **Status 07/08 (fiscalização):** a ANTHROPIC_API_KEY de `~/.env` está **inválida (401)** — renovar em
> console.anthropic.com → API keys, colar em `~/.env` (ou no `.env` local) e rodar `--check` de novo.
> Até lá o circuito não atende ponta a ponta.

Sem Supabase configurado **tudo continua funcionando**: histórico, funil e agenda caem no
armazenamento local. O runner nunca quebra por falta de banco.

## Pré-condições de go-live (fase 1, conversa real)

1. **Chave válida:** `node emily.mjs --check` verde.
2. **Entrevista E2-T1 feita:** `clinica-config.json` sem nenhum campo `[PREENCHER` — o motor **recusa
   rodar fora de `--dry-run`** enquanto houver placeholder (a Emily jamais se apresenta como
   "Clínica [PREENCHER...]" para um cliente).
3. **Gate de eval:** `node eval.mjs` com [SEG] = 100% (bloco A ≥ 7/8).

## O ciclo Wizard-of-Oz — como operar HOJE

Decisão da mentoria (PRD §8): validar roteiro com operação manual assistida antes de qualquer
automação. Zero risco de ban, zero infra.

1. **Terminal aberto** em `~/Applications/medgrowth/emily-vendas`, WhatsApp Business da clínica no celular/web ao lado.
2. **Mensagem chega** no WhatsApp → o operador cola no motor. Para quem não é técnico (persona B —
   mãe/recepção), use o modo `--texto`: sai SÓ a mensagem pronta (e já vai para o clipboard no Mac):
   ```bash
   node emily.mjs --texto "5584999990000" "quanto custa limpeza de pele?"
   # → mensagem pronta no stdout + clipboard; status/alertas aparecem em linhas [emily] separadas
   node emily.mjs "5584999990000" "..."          # forma completa: JSON com tudo
   ```
3. O motor devolve:
   - `resposta_whatsapp` → **revise** e cole de volta no WhatsApp (janela-alvo: < 1 min);
   - `acao` → `responder` | `consultar_especialista` (já veio fundida com a 2ª opinião) |
     `escalar_humano` (alerta + notificação; **a conversa fica PAUSADA para a IA** — assuma) |
     `opt_out` (confirmação enviada; lead sai de TODA cadência — nenhum contato futuro);
   - `estagio_funil` + `proximo_followup_dias` + `nota_interna` → registrados no funil automaticamente.
   - Conversa pausada/opt-out: a próxima mensagem do cliente **não volta para a IA** — o motor só
     registra a entrada e avisa. Devolver à Emily é decisão humana: `node funil.mjs retomar <tel>`
     (opt-out exige `--cliente-voltou`).
4. **Cliente escolheu horário?** Marque na agenda (a Emily só oferece horários reais desta grade;
   `marcar` recusa data passada/antecedência violada e já move o lead para `avaliacao_agendada`
   com a tarefa de lembrete de véspera criada — a defesa contra o no-show não depende de memória):
   ```bash
   node agenda.mjs livres
   node agenda.mjs marcar "5584999990000" "Maria Silva" "avaliação estética" 2026-08-10 09:00
   node agenda.mjs confirmar "5584999990000" 2026-08-10   # na véspera, após o "sim"
   ```
5. **Começo e fim do dia** — abra o board e ataque os follow-ups vencidos primeiro. Reengajamento tem
   TETO (playbook §1.4): máx. 2 toques de venda (D1/D3); o 3º contato é o D7 de encerramento digno.
   Registre cada toque para o board respeitar o teto:
   ```bash
   node funil.mjs
   node funil.mjs toque "5584999990000"      # registra D1/D3; no 3º vira D7 e pausa o lead
   node funil.mjs mover "5584999990000" compareceu
   ```
6. **Teste sem gravar nada** (ensaio, demo, eval):
   ```bash
   node emily.mjs --dry-run "5584999990000" "vocês têm Mounjaro?"
   ```
7. **Fim de semana / go-no-go** — métricas do PRD §5 sem contagem manual:
   ```bash
   node metricas.mjs --dias 7
   ```

Cada conversa real vira caso da suite `../knowledge/eval-casos-v1.md` (30 casos) — rode
`node eval.mjs` antes de qualquer mudança de prompt entrar no ar (E2-T4): gate [SEG] < 100% = exit 1.

## O circuito de escalação (o pedido central)

```
mensagem → [GATE: conversa pausada/opt-out? → IA NÃO responde; registra entrada + avisa humano]
         → Emily (claude-sonnet-4-5, JSON)
             ├─ responder             → resposta direta
             ├─ consultar_especialista → 2ª chamada com effort maior (extended thinking) COM os
             │                           mesmos 2 catálogos + tabela + playbook → respostas fundidas
             ├─ escalar_humano        → notificação imediata (log + webhook de alerta + notificação
             │                           macOS) + mensagem de transição + conversa PAUSADA p/ IA
             └─ opt_out               → confirmação sem contraproposta, followup zerado, lead fora
                                        de toda cadência (flag opt_out + ai_paused)
```

O especialista obedece às MESMAS regras invioláveis e agora recebe os MESMOS catálogos (fonte
exclusiva), a tabela autorizada e o playbook — nada de responder as perguntas mais difíceis "de
cabeça". Se o especialista falhar, o rascunho da Emily segue — o circuito nunca deixa o cliente sem
resposta.

## Evolução para a fase 2 (WhatsApp Cloud API oficial)

1. Verificação Meta Business + acesso Cloud API (E1-T3 — iniciar já, leva 1–3 semanas).
2. `webhook.mjs` está **implementado e desligado** (`WEBHOOK_ENABLED=false`; envio real comentado).
   Ele NÃO é considerado pronto para exposição pública sem as pré-condições, e **recusa subir** sem:
   - `WHATSAPP_APP_SECRET` — todo POST é validado por assinatura `X-Hub-Signature-256` (HMAC do
     corpo bruto); POST forjado → 401, nada processado (anti-forja / anti prompt-injection);
   - `ALERTA_WEBHOOK_URL` — urgência médica/escalação notifica a dona NA HORA (jornada H2), não
     espera painel/log;
   - gate de eval aprovado (`node eval.mjs`, [SEG] = 100%) e `clinica-config.json` sem `[PREENCHER`;
   - revisão humana antes de descomentar o envio real.
   O POST chama o MESMO `processarMensagem()` do emily.mjs — inclusive o gate de pausa: conversa
   escalada/opt-out **não** recebe resposta automática na fase 2.
3. API não-oficial (Baileys/Evolution): **VETADA** — risco de banir o número real da clínica (PRD §7).

## Dados e LGPD

- Mínimo de dados: telefone, nome, estágio, próxima ação. `conversas/`, `agenda.json` e
  `escalacoes.log` estão no `.gitignore` do repositório.
- Supabase `sosmed` (São Paulo) com RLS; service key só via `.env` (nunca em código ou log).
- Opt-out: a Emily confirma imediatamente (`acao: "opt_out"`), o follow-up é zerado, o lead ganha as
  flags `opt_out` + `ai_paused` e sai de TODA cadência (o board mostra em "PAUSADO / OPT-OUT — não
  recontatar"). Nenhuma mensagem futura; reativação só com pedido do cliente
  (`node funil.mjs retomar <tel> --cliente-voltou`).
