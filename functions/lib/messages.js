'use strict';

/**
 * Human-like message variation engine.
 * - No AI / no "robot" phrasing
 * - Salutation + closing rotate from natural pools
 * - Mentions favorite pizza when known
 * - Signed like a person (no "no-reply", no "automated")
 * - Day-of-week and time-of-day appropriate
 */

const SALUT = [
  'Bonjour {prenom}',
  'Coucou {prenom}',
  'Hello {prenom}',
  'Salut {prenom}',
  'Hey {prenom}',
  'Bonsoir {prenom}'
];

const SALUT_MIDI = ['Bonjour {prenom}', 'Hello {prenom}', 'Coucou {prenom}', 'Salut {prenom}'];
const SALUT_SOIR = ['Bonsoir {prenom}', 'Hello {prenom}', 'Coucou {prenom}'];

const SIGN = [
  'Mwaka Pizza 🍕',
  "L'équipe Mwaka 🍕",
  'À bientôt – Mwaka 🍕',
  'Mwaka, votre pizzeria 🍕'
];

// Soft win-back (30-60 d, regular customers)
const SOFT = [
  "Ça fait un moment qu'on ne vous a pas vu(e) !{fav} Si l'envie vous prend, on est là 😉 {sign}",
  "Petit coucou {dayHint} : on pense à vous chez Mwaka.{fav} Au plaisir ! {sign}",
  "Pas vu(e) depuis un petit moment 👀{fav} On garde votre place au chaud. {sign}",
  "Juste un mot pour vous dire qu'on pense à vous.{fav} Passez quand vous voulez. {sign}",
  "Ça nous ferait plaisir de vous revoir cette semaine.{fav} {sign}"
];

// Medium win-back (60-120 d) — small incentive
const MEDIUM = [
  "On vous a gardé une petite surprise : -15% sur votre prochaine commande (code MWAKA15).{fav} Valable cette semaine. {sign}",
  "Pour fêter votre retour : une boisson offerte sur votre prochaine pizza 🥤{fav} Mentionnez ce message. {sign}",
  "On a ajouté de nouvelles pizzas à la carte – on vous offre -15% pour les goûter (code MWAKA15).{fav} {sign}",
  "Cette semaine c'est -15% pour vous (code MWAKA15).{fav} On vous attend ! {sign}",
  "Petit cadeau du chef : -15% sur votre prochaine commande, code MWAKA15.{fav} {sign}"
];

// Long win-back (120+ d) — stronger incentive
const LONG = [
  "Ça fait longtemps ! On vous fait -20% sur votre prochaine commande, code REVIENS20.{fav} On serait ravis de vous revoir. {sign}",
  "Vous nous manquez vraiment !{fav} -20% sur votre prochaine pizza, code REVIENS20. {sign}",
  "On profite de ce message pour vous dire qu'on pense toujours à vous.{fav} -20% si vous repassez (code REVIENS20). {sign}",
  "Petit retour de Mwaka : -20% sur votre prochaine commande (code REVIENS20).{fav} À très vite j'espère ! {sign}"
];

// Prospect (1 order only) — convert to second purchase
const PROSPECT = [
  "Merci d'avoir testé Mwaka l'autre jour !{fav} Pour votre prochaine, on vous offre un dessert. Code MWAKA2. {sign}",
  "On espère que vous avez aimé votre première commande chez nous.{fav} Pour la 2ème, dessert offert (code MWAKA2). {sign}",
  "Vous avez goûté Mwaka une fois – on aimerait vous faire essayer une nouveauté.{fav} Code MWAKA2 = dessert offert. {sign}",
  "On voulait juste prendre des nouvelles depuis votre commande.{fav} Un dessert offert pour la prochaine, code MWAKA2. {sign}"
];

// VIP (5+ orders) inactive — warm personal touch, light incentive
const VIP = [
  "On a remarqué qu'on ne vous a pas vu(e) depuis un moment et ça nous étonne 😊{fav} On vous garde un -20% personnel (code VIP20). {sign}",
  "Vous comptez parmi nos meilleurs clients – on tenait à prendre de vos nouvelles.{fav} -20% pour vous (code VIP20). {sign}",
  "Petit message rien que pour vous : -20% sur votre prochaine commande (code VIP20).{fav} Merci pour votre fidélité ! {sign}",
  "Ça fait un moment, tout va bien ?{fav} On vous garde un -20% (code VIP20). {sign}"
];

function dayHint(date) {
  const d = date.getDay(); // 0=dim..6=sam
  if (d === 5) return 'de vendredi';
  if (d === 6) return 'de samedi';
  if (d === 0) return 'de dimanche';
  if (d === 3) return 'de mercredi';
  return '';
}

function pickSalut(now) {
  const h = now.getHours();
  const pool = h >= 17 ? SALUT_SOIR : (h <= 13 ? SALUT_MIDI : SALUT);
  return pick(pool);
}

function pick(arr, seed) {
  if (typeof seed === 'number') return arr[seed % arr.length];
  return arr[Math.floor(Math.random() * arr.length)];
}

function favoriteMention(favPizza) {
  if (!favPizza) return '';
  // Vary how we reference the favorite pizza
  const variants = [
    ` Votre ${favPizza} vous attend toujours 🍕`,
    ` On a pensé à votre ${favPizza} en écrivant ce mot.`,
    ` Votre ${favPizza} est toujours au menu !`,
    ` PS : la ${favPizza} marche fort en ce moment.`,
    ''
  ];
  return pick(variants);
}

/**
 * Build a personalized message for a customer.
 * @param {Object} customer  - { name, favPizza, orders, daysCold, seg }
 * @param {Date}   now       - reference time (Martinique)
 * @returns {{body: string, template: string}}
 */
function buildMessage(customer, now) {
  const prenom = (customer.name || '').trim().split(/\s+/)[0] || '';

  let pool, template;
  if (customer.seg === 'vip') { pool = VIP; template = 'vip'; }
  else if (customer.orders <= 1) { pool = PROSPECT; template = 'prospect'; }
  else if (customer.daysCold >= 120) { pool = LONG; template = 'long'; }
  else if (customer.daysCold >= 60) { pool = MEDIUM; template = 'medium'; }
  else { pool = SOFT; template = 'soft'; }

  const opener = pickSalut(now);
  const body = pick(pool);
  const sign = pick(SIGN);

  const text = (opener + ' ! ' + body)
    .replace(/\{prenom\}/g, prenom)
    .replace(/\{fav\}/g, favoriteMention(customer.favPizza))
    .replace(/\{dayHint\}/g, dayHint(now))
    .replace(/\{sign\}/g, sign)
    .replace(/\s+/g, ' ')
    .replace(/\s+([.!?,])/g, '$1')
    .trim();

  return { body: text, template };
}

module.exports = { buildMessage };
