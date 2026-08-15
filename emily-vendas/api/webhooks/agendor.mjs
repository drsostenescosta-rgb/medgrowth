// /webhooks/agendor — o vercel.json reescreve /webhooks/* para cá.
// A rota exige assinatura HMAC (agendor.mjs); POST sem assinatura é 401.
export { default } from "../_ponte.mjs";
