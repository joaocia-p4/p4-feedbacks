// Central error handler + 404. Keeps responses as consistent JSON.
const { AppError } = require('../lib/errors');
const { notifyError } = require('../lib/notify');

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Rota não encontrada', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Unique-constraint violations (sqlite + pg) → 409 with a friendly message.
  const msg = String(err && err.message);
  if (/unique/i.test(msg) || err.code === '23505') {
    return res.status(409).json({ error: 'Registro duplicado.', details: msg });
  }
  // Foreign-key violations (sqlite: "FOREIGN KEY constraint failed" / pg: 23503)
  // → 409. Backstop so a linked record can never be orphaned or 500.
  if (/foreign key/i.test(msg) || err.code === '23503') {
    return res.status(409).json({
      error: 'Não é possível concluir: existem registros vinculados a este item.',
      details: msg,
    });
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  notifyError(`${req.method} ${req.originalUrl}`, err); // alerta (se configurado)
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

module.exports = { notFoundHandler, errorHandler };
