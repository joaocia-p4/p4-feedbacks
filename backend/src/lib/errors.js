// Typed application error + async wrapper so route handlers can throw and the
// central error middleware turns it into a clean JSON response.
class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true; // safe to send to the client
  }
}

const badRequest = (msg, details) => new AppError(400, msg, details);
const unauthorized = (msg = 'Não autenticado') => new AppError(401, msg);
const forbidden = (msg = 'Acesso negado') => new AppError(403, msg);
const notFound = (msg = 'Não encontrado') => new AppError(404, msg);
const conflict = (msg) => new AppError(409, msg);

// Wrap an async handler so rejected promises reach next() (and the error mw).
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  AppError,
  asyncHandler,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
};
