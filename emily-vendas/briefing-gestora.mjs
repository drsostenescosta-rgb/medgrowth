// Briefing comercial PRIVADO para a gestora. Não é resposta à paciente e não é
// recomendação clínica. O motor só usa fatos já classificados e o catálogo autorizado.

const REGRAS_SEGURANCA = /^(R6\.|LGPD\.)/;
const REGRAS_FINANCEIRAS = /(PRECO|DESCONTO|PACOTE|SINAL)/;
const REGRAS_AGENDA = /(AGENDA|CONFIRMACAO|CANCELAMENTO|CONFLITO|ENCAIXE|ATRASO)/;

function nomeSeguro(contexto = {}) {
  return String(contexto.primeiro_nome || "Cliente").trim().split(/\s+/)[0].slice(0, 40) || "Cliente";
}

function servicoAutorizado(contexto = {}, operacao = {}) {
  const procurado = String(contexto.servico || "").toLowerCase();
  if (!procurado) return null;
  return (operacao.servicos || []).find((s) => {
    const nomes = [s.id, s.nome_publico, s.nome].filter(Boolean).map((v) => String(v).toLowerCase());
    return nomes.some((n) => n === procurado || n.includes(procurado) || procurado.includes(n));
  }) || null;
}

export function gerarBriefingGestora({ decisao = {}, contexto = {}, operacao = {}, clinica = {} }) {
  const regra = String(decisao.regra || "R8.NAO_SABE");
  const nome = nomeSeguro(contexto);
  const servico = servicoAutorizado(contexto, operacao);
  const seguranca = REGRAS_SEGURANCA.test(regra) || decisao.acao === "escalar" && regra.includes("CLINICA");
  const financeiro = REGRAS_FINANCEIRAS.test(regra);
  const agenda = REGRAS_AGENDA.test(regra);

  const briefing = {
    visibilidade: "somente_gestora",
    titulo: seguranca ? "Assumir atendimento agora" : `Preparação comercial — ${nome}`,
    resumo: seguranca
      ? "Há sinal clínico, urgência ou pedido de privacidade. Interrompa a venda e assuma a conversa."
      : financeiro
        ? "A cliente trouxe uma questão financeira. Entenda o limite antes de apresentar apenas condições autorizadas."
        : agenda
          ? "A intenção observada é avançar ou reorganizar a agenda. Preserve confirmação explícita e disponibilidade real."
          : "A intenção ainda precisa ser entendida. Acolha, faça uma pergunta e não antecipe procedimento.",
    intencao_observada: seguranca ? "segurança / atendimento humano" : financeiro ? "objeção ou dúvida financeira" : agenda ? "agendamento" : "descoberta",
    perguntas_sugeridas: seguranca
      ? ["O que aconteceu e desde quando?", "Você consegue falar agora com a responsável?"]
      : financeiro
        ? ["O que pesa mais hoje: o valor total ou a forma de pagamento?", "Você quer entender primeiro a avaliação ou uma condição já autorizada?"]
        : agenda
          ? ["Qual período funciona melhor para você?", "Esse horário pode ser confirmado com um sim explícito?"]
          : ["O que você gostaria de entender ou melhorar neste momento?", "Faz sentido começar por uma avaliação sem compromisso de procedimento?"],
    oportunidades_autorizadas: seguranca ? [] : [
      ...(servico ? [{ tipo: "interesse_declarado", nome: servico.nome_publico || servico.nome, preco_usd: Number.isFinite(servico.preco_usd) ? servico.preco_usd : undefined }] : []),
      { tipo: "proximo_passo", nome: "avaliação com a profissional" },
    ],
    proxima_acao: seguranca ? "Gestora assume; Emily não vende nem orienta clinicamente." : "Gestora revisa o rascunho e escolhe uma pergunta antes da consulta.",
    nao_fazer: [
      "não diagnosticar nem indicar tratamento",
      "não criar desconto, prazo, escassez ou promessa",
      "não explorar insegurança corporal",
      "não encaminhar este bloco à paciente",
    ],
    evidencia: { regra, clinica: clinica.nome_clinica || "clínica configurada", limite: "Baseado na intenção observada e no catálogo; decisão clínica é humana." },
  };
  return briefing;
}

export function briefingComoTexto(b) {
  const oportunidades = (b.oportunidades_autorizadas || []).map((o) => `• ${o.nome}${Number.isFinite(o.preco_usd) ? ` — US$ ${o.preco_usd}` : ""}`);
  return [
    `🔒 ${b.titulo}`,
    b.resumo,
    `Intenção: ${b.intencao_observada}`,
    "Perguntas sugeridas:", ...(b.perguntas_sugeridas || []).map((p) => `• ${p}`),
    ...(oportunidades.length ? ["Oportunidades autorizadas:", ...oportunidades] : []),
    `Próxima ação: ${b.proxima_acao}`,
    `Limite: ${b.evidencia?.limite || "decisão humana"}`,
  ].join("\n");
}
