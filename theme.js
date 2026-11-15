// Applique les réglages d'affichage (thème, taille du texte, animations) avant l'affichage de la page.
// Les réglages sont choisis dans la plateforme (Paramètres) et gardés dans ce navigateur.
(function () {
  var r = {};
  try { r = JSON.parse(localStorage.getItem('cm-reglages') || '{}') || {}; } catch (e) { r = {}; }
  var root = document.documentElement;
  if (r.theme === 'sombre') root.setAttribute('data-theme', 'dark');
  else if (r.theme === 'clair') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  if (r.texte === 'grand') root.setAttribute('data-text', 'grand'); else root.removeAttribute('data-text');
  if (r.animations === 'reduit') root.setAttribute('data-motion', 'reduit'); else root.removeAttribute('data-motion');
})();
