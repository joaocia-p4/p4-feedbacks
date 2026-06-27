// Zod validation middleware. Parsed/coerced values are stored on req.valid so we
// never mutate Express' own req.query/req.params.
const { badRequest } = require('../lib/errors');

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(badRequest('Dados inválidos.', details));
    }
    req.valid = req.valid || {};
    req.valid[source] = result.data;
    next();
  };
}

module.exports = { validate };
