// /users — admin-managed accounts (the README's "Gerenciar usuários").
const express = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { createUserSchema, updateUserSchema } = require('../validators/schemas');
const { asyncHandler } = require('../lib/errors');
const userService = require('../services/userService');

const router = express.Router();

router.use(authenticate, requireAdmin);

// GET /users
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ users: await userService.listUsers() });
  })
);

// POST /users
router.post(
  '/',
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const user = await userService.createUser(req.valid.body);
    res.status(201).json({ user });
  })
);

// PUT /users/:id
router.put(
  '/:id',
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.params.id, req.valid.body);
    res.json({ user });
  })
);

// DELETE /users/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await userService.deleteUser(req.params.id, req.user.id);
    res.json({ ok: true, ...result });
  })
);

module.exports = router;
