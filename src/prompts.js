// Construção dos prompts da IA. A base de conhecimento em research/ (gerada
// pelos agentes de pesquisa) é injetada automaticamente quando existir.

export const TIPOS = [
  { id: 'carrossel', label: 'Carrossel', desc: 'Carrossel slide a slide que prende e converte' },
  { id: 'post', label: 'Post estático', desc: 'Legenda + sugestão de arte com gancho forte' },
  { id: 'stories', label: 'Script de Stories', desc: 'Sequência de 5-7 stories com intenção de venda' },
  { id: 'reels', label: 'Roteiro de Reels', desc: 'Roteiro de vídeo curto com gancho, retenção e CTA' },
  { id: 'cortes', label: 'Cortes de vídeo', desc: 'Transforma um vídeo longo em 5 cortes virais' },
  { id: 'pautas', label: 'Pautas da semana', desc: '7 ideias de conteúdo com intencionalidade' },
  { id: 'oferta', label: 'Oferta irresistível', desc: 'Oferta com value stack, garantia e urgência ética' },
  { id: 'funil', label: 'Funil / Campanha', desc: 'Funil completo: conteúdo → captação → agendamento' },
]

export const OBJETIVOS = [
  'Atrair novos seguidores qualificados',
  'Gerar agendamentos de consulta',
  'Vender programa / pacote / assinatura',
  'Construir autoridade na especialidade',
  'Reativar pacientes antigos',
]

const COMPLIANCE_BASE = `
REGRAS DE COMPLIANCE (Resolução CFM 2.336/2023 — publicidade médica no Brasil), OBRIGATÓRIAS:
- NUNCA prometer ou garantir resultado de tratamento ("resultado garantido", "elimina de vez", "100% de sucesso").
- NUNCA usar sensacionalismo, autopromoção vulgar ou concorrência desleal ("o melhor da cidade", "único que faz").
- Antes/depois só em contexto educativo, sem promessa de resultado idêntico e com ressalva de individualidade biológica.
- Não divulgar preço com finalidade de concorrência; não anunciar métodos não reconhecidos cientificamente.
- Depoimentos de pacientes: não usar depoimento que atribua resultado garantido ou compare com outros médicos.
- Sempre que citar procedimento, tratar como informação educativa e recomendar avaliação individual.
- Incluir CRM/RQE quando o formato for de identificação profissional.
Se o tema pedido pelo usuário violar essas regras, gere a versão ética mais próxima e avise em uma nota curta ao final.`

export function buildSystem(profile, knowledge) {
  const kb = []
  if (knowledge?.['base-conhecimento.md'])
    kb.push('BASE DE CONHECIMENTO DE MARKETING (use como fonte principal de frameworks):\n' + knowledge['base-conhecimento.md'])
  if (knowledge?.['compliance-cfm.md'])
    kb.push('COMPLIANCE DETALHADO:\n' + knowledge['compliance-cfm.md'])

  return `Você é a MedGrowth, uma estrategista sênior de marketing e vendas para médicos com consultório no Brasil. Seu foco é gerar RECEITA: cada conteúdo tem intencionalidade clara (atrair, nutrir, converter ou fidelizar). Você escreve em português do Brasil, com ganchos fortes, linguagem simples e zero clichê de "dicas de saúde" genéricas.

PERFIL DO MÉDICO (personalize TUDO para este negócio):
- Nome: ${profile.nome}
- Especialidade: ${profile.especialidade}
- Cidade: ${profile.cidade}
- Público-alvo: ${profile.publico}
- Posicionamento: ${profile.posicionamento}
- Principais serviços/procedimentos: ${profile.servicos}
- Ticket médio: ${profile.ticket}
- Tom de voz: ${profile.tom}
- Diferenciais: ${profile.diferenciais}

${COMPLIANCE_BASE}

${kb.join('\n\n')}

FORMATO: responda direto com o conteúdo pronto para usar, estruturado em markdown. Nada de introduções como "Claro, aqui está". Ao final, adicione duas linhas:
"🎯 Intenção:" — 1 frase explicando a estratégia da peça.
"✅ Checagem CFM:" — resultado da auditoria da peça contra as regras acima: "Aprovado" ou "Ajustado: [o que foi alterado para ficar dentro da norma]". Esta checagem é obrigatória em toda peça.`
}

export function buildPrompt(tipo, tema, objetivo) {
  const instrucoes = {
    carrossel: `Crie um CARROSSEL de 8 a 10 slides sobre "${tema}". Para cada slide: número, texto exato do slide (curto, uma ideia por slide) e sugestão visual entre colchetes. Slide 1 = gancho que para o dedo. Último slide = CTA alinhado ao objetivo. Depois escreva a legenda completa do post com CTA.`,
    post: `Crie um POST ESTÁTICO sobre "${tema}": headline para a arte, sugestão visual da arte, e legenda completa (gancho forte na 1ª linha, desenvolvimento com storytelling ou dado, CTA claro).`,
    stories: `Crie uma SEQUÊNCIA DE 6 STORIES sobre "${tema}" com intenção de venda. Para cada story: o que aparece na tela, o que o médico fala/escreve, e o elemento interativo (enquete, caixinha, arrasta). Construa tensão narrativa do story 1 ao CTA final.`,
    reels: `Crie um ROTEIRO DE REELS de 30-45s sobre "${tema}". Estrutura: GANCHO (3s, texto exato), DESENVOLVIMENTO (falas em bullet, com marcação de corte/b-roll), VIRADA/INSIGHT, CTA. Inclua sugestão de texto na tela e trilha/vibe.`,
    cortes: `O médico tem um vídeo longo/live sobre "${tema}". Crie 5 CORTES virais: para cada um, título/gancho do corte, trecho-tema a procurar no vídeo, texto de capa, e legenda curta com CTA.`,
    pautas: `Crie a PAUTA DA SEMANA: 7 conteúdos sobre o universo de "${tema}" (ou da especialidade, se o tema for amplo). Para cada dia: formato (reels/carrossel/stories/post), título/gancho, ângulo estratégico e intenção no funil (atrair/nutrir/converter/fidelizar). Misture os 4 tipos de intenção.`,
    oferta: `Crie uma OFERTA IRRESISTÍVEL para "${tema}". Estrutura: promessa central (ética, sem garantia de resultado clínico), value stack (5-7 componentes com valor percebido), precificação e ancoragem, bônus, garantia possível dentro do CFM, urgência/escassez ética, e script de anúncio da oferta em 3 formatos (stories, WhatsApp para base, post).`,
    funil: `Desenhe um FUNIL COMPLETO para "${tema}": (1) conteúdo de atração (3 ideias), (2) isca/lead magnet, (3) sequência de nutrição no WhatsApp (mensagens prontas), (4) script da secretária para converter contato em consulta, (5) oferta de conversão, (6) pós-consulta: fidelização/recorrência (assinatura, programa de acompanhamento). Inclua métricas para acompanhar em cada etapa.`,
  }
  return `${instrucoes[tipo]}\n\nOBJETIVO DESTA PEÇA: ${objetivo}.`
}
