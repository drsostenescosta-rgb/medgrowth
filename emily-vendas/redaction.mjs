const CAMPO_PII = /(?:^|_)(?:nome_cliente|nome_paciente|sobrenome|telefone|celular|email|e_mail|cpf|ssn|nascimento|endereco_cliente|address_cliente|patient|paciente|cliente)(?:$|_)/i;
const CAMPO_CLINICO_LIVRE = /(?:sintoma|sintomas|diagnostico|diagnóstico|anamnese|historico|histórico|medicacao|medicação|alergia|queixa|prontuario|prontuário|observacao|observação|nota|texto_livre|mensagem_livre)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const TELEFONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3}[\s.-]\d{4}\b/;

function visitar(valor, caminho, achados) {
  if (Array.isArray(valor)) return valor.forEach((item, indice) => visitar(item, `${caminho}[${indice}]`, achados));
  if (valor && typeof valor === "object") {
    for (const [chave, item] of Object.entries(valor)) {
      const proximo = caminho ? `${caminho}.${chave}` : chave;
      if (CAMPO_PII.test(chave)) achados.push({ codigo: "CAMPO_PII", caminho: proximo });
      if (CAMPO_CLINICO_LIVRE.test(chave)) achados.push({ codigo: "CAMPO_CLINICO_LIVRE", caminho: proximo });
      visitar(item, proximo, achados);
    }
  } else if (typeof valor === "string") {
    if (EMAIL.test(valor)) achados.push({ codigo: "EMAIL_ENCONTRADO", caminho });
    if (TELEFONE.test(valor)) achados.push({ codigo: "TELEFONE_ENCONTRADO", caminho });
  }
}

export function escanearDadosSensiveis(dados) { const achados = []; visitar(dados, "", achados); return achados; }
export function exigirSomenteSintetico(dados) {
  const achados = escanearDadosSensiveis(dados);
  if (achados.length) throw new Error(`DADOS_SENSIVEIS_REPROVADOS: ${achados.map((item) => `${item.codigo}:${item.caminho}`).join(", ")}`);
}
