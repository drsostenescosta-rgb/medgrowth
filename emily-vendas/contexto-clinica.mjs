const CAMPOS = ["clinic_id", "nome_clinica", "nome_humano_responsavel", "fuso_horario"];

export function validarContextoClinica(config = {}) {
  const erros = CAMPOS.filter((c) => !String(config[c] || "").trim()).map((c) => `${c} obrigatório`);
  if (!Array.isArray(config.servicos) || config.servicos.length === 0) erros.push("serviços autorizados obrigatórios");
  if (!config.voz || typeof config.voz !== "object") erros.push("voz da clínica obrigatória");
  return { ok: erros.length === 0, erros };
}

export function criarContextoClinica(config = {}) {
  const validacao = validarContextoClinica(config);
  if (!validacao.ok) throw new Error(`configuração da clínica inválida: ${validacao.erros.join("; ")}`);
  return Object.freeze({
    clinic_id: String(config.clinic_id),
    nome_clinica: String(config.nome_clinica),
    responsavel: String(config.nome_humano_responsavel),
    fuso: String(config.fuso_horario),
    servicos: config.servicos.map((s) => ({ ...s })),
    voz: { ...config.voz },
    politicas: { ...(config.politicas || {}) },
    formas_pagamento: [...(config.formas_pagamento || [])],
  });
}

export function assertMesmoTenant(contexto, clinicIdDoRegistro) {
  if (!contexto?.clinic_id || contexto.clinic_id !== clinicIdDoRegistro) {
    throw new Error("isolamento de clínica: registro pertence a outro tenant");
  }
  return true;
}
