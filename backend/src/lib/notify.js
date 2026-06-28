// Alerta de erros para um webhook (Discord ou Slack) — simples e grátis.
// Sem ERROR_WEBHOOK_URL definido, não faz nada. Nunca lança nem bloqueia a resposta.
// Enviar { content, text } no mesmo corpo funciona para Discord (usa content) e
// Slack (usa text).
let last = 0;

function notifyError(context, err) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return Promise.resolve();
  const now = Date.now();
  if (now - last < 4000) return Promise.resolve(); // throttle: 1 alerta / 4s
  last = now;

  const detail = (err && (err.stack || err.message)) || String(err);
  const msg = `🔴 P4 API — erro\n${context || ''}\n${detail}`.slice(0, 1500);

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: msg, text: msg }),
  }).catch(() => {}); // nunca quebra por causa do alerta
}

module.exports = { notifyError };
