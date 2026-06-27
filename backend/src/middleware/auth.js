// Auth middleware: verify the Bearer token, load the (still-existing) user, and
// gate admin-only routes.
const db = require('../db/knex');
const { verifyToken } = require('../lib/auth');
const { unauthorized, forbidden, asyncHandler } = require('../lib/errors');

const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw unauthorized('Token ausente. Envie o header Authorization: Bearer <token>.');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (_e) {
    throw unauthorized('Token inválido ou expirado.');
  }

  // Re-load from DB so revoked/edited accounts can't keep using an old token.
  const user = await db('users').where({ id: payload.sub }).first();
  if (!user) throw unauthorized('Usuário não encontrado.');

  req.user = { id: user.id, nome: user.nome, email: user.email, papel: user.papel };
  next();
});

function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.papel !== 'admin') {
    return next(forbidden('Esta ação é restrita a administradores.'));
  }
  next();
}

// Gerenciar clientes/relatórios: admin ou analista. Bloqueia CS (somente leitura).
function requireManager(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.papel !== 'admin' && req.user.papel !== 'analista') {
    return next(forbidden('Seu perfil é somente leitura.'));
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireManager };
