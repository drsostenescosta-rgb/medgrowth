# MedGrowth

SaaS de IA de marketing e vendas para **médicos com consultório**. Gera conteúdo com intencionalidade de venda (carrossel, post, stories, reels, cortes, pautas, ofertas e funis), personalizado ao negócio do médico e **auditado contra a Resolução CFM 2.336/2023** em cada peça.

## Rodar

```bash
npm install
npm run dev        # http://localhost:4520
```

Sem `ANTHROPIC_API_KEY`, o app roda em **modo demo** (exemplos prontos). Para geração real:

```bash
cp .env.example .env   # e preencha ANTHROPIC_API_KEY
```

## Como funciona

- **Onboarding**: perfil do negócio (especialidade, público, posicionamento, ticket, tom) salvo em localStorage — personaliza todos os prompts.
- **8 tipos de conteúdo** em [src/prompts.js](src/prompts.js), cada um com objetivo de funil (atrair/nutrir/converter/fidelizar).
- **Base de conhecimento viva**: os arquivos em `research/` (gerados por agentes de pesquisa) são injetados automaticamente no system prompt via `/api/knowledge`. Badge verde no painel indica que está ativa.
- **Compliance CFM**: regras embutidas no system prompt + linha "✅ Checagem CFM" obrigatória em toda peça gerada — principal diferencial vs. concorrentes (ver `research/concorrentes.md`).
- **Backend dev**: middleware do Vite (`/api/generate`) chama a API da Anthropic (claude-sonnet-5).

## Página de vendas

[vendas.html](vendas.html) — página de vendas completa em `http://localhost:4520/vendas.html` (também acessível pelo link "página de vendas" na sidebar do app). Copy baseada na pesquisa: dor → sistema em 3 passos → 8 geradores → comparação com alternativas → planos → garantia → FAQ. Planos: **Starter R$ 197/mês · Pro R$ 397/mês (destaque) · Premium R$ 997/mês** (com grupo de acompanhamento). Os CTAs apontam para âncoras internas — trocar por link de checkout (Stripe/Hotmart) ou WhatsApp antes de publicar.

## Posicionamento (da pesquisa de concorrentes)

- Concorrente direto nº 1: CreatorMed.ai; nº 2: ecossistema Doctor Creator/IAMC.
- Lacunas de mercado a explorar: compliance CFM auditável, personalização real ao posicionamento, esteira de conversão (não só conteúdo), ROI em consultas agendadas.
- Preço-alvo sugerido: **R$ 197–497/mês**, vendido como "o sistema que executa diariamente o que a mentoria ensina" — competindo com orçamento de mentoria/agência, não com ChatGPT.

## Roadmap

1. **MVP atual**: geração de conteúdo personalizada + compliance (feito).
2. Supabase: auth, perfis e histórico na nuvem; deploy Vercel (mesma stack do Radar Criativo).
3. Radar de tendências/criativos da especialidade (reaproveitar Radar Criativo).
4. Módulo de lançamentos e campanhas de agenda; integração WhatsApp.
5. Fidelização: programas de assinatura/acompanhamento premium prontos para vender.
6. Possível integração com a Lia (Farol).
