// ChantierMarket — plateforme de simulation
// Tout fonctionne dans le navigateur : aucune donnée n'est envoyée, aucun paiement n'est réel.
// Les règles reprennent la fiche « V1 Infos ChantierMarket » : commission 12 %, versement 48 h,
// réclamation 48 h, livraison 30 km autour de Lorient, rétractation 14 jours, Premium 14,90 € HT, publicité 80 € HT (Wikicréa).
'use strict';

(function () {
  const KEY = 'chantiermarket-simulation-v2';
  const SETTINGS_KEY = 'cm-reglages';
  const DEMO_PWD = 'demo1234';
  const H = 3600e3;
  const D = 24 * H;
  const COMMISSION = 0.12;
  const TVA = 0.2;
  const PREMIUM_HT = 14.9; // sans publicité + livraison prioritaire (Wikicréa)
  const AD_HT = 80; // espace publicitaire, par mois et par annonceur (Wikicréa)
  const DELIVERY_SHARE = 0.15; // part du tarif de livraison gardée par ChantierMarket (Wikicréa)

  const CATEGORIES = [
    'Gros œuvre',
    'Bois et charpente',
    'Isolation et plâtrerie',
    'Carrelage et revêtements',
    'Plomberie et électricité',
    'Menuiseries',
    'Outillage et matériel de chantier'
  ];
  const UNITS = ['unités', 'm²', 'm³', 'mètres', 'kg', 'sacs', 'rouleaux', 'plaques', 'barres', 'palettes', 'lots'];
  const ETATS = ['Neuf', 'Très bon', 'Bon'];
  // Position approximative des communes en km (est, nord) par rapport à Lorient.
  const COMMUNES = {
    'Lorient': [0, 0], 'Lanester': [3, 2], 'Ploemeur': [-5, -2], 'Larmor-Plage': [-3, -5],
    'Quéven': [-4, 4], 'Caudan': [2, 7], 'Hennebont': [8, 7], 'Port-Louis': [4, -6],
    'Guidel': [-10, 3], 'Plouay': [-3, 17], 'Quimperlé': [-17, 11], 'Auray': [35, -4]
  };

  const STATUS = {
    payee: ['Payée', 'info'],
    transport: ['En livraison', 'info'],
    livree: ['Livrée, à confirmer', 'warn'],
    recue: ['Réception confirmée', 'ok'],
    versee: ['Terminée', 'ok'],
    litige: ['Réclamation en cours', 'alert'],
    annulee: ['Annulée', 'muted'],
    remboursee: ['Remboursée', 'muted'],
    retractee: ['Rétractation', 'muted']
  };

  let state;
  let storageOk = true;
  const ui = { q: '', cat: '', maxKm: '', sort: 'distance', vue: 'liste', commune: '', ordersTab: '', viewed: {}, after: '', loginReason: '', forgot: '', forgotEmail: '', forgotCode: '' };
  let draftPhotos = [];

  /* ---------- Outils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
  const r2 = (n) => Math.round(n * 100) / 100;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const now = () => Date.now() + state.offset;
  const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDay = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const since = (t) => {
    const d = now() - t;
    if (d < H) return "il y a moins d'une heure";
    if (d < D) return `il y a ${Math.floor(d / H)} h`;
    return `il y a ${Math.floor(d / D)} j`;
  };
  const dist = (a, b) => {
    if (a === b) return 2;
    const p = COMMUNES[a] || [0, 0];
    const q = COMMUNES[b] || [0, 0];
    return Math.round(Math.hypot(p[0] - q[0], p[1] - q[1]) * 1.25 * 10) / 10;
  };
  const inZone = (c) => dist(c, 'Lorient') <= 30;
  const feeHT = (km) => (km <= 10 ? 29 : km <= 20 ? 45 : km <= 30 ? 59 : null);
  const user = (id) => state.users.find((u) => u.id === id);
  const me = () => (state.current ? user(state.current) || null : null);
  const myCommune = () => (me() && me().commune) || 'Lorient';
  // Empreinte du mot de passe (simulation : les mots de passe ne quittent jamais ce navigateur)
  const hash = (str) => {
    let h1 = 0xdeadbeef ^ 7;
    let h2 = 0x41c6ce57 ^ 7;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };
  const pwdHash = (email, pwd) => hash(`cm:${String(email).toLowerCase()}:${pwd}`);
  const dayLabel = (t) => {
    const d = new Date(t);
    const n = new Date(now());
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (sameDay(d, n)) return `Aujourd'hui, ${hm}`;
    const y = new Date(n);
    y.setDate(n.getDate() - 1);
    if (sameDay(d, y)) return `Hier, ${hm}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };
  const daysLeft = (l) => Math.ceil((l.deadline - now()) / D);
  const urgent = (l) => l.status === 'en-ligne' && daysLeft(l) <= 4;
  const deadlineBadge = (l) => {
    const n = daysLeft(l);
    if (l.status !== 'en-ligne') return '';
    if (n <= 0) return '<span class="chip chip-urgent">Dernier jour</span>';
    if (n === 1) return '<span class="chip chip-urgent">À retirer avant demain</span>';
    if (n <= 4) return `<span class="chip chip-urgent">Plus que ${n} jours</span>`;
    return '';
  };
  const isFav = (id) => !!(me() && (me().favs || []).includes(+id));

  /* Réglages d'affichage, propres à ce navigateur */
  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* stockage indisponible : réglage gardé pour cette visite */ }
    const root = document.documentElement;
    if (s.theme === 'sombre') root.setAttribute('data-theme', 'dark');
    else if (s.theme === 'clair') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    if (s.texte === 'grand') root.setAttribute('data-text', 'grand'); else root.removeAttribute('data-text');
    if (s.animations === 'reduit') root.setAttribute('data-motion', 'reduit'); else root.removeAttribute('data-motion');
  }
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const defaultPrefs = () => ({ notif: { commande: true, message: true, alerte: true, actus: false }, canaux: { email: true, sms: true }, rayon: '', telephone: true });
  const lotById = (id) => state.lots.find((l) => l.id === +id);
  const orderById = (id) => state.orders.find((o) => o.id === +id);
  const typeLabel = (u) => ({ pro: 'Entreprise', particulier: 'Particulier', admin: 'Administration' }[u.type]);
  const isPremium = (id) => !!(user(id) && user(id).premium);
  const discount = (l) => Math.round((1 - l.price / l.neuf) * 100);
  const total = (o) => r2(o.price + o.feeHT * (1 + TVA));
  const qty = (l) => `${l.qty.toLocaleString('fr-FR')} ${l.unit}`;

  function avatar(u, size = '') {
    const ini = u.name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<span class="avatar-sm avatar-${u.type} ${size}" aria-hidden="true">${esc(ini)}</span>`;
  }

  // Photos réelles (Wikimedia Commons, licences libres : voir credits-photos.html)
  const P = (name) => `assets/photos/${name}.jpg`;
  const SEED_PHOTOS = { 1: 'parpaings', 2: 'fers', 3: 'carrelage', 4: 'laine', 5: 'bastaings', 6: 'fenetre', 7: 'platre', 8: 'betonniere',
    9: 'per', 10: 'treillis', 11: 'osb', 12: 'rails', 13: 'dalles', 14: 'tuiles' };
  const CAT_PHOTOS = ['parpaings', 'bastaings', 'laine', 'carrelage', 'per', 'fenetre', 'betonniere'];
  const catPhoto = (category) => P(CAT_PHOTOS[Math.max(0, CATEGORIES.indexOf(category))]);

  function photo(l, cls) {
    const src = l.photos && l.photos.length ? l.photos[0] : catPhoto(l.category);
    return `<img class="${cls}" src="${src}" alt="${esc(l.title)}" loading="lazy">`;
  }

  function sellerStats(id) {
    const rated = state.orders.filter((o) => o.sellerId === id && o.rating);
    const sales = state.orders.filter((o) => o.sellerId === id && ['recue', 'versee'].includes(o.status)).length;
    const avg = rated.length ? rated.reduce((s, o) => s + o.rating.stars, 0) / rated.length : 0;
    return { count: rated.length, avg, sales };
  }
  const isSuspended = (id) => { const s = sellerStats(id); return s.sales >= 10 && s.count > 0 && s.avg < 3; };
  function ratingText(id) {
    const s = sellerStats(id);
    if (!s.count) return '<span class="muted">Pas encore d\'avis</span>';
    return `<span class="stars" aria-hidden="true">${'★'.repeat(Math.round(s.avg))}${'☆'.repeat(5 - Math.round(s.avg))}</span> ${s.avg.toFixed(1).replace('.', ',')}/5 (${s.count} avis)`;
  }

  // cat : commande, message, alerte, actus, compte (toujours envoyée)
  function notify(userId, text, link = '', at = null, cat = 'commande') {
    const u = user(userId);
    if (u && u.prefs && cat !== 'compte' && u.prefs.notif && u.prefs.notif[cat] === false) return;
    state.notifs.push({ id: state.next.notif++, userId, text, link, at: at || now(), read: false, cat });
  }
  function addEvent(o, text, at = null) { o.events.push({ at: at || now(), text }); }

  /* ---------- Données de démonstration ---------- */
  function seed() {
    const t0 = Date.now();
    const at = (h) => t0 - h * H;
    const s = {
      version: 2, offset: 0, current: null,
      next: { lot: 100, order: 1006, msg: 10, notif: 1, alert: 3, req: 2, report: 1 },
      users: [], lots: [], orders: [], messages: [], alerts: [], notifs: [], requests: [], reports: []
    };
    s.users = [
      { id: 'u1', name: 'Kerbâti Construction', type: 'pro', roles: ['vendeur', 'acheteur'], commune: 'Lanester', siret: '90011122200014', kbis: true,
        email: 'achats@kerbati.example', phone: '02 61 91 00 11', address: 'Dépôt Kerbâti, rue des Fondeurs (fictif)',
        about: 'Entreprise de gros œuvre, 25 salariés. Vend ses surplus de fin de chantier et achète du matériel d\'occasion.',
        premium: true, premiumSince: at(40 * 24), renewAt: at(40 * 24) + 60 * D, monthsPaid: 2, cancelled: false },
      { id: 'u2', name: 'Atelier Plâtre & Isolation', type: 'pro', roles: ['acheteur'], commune: 'Hennebont', siret: '90022233300021', kbis: true,
        email: 'contact@atelier-platre.example', phone: '02 61 91 00 22', address: 'Atelier, 4 impasse des Plâtriers (fictif)',
        about: 'Artisan plaquiste, 2 salariés. Cherche des matériaux moins chers pour ses petits chantiers.', premium: false },
      { id: 'u3', name: 'MatériOuest Fournitures', type: 'pro', roles: ['vendeur'], commune: 'Caudan', siret: '90033344400035', kbis: true,
        email: 'ventes@materiouest.example', phone: '02 61 91 00 33', address: 'Entrepôt MatériOuest, ZA des Quatre Vents (fictif)',
        about: 'Fournisseur de matériaux. Écoule ses fins de série et ses invendus.', premium: false },
      { id: 'u4', name: 'Sophie L.', type: 'particulier', roles: ['acheteur'], commune: 'Ploemeur', emailVerified: true, phoneVerified: true, idVerified: false,
        email: 'sophie.l@courriel.example', phone: '06 39 98 00 44', address: '12 rue des Goélands (fictif)',
        about: 'Rénove sa maison avec un petit budget.' },
      { id: 'u5', name: 'Marc D.', type: 'particulier', roles: ['vendeur', 'acheteur'], commune: 'Quéven', emailVerified: true, phoneVerified: true, idVerified: false,
        email: 'marc.d@courriel.example', phone: '06 39 98 00 55', address: '3 chemin du Moulin (fictif)',
        about: 'A terminé l\'extension de sa maison et veut revendre ses surplus.' },
      { id: 'admin', name: 'Équipe ChantierMarket', type: 'admin', roles: [], commune: 'Lorient', email: 'equipe@chantiermarket.example',
        about: 'Valide les annonces, traite les réclamations et suit l\'activité de la plateforme.' }
    ];
    const joined = { u1: 400, u2: 200, u3: 320, u4: 45, u5: 30, admin: 500 };
    s.users.forEach((u) => {
      u.pwd = pwdHash(u.email, DEMO_PWD);
      u.createdAt = at(joined[u.id] * 24);
      u.favs = { u2: [7], u4: [3, 6] }[u.id] || [];
      u.prefs = defaultPrefs();
    });

    const lot = (id, sellerId, title, cat, q, unit, etat, price, neuf, weight, hAgo, description, status = 'en-ligne') => {
      const seller = s.users.find((u) => u.id === sellerId);
      s.lots.push({ id, sellerId, title, category: CATEGORIES[cat], qty: q, unit, etat, price, neuf, weight, commune: seller.commune,
        address: seller.address, deadline: at(hAgo) + 21 * D, description, photos: [], examplePhotos: true, status, createdAt: at(hAgo) });
    };
    lot(1, 'u1', 'Parpaings creux 20×20×50', 0, 120, 'unités', 'Neuf', 216, 336, 2400, 30, 'Reste de commande d\'un chantier de maison individuelle. Sur palettes filmées, stockés à l\'abri.');
    lot(2, 'u1', 'Fers à béton HA10, barres de 6 m', 0, 35, 'barres', 'Très bon', 95, 160, 130, 52, 'Barres droites, légère oxydation de surface sans perte de section.');
    lot(3, 'u3', 'Carrelage grès cérame 60×60 gris clair', 3, 18, 'm²', 'Neuf', 252, 504, 414, 20, 'Fin de série, cartons d\'origine. Même bain de fabrication.');
    lot(4, 'u3', 'Laine de verre 100 mm en rouleaux', 2, 12, 'rouleaux', 'Neuf', 168, 288, 96, 70, 'Emballages d\'origine non ouverts. R = 3,15.');
    lot(5, 'u1', 'Bastaings sapin 63×175, longueur 4 m', 1, 20, 'unités', 'Bon', 180, 340, 440, 96, 'Bois de coffrage réutilisable, quelques traces de béton.');
    lot(6, 'u3', 'Fenêtres PVC 2 vantaux 115×125', 5, 2, 'unités', 'Neuf', 380, 760, 60, 12, 'Commandées avec une erreur de cote. Double vitrage, blanches.');
    lot(7, 'u3', 'Plaques de plâtre BA13 250×120', 2, 30, 'plaques', 'Neuf', 165, 270, 750, 6, 'Palette complète, stockée au sec.');
    lot(8, 'u1', 'Bétonnière électrique 160 L', 6, 1, 'unités', 'Bon', 140, 320, 55, 120, 'Fonctionne bien, cuve un peu marquée. Remplacée par un modèle plus grand.');
    lot(9, 'u1', 'Tube PER 16 mm, couronnes de 100 m', 4, 3, 'rouleaux', 'Neuf', 90, 165, 15, 40, 'Couronnes non entamées.');
    // Lots déjà vendus (commandes de démonstration)
    lot(10, 'u3', 'Treillis soudé ST25C, panneaux 2,40 × 6 m', 0, 15, 'unités', 'Neuf', 150, 260, 300, 260, 'Panneaux neufs.', 'vendu');
    lot(11, 'u1', 'Panneaux OSB 12 mm', 1, 10, 'plaques', 'Bon', 80, 150, 180, 420, 'Quelques coins abîmés, visibles sur les photos.', 'vendu');
    lot(12, 'u1', 'Rails et montants métalliques 48 mm', 2, 60, 'unités', 'Neuf', 120, 210, 90, 60, 'Longueur 3 m, en bottes.', 'vendu');
    lot(13, 'u1', 'Dalles de terrasse grès 40×40', 3, 12, 'm²', 'Très bon', 96, 190, 290, 90, 'Dalles posées à sec puis déposées, propres.', 'vendu');
    lot(14, 'u1', 'Tuiles mécaniques terre cuite', 0, 150, 'unités', 'Bon', 75, 180, 450, 30, 'Tuiles de dépose, triées.', 'vendu');
    // Lots à retirer bientôt : la rubrique « Dernière chance », comme les paniers à sauver
    s.lots.forEach((l) => { if (SEED_PHOTOS[l.id]) { l.photos = [P(SEED_PHOTOS[l.id])]; l.examplePhotos = false; } });
    const soon = { 8: 1, 6: 2, 2: 3, 9: 4 };
    s.lots.forEach((l) => { if (soon[l.id]) l.deadline = t0 + soon[l.id] * D - 2 * H; l.vues = 6 + ((l.id * 37) % 90); });

    const order = (id, lotId, buyerId, mode, pay, times, status, extra = {}) => {
      const l = s.lots.find((x) => x.id === lotId);
      const buyer = s.users.find((u) => u.id === buyerId);
      const km = dist(l.commune, buyer.commune);
      const o = { id, lotId, buyerId, sellerId: l.sellerId, price: l.price, mode, km, feeHT: mode === 'livraison' ? feeHT(km) : 0, pay,
        status, times, events: [], refund: 0, payout: 0, ...extra };
      o.events.push({ at: times.paid, text: `Paiement de ${money(total(o))} par ${pay === 'carte' ? 'carte bancaire' : 'virement'}. Les fonds sont conservés par le prestataire de paiement.` });
      if (times.transport) o.events.push({ at: times.transport, text: 'Lot pris en charge par le transporteur partenaire.' });
      if (times.delivered) o.events.push({ at: times.delivered, text: 'Lot livré au pied du véhicule.' });
      if (times.received) o.events.push({ at: times.received, text: mode === 'retrait' ? 'Lot retiré par l\'acheteur sur place.' : 'Réception confirmée par l\'acheteur.' });
      if (times.paidOut) {
        o.payout = r2(o.price * (1 - COMMISSION));
        o.events.push({ at: times.paidOut, text: `Paiement de ${money(o.payout)} versé au vendeur (prix moins 12 % de commission).` });
      }
      s.orders.push(o);
      return o;
    };
    order(1001, 10, 'u1', 'livraison', 'virement', { paid: at(240), transport: at(216), delivered: at(192), received: at(190), paidOut: at(142) }, 'versee',
      { rating: { stars: 5, comment: 'Lot conforme à l\'annonce, livraison à l\'heure.', at: at(189) } });
    order(1002, 11, 'u2', 'retrait', 'carte', { paid: at(400), received: at(398), paidOut: at(350) }, 'versee',
      { rating: { stars: 4, comment: 'Bon état, coins abîmés comme indiqué dans l\'annonce.', at: at(397) } });
    order(1003, 12, 'u2', 'livraison', 'carte', { paid: at(46), transport: at(22) }, 'transport');
    const o4 = order(1004, 13, 'u4', 'livraison', 'carte', { paid: at(80), transport: at(56), delivered: at(32) }, 'litige',
      { claim: { text: 'Trois dalles sont fendues à la livraison. J\'ai pris des photos devant le livreur.', at: at(20), photos: 2 } });
    o4.events.push({ at: at(20), text: 'Réclamation déposée par l\'acheteur. Le versement au vendeur est bloqué pendant l\'examen.' });
    order(1005, 14, 'u5', 'retrait', 'carte', { paid: at(3) }, 'payee');

    s.messages = [
      { id: 1, lotId: 3, from: 'u2', to: 'u3', text: 'Bonjour, le carrelage est-il encore disponible ? Je pourrais passer le récupérer samedi matin.', at: at(10) },
      { id: 2, lotId: 3, from: 'u3', to: 'u2', text: 'Bonjour, oui il est disponible. Le dépôt est ouvert le samedi de 8 h à 12 h.', at: at(9) },
      { id: 3, lotId: 14, from: 'u5', to: 'u1', text: 'Bonjour, je passe chercher les tuiles demain vers 10 h, ça vous va ?', at: at(2) }
    ];
    s.alerts = [
      { id: 1, userId: 'u2', q: 'plâtre', cat: 'Isolation et plâtrerie', max: 250 },
      { id: 2, userId: 'u4', q: 'carrelage', cat: '', max: 300 }
    ];
    s.requests = [
      { id: 1, userId: 'u1', address: 'Chantier rue de la Corderie, Lanester (fictif)', volume: '8 m³', types: 'Chutes de bois, gravats propres, emballages', wish: at(-72), status: 'demandee', createdAt: at(5) }
    ];
    const n = (userId, text, link, h) => s.notifs.push({ id: s.next.notif++, userId, text, link, at: at(h), read: false });
    n('u2', 'Votre commande CM-1003 est en route : livraison prévue demain.', '#commande-1003', 22);
    n('u1', 'Nouvelle commande CM-1005 : « Tuiles mécaniques terre cuite » par Marc D. (retrait sur place).', '#commande-1005', 3);
    n('u1', 'Réclamation sur la commande CM-1004 : le versement est bloqué pendant l\'examen.', '#commande-1004', 20);
    n('u1', 'Nouveau message de Marc D. à propos de « Tuiles mécaniques terre cuite ».', '#messages-14-u5', 2);
    n('u3', 'Nouveau message de Atelier Plâtre & Isolation à propos de « Carrelage grès cérame 60×60 gris clair ».', '#messages-3-u2', 10);
    n('admin', 'Nouvelle réclamation sur la commande CM-1004 (Sophie L.).', '#commande-1004', 20);
    n('admin', 'Nouvelle demande d\'enlèvement de Kerbâti Construction.', '#admin', 5);
    n('u4', 'Votre réclamation sur la commande CM-1004 est en cours d\'examen. Réponse sous 5 jours ouvrés.', '#commande-1004', 20);
    return s;
  }

  /* ---------- Sauvegarde ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 2) {
          // Simulations commencées avant l'ajout des photos : on les ajoute aux lots de démonstration
          s.lots.forEach((l) => { if (SEED_PHOTOS[l.id] && (!l.photos || !l.photos.length)) { l.photos = [P(SEED_PHOTOS[l.id])]; l.examplePhotos = false; } });
          return s;
        }
      }
    } catch (e) { storageOk = false; }
    return seed();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) {
      storageOk = false;
      toast('Le navigateur n\'a pas pu enregistrer la simulation (stockage plein ou bloqué). Retirez des photos ou réinitialisez.');
    }
  }

  /* ---------- Horloge et automatismes ---------- */
  function confirmReception(o, at, how) {
    o.status = 'recue';
    o.times.received = at;
    addEvent(o, how, at);
    notify(o.sellerId, `Réception confirmée pour la commande CM-${o.id}. Votre paiement sera versé sous 48 h.`, `#commande-${o.id}`, at);
  }
  function payout(o, at) {
    o.status = 'versee';
    o.times.paidOut = at;
    o.payout = r2((o.price - o.refund) * (1 - COMMISSION));
    addEvent(o, `Paiement de ${money(o.payout)} versé au vendeur (prix moins 12 % de commission).`, at);
    notify(o.sellerId, `Paiement de ${money(o.payout)} versé pour la commande CM-${o.id}.`, `#commande-${o.id}`, at);
  }

  function tick() {
    const t = now();
    let changed = false;
    for (const o of state.orders) {
      if (o.mode === 'livraison') {
        if (o.status === 'payee' && t >= o.times.paid + (o.priority ? 12 : 24) * H) {
          o.status = 'transport';
          o.times.transport = o.times.paid + (o.priority ? 12 : 24) * H;
          addEvent(o, 'Lot pris en charge par le transporteur partenaire.', o.times.transport);
          notify(o.buyerId, `SMS : votre commande CM-${o.id} sera livrée demain.`, `#commande-${o.id}`, o.times.transport);
          changed = true;
        }
        if (o.status === 'transport' && t >= o.times.paid + (o.priority ? 24 : 48) * H) {
          o.status = 'livree';
          o.times.delivered = o.times.paid + (o.priority ? 24 : 48) * H;
          addEvent(o, 'Lot livré au pied du véhicule. L\'acheteur a 48 h pour confirmer la réception ou signaler un problème.', o.times.delivered);
          notify(o.buyerId, `SMS : le transporteur est arrivé avec la commande CM-${o.id}. Vérifiez le lot et confirmez la réception.`, `#commande-${o.id}`, o.times.delivered);
          notify(o.sellerId, `La commande CM-${o.id} a été livrée à ${user(o.buyerId).name}.`, `#commande-${o.id}`, o.times.delivered);
          changed = true;
        }
      }
      if (o.status === 'livree' && t >= o.times.delivered + 48 * H) {
        confirmReception(o, o.times.delivered + 48 * H, 'Réception confirmée automatiquement : aucune réclamation dans les 48 h suivant la livraison.');
        changed = true;
      }
      if (o.status === 'recue' && t >= o.times.received + 48 * H) {
        payout(o, o.times.received + 48 * H);
        changed = true;
      }
    }
    for (const u of state.users) {
      while (u.premium && t >= u.renewAt) {
        if (u.cancelled) {
          u.premium = false;
          notify(u.id, 'Votre abonnement Premium est terminé.', '#compte', u.renewAt);
        } else {
          u.monthsPaid += 1;
          notify(u.id, `Abonnement Premium renouvelé : ${money(PREMIUM_HT)} HT prélevés.`, '#compte', u.renewAt);
          u.renewAt += 30 * D;
        }
        changed = true;
      }
    }
    if (changed) save();
  }

  /* ---------- Affichage commun ---------- */
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 4200);
  }

  function parseRoute() {
    const h = decodeURIComponent((location.hash || '').slice(1));
    const parts = h.split('-');
    const name = parts[0] || 'accueil';
    return { name, args: parts.slice(1) };
  }

  function renderHeader(routeName) {
    const u = me();
    const unread = u ? state.notifs.filter((n) => n.userId === u.id && !n.read).length : 0;
    const badge = $('#notif-count');
    badge.textContent = unread;
    badge.hidden = !unread;
    $('#notif-link').hidden = !u;
    $('#clock').textContent = fmtDate(now());
    $('#nav-admin').hidden = !u || u.type !== 'admin';
    $('#theme-toggle').setAttribute('aria-label', isDark() ? 'Passer en mode jour' : 'Passer en mode nuit');
    $('#theme-toggle').innerHTML = isDark()
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    $('#account-area').innerHTML = u
      ? `<details class="account-menu">
          <summary>${avatar(u)}<span class="account-name">${esc(u.name)}</span></summary>
          <div class="account-pop">
            <p class="small muted">Connecté en tant que<br><strong>${esc(u.email || u.name)}</strong></p>
            <a href="#compte">Mon compte</a>
            ${u.type !== 'admin' ? '<a href="#annonces">Mes annonces</a><a href="#favoris">Mes favoris</a><a href="#alertes">Mes alertes</a>' : '<a href="#admin">Administration</a>'}
            <a href="#notifications">Notifications</a>
            <a href="#parametres">Paramètres</a>
            <a href="#connexion">Changer de compte</a>
            <button type="button" data-action="logout">Se déconnecter</button>
          </div>
        </details>`
      : '<a class="btn btn-small" href="#connexion">Se connecter</a>';
    const alias = { lot: 'catalogue', commande: 'commandes', vendeur: 'catalogue', modifier: 'vendre' };
    document.querySelectorAll('.app-nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === (alias[routeName] || routeName));
    });
  }

  const PROTECTED = {
    vendre: 'déposer une annonce', annonces: 'voir vos annonces', commandes: 'suivre vos commandes', commande: 'suivre cette commande',
    messages: 'lire vos messages', alertes: 'gérer vos alertes', notifications: 'voir vos notifications', compte: 'ouvrir votre compte',
    parametres: 'modifier vos paramètres', favoris: 'retrouver vos favoris', modifier: 'modifier une annonce', admin: 'ouvrir l\'administration'
  };

  function render(keepScroll = false) {
    tick();
    const r = parseRoute();
    const views = { accueil: viewHome, demarrer: viewStart, catalogue: viewCatalogue, lot: viewLot, vendre: viewSell, annonces: viewMyLots, commandes: viewOrders,
      commande: viewOrder, messages: viewMessages, alertes: viewAlerts, notifications: viewNotifs, compte: viewAccount, inscription: viewSignup, admin: viewAdmin,
      connexion: viewLogin, favoris: viewFavs, vendeur: viewSeller, modifier: viewEdit, parametres: viewSettings };
    let fn = views[r.name] || viewHome;
    let args = r.args;
    if (PROTECTED[r.name] && !me()) {
      ui.after = location.hash;
      ui.loginReason = PROTECTED[r.name];
      fn = viewLogin;
      args = [];
    }
    const y = window.scrollY;
    $('#view').innerHTML = fn(...args);
    renderHeader(r.name);
    if (r.name === 'catalogue') renderResults();
    if (r.name === 'lot') updateBuySummary();
    if (r.name === 'notifications' && me()) {
      state.notifs.forEach((n) => { if (n.userId === me().id) n.read = true; });
      save();
      renderHeader(r.name);
    }
    if (keepScroll) window.scrollTo(0, y);
    else window.scrollTo(0, 0);
  }

  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  const notFound = (text) => `<section class="empty"><h1>Page introuvable</h1><p>${esc(text)}</p><a class="btn" href="#catalogue">Voir les lots disponibles</a></section>`;
  const pill = (status) => `<span class="pill pill-${STATUS[status][1]}">${STATUS[status][0]}</span>`;
  const roleChips = (u) => u.roles.map((r) => `<span class="chip">${r === 'vendeur' ? 'Vendeur' : 'Acheteur'}</span>`).join(' ');
  const needAccount = (text) => `<section class="panel"><p>${text}</p></section>`;

  /* ---------- Publicité (masquée pour les abonnés Premium) ---------- */
  function adBanner() {
    const u = me();
    if (u && u.premium) return '';
    return `<aside class="ad-banner" aria-label="Publicité"><span class="ad-tag">Publicité</span><p><strong>MatériOuest Location</strong> · Bétonnières, échafaudages et mini-pelles à la journée, livrés autour de Lorient.</p><span class="muted small">Annonce de démonstration · ${money(AD_HT)} HT par mois · les abonnés Premium ne voient pas de publicité</span></aside>`;
  }

  /* ---------- Accueil des annonces ---------- */
  function viewHome() {
    const u = me();
    const online = state.lots.filter((l) => l.status === 'en-ligne' && !isSuspended(l.sellerId));
    const c = myCommune();
    const last = online.filter(urgent).sort((a, b) => a.deadline - b.deadline);
    const fresh = online.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    const near = online.slice().sort((a, b) => dist(a.commune, c) - dist(b.commune, c)).slice(0, 8);
    const row = (list) => `<div class="row-scroll">${list.map((l) => lotCard({ l })).join('')}</div>`;
    const count = (cat) => online.filter((l) => l.category === cat).length;
    return `
      <section class="home-hero">
        <div>
          <p class="eyebrow">${u ? `Bonjour ${esc(u.type === 'particulier' ? u.name.split(' ')[0] : u.name)}` : 'Matériaux de chantier à petit prix'}</p>
          <h1>Des matériaux à sauver, près de chez vous.</h1>
          <p class="lead">${online.length} lots disponibles autour de Lorient, de 30 à 60 % moins chers que le neuf.</p>
        </div>
        <form class="home-search" data-form="home-search" role="search">
          <label for="home-q" class="sr-only">Que cherchez-vous ?</label>
          <input id="home-q" name="q" type="search" placeholder="Parpaings, carrelage, bétonnière…">
          <button class="btn">Rechercher</button>
        </form>
      </section>

      <section class="home-cats" aria-label="Catégories">
        ${CATEGORIES.map((cat, i) => `<button type="button" class="cat-tile" data-action="cat" data-cat="${esc(cat)}"><img class="cat-ico" src="${P(CAT_PHOTOS[i])}" alt="" loading="lazy"><span>${esc(cat)}<small>${count(cat)} lot${count(cat) > 1 ? 's' : ''}</small></span></button>`).join('')}
      </section>

      ${adBanner()}

      ${last.length ? `<section class="home-section">
        <div class="home-section-head"><div><h2>Dernière chance</h2><p class="muted">Ces lots doivent être retirés dans les prochains jours. Après, ils partent à la benne.</p></div><a href="#catalogue" data-action="sort-urgent">Tout voir</a></div>
        ${row(last)}
      </section>` : ''}

      <section class="home-section">
        <div class="home-section-head"><div><h2>Nouveautés</h2><p class="muted">Les derniers lots publiés.</p></div><a href="#catalogue" data-action="sort-recent">Tout voir</a></div>
        ${row(fresh)}
      </section>

      <section class="home-section">
        <div class="home-section-head"><div><h2>Près de ${esc(c)}</h2><p class="muted">${u ? 'Selon la commune de votre compte.' : 'Connectez-vous pour voir les lots autour de chez vous.'}</p></div><a href="#catalogue">Tout voir</a></div>
        ${row(near)}
      </section>

      <section class="home-sell">
        <div><h2>Des surplus sur votre chantier ?</h2><p>Déposez une annonce gratuite en 2 minutes. Vous ne payez que 12 % si le lot est vendu.</p></div>
        <a class="btn btn-light" href="#vendre">Déposer une annonce</a>
      </section>`;
  }

  /* ---------- Connexion ---------- */
  function viewLogin() {
    const u = me();
    const demo = state.users.filter((x) => ['u1', 'u2', 'u3', 'u4', 'u5', 'admin'].includes(x.id));
    if (ui.forgot) return viewForgot();
    return `
      <div class="login-layout">
        <section class="panel login-panel">
          <p class="eyebrow">Connexion</p>
          <h1>${ui.loginReason ? `Connectez-vous pour ${ui.loginReason}` : 'Connectez-vous à ChantierMarket'}</h1>
          ${u ? `<p class="banner banner-info">Vous êtes connecté en tant que <strong>${esc(u.name)}</strong>. Connectez-vous avec un autre compte pour en changer.</p>` : ''}
          <form class="form" data-form="login" novalidate>
            <div class="field"><label for="l-email">E-mail</label><input id="l-email" name="email" type="email" autocomplete="username" required></div>
            <div class="field"><label for="l-pwd">Mot de passe</label><input id="l-pwd" name="pwd" type="password" autocomplete="current-password" required></div>
            <p class="form-error" id="login-error" hidden></p>
            <button class="btn">Se connecter</button>
          </form>
          <p class="login-links"><button type="button" class="link-btn" data-action="forgot">Mot de passe oublié ?</button> · <a href="#inscription">Créer un compte</a></p>
          ${u ? '<button type="button" class="btn btn-small btn-ghost" data-action="logout">Se déconnecter</button>' : ''}
        </section>
        <section class="panel demo-panel">
          <h2 class="h3">Comptes de démonstration</h2>
          <p class="small">Mot de passe pour tous : <strong>${DEMO_PWD}</strong>. Un clic vous connecte directement.</p>
          <ul class="demo-list">${demo.map((x) => `<li>${avatar(x)}<div><strong>${esc(x.name)}</strong><span class="small muted">${typeLabel(x)} · ${esc(x.email)}</span></div>
            <button type="button" class="btn btn-small${x.id === state.current ? ' btn-ghost' : ''}" data-action="switch" data-id="${x.id}">${x.id === state.current ? 'Connecté' : 'Se connecter'}</button></li>`).join('')}</ul>
          ${state.users.filter((x) => x.id.startsWith('n')).length ? `<p class="small muted">Vos comptes créés pendant la simulation se connectent avec leur e-mail et leur mot de passe.</p>` : ''}
        </section>
      </div>`;
  }

  function viewForgot() {
    const step = ui.forgot;
    return `
      <section class="panel login-panel narrow">
        <p class="eyebrow">Mot de passe oublié</p>
        ${step === 'email' ? `<h1>Réinitialiser votre mot de passe</h1>
          <p>Indiquez l'adresse e-mail de votre compte. Nous vous envoyons un code à 6 chiffres.</p>
          <form class="form" data-form="forgot-email" novalidate>
            <div class="field"><label for="fg-email">E-mail</label><input id="fg-email" name="email" type="email" required autocomplete="username"></div>
            <p class="form-error" id="forgot-error" hidden></p>
            <button class="btn">Recevoir le code</button>
          </form>` : `<h1>Choisissez un nouveau mot de passe</h1>
          <p>Un code a été envoyé à <strong>${esc(ui.forgotEmail)}</strong>. <span class="muted">Simulation : le code est <strong>${ui.forgotCode}</strong>.</span></p>
          <form class="form" data-form="forgot-reset" novalidate>
            <div class="field"><label for="fg-code">Code reçu</label><input id="fg-code" name="code" inputmode="numeric" maxlength="6" required></div>
            <div class="field"><label for="fg-pwd">Nouveau mot de passe (8 caractères minimum)</label><input id="fg-pwd" name="pwd" type="password" autocomplete="new-password" required></div>
            <p class="form-error" id="forgot-error" hidden></p>
            <button class="btn">Enregistrer le mot de passe</button>
          </form>`}
        <p class="login-links"><button type="button" class="link-btn" data-action="forgot-cancel">Retour à la connexion</button></p>
      </section>`;
  }

  /* ---------- Favoris et profil vendeur ---------- */
  function viewFavs() {
    const u = me();
    const favs = (u.favs || []).map(lotById).filter(Boolean);
    return `
      <section class="page-head"><p class="eyebrow">Favoris</p><h1>Mes favoris</h1>
        <p class="lead">Vous êtes prévenu si le prix d'un favori baisse.</p></section>
      ${favs.length ? `<div class="lot-grid">${favs.map((l) => lotCard({ l })).join('')}</div>`
        : '<div class="empty"><p>Aucun favori pour l\'instant. Touchez le cœur sur une annonce pour la retrouver ici.</p><a class="btn btn-small" href="#catalogue">Voir les annonces</a></div>'}`;
  }

  function viewSeller(id) {
    const s = user(id);
    if (!s || s.type === 'admin' || s.deleted) return notFound('Ce profil n\'existe pas.');
    const st = sellerStats(s.id);
    const lots = state.lots.filter((l) => l.sellerId === s.id && l.status === 'en-ligne').sort((a, b) => b.createdAt - a.createdAt);
    const reviews = state.orders.filter((o) => o.sellerId === s.id && o.rating).sort((a, b) => b.rating.at - a.rating.at);
    return `
      <section class="seller-head">
        ${avatar(s, 'avatar-lg')}
        <div>
          <p class="eyebrow">${typeLabel(s)}</p>
          <h1>${esc(s.name)}</h1>
          <p class="muted">${esc(s.commune)} · Membre depuis ${new Date(s.createdAt || now()).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} · ${s.type === 'pro' ? 'SIRET vérifié' : 'Identité vérifiée'}${s.premium ? ' · <span class="chip chip-sponso">Premium</span>' : ''}</p>
          <p>${ratingText(s.id)} · ${st.sales} vente${st.sales > 1 ? 's' : ''}</p>
          ${s.about ? `<p class="prose">${esc(s.about)}</p>` : ''}
        </div>
      </section>
      <h2 class="section-title">Annonces en ligne (${lots.length})</h2>
      ${lots.length ? `<div class="lot-grid">${lots.map((l) => lotCard({ l })).join('')}</div>` : '<p class="muted">Aucune annonce en ligne.</p>'}
      <h2 class="section-title">Avis des acheteurs (${reviews.length})</h2>
      ${reviews.length ? `<ul class="reviews">${reviews.map((o) => `<li><p><span class="stars">${'★'.repeat(o.rating.stars)}${'☆'.repeat(5 - o.rating.stars)}</span> <strong>${esc(user(o.buyerId).name)}</strong> <span class="muted small">· ${fmtDay(o.rating.at)} · ${esc(lotById(o.lotId).title)}</span></p><p>${esc(o.rating.comment) || '<span class="muted">Pas de commentaire.</span>'}</p></li>`).join('')}</ul>` : '<p class="muted">Pas encore d\'avis.</p>'}`;
  }

  function viewEdit(id) {
    const l = lotById(id);
    const u = me();
    if (!l) return notFound('Cette annonce n\'existe pas.');
    if (l.sellerId !== u.id) return needAccount('Seul le vendeur peut modifier cette annonce.');
    if (l.status === 'vendu') return needAccount('Ce lot est vendu : l\'annonce ne peut plus être modifiée.');
    const active = state.lots.filter((x) => x.sellerId === u.id && x.status === 'en-ligne').length;
    return lotForm(l, active);
  }

  /* ---------- Paramètres ---------- */
  function viewSettings() {
    const u = me();
    const s = readSettings();
    const p = u.prefs || defaultPrefs();
    const radio = (name, val, label, cur, hint = '') => `<label class="option"><input type="radio" name="${name}" value="${val}"${cur === val ? ' checked' : ''} data-setting="${name}"><span><strong>${label}</strong>${hint ? `<br><small>${hint}</small>` : ''}</span></label>`;
    const toggle = (name, label, on, hint = '') => `<label class="switch-row"><span><strong>${label}</strong>${hint ? `<br><small class="muted">${hint}</small>` : ''}</span><input type="checkbox" role="switch" name="${name}" data-pref="${name}"${on ? ' checked' : ''}></label>`;
    const ongoing = state.orders.some((o) => (o.buyerId === u.id || o.sellerId === u.id) && ['payee', 'transport', 'livree', 'recue', 'litige'].includes(o.status));
    return `
      <section class="page-head"><p class="eyebrow">Paramètres</p><h1>Paramètres</h1></section>
      <div class="settings">
        <nav class="settings-nav" aria-label="Sections des paramètres">
          <a href="#parametres" data-action="scroll-to" data-target="set-affichage">Affichage</a>
          <a href="#parametres" data-action="scroll-to" data-target="set-notifs">Notifications</a>
          <a href="#parametres" data-action="scroll-to" data-target="set-recherche">Recherche</a>
          <a href="#parametres" data-action="scroll-to" data-target="set-confid">Confidentialité</a>
          <a href="#parametres" data-action="scroll-to" data-target="set-securite">Sécurité</a>
          <a href="#parametres" data-action="scroll-to" data-target="set-compte">Compte</a>
        </nav>
        <div class="settings-body">
          <section class="panel" id="set-affichage">
            <h2 class="h3">Affichage</h2>
            <p class="small muted">Ces réglages s'appliquent à tout le site, dans ce navigateur.</p>
            <fieldset class="setting-group"><legend>Thème</legend><div class="option-row">
              ${radio('theme', 'systeme', 'Automatique', s.theme || 'systeme', 'Suit le réglage de votre appareil')}
              ${radio('theme', 'clair', 'Mode jour', s.theme || 'systeme')}
              ${radio('theme', 'sombre', 'Mode nuit', s.theme || 'systeme')}
            </div></fieldset>
            <fieldset class="setting-group"><legend>Taille du texte</legend><div class="option-row">
              ${radio('texte', 'normal', 'Normale', s.texte || 'normal')}
              ${radio('texte', 'grand', 'Grande', s.texte || 'normal')}
            </div></fieldset>
            <fieldset class="setting-group"><legend>Animations</legend><div class="option-row">
              ${radio('animations', 'normal', 'Normales', s.animations || 'normal')}
              ${radio('animations', 'reduit', 'Réduites', s.animations || 'normal', 'Moins de mouvements à l\'écran')}
            </div></fieldset>
          </section>

          <section class="panel" id="set-notifs">
            <h2 class="h3">Notifications</h2>
            <h3 class="h4">Ce que vous recevez</h3>
            ${toggle('notif.commande', 'Commandes et livraisons', p.notif.commande, 'Paiement, prise en charge, livraison, versement')}
            ${toggle('notif.message', 'Messages', p.notif.message, 'Quand un acheteur ou un vendeur vous écrit')}
            ${toggle('notif.alerte', 'Alertes et favoris', p.notif.alerte, 'Nouveau lot correspondant à une alerte, baisse de prix d\'un favori')}
            ${toggle('notif.actus', 'Actualités et offres de ChantierMarket', p.notif.actus, 'Lettre d\'information, une fois par mois au plus')}
            <h3 class="h4">Comment vous les recevez</h3>
            ${toggle('canaux.email', 'Par e-mail', p.canaux.email, esc(u.email || ''))}
            ${toggle('canaux.sms', 'Par SMS', p.canaux.sms, esc(u.phone || ''))}
            <p class="small muted">Les messages importants sur votre compte et vos paiements sont toujours envoyés.</p>
          </section>

          <section class="panel" id="set-recherche">
            <h2 class="h3">Recherche</h2>
            <div class="form-grid">
              <div class="field"><label for="set-rayon">Distance par défaut</label>
                <select id="set-rayon" data-pref="rayon">${[['', 'Toutes'], ['10', 'Moins de 10 km'], ['20', 'Moins de 20 km'], ['30', 'Moins de 30 km']].map(([v, t]) => `<option value="${v}"${(p.rayon || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
              <div class="field"><label for="set-commune">Votre commune</label>
                <select id="set-commune" data-pref="commune">${Object.keys(COMMUNES).map((c) => `<option${c === u.commune ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
            </div>
          </section>

          <section class="panel" id="set-confid">
            <h2 class="h3">Confidentialité</h2>
            ${toggle('telephone', 'Montrer mon numéro après une commande', p.telephone !== false, 'Sinon, l\'autre partie vous contacte par la messagerie')}
            <p class="small"><a href="confidentialite.html">Politique de confidentialité</a> · <a href="cookies.html">Cookies</a></p>
          </section>

          <section class="panel" id="set-securite">
            <h2 class="h3">Sécurité</h2>
            <form class="form" data-form="password" novalidate>
              <div class="field"><label for="pw-old">Mot de passe actuel</label><input id="pw-old" name="old" type="password" autocomplete="current-password"></div>
              <div class="form-grid">
                <div class="field"><label for="pw-new">Nouveau mot de passe</label><input id="pw-new" name="pwd" type="password" autocomplete="new-password"><p class="hint">8 caractères minimum.</p></div>
                <div class="field"><label for="pw-new2">Confirmation</label><input id="pw-new2" name="pwd2" type="password" autocomplete="new-password"></div>
              </div>
              <p class="form-error" id="password-error" hidden></p>
              <button class="btn btn-small">Changer le mot de passe</button>
            </form>
          </section>

          <section class="panel" id="set-compte">
            <h2 class="h3">Compte</h2>
            <div class="btn-group">
              <button type="button" class="btn btn-small btn-ghost" data-action="logout">Se déconnecter</button>
              ${u.type !== 'admin' ? (ongoing
                ? '<button type="button" class="btn btn-small btn-danger" disabled>Supprimer mon compte</button>'
                : '<button type="button" class="btn btn-small btn-danger" data-action="delete-account" data-confirm="Confirmer : supprimer définitivement">Supprimer mon compte</button>') : ''}
            </div>
            ${u.type !== 'admin' ? `<p class="small muted">${ongoing ? 'Vous avez des commandes en cours : terminez-les avant de supprimer votre compte.' : 'La suppression retire vos annonces et efface vos informations personnelles. Les factures sont gardées 10 ans, comme la loi l\'exige.'}</p>` : ''}
          </section>
        </div>
      </div>`;
  }

  /* ---------- Démarrer ---------- */
  function viewStart() {
    const scen = [
      ['u2', 'Acheter en tant qu\'entreprise', 'Atelier Plâtre & Isolation attend la commande CM-1003. Avancez le temps de 24 h pour la livraison, confirmez la réception, puis achetez un autre lot avec livraison.', '#commande-1003'],
      ['u1', 'Vendre en tant qu\'entreprise', 'Kerbâti Construction (Premium) doit remettre des tuiles à Marc D. Publiez aussi une annonce et suivez le versement de vos ventes.', '#commande-1005'],
      ['u4', 'Acheter en tant que particulier', 'Sophie L. a une réclamation en cours. Achetez un lot à une entreprise, puis testez le droit de rétractation de 14 jours.', '#commandes'],
      ['u5', 'Acheter et vendre en tant que particulier', 'Marc D. vient chercher ses tuiles, puis veut revendre ses surplus : il doit d\'abord faire vérifier sa pièce d\'identité.', '#commande-1005'],
      ['admin', 'Gérer la plateforme', 'L\'équipe ChantierMarket traite la réclamation de Sophie L., planifie un enlèvement et suit les chiffres.', '#admin']
    ];
    const u = me();
    return `
      <section class="page-head">
        <p class="eyebrow">Simulation</p>
        <h1>Testez ChantierMarket de bout en bout</h1>
        <p class="lead">${u ? `Vous êtes connecté en tant que <strong>${esc(u.name)}</strong> (${typeLabel(u).toLowerCase()}).` : 'Vous n\'êtes pas connecté.'} Choisissez un scénario : vous êtes connecté au bon compte. Pour jouer l'autre partie de la transaction, utilisez « Changer de compte » dans le menu du compte. Tous les comptes de démonstration ont le mot de passe <strong>${DEMO_PWD}</strong>. Le bouton <strong>+24 h</strong> fait avancer le temps : livraisons, versements et délais se déclenchent comme sur la vraie plateforme.</p>
      </section>

      <h2 class="section-title">Scénarios</h2>
      <div class="scenarios">
        ${scen.map(([id, title, text, link]) => `
          <article class="scenario">
            <div class="scenario-head">${avatar(user(id))}<div><h3>${title}</h3><p class="muted small">${esc(user(id).name)} · ${typeLabel(user(id))}</p></div></div>
            <p>${text}</p>
            <button class="btn btn-small" data-action="scenario" data-id="${id}" data-link="${link}">Commencer</button>
          </article>`).join('')}
        <article class="scenario scenario-new">
          <div class="scenario-head"><span class="avatar-sm avatar-new" aria-hidden="true">+</span><div><h3>Créer votre propre compte</h3><p class="muted small">Entreprise ou particulier</p></div></div>
          <p>Inscrivez-vous comme sur la vraie plateforme : SIRET et Kbis pour une entreprise, e-mail et téléphone vérifiés pour un particulier.</p>
          <a class="btn btn-small" href="#inscription">Créer un compte</a>
        </article>
      </div>

      <h2 class="section-title">Règles appliquées</h2>
      <ul class="rules">
        <li><strong>12 %</strong> de commission sur chaque vente, payée par le vendeur</li>
        <li><strong>48 h</strong> après la réception, le vendeur est payé</li>
        <li><strong>48 h</strong> pour signaler un lot non conforme</li>
        <li><strong>29, 45 ou 59 € HT</strong> de livraison selon la distance, jusqu'à 30 km de Lorient</li>
        <li><strong>14 jours</strong> de rétractation pour un particulier qui achète à une entreprise</li>
        <li><strong>${money(PREMIUM_HT)} HT</strong> par mois pour Premium : sans publicité, livraison prioritaire en 24 h</li>
        <li><strong>${money(AD_HT)} HT</strong> par mois pour un espace publicitaire (négoces, loueurs, transporteurs)</li>
      </ul>

      <section class="panel panel-danger">
        <h2>Recommencer à zéro</h2>
        <p>Efface vos comptes, annonces et commandes, et remet les données de démonstration de départ.</p>
        <button class="btn btn-danger" data-action="reset" data-confirm="Confirmer la remise à zéro">Réinitialiser la simulation</button>
      </section>
      ${storageOk ? '' : '<p class="form-error">Ce navigateur bloque l\'enregistrement : la simulation sera perdue si vous rechargez la page.</p>'}`;
  }

  /* ---------- Catalogue ---------- */
  function visibleLots() {
    const c = myCommune();
    let list = state.lots.filter((l) => l.status === 'en-ligne' && !isSuspended(l.sellerId))
      .map((l) => ({ l, km: dist(l.commune, c), sp: false }));
    if (ui.q) { const q = norm(ui.q); list = list.filter((x) => norm(`${x.l.title} ${x.l.description} ${x.l.category}`).includes(q)); }
    if (ui.cat) list = list.filter((x) => x.l.category === ui.cat);
    if (ui.maxKm) list = list.filter((x) => x.km <= +ui.maxKm);
    if (ui.commune) list = list.filter((x) => x.l.commune === ui.commune);
    const cmp = {
      distance: (a, b) => a.km - b.km || b.l.createdAt - a.l.createdAt,
      'prix-croissant': (a, b) => a.l.price - b.l.price,
      'prix-decroissant': (a, b) => b.l.price - a.l.price,
      recent: (a, b) => b.l.createdAt - a.l.createdAt,
      urgent: (a, b) => a.l.deadline - b.l.deadline
    }[ui.sort];
    return list.sort((a, b) => (b.sp - a.sp) || cmp(a, b));
  }

  function viewCatalogue() {
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    return `
      <section class="page-head page-head-row">
        <div>
          <p class="eyebrow">Acheter</p>
          <h1>Lots disponibles près de ${esc(myCommune())}</h1>
        </div>
        <div class="seg" role="group" aria-label="Affichage">
          <button type="button" data-action="vue" data-vue="liste" aria-pressed="${ui.vue === 'liste'}">Liste</button>
          <button type="button" data-action="vue" data-vue="carte" aria-pressed="${ui.vue === 'carte'}">Carte</button>
        </div>
      </section>
      <form class="filters" data-form="filters" role="search">
        <div class="field-inline grow"><label for="f-q">Recherche</label><input id="f-q" type="search" value="${esc(ui.q)}" placeholder="Parpaing, carrelage, bétonnière…"></div>
        <div class="field-inline"><label for="f-cat">Catégorie</label><select id="f-cat">${opt('', 'Toutes', ui.cat)}${CATEGORIES.map((c) => opt(c, c, ui.cat)).join('')}</select></div>
        <div class="field-inline"><label for="f-km">Distance</label><select id="f-km">${opt('', 'Toutes', ui.maxKm)}${opt('10', 'Moins de 10 km', ui.maxKm)}${opt('20', 'Moins de 20 km', ui.maxKm)}${opt('30', 'Moins de 30 km', ui.maxKm)}</select></div>
        <div class="field-inline"><label for="f-sort">Trier par</label><select id="f-sort">${opt('distance', 'Distance', ui.sort)}${opt('prix-croissant', 'Prix croissant', ui.sort)}${opt('prix-decroissant', 'Prix décroissant', ui.sort)}${opt('recent', 'Plus récents', ui.sort)}${opt('urgent', 'À retirer en premier', ui.sort)}</select></div>
      </form>
      ${adBanner()}
      <div id="results"></div>
      <p class="muted small">Classement par défaut : distance, puis date de publication.</p>`;
  }

  function renderResults() {
    const box = $('#results');
    if (!box) return;
    const list = visibleLots();
    const chip = ui.commune ? `<p class="active-filter">Commune : <strong>${esc(ui.commune)}</strong> <button type="button" class="link-btn" data-action="clear-commune">Retirer ce filtre</button></p>` : '';
    if (ui.vue === 'carte') { box.innerHTML = chip + mapView(list); return; }
    box.innerHTML = chip + (list.length
      ? `<p class="muted small">${list.length} lot${list.length > 1 ? 's' : ''}</p><div class="lot-grid">${list.map(lotCard).join('')}</div>`
      : '<div class="empty"><p>Aucun lot ne correspond à votre recherche.</p><p class="muted">Créez une alerte pour être prévenu dès qu\'un lot correspondant est publié.</p><a class="btn btn-small" href="#alertes">Créer une alerte</a></div>');
  }

  function favButton(l) {
    const on = isFav(l.id);
    return `<button type="button" class="fav-btn${on ? ' is-on' : ''}" data-action="fav" data-id="${l.id}" aria-pressed="${on}" aria-label="${on ? 'Retirer des favoris' : 'Ajouter aux favoris'} : ${esc(l.title)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.3 5 6.7 5c2 0 3.6 1.1 4.3 2.6h2C13.7 6.1 15.3 5 17.3 5c3.4 0 5.6 3.3 4.2 6.7C19.5 16.4 12 21 12 21z"/></svg></button>`;
  }

  function lotCard({ l, km, sp }) {
    const s = user(l.sellerId);
    if (km === undefined) km = dist(l.commune, myCommune());
    if (sp === undefined) sp = false;
    const gone = l.status !== 'en-ligne';
    return `<article class="lot-card${gone ? ' is-gone' : ''}">
      <a class="lot-link" href="#lot-${l.id}">
        <div class="lot-media">${photo(l, 'lot-img')}${gone ? `<span class="lot-gone">${l.status === 'vendu' ? 'Vendu' : 'Retiré'}</span>` : ''}</div>
        <div class="lot-body">
          <div class="tags">${sp ? '<span class="chip chip-sponso">Sponsorisé</span>' : ''}${deadlineBadge(l)}<span class="chip">${esc(l.etat)}</span>${l.sellerId === state.current ? '<span class="chip chip-mine">Votre annonce</span>' : ''}</div>
          <h3>${esc(l.title)}</h3>
          <p class="lot-price"><strong>${money(l.price)}</strong>${l.neuf ? ` <span class="discount">−${discount(l)} %</span>` : ''}</p>
          <p class="muted small">${esc(qty(l))} · ${esc(l.commune)} · ${String(km).replace('.', ',')} km</p>
          <p class="muted small">${esc(s.name)} · ${typeLabel(s)}</p>
          <p class="muted small">${dayLabel(l.createdAt)}</p>
        </div>
      </a>
      ${l.sellerId !== state.current ? favButton(l) : ''}
    </article>`;
  }

  function mapView(list) {
    const counts = {};
    list.forEach((x) => { counts[x.l.commune] = (counts[x.l.commune] || 0) + 1; });
    const mine = myCommune();
    // Côté de l'étiquette pour éviter les chevauchements : g = gauche, d = droite, h = haut, b = bas
    const side = { 'Lorient': 'g', 'Lanester': 'd', 'Ploemeur': 'g', 'Larmor-Plage': 'b', 'Quéven': 'g', 'Caudan': 'h', 'Hennebont': 'd',
      'Port-Louis': 'd', 'Guidel': 'g', 'Plouay': 'h', 'Quimperlé': 'h', 'Auray': 'h' };
    const towns = Object.entries(COMMUNES).map(([name, [x, y]]) => {
      const n = counts[name] || 0;
      const isMine = name === mine;
      const r = n ? 1 + Math.min(n, 6) * 0.22 : 0.6;
      const dot = `<circle cx="${x}" cy="${-y}" r="${r}" class="${n ? 'map-dot' : 'map-town'}"/>`;
      const s = side[name] || 'h';
      const lx = s === 'g' ? x - r - 0.8 : s === 'd' ? x + r + 0.8 : x;
      const ly = s === 'h' ? -y - r - 0.7 : s === 'b' ? -y + r + 1.8 : -y + 0.55;
      const anchor = s === 'g' ? 'end' : s === 'd' ? 'start' : 'middle';
      const label = `<text x="${lx}" y="${ly}" class="map-label${isMine ? ' map-label-me' : ''}" text-anchor="${anchor}">${esc(name)}${n ? ` (${n})` : ''}</text>`;
      const me2 = isMine ? `<circle cx="${x}" cy="${-y}" r="${r + 1.2}" class="map-me"/>` : '';
      return n
        ? `<g class="map-link" data-action="map-commune" data-commune="${esc(name)}" tabindex="0" role="button" aria-label="${esc(name)} : ${n} lot${n > 1 ? 's' : ''}">${me2}${dot}${label}</g>`
        : `<g>${me2}${dot}${label}</g>`;
    }).join('');
    return `<div class="map-wrap">
      <svg class="map" viewBox="-30 -27 72 54" role="img" aria-label="Carte des lots autour de Lorient">
        <rect x="-30" y="-27" width="72" height="54" class="map-bg"/>
        <path d="M-30 6 Q-12 3 -6 8 Q-1 4 3 8 Q8 5 14 9 Q26 6 42 8 L42 27 L-30 27 Z" class="map-sea"/>
        <text x="-26" y="20" class="map-sea-label">Océan Atlantique</text>
        ${[8, 16, 24].map((r, i) => `<circle cx="0" cy="0" r="${r}" class="map-ring"/><text x="${r * 0.71 + 0.5}" y="${-r * 0.71 - 0.5}" class="map-ring-label">${(i + 1) * 10} km</text>`).join('')}
        ${towns}
      </svg>
      <p class="muted small">Les cercles montrent la zone de livraison : 10, 20 et 30 km de route autour de Lorient. Cliquez sur une commune pour voir ses lots. Votre position : ${esc(mine)}.</p>
    </div>`;
  }

  /* ---------- Fiche d'un lot ---------- */
  function viewLot(id) {
    const l = lotById(id);
    if (!l) return notFound('Cette annonce n\'existe pas.');
    const s = user(l.sellerId);
    const u = me();
    const mine = !!u && l.sellerId === u.id;
    const km = dist(l.commune, myCommune());
    if (!mine && !ui.viewed[l.id]) { ui.viewed[l.id] = true; l.vues = (l.vues || 0) + 1; save(); }
    const pics = l.photos && l.photos.length ? l.photos : [catPhoto(l.category)];
    const gallery = `<div class="gallery${pics.length === 1 ? ' gallery-single' : ''}">${pics.slice(0, 3).map((p) => `<img src="${p}" alt="Photo : ${esc(l.title)}">`).join('')}</div>
      <p class="muted small">${l.photos && l.photos.length ? (SEED_PHOTOS[l.id] ? 'Photo d\'illustration (Wikimedia Commons, voir les <a href="credits-photos.html">crédits photos</a>).' : '') : 'Photo d\'illustration de la catégorie (voir les <a href="credits-photos.html">crédits photos</a>).'}</p>`;
    const thread = u ? state.messages.filter((m) => m.lotId === l.id && ((m.from === u.id && m.to === s.id) || (m.from === s.id && m.to === u.id))) : [];
    const n = daysLeft(l);
    const others = state.lots.filter((x) => x.sellerId === s.id && x.id !== l.id && x.status === 'en-ligne').length;
    return `
      <p class="crumbs"><a href="#catalogue">← Tous les lots</a></p>
      <div class="lot-layout">
        <div class="lot-main">
          ${gallery}
          <div class="tags">${deadlineBadge(l)}<span class="chip">${esc(l.category)}</span><span class="chip">État : ${esc(l.etat)}</span></div>
          <h1>${esc(l.title)}</h1>
          <p class="lot-price big"><strong>${money(l.price)}</strong>${l.neuf ? ` <span class="discount">−${discount(l)} % sur le neuf (${money(l.neuf)})</span>` : ''}</p>
          <div class="lot-actions">
            ${!mine ? `<button type="button" class="btn btn-small btn-ghost" data-action="fav" data-id="${l.id}" aria-pressed="${isFav(l.id)}">${isFav(l.id) ? '♥ Dans vos favoris' : '♡ Ajouter aux favoris'}</button>` : ''}
            <button type="button" class="btn btn-small btn-ghost" data-action="share" data-id="${l.id}">Partager l'annonce</button>
            ${mine ? `<a class="btn btn-small" href="#modifier-${l.id}">Modifier l'annonce</a>` : ''}
            <span class="muted small">Publiée ${dayLabel(l.createdAt).toLowerCase()} · ${l.vues || 0} vue${(l.vues || 0) > 1 ? 's' : ''}</span>
          </div>
          <p class="share-box" id="share-box" hidden></p>
          <dl class="specs">
            <div><dt>Quantité</dt><dd>${esc(qty(l))}</dd></div>
            <div><dt>Poids estimé</dt><dd>${l.weight ? `${l.weight.toLocaleString('fr-FR')} kg` : 'Non indiqué'}</dd></div>
            <div><dt>Retrait</dt><dd>${esc(l.address)}, ${esc(l.commune)}</dd></div>
            <div><dt>À retirer avant le</dt><dd>${fmtDay(l.deadline)}${l.status === 'en-ligne' ? `<br><small class="${n <= 4 ? 'urgent-text' : 'muted'}">${n <= 0 ? 'Dernier jour' : n === 1 ? 'Demain' : `Dans ${n} jours`}</small>` : ''}</dd></div>
            <div><dt>Distance</dt><dd>${String(km).replace('.', ',')} km de ${esc(myCommune())}</dd></div>
            <div><dt>Publié</dt><dd>${since(l.createdAt)}</dd></div>
          </dl>
          <h2 class="h3">Description</h2>
          <p class="prose">${esc(l.description) || '<span class="muted">Pas de description.</span>'}</p>

          <a class="seller-card" href="#vendeur-${s.id}">
            ${avatar(s)}
            <div>
              <h2 class="h3">${esc(s.name)}</h2>
              <p class="muted small">${typeLabel(s)}${s.type === 'pro' ? ' · SIRET vérifié' : ' · Identité vérifiée'} · ${esc(s.commune)}</p>
              <p class="small">${ratingText(s.id)}</p>
              <p class="small seller-more">Voir le profil${others ? ` et ses ${others} autre${others > 1 ? 's' : ''} annonce${others > 1 ? 's' : ''}` : ''} →</p>
            </div>
          </a>

          ${!u && l.status === 'en-ligne' ? `<section class="panel"><h2 class="h3">Une question sur ce lot ?</h2><p>Connectez-vous pour contacter le vendeur.</p><a class="btn btn-small" href="#connexion">Se connecter</a></section>` : ''}
          ${u && !mine && u.type !== 'admin' && l.status === 'en-ligne' ? `
          <section class="panel">
            <h2 class="h3">Poser une question au vendeur</h2>
            ${thread.length ? `<div class="thread">${thread.map(msgBubble).join('')}</div>` : ''}
            <form data-form="message" data-lot="${l.id}" data-to="${s.id}" class="msg-form">
              <label for="msg-text" class="sr-only">Votre message</label>
              <textarea id="msg-text" name="text" rows="2" required placeholder="Bonjour, le lot est-il encore disponible ?"></textarea>
              <button class="btn btn-small">Envoyer</button>
            </form>
          </section>
          <details class="report">
            <summary>Signaler cette annonce</summary>
            <form data-form="report" data-lot="${l.id}" class="report-form">
              <label for="report-reason">Motif</label>
              <select id="report-reason" name="reason">
                <option>Produit interdit (amiante, produit dangereux…)</option>
                <option>Annonce trompeuse ou photos non conformes</option>
                <option>Autre contenu illicite</option>
              </select>
              <button class="btn btn-small btn-ghost">Envoyer le signalement</button>
            </form>
          </details>` : ''}
        </div>
        <aside class="lot-side">${buyPanel(l, km)}</aside>
      </div>`;
  }

  function buyPanel(l, km) {
    const u = me();
    const s = user(l.sellerId);
    if (!u) {
      return l.status === 'en-ligne'
        ? `<div class="buy-box"><h2 class="h3">Acheter ce lot</h2><p class="lot-price"><strong>${money(l.price)}</strong></p>
          <p>Retrait sur place gratuit, ou livraison sur votre chantier (${feeHT(km) ? `${money(feeHT(km))} HT depuis ${esc(myCommune())}` : 'selon la distance'}).</p>
          <a class="btn btn-block" href="#connexion" data-action="remember" data-after="#lot-${l.id}">Se connecter pour acheter</a>
          <a class="btn btn-block btn-ghost" href="#inscription">Créer un compte</a></div>`
        : `<div class="buy-box"><h2 class="h3">Lot indisponible</h2><p>${l.status === 'vendu' ? 'Ce lot a été vendu.' : 'Ce lot a été retiré de la vente.'}</p></div>`;
    }
    if (l.status !== 'en-ligne') {
      const o = state.orders.find((x) => x.lotId === l.id && (x.buyerId === u.id || x.sellerId === u.id || u.type === 'admin'));
      return `<div class="buy-box"><h2 class="h3">Lot indisponible</h2><p>${l.status === 'vendu' ? 'Ce lot a été vendu.' : 'Ce lot a été retiré de la vente.'}</p>${o ? `<a class="btn btn-small" href="#commande-${o.id}">Voir la commande CM-${o.id}</a>` : ''}</div>`;
    }
    if (l.sellerId === u.id) {
      const favCount = state.users.filter((x) => (x.favs || []).includes(l.id)).length;
      return `<div class="buy-box"><h2 class="h3">C'est votre annonce</h2><p>Elle est en ligne. Vous serez prévenu dès qu'un acheteur la commande.</p>
        <p class="small muted">${l.vues || 0} vue${(l.vues || 0) > 1 ? 's' : ''} · ${favCount} personne${favCount > 1 ? 's l\'ont' : ' l\'a'} mise en favori</p>
        <a class="btn btn-small" href="#modifier-${l.id}">Modifier l'annonce</a>
        <button class="btn btn-small btn-ghost" data-action="withdraw" data-id="${l.id}" data-confirm="Confirmer le retrait de l'annonce">Retirer l'annonce</button></div>`;
    }
    if (u.type === 'admin') {
      return `<div class="buy-box"><h2 class="h3">Modération</h2><p>Retirez l'annonce si elle ne respecte pas les règles de la plateforme. Le vendeur est prévenu par e-mail.</p>
        <button class="btn btn-small btn-danger" data-action="withdraw" data-id="${l.id}" data-confirm="Confirmer le retrait de l'annonce">Retirer l'annonce</button></div>`;
    }
    if (!u.roles.includes('acheteur')) {
      return `<div class="buy-box"><h2 class="h3">Acheter ce lot</h2><p>Votre compte est configuré pour vendre uniquement.</p><button class="btn btn-small" data-action="add-role" data-role="acheteur">Ajouter le rôle acheteur</button></div>`;
    }
    const fee = feeHT(km);
    const canDeliver = fee !== null && inZone(myCommune()) && inZone(l.commune);
    const retract = u.type === 'particulier' && s.type === 'pro';
    return `<form class="buy-box" data-form="buy" data-id="${l.id}">
      <h2 class="h3">Acheter ce lot</h2>
      <fieldset>
        <legend>Récupération</legend>
        <label class="option"><input type="radio" name="mode" value="retrait" checked>
          <span><strong>Retrait sur place</strong> · gratuit<br><small>${esc(l.address)}, ${esc(l.commune)}. Prévoyez un véhicule adapté.</small></span></label>
        <label class="option${canDeliver ? '' : ' is-disabled'}"><input type="radio" name="mode" value="livraison"${canDeliver ? '' : ' disabled'}>
          <span><strong>Livraison sur votre chantier</strong>${canDeliver ? ` · ${money(fee)} HT` : ''}<br><small>${canDeliver
            ? `${String(km).replace('.', ',')} km · ${u.premium ? 'livraison prioritaire en 24 h (Premium)' : 'sous 24 à 48 h ouvrées'} · au pied du véhicule`
            : 'Indisponible : la livraison couvre 30 km autour de Lorient.'}</small></span></label>
      </fieldset>
      <fieldset>
        <legend>Paiement (simulation)</legend>
        <label class="option"><input type="radio" name="pay" value="carte" checked><span>Carte bancaire</span></label>
        <label class="option"><input type="radio" name="pay" value="virement"><span>Virement</span></label>
      </fieldset>
      <div id="buy-summary" class="summary"></div>
      ${retract ? '<p class="note">Vous achetez à une entreprise : vous disposez de 14 jours après la réception pour vous rétracter, et de la garantie légale de conformité.</p>' : ''}
      ${u.type === 'pro' ? '<p class="note">Une facture avec TVA est disponible dans la commande.</p>' : ''}
      <button class="btn btn-block" id="pay-btn">Payer</button>
      <p class="muted small">Aucun paiement réel : aucune carte n'est demandée. Les fonds sont conservés jusqu'à la remise du lot.</p>
    </form>`;
  }

  function updateBuySummary() {
    const form = document.querySelector('[data-form="buy"]');
    if (!form) return;
    const l = lotById(form.dataset.id);
    const mode = form.querySelector('input[name="mode"]:checked').value;
    const km = dist(l.commune, myCommune());
    const fee = mode === 'livraison' ? feeHT(km) : 0;
    const t = r2(l.price + fee * (1 + TVA));
    const sellerPro = user(l.sellerId).type === 'pro';
    $('#buy-summary').innerHTML = `
      <div><span>Prix du lot${sellerPro ? ' (TTC)' : ''}</span><span>${money(l.price)}</span></div>
      ${sellerPro && me().type === 'pro' ? `<div class="sub"><span>dont TVA 20 %</span><span>${money(r2(l.price - l.price / (1 + TVA)))}</span></div>` : ''}
      <div><span>Livraison</span><span>${fee ? `${money(r2(fee * (1 + TVA)))} TTC` : 'Gratuit'}</span></div>
      ${fee ? `<div class="sub"><span>soit ${money(fee)} HT</span><span></span></div>` : ''}
      <div class="sum-total"><span>Total à payer</span><span>${money(t)}</span></div>`;
    $('#pay-btn').textContent = `Payer ${money(t)}`;
  }

  /* ---------- Vendre ---------- */
  function viewSell() {
    const u = me();
    if (u.type === 'admin') return needAccount('Le compte administrateur ne vend pas. Changez de compte pour publier une annonce.');
    if (!u.roles.includes('vendeur')) {
      return `<section class="page-head"><p class="eyebrow">Vendre</p><h1>Publier une annonce</h1></section>
        <section class="panel"><p>Votre compte est configuré pour acheter uniquement. Ajoutez le rôle vendeur pour publier vos surplus.</p>
        <button class="btn btn-small" data-action="add-role" data-role="vendeur">Ajouter le rôle vendeur</button></section>`;
    }
    if (u.type === 'particulier' && !u.idVerified) {
      return `<section class="page-head"><p class="eyebrow">Vendre</p><h1>Vérifiez votre identité</h1>
        <p class="lead">Pour vendre en tant que particulier, ChantierMarket vérifie votre pièce d'identité. Elle est supprimée dès que la vérification est faite.</p></section>
        <form class="panel form" data-form="verify-id">
          <div class="field"><label for="id-file">Pièce d'identité (photo ou PDF)</label><input id="id-file" type="file" accept="image/*,.pdf">
          <p class="hint">Simulation : vous pouvez aussi valider sans fichier.</p></div>
          <button class="btn">Envoyer pour vérification</button>
        </form>`;
    }
    if (isSuspended(u.id)) return needAccount('Votre compte vendeur est suspendu : votre note moyenne est inférieure à 3 sur 5 après 10 ventes. Contactez le service client.');
    const active = state.lots.filter((l) => l.sellerId === u.id && l.status === 'en-ligne').length;
    return lotForm(null, active);
  }

  function lotForm(l, active) {
    const u = me();
    const v = l || { title: '', category: CATEGORIES[0], etat: ETATS[0], qty: 1, unit: UNITS[0], price: '', neuf: '', weight: '',
      commune: u.commune, address: u.address || '', deadline: now() + 21 * D, description: '' };
    const deadline = new Date(v.deadline).toISOString().slice(0, 10);
    const opts = (list, cur) => list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
    const existing = l ? (l.photos || []).length : 0;
    return `
      ${l ? `<p class="crumbs"><a href="#lot-${l.id}">← Retour à l'annonce</a></p>` : ''}
      <section class="page-head"><p class="eyebrow">Vendre</p><h1>${l ? 'Modifier l\'annonce' : 'Déposer une annonce'}</h1>
        <p class="lead">${l ? 'Si vous baissez le prix, les acheteurs qui ont mis ce lot en favori sont prévenus.' : 'Quelques photos, la quantité, un prix et l\'adresse de retrait : votre lot est en ligne en 2 minutes.'}</p></section>
      <form class="form panel" data-form="publish"${l ? ` data-id="${l.id}"` : ''} novalidate>
        <div class="form-grid">
          <div class="field span-2"><label for="p-title">Titre</label><input id="p-title" name="title" required maxlength="80" placeholder="Ex. : Parpaings creux 20×20×50" value="${esc(v.title)}"></div>
          <div class="field"><label for="p-cat">Catégorie</label><select id="p-cat" name="category">${opts(CATEGORIES, v.category)}</select></div>
          <div class="field"><label for="p-etat">État</label><select id="p-etat" name="etat">${opts(ETATS, v.etat)}</select></div>
          <div class="field"><label for="p-qty">Quantité</label><input id="p-qty" name="qty" type="number" min="1" step="any" required value="${v.qty}"></div>
          <div class="field"><label for="p-unit">Unité</label><select id="p-unit" name="unit">${opts(UNITS, v.unit)}</select></div>
          <div class="field"><label for="p-price">Prix de vente (€${u.type === 'pro' ? ' TTC' : ''})</label><input id="p-price" name="price" type="number" min="1" step="0.01" required value="${v.price}"></div>
          <div class="field"><label for="p-neuf">Prix du neuf (€, facultatif)</label><input id="p-neuf" name="neuf" type="number" min="1" step="0.01" value="${v.neuf || ''}"><p class="hint" id="price-advice">Nous conseillons un prix 30 à 60 % sous le prix du neuf.</p></div>
          <div class="field"><label for="p-weight">Poids estimé (kg, facultatif)</label><input id="p-weight" name="weight" type="number" min="0" step="1" value="${v.weight || ''}"><p class="hint">Sert au compteur de déchets évités.</p></div>
          <div class="field"><label for="p-commune">Commune de retrait</label><select id="p-commune" name="commune">${opts(Object.keys(COMMUNES), v.commune)}</select></div>
          <div class="field span-2"><label for="p-address">Adresse de retrait</label><input id="p-address" name="address" required value="${esc(v.address)}"></div>
          <div class="field"><label for="p-deadline">Date limite de retrait</label><input id="p-deadline" name="deadline" type="date" required value="${deadline}"></div>
          <div class="field span-2"><label for="p-desc">Description</label><textarea id="p-desc" name="description" rows="3" placeholder="Origine du lot, conditionnement, défauts visibles…">${esc(v.description)}</textarea></div>
          <div class="field span-2">
            <label for="p-photos">Photos (3 au minimum)</label>
            <input id="p-photos" type="file" accept="image/*" multiple>
            ${existing ? `<p class="hint">${existing} photo${existing > 1 ? 's' : ''} actuelle${existing > 1 ? 's' : ''} : elles sont gardées si vous n'en ajoutez pas.</p>` : ''}
            <div id="photo-preview" class="photo-preview">${draftPhotos.map((p) => `<img src="${p}" alt="">`).join('')}</div>
            <label class="check"><input type="checkbox" name="examplePhotos" id="p-example"${l && l.examplePhotos ? ' checked' : ''}> Utiliser des photos d'exemple (simulation)</label>
          </div>
          <div class="field span-2">
            <label class="check"><input type="checkbox" name="certify" id="p-certify" required${l ? ' checked' : ''}> Je certifie être propriétaire du lot et qu'il ne contient pas de produit interdit : amiante, plomb, peintures ou solvants entamés, produits périmés, bouteilles de gaz, matériaux pollués.</label>
          </div>
        </div>
        <p class="form-error" id="publish-error" hidden></p>
        <div class="form-actions">
          <button class="btn">${l ? 'Enregistrer les modifications' : 'Publier l\'annonce'}</button>
          <span class="muted small">Publication gratuite et sans limite. Commission de 12 % uniquement si le lot est vendu.</span>
        </div>
      </form>`;
  }

  function viewMyLots() {
    const u = me();
    if (u.type === 'admin') return needAccount('Le compte administrateur n\'a pas d\'annonces. Les annonces se modèrent depuis l\'administration.');
    const mine = state.lots.filter((l) => l.sellerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    const label = { 'en-ligne': ['En ligne', 'ok'], vendu: ['Vendu', 'info'], retire: ['Retiré', 'muted'] };
    return `
      <section class="page-head page-head-row"><div><p class="eyebrow">Vendre</p><h1>Mes annonces</h1></div><a class="btn btn-small" href="#vendre">Publier une annonce</a></section>
      ${mine.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Lot</th><th>Prix</th><th>Publié</th><th>État</th><th></th></tr></thead>
        <tbody>${mine.map((l) => {
          const o = state.orders.find((x) => x.lotId === l.id && !['annulee'].includes(x.status));
          return `<tr><td><a href="#lot-${l.id}">${esc(l.title)}</a><br><small class="muted">${esc(qty(l))}</small></td>
            <td class="num">${money(l.price)}</td><td>${since(l.createdAt)}</td>
            <td><span class="pill pill-${label[l.status][1]}">${label[l.status][0]}</span></td>
            <td class="actions">${l.status === 'en-ligne' ? `<button class="link-btn" data-action="withdraw" data-id="${l.id}" data-confirm="Confirmer le retrait">Retirer</button>` : ''}
              ${l.status === 'retire' ? `<button class="link-btn" data-action="relist" data-id="${l.id}">Remettre en ligne</button>` : ''}
              ${l.status === 'vendu' && o ? `<a href="#commande-${o.id}">Commande CM-${o.id}</a>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`
        : `<div class="empty"><p>Vous n'avez pas encore publié d'annonce.</p>${u.roles.includes('vendeur') ? '<a class="btn btn-small" href="#vendre">Publier une annonce</a>' : ''}</div>`}`;
  }

  /* ---------- Commandes ---------- */
  function viewOrders() {
    const u = me();
    const isAdmin = u.type === 'admin';
    const buys = state.orders.filter((o) => o.buyerId === u.id);
    const sales = state.orders.filter((o) => o.sellerId === u.id);
    let tab = ui.ordersTab || (buys.length || !sales.length ? 'achats' : 'ventes');
    if (isAdmin) tab = 'toutes';
    const list = (isAdmin ? state.orders : tab === 'achats' ? buys : sales).slice().sort((a, b) => b.times.paid - a.times.paid);
    const other = (o) => (tab === 'achats' ? user(o.sellerId) : tab === 'ventes' ? user(o.buyerId) : null);
    return `
      <section class="page-head"><p class="eyebrow">Suivi</p><h1>${isAdmin ? 'Toutes les commandes' : 'Mes commandes'}</h1></section>
      ${isAdmin ? '' : `<div class="seg" role="group" aria-label="Type de commandes">
        <button type="button" data-action="orders-tab" data-tab="achats" aria-pressed="${tab === 'achats'}">Achats (${buys.length})</button>
        <button type="button" data-action="orders-tab" data-tab="ventes" aria-pressed="${tab === 'ventes'}">Ventes (${sales.length})</button>
      </div>`}
      ${list.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Commande</th><th>Lot</th><th>${isAdmin ? 'Vendeur → acheteur' : tab === 'achats' ? 'Vendeur' : 'Acheteur'}</th><th>Mode</th><th class="num">${tab === 'ventes' ? 'Net vendeur' : 'Total'}</th><th>Statut</th></tr></thead>
        <tbody>${list.map((o) => `<tr>
          <td><a href="#commande-${o.id}">CM-${o.id}</a><br><small class="muted">${fmtDate(o.times.paid)}</small></td>
          <td>${esc(lotById(o.lotId).title)}</td>
          <td>${isAdmin ? `${esc(user(o.sellerId).name)} → ${esc(user(o.buyerId).name)}` : esc(other(o).name)}</td>
          <td>${o.mode === 'livraison' ? 'Livraison' : 'Retrait'}</td>
          <td class="num">${money(tab === 'ventes' ? (['annulee', 'remboursee', 'retractee'].includes(o.status) ? 0 : r2((o.price - Math.min(o.refund, o.price)) * (1 - COMMISSION))) : total(o))}</td>
          <td>${pill(o.status)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><p>${tab === 'achats' ? 'Aucun achat pour l\'instant.' : 'Aucune vente pour l\'instant.'}</p><a class="btn btn-small" href="${tab === 'achats' ? '#catalogue' : '#vendre'}">${tab === 'achats' ? 'Voir les lots disponibles' : 'Publier une annonce'}</a></div>`}`;
  }

  function steps(o) {
    const flow = o.mode === 'livraison'
      ? [['payee', 'Payée'], ['transport', 'Prise en charge'], ['livree', 'Livrée'], ['recue', 'Réception confirmée'], ['versee', 'Vendeur payé']]
      : [['payee', 'Payée'], ['recue', 'Lot retiré'], ['versee', 'Vendeur payé']];
    let cur = flow.findIndex((f) => f[0] === o.status);
    if (o.status === 'litige') cur = flow.findIndex((f) => f[0] === (o.mode === 'livraison' ? 'livree' : 'recue'));
    if (cur < 0) cur = -1;
    return `<ol class="steps-line">${flow.map(([, label], i) => `<li class="${i < cur ? 'done' : i === cur ? 'current' : ''}"><span>${label}</span></li>`).join('')}</ol>`;
  }

  function viewOrder(id) {
    const o = orderById(id);
    if (!o) return notFound('Cette commande n\'existe pas.');
    const u = me();
    const l = lotById(o.lotId);
    const buyer = user(o.buyerId);
    const seller = user(o.sellerId);
    const isBuyer = u.id === o.buyerId;
    const isSeller = u.id === o.sellerId;
    const isAdmin = u.type === 'admin';
    if (!isBuyer && !isSeller && !isAdmin) {
      return `<section class="panel"><h1 class="h3">Commande CM-${o.id}</h1><p>Cette commande concerne ${esc(buyer.name)} et ${esc(seller.name)}. Changez de compte pour la suivre.</p>
        <button class="btn btn-small" data-action="switch" data-id="${o.buyerId}" data-link="#commande-${o.id}">Passer sur le compte acheteur</button>
        <button class="btn btn-small btn-ghost" data-action="switch" data-id="${o.sellerId}" data-link="#commande-${o.id}">Passer sur le compte vendeur</button></section>`;
    }
    const t = now();
    const actions = [];
    const banner = [];
    const retractOk = buyer.type === 'particulier' && seller.type === 'pro' && ['recue', 'versee'].includes(o.status) && t - o.times.received <= 14 * D;
    const claimOk = (o.status === 'livree') || (o.status === 'recue' && t - o.times.received <= 48 * H);
    const rateOk = ['recue', 'versee'].includes(o.status) && !o.rating && t - o.times.received <= 30 * D;

    if (isBuyer) {
      if (o.status === 'payee' && o.mode === 'retrait') {
        banner.push(`Rendez-vous à l'adresse de retrait : <strong>${esc(l.address)}, ${esc(l.commune)}</strong>, avant le ${fmtDay(l.deadline)}. Vérifiez le lot avant de l'emporter.`);
        actions.push(`<button class="btn" data-action="picked" data-id="${o.id}">J'ai retiré le lot, il est conforme</button>`);
      }
      if (o.status === 'payee') actions.push(`<button class="btn btn-ghost" data-action="cancel" data-id="${o.id}" data-confirm="Confirmer l'annulation (remboursement intégral)">Annuler la commande</button>`);
      if (o.status === 'payee' && o.mode === 'livraison') banner.push('Le transporteur prend le lot en charge sous 24 h. Avancez le temps pour simuler la livraison.');
      if (o.status === 'transport') banner.push('Votre lot est chez le transporteur. Livraison prévue dans les prochaines 24 h.');
      if (o.status === 'livree') {
        banner.push(`Vérifiez le lot. Sans réponse de votre part, la réception sera confirmée automatiquement le ${fmtDate(o.times.delivered + 48 * H)}.`);
        actions.push(`<button class="btn" data-action="confirm" data-id="${o.id}">Confirmer la réception</button>`);
      }
      if (retractOk) actions.push(`<button class="btn btn-ghost" data-action="retract" data-id="${o.id}" data-confirm="Confirmer la rétractation">Me rétracter</button>`);
    }
    if (isSeller) {
      if (o.status === 'payee' && o.mode === 'retrait') {
        banner.push(`${esc(buyer.name)} viendra retirer le lot à votre adresse. Remettez-le, puis confirmez la remise.`);
        actions.push(`<button class="btn" data-action="picked" data-id="${o.id}">Lot remis à l'acheteur</button>`);
      }
      if (o.status === 'payee' && o.mode === 'livraison') banner.push('Préparez le lot : le transporteur partenaire passe le récupérer sous 24 h.');
      if (['livree', 'recue'].includes(o.status)) banner.push('Le paiement vous est versé 48 h après la confirmation de réception.');
      if (o.status === 'litige') banner.push('Une réclamation est en cours : votre paiement est bloqué pendant l\'examen par ChantierMarket.');
    }

    const amounts = isSeller && !isAdmin
      ? `<div><span>Prix de vente</span><span>${money(o.price)}</span></div>
         ${o.refund ? `<div><span>Remboursé à l'acheteur</span><span>− ${money(Math.min(o.refund, o.price))}</span></div>` : ''}
         <div><span>Commission ChantierMarket (12 %)</span><span>− ${money(r2((o.price - Math.min(o.refund, o.price)) * COMMISSION))}</span></div>
         <div class="sum-total"><span>Montant net</span><span>${money(r2((o.price - Math.min(o.refund, o.price)) * (1 - COMMISSION)))}</span></div>
         <p class="small muted">${o.status === 'versee' ? `Versé le ${fmtDate(o.times.paidOut)}.` : o.status === 'litige' ? 'Versement bloqué pendant la réclamation.' : ['annulee', 'remboursee', 'retractee'].includes(o.status) ? 'Aucun versement : la vente a été annulée ou remboursée.' : 'Versement 48 h après la confirmation de réception.'}</p>`
      : `<div><span>Prix du lot</span><span>${money(o.price)}</span></div>
         <div><span>Livraison</span><span>${o.feeHT ? `${money(r2(o.feeHT * (1 + TVA)))} TTC (${money(o.feeHT)} HT)` : 'Retrait gratuit'}</span></div>
         <div class="sum-total"><span>Total payé</span><span>${money(total(o))}</span></div>
         ${o.refund ? `<div class="refund"><span>Remboursé</span><span>${money(o.refund)}</span></div>` : ''}
         <p class="small muted">Payé par ${o.pay === 'carte' ? 'carte bancaire' : 'virement'} le ${fmtDate(o.times.paid)}.${isAdmin ? ` Commission : ${money(r2((o.price - Math.min(o.refund, o.price)) * COMMISSION))}.` : ''}</p>`;

    const statusBanner = {
      annulee: 'Commande annulée. L\'acheteur a été remboursé intégralement et le lot est de nouveau en vente.',
      remboursee: 'Réclamation acceptée : l\'acheteur a été remboursé intégralement.',
      retractee: 'Rétractation enregistrée. L\'acheteur restitue le lot au vendeur sous 14 jours (frais de retour à sa charge) et il est remboursé du prix et des frais de livraison.'
    }[o.status];

    const otherId = isBuyer ? o.sellerId : o.buyerId;
    return `
      <p class="crumbs"><a href="#commandes">← Mes commandes</a></p>
      <section class="page-head page-head-row">
        <div><p class="eyebrow">Commande CM-${o.id}</p><h1>${esc(l.title)}</h1>
        <p class="muted">${esc(qty(l))} · ${o.mode === 'livraison' ? `Livraison, ${String(o.km).replace('.', ',')} km` : 'Retrait sur place'} · ${esc(seller.name)} → ${esc(buyer.name)}</p></div>
        ${pill(o.status)}
      </section>
      ${steps(o)}
      ${statusBanner ? `<p class="banner">${statusBanner}</p>` : ''}
      ${banner.map((b) => `<p class="banner banner-info">${b}</p>`).join('')}
      ${actions.length ? `<div class="action-row">${actions.join('')}</div>` : ''}

      <div class="order-layout">
        <div class="order-main">
          ${o.status === 'litige' ? claimBlock(o, isAdmin) : ''}
          ${o.claim && o.status !== 'litige' ? `<section class="panel"><h2 class="h3">Réclamation</h2><p>« ${esc(o.claim.text)} »</p><p class="small muted">Décision : ${esc(o.claim.resolution || '')}</p></section>` : ''}
          ${isBuyer && claimOk ? `
            <details class="panel claim">
              <summary>Signaler un problème</summary>
              <form data-form="claim" data-id="${o.id}" class="form">
                <p class="small">Le lot ne correspond pas à l'annonce (quantité, nature, état) ? Décrivez le problème avec des photos. Le paiement du vendeur est bloqué pendant l'examen, et ChantierMarket propose une solution sous 5 jours ouvrés.</p>
                <div class="field"><label for="claim-text">Description du problème</label><textarea id="claim-text" name="text" rows="3" required></textarea></div>
                <div class="field"><label for="claim-photos">Photos</label><input id="claim-photos" type="file" accept="image/*" multiple></div>
                <button class="btn btn-small">Envoyer la réclamation</button>
              </form>
            </details>` : ''}
          ${isBuyer && rateOk ? `
            <form class="panel form" data-form="rate" data-id="${o.id}">
              <h2 class="h3">Noter ${esc(seller.name)}</h2>
              <div class="stars-input" role="radiogroup" aria-label="Note sur 5">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="stars" value="${n}"${n === 5 ? ' checked' : ''}><span>${n} ★</span></label>`).join('')}</div>
              <div class="field"><label for="rate-comment">Commentaire</label><textarea id="rate-comment" name="comment" rows="2" placeholder="Lot conforme, vendeur ponctuel…"></textarea></div>
              <button class="btn btn-small">Publier mon avis</button>
            </form>` : ''}
          ${o.rating ? `<section class="panel"><h2 class="h3">Avis de l'acheteur</h2><p><span class="stars">${'★'.repeat(o.rating.stars)}${'☆'.repeat(5 - o.rating.stars)}</span> ${esc(o.rating.comment)}</p><p class="small muted">${fmtDate(o.rating.at)}</p></section>` : ''}
          <section class="panel">
            <h2 class="h3">Historique</h2>
            <ol class="events">${o.events.slice().sort((a, b) => b.at - a.at).map((e) => `<li><time>${fmtDate(e.at)}</time><span>${esc(e.text)}</span></li>`).join('')}</ol>
          </section>
        </div>
        <aside class="order-side">
          <section class="panel"><h2 class="h3">${isSeller && !isAdmin ? 'Votre vente' : 'Paiement'}</h2><div class="summary">${amounts}</div></section>
          ${!isAdmin ? `<section class="panel"><h2 class="h3">${isBuyer ? 'Vendeur' : 'Acheteur'}</h2><p><strong>${esc(user(otherId).name)}</strong><br><span class="muted small">${typeLabel(user(otherId))} · ${esc(user(otherId).commune)}</span></p>
            <p class="small">Téléphone : ${user(otherId).prefs && user(otherId).prefs.telephone === false ? 'masqué (contactez-le par message)' : esc(user(otherId).phone || 'non communiqué')}</p>
            <a class="btn btn-small btn-ghost" href="#messages-${o.lotId}-${otherId}">Envoyer un message</a></section>` : ''}
          ${buyer.type === 'pro' && (isBuyer || isAdmin) ? `<section class="panel"><h2 class="h3">Facture</h2>${invoice(o)}</section>` : ''}
        </aside>
      </div>`;
  }

  function invoice(o) {
    const seller = user(o.sellerId);
    const lotHT = seller.type === 'pro' ? r2(o.price / (1 + TVA)) : o.price;
    const lotTVA = seller.type === 'pro' ? r2(o.price - lotHT) : 0;
    return `<div class="summary">
      <div><span>Lot, hors taxes</span><span>${money(lotHT)}</span></div>
      <div><span>TVA sur le lot</span><span>${seller.type === 'pro' ? money(lotTVA) : 'Non applicable'}</span></div>
      ${o.feeHT ? `<div><span>Livraison HT</span><span>${money(o.feeHT)}</span></div><div><span>TVA sur la livraison</span><span>${money(r2(o.feeHT * TVA))}</span></div>` : ''}
      <div class="sum-total"><span>Total TTC</span><span>${money(total(o))}</span></div>
    </div><p class="small muted">Facture n° F-${o.id} au nom de ${esc(user(o.buyerId).name)} (SIRET ${esc(user(o.buyerId).siret || '')}).</p>`;
  }

  function claimBlock(o, isAdmin) {
    return `<section class="panel panel-alert">
      <h2 class="h3">Réclamation en cours</h2>
      <p>« ${esc(o.claim.text)} »</p>
      <p class="small muted">Déposée le ${fmtDate(o.claim.at)}${o.claim.photos ? ` avec ${o.claim.photos} photo${o.claim.photos > 1 ? 's' : ''}` : ''}. Réponse de ChantierMarket sous 5 jours ouvrés.</p>
      ${isAdmin ? `
        <form class="form resolve" data-form="resolve" data-id="${o.id}">
          <fieldset><legend>Décision</legend>
            <label class="option"><input type="radio" name="decision" value="total" checked><span>Remboursement total (${money(total(o))})</span></label>
            <label class="option"><input type="radio" name="decision" value="partiel"><span>Remboursement partiel de <input type="number" name="amount" id="resolve-amount" min="1" max="${o.price}" step="0.01" value="${r2(o.price * 0.25)}" aria-label="Montant remboursé"> €</span></label>
            <label class="option"><input type="radio" name="decision" value="rejet"><span>Rejeter la réclamation (le vendeur est payé sous 48 h)</span></label>
          </fieldset>
          <button class="btn btn-small">Appliquer la décision</button>
        </form>` : ''}
    </section>`;
  }

  /* ---------- Messages ---------- */
  function msgBubble(m) {
    const mine = m.from === state.current;
    return `<div class="bubble${mine ? ' bubble-me' : ''}"><p>${esc(m.text)}</p><span class="small muted">${mine ? 'Vous' : esc(user(m.from).name)} · ${fmtDate(m.at)}</span></div>`;
  }

  function viewMessages(lotId, otherId) {
    const u = me();
    const threads = {};
    state.messages.filter((m) => m.from === u.id || m.to === u.id).forEach((m) => {
      const other = m.from === u.id ? m.to : m.from;
      const k = `${m.lotId}-${other}`;
      (threads[k] = threads[k] || { lotId: m.lotId, other, msgs: [] }).msgs.push(m);
    });
    if (lotId && otherId && !threads[`${lotId}-${otherId}`] && lotById(lotId) && user(otherId)) threads[`${lotId}-${otherId}`] = { lotId: +lotId, other: otherId, msgs: [] };
    const list = Object.values(threads).sort((a, b) => (b.msgs.length ? b.msgs[b.msgs.length - 1].at : now()) - (a.msgs.length ? a.msgs[a.msgs.length - 1].at : now()));
    const cur = lotId && otherId ? threads[`${lotId}-${otherId}`] : null;
    return `
      <section class="page-head"><p class="eyebrow">Messagerie</p><h1>Messages</h1></section>
      ${list.length ? `<div class="inbox">
        <ul class="threads">${list.map((th) => {
          const last = th.msgs[th.msgs.length - 1];
          const active = cur && th.lotId === cur.lotId && th.other === cur.other;
          return `<li><a href="#messages-${th.lotId}-${th.other}" class="${active ? 'active' : ''}"><strong>${esc(user(th.other).name)}</strong><span class="small">${esc(lotById(th.lotId).title)}</span><span class="small muted">${last ? esc(last.text.slice(0, 60)) : 'Nouvelle conversation'}</span></a></li>`;
        }).join('')}</ul>
        <div class="conversation">${cur ? `
          <h2 class="h3">${esc(user(cur.other).name)} · <a href="#lot-${cur.lotId}">${esc(lotById(cur.lotId).title)}</a></h2>
          <div class="thread">${cur.msgs.map(msgBubble).join('') || '<p class="muted">Écrivez le premier message.</p>'}</div>
          <form data-form="message" data-lot="${cur.lotId}" data-to="${cur.other}" class="msg-form">
            <label for="msg-reply" class="sr-only">Votre message</label>
            <textarea id="msg-reply" name="text" rows="2" required></textarea>
            <button class="btn btn-small">Envoyer</button>
          </form>` : '<p class="muted">Choisissez une conversation.</p>'}</div>
      </div>` : '<div class="empty"><p>Aucune conversation. Posez une question à un vendeur depuis la fiche d\'un lot.</p><a class="btn btn-small" href="#catalogue">Voir les lots</a></div>'}`;
  }

  /* ---------- Alertes et notifications ---------- */
  function matches(a, l) {
    return (!a.q || norm(`${l.title} ${l.description}`).includes(norm(a.q))) && (!a.cat || a.cat === l.category) && (!a.max || l.price <= a.max);
  }

  function viewAlerts() {
    const u = me();
    if (u.type === 'admin') return needAccount('Les alertes sont réservées aux acheteurs.');
    const mine = state.alerts.filter((a) => a.userId === u.id);
    return `
      <section class="page-head"><p class="eyebrow">Alertes</p><h1>Alertes sur un matériau recherché</h1>
        <p class="lead">Enregistrez ce que vous cherchez : vous recevez une notification dès qu'un lot correspondant est publié.</p></section>
      <form class="panel form form-row" data-form="alert">
        <div class="field grow"><label for="a-q">Mot-clé</label><input id="a-q" name="q" placeholder="Ex. : parpaing, BA13, fenêtre" required></div>
        <div class="field"><label for="a-cat">Catégorie</label><select id="a-cat" name="cat"><option value="">Toutes</option>${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="a-max">Prix maximum (€)</label><input id="a-max" name="max" type="number" min="1"></div>
        <button class="btn btn-small">Créer l'alerte</button>
      </form>
      ${mine.length ? `<ul class="alert-list">${mine.map((a) => {
        const n = state.lots.filter((l) => l.status === 'en-ligne' && l.sellerId !== u.id && matches(a, l)).length;
        return `<li><div><strong>« ${esc(a.q)} »</strong> <span class="muted small">${a.cat ? esc(a.cat) : 'Toutes catégories'}${a.max ? ` · jusqu'à ${money(a.max)}` : ''}</span><br>
          <span class="small">${n} lot${n > 1 ? 's' : ''} correspondant${n > 1 ? 's' : ''} en ce moment</span>${n ? ` · <button class="link-btn small" data-action="alert-search" data-q="${esc(a.q)}" data-cat="${esc(a.cat)}">Voir</button>` : ''}</div>
          <button class="link-btn" data-action="alert-delete" data-id="${a.id}">Supprimer</button></li>`;
      }).join('')}</ul>` : '<p class="muted">Aucune alerte enregistrée.</p>'}`;
  }

  function channels() {
    const c = (me().prefs || defaultPrefs()).canaux;
    return ['Application'].concat(c.email ? ['e-mail'] : [], c.sms ? ['SMS'] : []).join(' · ');
  }

  function viewNotifs() {
    const list = state.notifs.filter((n) => n.userId === me().id).sort((a, b) => b.at - a.at);
    return `
      <section class="page-head"><p class="eyebrow">Notifications</p><h1>Notifications de ${esc(me().name)}</h1>
        <p class="lead">Les e-mails, SMS et alertes de l'application apparaissent ici pendant la simulation.</p></section>
      ${list.length ? `<ul class="notif-list">${list.map((n) => `<li class="${n.read ? '' : 'unread'}"><time>${fmtDate(n.at)}</time><div>${n.link ? `<a href="${n.link}">${esc(n.text)}</a>` : `<span>${esc(n.text)}</span>`}<br><small class="muted">${channels()}</small></div></li>`).join('')}</ul>`
        : '<p class="muted">Aucune notification.</p>'}`;
  }

  /* ---------- Compte ---------- */
  function wasteKg(u) {
    let sold = 0;
    let bought = 0;
    state.orders.filter((o) => ['recue', 'versee'].includes(o.status)).forEach((o) => {
      const w = lotById(o.lotId).weight || 0;
      if (o.sellerId === u.id) sold += w;
      if (o.buyerId === u.id) bought += w;
    });
    return { sold, bought };
  }
  const tonnes = (kg) => `${(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} t`;

  function viewAccount() {
    const u = me();
    if (u.type === 'admin') return `<section class="page-head"><p class="eyebrow">Mon compte</p><h1>${esc(u.name)}</h1><p class="lead">${esc(u.about)}</p></section><a class="btn" href="#admin">Ouvrir l'administration</a>`;
    const w = wasteKg(u);
    const sales = state.orders.filter((o) => o.sellerId === u.id);
    const paid = sales.filter((o) => o.status === 'versee').reduce((s, o) => s + o.payout, 0);
    const pending = sales.filter((o) => ['payee', 'transport', 'livree', 'recue', 'litige'].includes(o.status)).reduce((s, o) => s + r2(o.price * (1 - COMMISSION)), 0);
    const reqs = state.requests.filter((r) => r.userId === u.id);
    const reqLabel = { demandee: ['Demande envoyée', 'info'], planifiee: ['Planifié', 'warn'], effectuee: ['Effectué', 'ok'] };
    const verif = u.type === 'pro'
      ? `<li>SIRET ${esc(u.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4'))} <span class="chip chip-ok">Vérifié</span></li><li>Extrait Kbis de moins de 3 mois <span class="chip ${u.kbis ? 'chip-ok' : ''}">${u.kbis ? 'Fourni' : 'Manquant'}</span></li>`
      : `<li>E-mail <span class="chip chip-ok">Vérifié</span></li><li>Téléphone <span class="chip chip-ok">Vérifié</span></li><li>Pièce d'identité <span class="chip ${u.idVerified ? 'chip-ok' : ''}">${u.idVerified ? 'Vérifiée' : 'Demandée pour vendre'}</span></li>`;
    return `
      <section class="page-head page-head-row">
        <div class="account-title">${avatar(u, 'avatar-lg')}<div><p class="eyebrow">Mon compte</p><h1>${esc(u.name)}</h1><p class="muted">${typeLabel(u)} · ${esc(u.commune)} · ${roleChips(u)}${u.premium ? ' <span class="chip chip-sponso">Premium</span>' : ''}</p></div></div>
      </section>

      <div class="stat-row">
        <div class="stat"><span class="stat-value">${tonnes(w.sold)}</span><span class="stat-label">de matériaux sauvés de la décharge grâce à vos ventes</span></div>
        <div class="stat"><span class="stat-value">${tonnes(w.bought)}</span><span class="stat-label">de matériaux réemployés grâce à vos achats</span></div>
        <div class="stat"><span class="stat-value">${money(paid)}</span><span class="stat-label">versés sur vos ventes</span></div>
        <div class="stat"><span class="stat-value">${money(pending)}</span><span class="stat-label">en attente de versement</span></div>
      </div>

      <div class="account-grid">
        <section class="panel">
          <h2 class="h3">Profil</h2>
          <form class="form" data-form="profile">
            <div class="field"><label for="acc-commune">Commune (sert au calcul des distances)</label><select id="acc-commune" name="commune">${Object.keys(COMMUNES).map((c) => `<option${c === u.commune ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
            <div class="field"><label for="acc-address">Adresse de retrait et de livraison</label><input id="acc-address" name="address" value="${esc(u.address || '')}"></div>
            <fieldset class="field"><legend>Je souhaite</legend><div class="choices-row">
              <label class="check"><input type="checkbox" name="acheteur"${u.roles.includes('acheteur') ? ' checked' : ''}> Acheter</label>
              <label class="check"><input type="checkbox" name="vendeur"${u.roles.includes('vendeur') ? ' checked' : ''}> Vendre</label></div></fieldset>
            <button class="btn btn-small">Enregistrer</button>
          </form>
          <h3 class="h4">Vérifications</h3>
          <ul class="verif">${verif}</ul>
          <p class="small muted">Contact : ${esc(u.email || '')} · ${esc(u.phone || '')}</p>
        </section>

        ${u.type === 'pro' ? `
        <section class="panel ${u.premium ? 'panel-premium' : ''}">
          <h2 class="h3">Abonnement Premium</h2>
          <p>${money(PREMIUM_HT)} HT par mois : navigation sans publicité et livraison prioritaire, en 24 h au lieu de 48 h. Sans engagement.</p>
          ${u.premium
            ? `<p><span class="chip chip-sponso">Actif</span> depuis le ${fmtDay(u.premiumSince)} · ${u.monthsPaid} mois payé${u.monthsPaid > 1 ? 's' : ''}</p>
               <p class="small">${u.cancelled ? `Résilié : l'abonnement s'arrête le ${fmtDay(u.renewAt)}.` : `Prochain renouvellement le ${fmtDay(u.renewAt)}.`}</p>
               ${u.cancelled ? `<button class="btn btn-small" data-action="premium-resume">Reprendre l'abonnement</button>` : `<button class="btn btn-small btn-ghost" data-action="premium-cancel" data-confirm="Confirmer la résiliation">Résilier</button>`}`
            : `<button class="btn btn-small" data-action="premium-subscribe">S'abonner pour ${money(PREMIUM_HT)} HT par mois (simulation)</button>`}
        </section>` : ''}

        <section class="panel">
          <h2 class="h3">Enlèvement des déchets sur chantier</h2>
          <p class="small">Nous venons récupérer vos déchets et surplus directement sur le chantier.</p>
          <form class="form" data-form="pickup">
            <div class="field"><label for="pk-address">Adresse du chantier</label><input id="pk-address" name="address" required value="${esc(u.address || '')}"></div>
            <div class="form-grid">
              <div class="field"><label for="pk-volume">Volume estimé</label><select id="pk-volume" name="volume"><option>Moins de 3 m³</option><option>3 à 8 m³</option><option>8 à 15 m³</option><option>Plus de 15 m³</option></select></div>
              <div class="field"><label for="pk-date">Date souhaitée</label><input id="pk-date" name="date" type="date" required value="${new Date(now() + 3 * D).toISOString().slice(0, 10)}"></div>
            </div>
            <div class="field"><label for="pk-types">Types de déchets</label><input id="pk-types" name="types" required placeholder="Chutes de bois, gravats, emballages…"></div>
            <button class="btn btn-small">Demander un enlèvement</button>
          </form>
          ${reqs.length ? `<ul class="req-list">${reqs.map((r) => `<li><span>${esc(r.types)} · ${esc(r.volume)}<br><small class="muted">${esc(r.address)}${r.plannedFor ? ` · passage le ${fmtDay(r.plannedFor)}` : ` · souhaité le ${fmtDay(r.wish)}`}</small></span><span class="pill pill-${reqLabel[r.status][1]}">${reqLabel[r.status][0]}</span></li>`).join('')}</ul>` : ''}
        </section>
      </div>`;
  }

  /* ---------- Inscription ---------- */
  function viewSignup() {
    if (!ui.code) ui.code = String(Math.floor(100000 + Math.random() * 900000));
    return `
      <section class="page-head"><p class="eyebrow">Inscription</p><h1>Créer un compte</h1>
        <p class="lead">L'inscription est gratuite et réservée aux personnes majeures.</p></section>
      <form class="form panel" data-form="signup" novalidate>
        <fieldset class="field"><legend>Vous êtes</legend><div class="choices-row">
          <label class="option-card"><input type="radio" name="type" value="pro" checked><span><strong>Une entreprise</strong><small>BTP, artisan, fournisseur</small></span></label>
          <label class="option-card"><input type="radio" name="type" value="particulier"><span><strong>Un particulier</strong><small>Autoconstruction, rénovation</small></span></label></div></fieldset>
        <div class="form-grid">
          <div class="field span-2"><label for="s-name" id="s-name-label">Raison sociale</label><input id="s-name" name="name" required autocomplete="organization"></div>
          <div class="field" data-for="pro"><label for="s-siret">Numéro SIRET (14 chiffres)</label><input id="s-siret" name="siret" inputmode="numeric" placeholder="123 456 789 00012"></div>
          <div class="field" data-for="pro"><label for="s-kbis">Extrait Kbis de moins de 3 mois</label><input id="s-kbis" type="file" accept=".pdf,image/*"><p class="hint">Simulation : facultatif.</p></div>
          <div class="field"><label for="s-email">E-mail</label><input id="s-email" name="email" type="email" required autocomplete="email"></div>
          <div class="field"><label for="s-phone">Téléphone</label><input id="s-phone" name="phone" type="tel" required autocomplete="tel"></div>
          <div class="field"><label for="s-pwd">Mot de passe</label><input id="s-pwd" name="pwd" type="password" required autocomplete="new-password"><p class="hint">8 caractères minimum.</p></div>
          <div class="field"><label for="s-pwd2">Confirmation du mot de passe</label><input id="s-pwd2" name="pwd2" type="password" required autocomplete="new-password"></div>
          <div class="field" data-for="particulier" hidden><label for="s-code">Code reçu par SMS</label><input id="s-code" name="code" inputmode="numeric" maxlength="6"><p class="hint">Simulation : votre code est <strong>${ui.code}</strong>.</p></div>
          <div class="field"><label for="s-commune">Commune</label><select id="s-commune" name="commune">${Object.keys(COMMUNES).map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
          <div class="field span-2"><label for="s-address">Adresse</label><input id="s-address" name="address" required autocomplete="street-address"></div>
        </div>
        <fieldset class="field"><legend>Je souhaite</legend><div class="choices-row">
          <label class="check"><input type="radio" name="roles" value="acheteur" checked> Acheter</label>
          <label class="check"><input type="radio" name="roles" value="vendeur"> Vendre</label>
          <label class="check"><input type="radio" name="roles" value="les-deux"> Les deux</label></div></fieldset>
        <label class="check"><input type="checkbox" name="adult" id="s-adult"> J'ai 18 ans ou plus.</label>
        <label class="check"><input type="checkbox" name="cgu" id="s-cgu"> J'accepte les <a href="cgu.html">conditions générales d'utilisation</a> et la <a href="confidentialite.html">politique de confidentialité</a>.</label>
        <p class="form-error" id="signup-error" hidden></p>
        <button class="btn">Créer mon compte</button>
      </form>`;
  }

  /* ---------- Administration ---------- */
  function viewAdmin() {
    const u = me();
    if (u.type !== 'admin') {
      return `<section class="panel"><h1 class="h3">Administration</h1><p>Cette page est réservée à l'équipe ChantierMarket.</p><button class="btn btn-small" data-action="switch" data-id="admin" data-link="#admin">Passer sur le compte administrateur</button></section>`;
    }
    const valid = state.orders.filter((o) => !['annulee', 'remboursee', 'retractee'].includes(o.status));
    const gmv = valid.reduce((s, o) => s + o.price - Math.min(o.refund, o.price), 0);
    const commissions = valid.reduce((s, o) => s + (o.price - Math.min(o.refund, o.price)) * COMMISSION, 0);
    const delivery = valid.filter((o) => o.mode === 'livraison').reduce((s, o) => s + o.feeHT * DELIVERY_SHARE, 0);
    const premium = state.users.reduce((s, x) => s + (x.monthsPaid || 0) * PREMIUM_HT, 0);
    const kg = state.orders.filter((o) => ['recue', 'versee'].includes(o.status)).reduce((s, o) => s + (lotById(o.lotId).weight || 0), 0);
    const claims = state.orders.filter((o) => o.status === 'litige');
    const reports = state.reports.filter((r) => r.status === 'ouvert');
    const reqs = state.requests.filter((r) => r.status !== 'effectuee');
    const stat = (v, label) => `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${label}</span></div>`;
    return `
      <section class="page-head"><p class="eyebrow">Administration</p><h1>Tableau de bord</h1></section>
      <div class="stat-row">
        ${stat(state.lots.filter((l) => l.status === 'en-ligne').length, 'lots en ligne')}
        ${stat(state.lots.filter((l) => l.status === 'vendu').length, 'lots vendus')}
        ${stat(money(gmv), 'de matériaux vendus')}
        ${stat(money(r2(commissions)), 'de commissions (12 %)')}
        ${stat(money(r2(delivery)), 'de part sur les livraisons (15 %)')}
        ${stat(money(premium), 'd\'abonnements Premium HT')}
        ${stat(tonnes(kg), 'évitées en décharge')}
      </div>

      <h2 class="section-title">Réclamations à traiter (${claims.length})</h2>
      ${claims.length ? claims.map((o) => `<div class="admin-item"><div><a href="#commande-${o.id}"><strong>CM-${o.id}</strong> · ${esc(lotById(o.lotId).title)}</a><br><span class="small">${esc(user(o.buyerId).name)} contre ${esc(user(o.sellerId).name)} : « ${esc(o.claim.text)} »</span></div><a class="btn btn-small" href="#commande-${o.id}">Traiter</a></div>`).join('') : '<p class="muted">Aucune réclamation en cours.</p>'}

      <h2 class="section-title">Signalements (${reports.length})</h2>
      ${reports.length ? reports.map((r) => `<div class="admin-item"><div><a href="#lot-${r.lotId}"><strong>${esc(lotById(r.lotId).title)}</strong></a><br><span class="small">${esc(r.reason)} · signalé par ${esc(user(r.userId).name)} ${since(r.at)}</span></div>
        <div class="btn-group"><button class="btn btn-small btn-danger" data-action="report-remove" data-id="${r.id}">Retirer l'annonce</button><button class="btn btn-small btn-ghost" data-action="report-dismiss" data-id="${r.id}">Classer</button></div></div>`).join('') : '<p class="muted">Aucun signalement.</p>'}

      <h2 class="section-title">Enlèvements sur chantier (${reqs.length})</h2>
      ${reqs.length ? reqs.map((r) => `<div class="admin-item"><div><strong>${esc(user(r.userId).name)}</strong> · ${esc(r.volume)}<br><span class="small">${esc(r.types)} · ${esc(r.address)} · ${r.plannedFor ? `passage le ${fmtDay(r.plannedFor)}` : `souhaité le ${fmtDay(r.wish)}`}</span></div>
        ${r.status === 'demandee' ? `<button class="btn btn-small" data-action="req-plan" data-id="${r.id}">Planifier le passage</button>` : `<button class="btn btn-small" data-action="req-done" data-id="${r.id}">Marquer comme effectué</button>`}</div>`).join('') : '<p class="muted">Aucune demande en cours.</p>'}

      <h2 class="section-title">Utilisateurs</h2>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Nom</th><th>Profil</th><th>Rôles</th><th class="num">Ventes</th><th>Note</th><th>Statut</th></tr></thead>
        <tbody>${state.users.filter((x) => x.type !== 'admin').map((x) => {
          const st = sellerStats(x.id);
          return `<tr><td>${esc(x.name)}</td><td>${typeLabel(x)}${x.premium ? ' · Premium' : ''}</td><td>${x.roles.join(', ')}</td><td class="num">${st.sales}</td><td>${st.count ? `${st.avg.toFixed(1).replace('.', ',')}/5` : '—'}</td><td>${isSuspended(x.id) ? '<span class="pill pill-alert">Suspendu</span>' : '<span class="pill pill-ok">Actif</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="muted small">Règle appliquée : un vendeur dont la note moyenne est inférieure à 3 sur 5 après 10 ventes est suspendu.</p>`;
  }

  /* ---------- Connexion ---------- */
  function login(id, link) {
    const u = user(id);
    state.current = id;
    u.prefs = u.prefs || defaultPrefs();
    ui.maxKm = u.prefs.rayon || '';
    ui.loginReason = '';
    ui.forgot = '';
    const dest = link || ui.after || (location.hash === '#connexion' || !location.hash ? '#accueil' : location.hash);
    ui.after = '';
    save();
    toast(`Bonjour ${u.name} : vous êtes connecté.`);
    go(dest);
    render();
  }

  /* ---------- Actions ---------- */
  const actions = {
    switch(d) {
      login(d.id, d.link);
    },
    logout() {
      const name = me() ? me().name : '';
      state.current = null;
      ui.after = '';
      save();
      toast(name ? `${name} est déconnecté.` : 'Vous êtes déconnecté.');
      go('#accueil');
      render();
    },
    remember(d) { ui.after = d.after; ui.loginReason = 'acheter ce lot'; go('#connexion'); },
    forgot() { ui.forgot = 'email'; render(true); },
    'forgot-cancel'() { ui.forgot = ''; render(true); },
    fav(d) {
      const u = me();
      if (!u) { ui.after = location.hash; ui.loginReason = 'garder vos annonces favorites'; go('#connexion'); return; }
      u.favs = u.favs || [];
      const id = +d.id;
      const on = u.favs.includes(id);
      u.favs = on ? u.favs.filter((x) => x !== id) : u.favs.concat(id);
      save();
      toast(on ? 'Retiré de vos favoris.' : 'Ajouté à vos favoris. Vous serez prévenu si le prix baisse.');
      if (parseRoute().name === 'catalogue') renderResults(); else render(true);
    },
    share(d) {
      const url = `${location.href.split('#')[0]}#lot-${d.id}`;
      const box = $('#share-box');
      const show = (ok) => {
        box.hidden = false;
        box.innerHTML = `${ok ? 'Lien copié : ' : 'Copiez ce lien : '}<input id="share-url" value="${esc(url)}" readonly aria-label="Lien de l'annonce">`;
        if (!ok) { const i = $('#share-url'); i.focus(); i.select(); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => show(true), () => show(false));
      else show(false);
    },
    cat(d) { ui.cat = d.cat; ui.commune = ''; go('#catalogue'); render(); },
    'sort-urgent'() { ui.sort = 'urgent'; ui.cat = ''; ui.commune = ''; go('#catalogue'); },
    'sort-recent'() { ui.sort = 'recent'; ui.cat = ''; ui.commune = ''; go('#catalogue'); },
    'scroll-to'(d) { const el = document.getElementById(d.target); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'theme-toggle'() {
      const s = readSettings();
      s.theme = isDark() ? 'clair' : 'sombre';
      writeSettings(s);
      render(true);
      toast(s.theme === 'sombre' ? 'Mode nuit activé.' : 'Mode jour activé.');
    },
    'delete-account'() {
      const u = me();
      state.lots.forEach((l) => { if (l.sellerId === u.id && l.status === 'en-ligne') l.status = 'retire'; });
      state.alerts = state.alerts.filter((a) => a.userId !== u.id);
      Object.assign(u, { deleted: true, name: 'Compte supprimé', email: '', phone: '', address: '', about: '', pwd: '', favs: [], roles: [] });
      state.current = null;
      save();
      toast('Votre compte a été supprimé.');
      go('#accueil');
      render();
    },
    scenario(d) { actions.switch(d); },
    advance(d) {
      state.offset += +d.hours * H;
      save();
      render(true);
      toast(`Le temps avance de ${d.hours} h. Il est maintenant ${fmtDate(now())}.`);
    },
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible */ }
      state = seed();
      draftPhotos = [];
      save();
      go('#demarrer');
      toast('Simulation réinitialisée.');
    },
    vue(d) { ui.vue = d.vue; render(true); },
    'clear-commune'() { ui.commune = ''; renderResults(); },
    'map-commune'(d) { ui.commune = d.commune; ui.vue = 'liste'; render(true); },
    'orders-tab'(d) { ui.ordersTab = d.tab; render(true); },
    'add-role'(d) {
      const u = me();
      if (!u.roles.includes(d.role)) u.roles.push(d.role);
      save();
      toast(`Rôle ${d.role} ajouté à votre compte.`);
      render(true);
    },
    withdraw(d) {
      const l = lotById(d.id);
      l.status = 'retire';
      if (me().type === 'admin') notify(l.sellerId, `Votre annonce « ${l.title} » a été retirée par la modération.`, `#lot-${l.id}`);
      save();
      toast('Annonce retirée.');
      render(true);
    },
    relist(d) {
      const u = me();
      const active = state.lots.filter((l) => l.sellerId === u.id && l.status === 'en-ligne').length;
      lotById(d.id).status = 'en-ligne';
      save();
      toast('Annonce remise en ligne.');
      render(true);
    },
    picked(d) {
      const o = orderById(d.id);
      confirmReception(o, now(), me().id === o.buyerId ? 'Lot retiré et vérifié par l\'acheteur sur place.' : 'Le vendeur a remis le lot à l\'acheteur.');
      notify(o.buyerId, `Retrait confirmé pour la commande CM-${o.id}. Vous avez 48 h pour signaler un problème.`, `#commande-${o.id}`);
      save();
      toast('Remise du lot confirmée. Le vendeur sera payé sous 48 h.');
      render(true);
    },
    confirm(d) {
      const o = orderById(d.id);
      confirmReception(o, now(), 'Réception confirmée par l\'acheteur.');
      save();
      toast('Réception confirmée. Le vendeur sera payé sous 48 h.');
      render(true);
    },
    cancel(d) {
      const o = orderById(d.id);
      o.status = 'annulee';
      o.refund = total(o);
      lotById(o.lotId).status = 'en-ligne';
      addEvent(o, `Commande annulée par l'acheteur. Remboursement intégral de ${money(o.refund)}.`);
      notify(o.sellerId, `La commande CM-${o.id} a été annulée par l'acheteur. Votre lot est de nouveau en vente.`, `#commande-${o.id}`);
      save();
      toast('Commande annulée et remboursée.');
      render(true);
    },
    retract(d) {
      const o = orderById(d.id);
      const wasPaid = o.status === 'versee';
      o.status = 'retractee';
      o.refund = total(o);
      if (wasPaid) addEvent(o, `Versement de ${money(o.payout)} repris sur le compte du vendeur.`);
      o.payout = 0;
      lotById(o.lotId).status = 'retire';
      addEvent(o, `Rétractation de l'acheteur. Remboursement de ${money(o.refund)} (prix et livraison) ; le lot est restitué sous 14 jours, frais de retour à la charge de l'acheteur.`);
      notify(o.sellerId, `Rétractation sur la commande CM-${o.id} : l'acheteur vous restitue le lot sous 14 jours.`, `#commande-${o.id}`);
      save();
      toast('Rétractation enregistrée. Remboursement en cours.');
      render(true);
    },
    'alert-delete'(d) { state.alerts = state.alerts.filter((a) => a.id !== +d.id); save(); render(true); },
    'alert-search'(d) { ui.q = d.q; ui.cat = d.cat; ui.commune = ''; ui.maxKm = ''; go('#catalogue'); },
    'premium-subscribe'() {
      const u = me();
      Object.assign(u, { premium: true, premiumSince: now(), renewAt: now() + 30 * D, monthsPaid: (u.monthsPaid || 0) + 1, cancelled: false });
      notify(u.id, `Abonnement Premium activé : ${money(PREMIUM_HT)} HT prélevés. Plus de publicité, et vos livraisons passent en priorité.`, '#compte');
      save();
      toast('Premium activé.');
      render(true);
    },
    'premium-cancel'() {
      me().cancelled = true;
      save();
      toast(`Résiliation enregistrée : Premium reste actif jusqu'au ${fmtDay(me().renewAt)}.`);
      render(true);
    },
    'premium-resume'() { me().cancelled = false; save(); toast('Abonnement repris.'); render(true); },
    'report-remove'(d) {
      const r = state.reports.find((x) => x.id === +d.id);
      r.status = 'traite';
      const l = lotById(r.lotId);
      l.status = 'retire';
      notify(l.sellerId, `Votre annonce « ${l.title} » a été retirée après un signalement : ${r.reason}.`, `#lot-${l.id}`);
      save();
      toast('Annonce retirée.');
      render(true);
    },
    'report-dismiss'(d) { state.reports.find((x) => x.id === +d.id).status = 'classe'; save(); render(true); },
    'req-plan'(d) {
      const r = state.requests.find((x) => x.id === +d.id);
      r.status = 'planifiee';
      r.plannedFor = Math.max(r.wish, now() + D);
      notify(r.userId, `Enlèvement planifié le ${fmtDay(r.plannedFor)} : ${r.address}.`, '#compte');
      save();
      render(true);
    },
    'req-done'(d) {
      const r = state.requests.find((x) => x.id === +d.id);
      r.status = 'effectuee';
      notify(r.userId, 'Enlèvement effectué. Merci d\'avoir trié vos déchets de chantier.', '#compte');
      save();
      render(true);
    }
  };

  /* ---------- Formulaires ---------- */
  const forms = {
    login(f) {
      const email = f.elements.email.value.trim().toLowerCase();
      const u = state.users.find((x) => !x.deleted && (x.email || '').toLowerCase() === email);
      const err = $('#login-error');
      if (!u || u.pwd !== pwdHash(email, f.elements.pwd.value)) {
        err.textContent = 'E-mail ou mot de passe incorrect. Vérifiez vos informations, ou utilisez « Mot de passe oublié ».';
        err.hidden = false;
        f.elements.pwd.value = '';
        return;
      }
      login(u.id);
    },
    'forgot-email'(f) {
      const email = f.elements.email.value.trim().toLowerCase();
      const u = state.users.find((x) => !x.deleted && (x.email || '').toLowerCase() === email);
      if (!u) {
        const err = $('#forgot-error');
        err.textContent = 'Aucun compte n\'utilise cette adresse e-mail.';
        err.hidden = false;
        return;
      }
      ui.forgot = 'code';
      ui.forgotEmail = u.email;
      ui.forgotCode = String(Math.floor(100000 + Math.random() * 900000));
      render(true);
    },
    'forgot-reset'(f) {
      const err = $('#forgot-error');
      if (f.elements.code.value.trim() !== ui.forgotCode) { err.textContent = 'Ce code ne correspond pas à celui envoyé.'; err.hidden = false; return; }
      if (f.elements.pwd.value.length < 8) { err.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; err.hidden = false; return; }
      const u = state.users.find((x) => x.email === ui.forgotEmail);
      u.pwd = pwdHash(u.email, f.elements.pwd.value);
      notify(u.id, 'E-mail : votre mot de passe a été modifié.', '#parametres', null, 'compte');
      ui.forgot = '';
      save();
      toast('Mot de passe enregistré. Vous pouvez vous connecter.');
      render(true);
    },
    password(f) {
      const u = me();
      const err = $('#password-error');
      const e = f.elements;
      let msg = '';
      if (u.pwd !== pwdHash(u.email, e.old.value)) msg = 'Le mot de passe actuel est incorrect.';
      else if (e.pwd.value.length < 8) msg = 'Le nouveau mot de passe doit faire au moins 8 caractères.';
      else if (e.pwd.value !== e.pwd2.value) msg = 'Les deux nouveaux mots de passe ne sont pas identiques.';
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      u.pwd = pwdHash(u.email, e.pwd.value);
      notify(u.id, 'E-mail : votre mot de passe a été modifié.', '#parametres', null, 'compte');
      save();
      toast('Mot de passe modifié.');
      render(true);
    },
    'home-search'(f) {
      ui.q = f.elements.q.value.trim();
      ui.cat = '';
      ui.commune = '';
      go('#catalogue');
    },
    buy(f) {
      const l = lotById(f.dataset.id);
      const u = me();
      if (l.status !== 'en-ligne') { toast('Ce lot n\'est plus disponible.'); render(); return; }
      const mode = f.querySelector('input[name="mode"]:checked').value;
      const pay = f.querySelector('input[name="pay"]:checked').value;
      const km = dist(l.commune, myCommune());
      const o = { id: state.next.order++, lotId: l.id, buyerId: u.id, sellerId: l.sellerId, price: l.price, mode, km,
        feeHT: mode === 'livraison' ? feeHT(km) : 0, pay, priority: mode === 'livraison' && !!u.premium, status: 'payee', times: { paid: now() }, events: [], refund: 0, payout: 0 };
      addEvent(o, `Paiement de ${money(total(o))} par ${pay === 'carte' ? 'carte bancaire' : 'virement'}. Les fonds sont conservés par le prestataire de paiement jusqu'à la remise du lot.`);
      state.orders.push(o);
      l.status = 'vendu';
      notify(l.sellerId, `Lot vendu ! Commande CM-${o.id} : « ${l.title} » par ${u.name} (${mode === 'livraison' ? 'livraison' : 'retrait sur place'}).`, `#commande-${o.id}`);
      notify(u.id, `E-mail : reçu de paiement de ${money(total(o))} pour la commande CM-${o.id}.`, `#commande-${o.id}`);
      save();
      toast(`Paiement accepté. Commande CM-${o.id} créée.`);
      go(`#commande-${o.id}`);
    },
    message(f) {
      const text = f.elements.text.value.trim();
      if (!text) return;
      const lotId = +f.dataset.lot;
      state.messages.push({ id: state.next.msg++, lotId, from: me().id, to: f.dataset.to, text, at: now() });
      notify(f.dataset.to, `Nouveau message de ${me().name} à propos de « ${lotById(lotId).title} ».`, `#messages-${lotId}-${me().id}`, null, 'message');
      save();
      toast('Message envoyé.');
      if (parseRoute().name === 'lot') render(true); else go(`#messages-${lotId}-${f.dataset.to}`);
    },
    report(f) {
      state.reports.push({ id: state.next.report++, lotId: +f.dataset.lot, userId: me().id, reason: f.elements.reason.value, at: now(), status: 'ouvert' });
      notify('admin', `Signalement sur l'annonce « ${lotById(f.dataset.lot).title} ».`, '#admin');
      save();
      toast('Signalement envoyé à l\'équipe ChantierMarket.');
      render(true);
    },
    'verify-id'() {
      me().idVerified = true;
      save();
      toast('Identité vérifiée. La pièce a été supprimée après vérification.');
      render();
    },
    publish(f) {
      const u = me();
      const e = f.elements;
      const err = $('#publish-error');
      const photos = draftPhotos.slice();
      const example = e.examplePhotos.checked;
      const price = +e.price.value;
      const existing = f.dataset.id ? lotById(f.dataset.id) : null;
      const problems = [];
      if (!e.title.value.trim()) problems.push('le titre');
      if (!(+e.qty.value > 0)) problems.push('la quantité');
      if (!(price > 0)) problems.push('le prix');
      if (!e.address.value.trim()) problems.push('l\'adresse de retrait');
      if (!e.deadline.value) problems.push('la date limite de retrait');
      if (photos.length < 3 && !example && !(existing && (existing.photos || []).length >= 3)) problems.push('au moins 3 photos (ou les photos d\'exemple)');
      if (!e.certify.checked) problems.push('la certification sur les produits interdits');
      if (problems.length) {
        err.textContent = `Il manque : ${problems.join(', ')}.`;
        err.hidden = false;
        err.scrollIntoView({ block: 'center' });
        return;
      }
      if (existing) {
        const old = existing.price;
        Object.assign(existing, { title: e.title.value.trim(), category: e.category.value, qty: +e.qty.value, unit: e.unit.value, etat: e.etat.value,
          price: r2(price), neuf: +e.neuf.value || null, weight: +e.weight.value || 0, commune: e.commune.value, address: e.address.value.trim(),
          deadline: new Date(`${e.deadline.value}T18:00`).getTime(), description: e.description.value.trim() });
        if (photos.length) existing.photos = photos;
        existing.examplePhotos = !(existing.photos || []).length;
        draftPhotos = [];
        let told = 0;
        if (existing.price < old) {
          state.users.filter((x) => x.id !== u.id && (x.favs || []).includes(existing.id)).forEach((x) => {
            notify(x.id, `Baisse de prix sur un de vos favoris : « ${existing.title} » passe de ${money(old)} à ${money(existing.price)}.`, `#lot-${existing.id}`, null, 'alerte');
            told += 1;
          });
        }
        save();
        toast(`Annonce modifiée.${told ? ` ${told} personne${told > 1 ? 's ont' : ' a'} été prévenue${told > 1 ? 's' : ''} de la baisse de prix.` : ''}`);
        go(`#lot-${existing.id}`);
        return;
      }
      const l = { id: state.next.lot++, sellerId: u.id, title: e.title.value.trim(), category: e.category.value, qty: +e.qty.value, unit: e.unit.value,
        etat: e.etat.value, price: r2(price), neuf: +e.neuf.value || null, weight: +e.weight.value || 0, commune: e.commune.value,
        address: e.address.value.trim(), deadline: new Date(`${e.deadline.value}T18:00`).getTime(), description: e.description.value.trim(),
        photos, examplePhotos: !photos.length, status: 'en-ligne', createdAt: now(), vues: 0 };
      state.lots.push(l);
      draftPhotos = [];
      let alerted = 0;
      state.alerts.filter((a) => a.userId !== u.id && matches(a, l)).forEach((a) => {
        notify(a.userId, `Alerte « ${a.q} » : nouveau lot « ${l.title} » à ${money(l.price)}.`, `#lot-${l.id}`, null, 'alerte');
        alerted += 1;
      });
      save();
      toast(`Annonce publiée.${alerted ? ` ${alerted} acheteur${alerted > 1 ? 's' : ''} prévenu${alerted > 1 ? 's' : ''} par son alerte.` : ''}`);
      go(`#lot-${l.id}`);
    },
    claim(f) {
      const o = orderById(f.dataset.id);
      const text = f.elements.text.value.trim();
      if (!text) { toast('Décrivez le problème pour envoyer la réclamation.'); return; }
      const files = $('#claim-photos').files.length;
      o.claim = { text, at: now(), photos: files };
      o.status = 'litige';
      addEvent(o, 'Réclamation déposée par l\'acheteur. Le versement au vendeur est bloqué pendant l\'examen.');
      notify(o.sellerId, `Réclamation sur la commande CM-${o.id} : le versement est bloqué pendant l'examen.`, `#commande-${o.id}`);
      notify('admin', `Nouvelle réclamation sur la commande CM-${o.id} (${me().name}).`, `#commande-${o.id}`);
      save();
      toast('Réclamation envoyée. Réponse sous 5 jours ouvrés.');
      render(true);
    },
    resolve(f) {
      const o = orderById(f.dataset.id);
      const decision = f.querySelector('input[name="decision"]:checked').value;
      if (decision === 'total') {
        o.status = 'remboursee';
        o.refund = total(o);
        o.claim.resolution = `Remboursement total de ${money(o.refund)}.`;
        addEvent(o, `Réclamation acceptée : remboursement total de ${money(o.refund)} à l'acheteur.`);
      } else if (decision === 'partiel') {
        const a = Math.min(Math.max(+f.elements.amount.value || 0, 1), o.price);
        o.refund = r2(a);
        o.claim.resolution = `Remboursement partiel de ${money(o.refund)}.`;
        addEvent(o, `Réclamation acceptée en partie : ${money(o.refund)} remboursés à l'acheteur.`);
        payout(o, now());
      } else {
        o.status = 'recue';
        o.times.received = now();
        o.claim.resolution = 'Réclamation rejetée : le lot est conforme à l\'annonce.';
        addEvent(o, 'Réclamation rejetée après examen. Le vendeur sera payé sous 48 h.');
      }
      [o.buyerId, o.sellerId].forEach((id) => notify(id, `Décision sur la réclamation CM-${o.id} : ${o.claim.resolution}`, `#commande-${o.id}`));
      save();
      toast('Décision appliquée. Acheteur et vendeur ont été prévenus.');
      render(true);
    },
    rate(f) {
      const o = orderById(f.dataset.id);
      o.rating = { stars: +f.querySelector('input[name="stars"]:checked').value, comment: f.elements.comment.value.trim(), at: now() };
      addEvent(o, `Avis publié : ${o.rating.stars}/5.`);
      notify(o.sellerId, `Nouvel avis ${o.rating.stars}/5 sur la commande CM-${o.id}.`, `#commande-${o.id}`);
      save();
      toast('Merci, votre avis est publié.');
      render(true);
    },
    alert(f) {
      state.alerts.push({ id: state.next.alert++, userId: me().id, q: f.elements.q.value.trim(), cat: f.elements.cat.value, max: +f.elements.max.value || null });
      save();
      toast('Alerte créée.');
      render(true);
    },
    profile(f) {
      const u = me();
      const roles = ['acheteur', 'vendeur'].filter((r) => f.elements[r].checked);
      if (!roles.length) { toast('Choisissez au moins un rôle : acheter ou vendre.'); return; }
      u.commune = f.elements.commune.value;
      u.address = f.elements.address.value.trim();
      u.roles = roles;
      save();
      toast('Profil enregistré.');
      render(true);
    },
    pickup(f) {
      const e = f.elements;
      state.requests.push({ id: state.next.req++, userId: me().id, address: e.address.value.trim(), volume: e.volume.value, types: e.types.value.trim(),
        wish: new Date(`${e.date.value}T09:00`).getTime(), status: 'demandee', createdAt: now() });
      notify('admin', `Nouvelle demande d'enlèvement de ${me().name}.`, '#admin');
      save();
      toast('Demande envoyée. L\'équipe vous propose un passage.');
      render(true);
    },
    filters() { renderResults(); },
    signup(f) {
      const e = f.elements;
      const type = f.querySelector('input[name="type"]:checked').value;
      const err = $('#signup-error');
      const problems = [];
      const siret = (e.siret.value || '').replace(/\s/g, '');
      if (!e.name.value.trim()) problems.push(type === 'pro' ? 'la raison sociale' : 'votre nom');
      if (type === 'pro' && !/^\d{14}$/.test(siret)) problems.push('un SIRET de 14 chiffres');
      const mail = e.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) problems.push('une adresse e-mail valide');
      else if (state.users.some((x) => (x.email || '').toLowerCase() === mail)) problems.push('une autre adresse e-mail (celle-ci a déjà un compte)');
      if (e.pwd.value.length < 8) problems.push('un mot de passe d\'au moins 8 caractères');
      else if (e.pwd.value !== e.pwd2.value) problems.push('deux mots de passe identiques');
      if (e.phone.value.replace(/\D/g, '').length < 10) problems.push('un numéro de téléphone à 10 chiffres');
      if (type === 'particulier' && e.code.value.trim() !== ui.code) problems.push('le bon code de vérification');
      if (!e.address.value.trim()) problems.push('votre adresse');
      if (!e.adult.checked) problems.push('la confirmation que vous êtes majeur');
      if (!e.cgu.checked) problems.push('l\'acceptation des conditions');
      if (problems.length) {
        err.textContent = `Pour continuer, indiquez ${problems.join(', ')}.`;
        err.hidden = false;
        return;
      }
      const roleVal = f.querySelector('input[name="roles"]:checked').value;
      const id = `n${Date.now().toString(36)}`;
      const u = { id, name: e.name.value.trim(), type, roles: roleVal === 'les-deux' ? ['acheteur', 'vendeur'] : [roleVal], commune: e.commune.value,
        email: mail, phone: e.phone.value.trim(), address: e.address.value.trim(), premium: false,
        pwd: pwdHash(mail, e.pwd.value), favs: [], prefs: defaultPrefs(), createdAt: now(),
        about: type === 'pro' ? 'Compte entreprise créé pendant la simulation.' : 'Compte particulier créé pendant la simulation.' };
      if (type === 'pro') Object.assign(u, { siret, kbis: true });
      else Object.assign(u, { emailVerified: true, phoneVerified: true, idVerified: false });
      state.users.push(u);
      state.current = id;
      ui.code = '';
      notify(id, `E-mail de confirmation : bienvenue sur ChantierMarket, ${u.name} !`, '#compte', null, 'compte');
      save();
      toast('Compte créé. Vous êtes connecté.');
      go('#compte');
    }
  };

  /* ---------- Site vitrine : annonces du moment ---------- */
  function showcase() {
    const box = document.getElementById('annonces-du-moment');
    if (!box) return;
    const online = state.lots.filter((l) => l.status === 'en-ligne');
    const list = online.slice().sort((a, b) => (urgent(b) - urgent(a)) || (b.createdAt - a.createdAt)).slice(0, 4);
    box.innerHTML = list.map((l) => `<a class="showcase-card" href="app.html#lot-${l.id}">
        ${photo(l, 'showcase-img')}
        <span class="showcase-body">
          <span class="showcase-tags">${deadlineBadge(l)}<span class="chip">${esc(l.etat)}</span></span>
          <strong>${esc(l.title)}</strong>
          <span class="showcase-price">${money(l.price)}${l.neuf ? ` <span class="discount">−${discount(l)} %</span>` : ''}</span>
          <span class="muted small">${esc(l.commune)} · ${esc(user(l.sellerId).name)}</span>
        </span>
      </a>`).join('');
    const n = document.getElementById('annonces-count');
    if (n) n.textContent = `${online.length} lots disponibles`;
  }

  if (!document.getElementById('view')) {
    state = load();
    showcase();
    return;
  }

  /* ---------- Écouteurs ---------- */
  function resetArmed() {
    document.querySelectorAll('[data-armed]').forEach((b) => {
      delete b.dataset.armed;
      b.textContent = b.dataset.label;
      b.classList.remove('is-armed');
    });
  }

  document.addEventListener('click', (ev) => {
    document.querySelectorAll('.account-menu[open]').forEach((d) => { if (!d.contains(ev.target) || ev.target.closest('a')) d.open = false; });
    const el = ev.target.closest('[data-action]');
    if (!el) { resetArmed(); return; }
    const name = el.dataset.action;
    if (!actions[name]) return;
    ev.preventDefault();
    if (el.dataset.confirm && !el.dataset.armed) {
      resetArmed();
      el.dataset.label = el.textContent;
      el.dataset.armed = '1';
      el.textContent = el.dataset.confirm;
      el.classList.add('is-armed');
      return;
    }
    actions[name]({ ...el.dataset });
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('g[data-action]')) {
      ev.preventDefault();
      actions[ev.target.dataset.action]({ ...ev.target.dataset });
    }
  });

  document.addEventListener('submit', (ev) => {
    const f = ev.target;
    if (!f.dataset.form || !forms[f.dataset.form]) return;
    ev.preventDefault();
    forms[f.dataset.form](f);
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'f-q') { ui.q = t.value; renderResults(); }
    if (t.id === 'p-neuf' || t.id === 'p-price') {
      const neuf = +$('#p-neuf').value;
      const price = +$('#p-price').value;
      const hint = $('#price-advice');
      if (!neuf) { hint.textContent = 'Nous conseillons un prix 30 à 60 % sous le prix du neuf.'; return; }
      const lo = r2(neuf * 0.4);
      const hi = r2(neuf * 0.7);
      hint.textContent = `Prix conseillé : entre ${money(lo)} et ${money(hi)}.${price ? ` Votre prix : −${Math.round((1 - price / neuf) * 100)} % sur le neuf.` : ''}`;
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.setting) {
      const s = readSettings();
      s[t.dataset.setting] = t.value;
      writeSettings(s);
      renderHeader('parametres');
      toast('Affichage mis à jour.');
      return;
    }
    if (t.dataset.pref && me()) {
      const u = me();
      u.prefs = u.prefs || defaultPrefs();
      const key = t.dataset.pref;
      if (key === 'commune') u.commune = t.value;
      else if (key === 'rayon') { u.prefs.rayon = t.value; ui.maxKm = t.value; }
      else if (key === 'telephone') u.prefs.telephone = t.checked;
      else { const [group, name] = key.split('.'); u.prefs[group][name] = t.checked; }
      save();
      toast('Paramètre enregistré.');
      return;
    }
    if (t.id === 'f-cat') { ui.cat = t.value; renderResults(); }
    if (t.id === 'f-km') { ui.maxKm = t.value; renderResults(); }
    if (t.id === 'f-sort') { ui.sort = t.value; renderResults(); }
    if (t.closest('[data-form="buy"]')) updateBuySummary();
    if (t.name === 'type' && t.closest('[data-form="signup"]')) {
      const pro = t.value === 'pro';
      document.querySelectorAll('[data-for="pro"]').forEach((x) => { x.hidden = !pro; });
      document.querySelectorAll('[data-for="particulier"]').forEach((x) => { x.hidden = pro; });
      $('#s-name-label').textContent = pro ? 'Raison sociale' : 'Prénom et initiale du nom';
    }
    if (t.id === 'p-photos') readPhotos(t.files);
  });

  function readPhotos(files) {
    const list = Array.from(files).slice(0, 6 - draftPhotos.length);
    list.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 640 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          draftPhotos.push(c.toDataURL('image/jpeg', 0.7));
          const box = $('#photo-preview');
          if (box) box.innerHTML = draftPhotos.map((p) => `<img src="${p}" alt="">`).join('');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.addEventListener('hashchange', () => render());
  setInterval(() => { tick(); const c = $('#clock'); if (c) c.textContent = fmtDate(now()); }, 30000);

  state = load();
  save();
  render();
})();
