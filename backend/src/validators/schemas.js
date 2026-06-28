// Zod schemas for every request body / query. Also normalizes the prototype's
// looser payloads (e.g. analyst-by-name, marketplaces-as-names).
const { z } = require('zod');
const { AD_MARKETPLACES, WEEKDAYS } = require('../lib/p4');

const TIPOS = ['Loja', 'Marca'];
// 'cs' = Customer Success: somente leitura, enxerga todos os clientes/relatórios.
const PAPEIS = ['admin', 'analista', 'cs'];
const FREQS = ['Semanal', 'Quinzenal', 'Mensal'];

// ── auth / users ─────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(1, 'Informe sua senha'),
});

const createUserSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(6, 'A senha deve ter ao menos 6 caracteres'),
  papel: z.enum(PAPEIS).default('analista'),
});

// Atualização parcial: todos opcionais, mas pelo menos um deve vir.
const updateUserSchema = z
  .object({
    nome: z.string().trim().min(1, 'Nome é obrigatório').optional(),
    email: z.string().trim().toLowerCase().email('E-mail inválido').optional(),
    papel: z.enum(PAPEIS).optional(),
    senha: z.string().min(6, 'A senha deve ter ao menos 6 caracteres').optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

// ── schedule (agenda) ────────────────────────────────────────────────────────
const agendaSchema = z
  .object({
    freq: z.enum(FREQS),
    diaSemana: z.enum(WEEKDAYS).optional(),
    diaMes: z.coerce.number().int().min(1).max(28).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.freq === 'Mensal') {
      if (a.diaMes == null) {
        ctx.addIssue({ code: 'custom', path: ['diaMes'], message: 'diaMes (1–28) é obrigatório para frequência Mensal.' });
      }
    } else if (!a.diaSemana) {
      ctx.addIssue({ code: 'custom', path: ['diaSemana'], message: 'diaSemana é obrigatório para Semanal/Quinzenal.' });
    }
  });

// ── accounts (contas) ────────────────────────────────────────────────────────
const contaSchema = z.object({
  id: z.string().optional(), // conta existente (na edição); ausente = nova
  marketplace: z.enum(AD_MARKETPLACES),
  // the prototype field is "conta"; accept "apelido" too
  apelido: z.string().trim().optional(),
  conta: z.string().trim().optional(),
  // metas são opcionais: podem ficar em branco ("" = sem meta definida)
  metaInvestimento: z.string().trim().default(''),
  metaRoas: z.string().trim().default(''),
  metaAcos: z.string().trim().default(''),
  metaTacos: z.string().trim().default(''),
});

// ── clients ──────────────────────────────────────────────────────────────────
const createClientSchema = z
  .object({
    loja: z.string().trim().min(1, 'Nome do cliente é obrigatório'),
    tipo: z.enum(TIPOS).default('Loja'),
    analistaId: z.string().trim().optional(),
    analista: z.string().trim().optional(), // analyst name (prototype fallback)
    contas: z.array(contaSchema).optional(),
    marketplaces: z.array(z.enum(AD_MARKETPLACES)).optional(), // names-only fallback
    agenda: agendaSchema,
    observacoes: z.string().optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.analistaId && !b.analista) {
      ctx.addIssue({ code: 'custom', path: ['analistaId'], message: 'Informe o analista responsável.' });
    }
    const hasContas = (b.contas && b.contas.length) || (b.marketplaces && b.marketplaces.length);
    if (!hasContas) {
      ctx.addIssue({ code: 'custom', path: ['contas'], message: 'Inclua ao menos um marketplace.' });
    }
  });

const updateClientSchema = z.object({
  loja: z.string().trim().min(1).optional(),
  tipo: z.enum(TIPOS).optional(),
  analistaId: z.string().trim().optional(),
  analista: z.string().trim().optional(),
  contas: z.array(contaSchema).optional(),
  marketplaces: z.array(z.enum(AD_MARKETPLACES)).optional(),
  agenda: agendaSchema.optional(),
  observacoes: z.string().optional(),
});

// ── list clients query ───────────────────────────────────────────────────────
const listClientsQuery = z
  .object({
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'due deve estar no formato YYYY-MM-DD')
      .optional(),
    q: z.string().optional(),
    marketplace: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

// ── report (generator payload) ───────────────────────────────────────────────
// Stored whole; we only require it to be a JSON object. Known fields are typed
// loosely so both strings and numbers from the generator are accepted.
const reportPayloadSchema = z
  .object({
    marketplace: z.string().optional(),
    periodoIni: z.string().optional(),
    periodoFim: z.string().optional(),
    criadoEm: z.string().optional(),
  })
  .passthrough()
  .refine((v) => v && typeof v === 'object' && !Array.isArray(v), {
    message: 'O corpo deve ser o objeto JSON exportado pelo gerador.',
  });

module.exports = {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  agendaSchema,
  contaSchema,
  createClientSchema,
  updateClientSchema,
  listClientsQuery,
  reportPayloadSchema,
  TIPOS,
  PAPEIS,
  FREQS,
};
