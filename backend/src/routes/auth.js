// /auth — login, logout, current user.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { loginSchema } = require('../validators/schemas');
const { asyncHandler, unauthorized } = require('../lib/errors');
const { comparePassword, signToken, publicUser } = require('../lib/auth');
const userService = require('../services/userService');

const router = express.Router();

// Constant dummy hash compared against when an e-mail doesn't exist, so login
// always pays the same bcrypt cost (no timing-based user enumeration).
const DUMMY_HASH = bcrypt.hashSync('p4-nonexistent-user', 10);

// Throttle credential-guessing: 20 attempts / 15 min per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

// POST /auth/login → { token, user }
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, senha } = req.valid.body;
    const user = await userService.findByEmail(email);
    // Always run a bcrypt compare (dummy hash when the user is absent) so the
    // response time can't reveal whether an e-mail exists.
    const ok = await comparePassword(senha, user ? user.senha_hash : DUMMY_HASH);
    if (!user || !ok) throw unauthorized('E-mail ou senha inválidos.');
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

// POST /auth/logout → stateless JWT; client just discards the token.
router.post('/logout', (_req, res) => res.json({ ok: true }));

// GET /auth/me → the authenticated user.
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

module.exports = router;
