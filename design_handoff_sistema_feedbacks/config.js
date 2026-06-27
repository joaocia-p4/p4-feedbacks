// config.js — configuração de ambiente do front-end.
// Em localhost (ou abrindo o arquivo direto) usa o backend local;
// em produção (site publicado) usa a URL pública do backend no Render.
//
// 👉 Depois de publicar o backend no Render, troque a URL abaixo pela sua,
//    algo como: https://p4-feedbacks-api.onrender.com  (SEM barra no final)
(function () {
  var h = location.hostname;
  var local = h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:';
  window.P4_API_BASE = local
    ? 'http://localhost:4000'
    : 'https://p4-feedbacks-api.onrender.com';
})();
