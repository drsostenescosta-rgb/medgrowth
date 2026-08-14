// redaction.mjs — scanner fail-closed de dado sensível.
//
// Limite honesto, e ele está escrito também no painel e no kit de operação:
// este scanner reconhece FORMATOS (e-mail, telefone, SSN, data de nascimento). Ele NÃO sabe
// reconhecer que "Larissa Mendes de Souza" é o nome de uma pessoa — isso exigiria lista de nomes
// e ainda erraria. Portanto ele reduz risco; não garante ausência de dado real. Quem promete
// "nenhum dado real entra" está mentindo; o que se promete é: o sistema recusa os formatos
// abaixo, e a instrução para quem opera é não digitar dado real.
//
// Rodada de 14/08 (auditoria do Sheldon Pai): a versão anterior só pegava telefone COM separador
// no meio (`\d{3}[-. ]\d{4}`), que é justamente o formato que menos gente digita. Passavam
// `5083341234`, `+55 11 987654321` e `123-45-6789`. Corrigido abaixo.

const CAMPO_PII = /(?:^|_)(?:nome_cliente|nome_paciente|sobrenome|telefone|celular|email|e_mail|cpf|ssn|nascimento|endereco_cliente|address_cliente|patient|paciente|cliente)(?:$|_)/i;
const CAMPO_CLINICO_LIVRE = /(?:sintoma|sintomas|diagnostico|diagnóstico|anamnese|historico|histórico|medicacao|medicação|alergia|queixa|prontuario|prontuário|observacao|observação|nota|texto_livre|mensagem_livre)/i;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

// Telefone com separadores: 508-334-1234, (508) 334 1234, 555.555.1212
const TELEFONE_SEPARADO = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3}[\s.-]\d{4}\b/;
// Telefone corrido: 5083341234, 11987654321 — 10 a 13 dígitos seguidos.
const TELEFONE_CORRIDO = /(?<!\d)\d{10,13}(?!\d)/;
// Internacional com prefixo: +55 11 98765 4321, +1 508 334 1234
const TELEFONE_INTERNACIONAL = /\+\d{1,3}[\s.-]?\d[\d\s.-]{7,}/;
// SSN dos EUA — a clínica é em Massachusetts.
const SSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/;
// Data de nascimento escrita à mão: 12/03/1988, 3-7-90.
const DATA_NASCIMENTO = /(?<![\d-])\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?![\d-])/;

const PADROES_TEXTO = [
  [EMAIL, "EMAIL_ENCONTRADO"],
  [TELEFONE_SEPARADO, "TELEFONE_ENCONTRADO"],
  [TELEFONE_CORRIDO, "TELEFONE_ENCONTRADO"],
  [TELEFONE_INTERNACIONAL, "TELEFONE_ENCONTRADO"],
  [SSN, "SSN_ENCONTRADO"],
  [DATA_NASCIMENTO, "DATA_ENCONTRADA"],
];

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
    // Timestamps ISO são estruturais e não são dado pessoal — não podem derrubar a gravação.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor.trim())) return;
    const vistos = new Set();
    for (const [padrao, codigo] of PADROES_TEXTO) {
      if (padrao.test(valor) && !vistos.has(codigo)) {
        vistos.add(codigo);
        achados.push({ codigo, caminho });
      }
    }
  }
}

export function escanearDadosSensiveis(dados) {
  const achados = [];
  visitar(dados, "", achados);
  return achados;
}

export function exigirSomenteSintetico(dados) {
  const achados = escanearDadosSensiveis(dados);
  if (achados.length) throw new Error(`DADOS_SENSIVEIS_REPROVADOS: ${achados.map((item) => `${item.codigo}:${item.caminho}`).join(", ")}`);
}

/** Alias sintético estrito — em modo sintético, identificador de pessoa só pode ser este formato. */
export const PADRAO_ALIAS_SINTETICO = /^(?:Cliente|Paciente) Demo \d{2}$/;
export function validarAliasSintetico(valor) {
  return PADRAO_ALIAS_SINTETICO.test(String(valor || "").trim());
}
