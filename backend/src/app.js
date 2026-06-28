// Express application: middleware, routes, error handling.
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const integrationRoutes = require('./routes/integrations');

const app = express();

app.set('trust proxy', 1); // correct client IPs behind a proxy (rate limiting)
app.use(helmet());

const corsOptions = config.corsOrigin.includes('*')
  ? { origin: true }
  : { origin: config.corsOrigin };
app.use(cors(corsOptions));

// Generous JSON limit — report payloads may embed base64 screenshots (obsImages).
app.use(express.json({ limit: '25mb' }));

if (config.env !== 'test') app.use(morgan('dev'));

// ── meta / health ────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Sistema de Feedbacks · Método P4 — API',
    status: 'ok',
    endpoints: ['/auth', '/clients', '/users', '/accounts/:accId/reports', '/reports/:id'],
  });
});
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/clients', clientRoutes);
app.use('/users', userRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/integrations', integrationRoutes);
app.use('/', reportRoutes); // /accounts/:accId/reports and /reports/:id

// ── errors ───────────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
