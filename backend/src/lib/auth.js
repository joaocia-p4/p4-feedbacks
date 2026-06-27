// Authentication primitives: password hashing (bcrypt) and JWT sign/verify.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

const SALT_ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}
function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash || '');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, papel: user.papel, email: user.email, nome: user.nome },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}
function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

// Two initials from a name (e.g. "Ana Prado" → "AP").
function initials(nome) {
  const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Strip sensitive fields before sending a user to the client.
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    papel: row.papel,
    iniciais: row.iniciais || initials(row.nome),
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  initials,
  publicUser,
};
