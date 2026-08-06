// Conteúdo do MODO DEMO — usado quando não há ANTHROPIC_API_KEY configurada.
// Mostra a qualidade esperada do produto sem custo de API.

export const DEMO = {
  carrossel: `## Carrossel: "O check-up que 8 em cada 10 pacientes adiam"

**Slide 1** — 🛑 Você não sente nada. E é exatamente por isso que deveria se preocupar.
[Visual: fundo escuro, texto grande, foto séria do médico]

**Slide 2** — A maioria das doenças silenciosas não dá sintoma até estar avançada.
[Visual: ícone de relógio/ampulheta]

**Slide 3** — Pressão alta, diabetes, colesterol: os 3 chegam sem avisar.
[Visual: 3 ícones lado a lado]

**Slide 4** — "Mas eu me sinto bem, doutor." — frase mais ouvida no consultório antes de um diagnóstico tardio.
[Visual: balão de fala]

**Slide 5** — Um check-up anual leva 40 minutos. Um tratamento tardio pode levar anos.
[Visual: comparação 40min vs anos]

**Slide 6** — O que avaliamos no check-up: exames de sangue, pressão, histórico familiar, hábitos e riscos individuais.
[Visual: checklist]

**Slide 7** — Cada organismo é único: o plano de prevenção certo é o desenhado para VOCÊ.
[Visual: foto do médico atendendo]

**Slide 8** — 📲 Agende sua avaliação: link na bio ou chame no WhatsApp. Sua saúde de daqui a 10 anos começa hoje.
[Visual: CTA grande + WhatsApp]

**Legenda:** Você cuidaria do seu carro só depois que o motor fundisse? Então por que fazer isso com o seu corpo?... (gancho + desenvolvimento + CTA para agendamento)

🎯 Intenção: converter seguidores em agendamento usando urgência ética + quebra da objeção "não sinto nada".

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no arquivo .env para gerar conteúdo real e personalizado ao seu perfil.`,

  post: `## Post estático: gancho de autoridade

**Headline da arte:** "Cansaço constante não é normal. É sinal."

**Legenda:** Se você acorda cansado(a) mesmo dormindo 8 horas, seu corpo está tentando te dizer algo... (desenvolvimento com 3 causas possíveis + CTA de agendamento)

🎯 Intenção: atrair público qualificado com dor específica e direcionar para consulta.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,

  stories: `## Sequência de 6 stories: bastidor + venda

**Story 1** — Câmera no rosto: "Hoje atendi um paciente que quase me deixou sem palavras..." [texto: "história real 👇"]
**Story 2** — "Ele passou 3 anos tratando o sintoma errado." [enquete: "Você já tomou remédio sem saber a causa? SIM/NÃO"]
**Story 3** — "O problema não era o que ele achava. Era algo que aparece num exame simples." [texto na tela]
**Story 4** — "Isso acontece TODO dia. Tratamos sintomas e ignoramos causas." [caixinha: "qual sintoma você ignora?"]
**Story 5** — "Essa semana abri X horários para avaliação completa — a que investiga a causa." [texto: "link abaixo"]
**Story 6** — CTA: "Arrasta pra cima / chama no WhatsApp. Sua vaga: [link]" [contagem/urgência ética]

🎯 Intenção: storytelling de caso (anonimizado) para gerar agendamento imediato.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,

  reels: `## Roteiro de Reels (40s)

**GANCHO (0-3s):** "3 sinais de que seu corpo está pedindo socorro — e você está ignorando o 2º."
**DESENVOLVIMENTO:** sinal 1 (corte rápido) → sinal 2 (zoom + texto na tela) → sinal 3 (b-roll consultório)
**VIRADA:** "Nenhum desses sinais significa doença. Mas todos merecem investigação."
**CTA:** "Me segue para entender seu corpo — e se identificou com algum, agenda uma avaliação. Link na bio."

🎯 Intenção: alcance + autoridade, com ponte para agendamento.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,

  cortes: `## 5 cortes do seu vídeo longo

1. **"O erro nº 1 de quem toma esse remédio"** — procurar trecho sobre automedicação. Capa: rosto sério + texto vermelho.
2. **"Isso NÃO é frescura"** — trecho validando a dor do paciente. Capa: texto grande.
3. **"O exame que quase ninguém pede"** — trecho técnico simplificado.
4. **"Respondi a pergunta que todo paciente faz"** — trecho de Q&A.
5. **"A história que me marcou"** — trecho de caso clínico anonimizado.

🎯 Intenção: multiplicar alcance de 1 gravação em 5 ativos de topo de funil.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,

  pautas: `## Pauta da semana (exemplo)

| Dia | Formato | Gancho | Intenção |
|-----|---------|--------|----------|
| Seg | Reels | "3 mitos que você acredita sobre..." | Atrair |
| Ter | Stories | Bastidor do consultório + enquete | Nutrir |
| Qua | Carrossel | "O guia definitivo de..." | Autoridade |
| Qui | Stories | Caso real (anonimizado) + caixinha | Nutrir |
| Sex | Post | Prova social + convite | Converter |
| Sáb | Reels | Trend adaptada à especialidade | Atrair |
| Dom | Stories | Pessoal/humano + recado da semana | Fidelizar |

🎯 Intenção: semana completa cobrindo todo o funil.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,

  oferta: `## Oferta: Programa de Acompanhamento Premium (exemplo)

**Promessa central:** acompanhamento contínuo e prioritário da sua saúde, com plano individualizado — sem promessa de resultado clínico, com promessa de EXPERIÊNCIA e acesso.

**Value stack:**
1. Consulta completa de mapeamento inicial
2. 4 consultas de acompanhamento no ano
3. Canal direto via WhatsApp com a equipe
4. Prioridade de agenda
5. Revisão de exames sem custo adicional
6. Plano de metas trimestral

**Ancoragem:** avulso sairia R$ X — no programa, 12x de R$ Y.
**Garantia (dentro do CFM):** garantia de acesso e reagendamento, não de resultado.
**Urgência ética:** vagas limitadas pela capacidade real de agenda.

+ Scripts de anúncio em stories, WhatsApp e post.

🎯 Intenção: criar receita recorrente e previsível para o consultório.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,

  funil: `## Funil: da atração à recorrência (exemplo)

**1. Atração:** 3 reels de dor específica do público.
**2. Isca:** guia em PDF "Checklist de sinais que merecem investigação" via link na bio.
**3. Nutrição WhatsApp:** sequência de 4 mensagens prontas (D0 entrega, D2 conteúdo, D4 caso, D6 convite).
**4. Script da secretária:** roteiro de resposta que converte "quanto custa?" em agendamento.
**5. Conversão:** oferta de avaliação completa.
**6. Recorrência:** convite pós-consulta para programa de acompanhamento.

**Métricas:** alcance → cliques na bio → leads WhatsApp → agendamentos → comparecimento → adesão ao programa.

🎯 Intenção: processo previsível de aquisição e retenção de pacientes.

> ⚠️ MODO DEMO — configure sua ANTHROPIC_API_KEY no .env para gerar conteúdo real.`,
}
