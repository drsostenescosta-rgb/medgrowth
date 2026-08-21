import { createHash } from "node:crypto";
import { briefingComoTexto } from "./briefing-gestora.mjs";
import { enviarWhatsApp } from "./envio.mjs";

export function estadoCanalGestora(config = {}) {
  if (config.habilitado !== true) return { pronto: false, motivo: "canal da gestora desligado" };
  if (config.coexistence_validado !== true) return { pronto: false, motivo: "WhatsApp 360/Coexistence ainda não validado" };
  if (!/^\d{10,15}$/.test(String(config.telefone_gestora || ""))) return { pronto: false, motivo: "telefone da gestora ausente ou inválido" };
  if (!config.phone_number_id || !config.token) return { pronto: false, motivo: "credenciais oficiais do WhatsApp ausentes" };
  return { pronto: true, motivo: "canal configurado e liberado" };
}

export function chaveBriefing({ clinicId, propostaId, telefone }) {
  return createHash("sha256").update(`${clinicId}\n${propostaId}\n${telefone}`).digest("hex").slice(0, 32);
}

export async function notificarGestora({ briefing, clinicId, propostaId, config = {}, jaEnviadas = [], fetchImpl = fetch }) {
  const estado = estadoCanalGestora(config);
  if (!estado.pronto) return { enviado: false, etapa: "preflight", ...estado };
  if (!briefing || briefing.visibilidade !== "somente_gestora") return { enviado: false, etapa: "conteudo", pronto: false, motivo: "briefing privado inválido" };
  const chave = chaveBriefing({ clinicId, propostaId, telefone: config.telefone_gestora });
  if (jaEnviadas.includes(chave)) return { enviado: false, etapa: "idempotencia", pronto: false, motivo: "briefing já enviado", chave };
  const envio = await enviarWhatsApp({ telefone: config.telefone_gestora, texto: briefingComoTexto(briefing), config, fetchImpl });
  return envio.ok ? { enviado: true, etapa: "meta", pronto: true, chave, wamid: envio.wamid } : { enviado: false, etapa: "meta", pronto: false, chave, motivo: envio.motivo };
}
