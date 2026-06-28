// Criptografia simétrica (AES-256-GCM) para guardar segredos sensíveis no banco
// — em especial os tokens OAuth do Mercado Livre. A chave vem de ENCRYPTION_KEY.
//
// Compatível com dados legados: valores sem o prefixo "enc:v1:" são tratados como
// texto puro (migram para criptografado no próximo save). Sem ENCRYPTION_KEY
// definida (ex.: desenvolvimento), não criptografa — mantém o zero-config local.
const crypto = require('crypto');

const ALG = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function key() {
  const raw = process.env.ENCRYPTION_KEY || '';
  if (!raw) return null;
  // Aceita 64 hex (32 bytes) ou qualquer string (derivada via SHA-256 → 32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plain) {
  if (plain == null) return plain;
  const k = key();
  if (!k) return String(plain); // sem chave → não criptografa
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, k, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(value) {
  if (value == null) return value;
  const s = String(value);
  if (!s.startsWith(PREFIX)) return s; // legado / texto puro
  const k = key();
  if (!k) return s; // sem chave não há como decifrar
  try {
    const raw = Buffer.from(s.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALG, k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (_e) {
    return s;
  }
}

module.exports = { encrypt, decrypt };
