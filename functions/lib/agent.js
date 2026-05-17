'use strict';

const admin = require('firebase-admin');

const TZ = 'America/Martinique';
const DAY_MS = 86400000;

/**
 * Returns Date converted to the equivalent local "Y-M-D H:m" in Martinique.
 * We only need fields, not a real shifted Date, so we extract via Intl.
 */
function nowMartinique() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  const d = new Date(Date.UTC(
    +get('year'), +get('month') - 1, +get('day'),
    +get('hour'), +get('minute')
  ));
  return d;
}

function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }

function cleanName(n) { return (n || '').trim().split(/\s+/)[0] || 'Client'; }

/** Load all customers aggregated from "commandes". */
async function loadCustomers(db) {
  const snap = await db.collection('commandes').get();
  const byKey = {};
  snap.docs.forEach(d => {
    const o = d.data();
    const phone = normalizePhone(o.phone);
    if (!phone) return; // need phone to contact
    const key = phone;
    const date = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
    if (!byKey[key]) {
      byKey[key] = {
        key, phone, names: {}, totalCA: 0, orders: 0,
        firstOrder: date, lastOrder: date, favPizzas: {}
      };
    }
    const c = byKey[key];
    c.totalCA += Number(o.total) || 0;
    c.orders += 1;
    if (date) {
      if (!c.firstOrder || date < c.firstOrder) c.firstOrder = date;
      if (!c.lastOrder  || date > c.lastOrder)  c.lastOrder  = date;
    }
    if (o.clientName) c.names[o.clientName] = (c.names[o.clientName] || 0) + 1;
    (o.items || []).forEach(p => {
      if (p && p.name) c.favPizzas[p.name] = (c.favPizzas[p.name] || 0) + (Number(p.qty) || 1);
    });
  });

  const now = Date.now();
  return Object.values(byKey).map(c => {
    const topName  = Object.entries(c.names).sort((a, b) => b[1] - a[1])[0];
    const topPizza = Object.entries(c.favPizzas).sort((a, b) => b[1] - a[1])[0];
    const daysCold = c.lastOrder ? Math.floor((now - c.lastOrder.getTime()) / DAY_MS) : 99999;
    return {
      key: c.key,
      phone: c.phone,
      name: topName ? topName[0] : 'Client',
      favPizza: topPizza ? topPizza[0] : '',
      orders: c.orders,
      totalCA: c.totalCA,
      avgTicket: c.totalCA / Math.max(c.orders, 1),
      lastOrder: c.lastOrder,
      daysCold,
      seg: c.orders <= 1 ? 'prospect' : (c.orders <= 4 ? 'regulier' : 'vip')
    };
  });
}

/** Load recent reactivation log keyed by phone. */
async function loadRecentContacts(db, sinceDays = 21) {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - sinceDays * DAY_MS);
  const snap = await db.collection('reactivations').where('createdAt', '>=', since).get();
  const byPhone = {};
  snap.docs.forEach(d => {
    const r = d.data();
    const k = normalizePhone(r.phone);
    if (!k) return;
    const t = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
    if (!byPhone[k] || (t && t > byPhone[k].at)) {
      byPhone[k] = { at: t, channel: r.channel, result: r.result };
    }
  });
  return byPhone;
}

/** Load "do not contact" list. */
async function loadOptOuts(db) {
  const snap = await db.collection('reactivation_optouts').get().catch(() => ({ docs: [] }));
  const s = new Set();
  snap.docs.forEach(d => {
    const p = normalizePhone(d.data().phone || d.id);
    if (p) s.add(p);
  });
  return s;
}

/** RFM-light score (0-100), used to prioritize daily targets. */
function rfmScore(c) {
  // Recency: closer to 90d window, higher (decays after)
  const rec = c.daysCold <= 30 ? 0
            : c.daysCold <= 60 ? 20
            : c.daysCold <= 120 ? 40
            : c.daysCold <= 240 ? 30
            : c.daysCold <= 365 ? 22
            : 10;
  const freq = Math.min(c.orders * 6, 30);                  // up to 30
  const mon  = Math.min(c.avgTicket / 2, 30);               // up to 30
  return Math.round(rec + freq + mon);
}

/** Decide if a customer is eligible for outreach today. */
function isEligible(c, recent, optOut, cfg, now) {
  if (optOut.has(c.phone)) return false;
  if (c.daysCold < cfg.minDays) return false;       // not cold enough yet
  if (c.daysCold > cfg.maxDays) return false;       // too far gone — exclude per policy
  if (c.orders === 0) return false;
  const last = recent[c.phone];
  if (last && (now.getTime() - last.at.getTime()) < cfg.cooldownDays * DAY_MS) return false;
  if (last && last.result === 'refus') return false;
  return true;
}

/** Pick best send time slot today (lunch or dinner). */
function pickWindow(now) {
  const h = now.getUTCHours(); // we built `now` from MQ parts, so getUTCHours == MQ hour
  if (h < 11) return { slot: 'lunch',  ready: false, hint: 'Avant midi' };
  if (h < 13) return { slot: 'lunch',  ready: true,  hint: 'Créneau déjeuner' };
  if (h < 18) return { slot: 'idle',   ready: false, hint: 'Heures creuses' };
  if (h < 20) return { slot: 'dinner', ready: true,  hint: 'Créneau dîner' };
  return { slot: 'late', ready: false, hint: 'Trop tard' };
}

/**
 * Build the daily plan: list of targets, prioritized & capped.
 */
async function planRun(db, cfg) {
  const [customers, recent, optOut] = await Promise.all([
    loadCustomers(db), loadRecentContacts(db, cfg.cooldownDays), loadOptOuts(db)
  ]);
  const now = nowMartinique();
  const win = pickWindow(now);

  const eligible = customers
    .filter(c => isEligible(c, recent, optOut, cfg, now))
    .map(c => ({ ...c, score: rfmScore(c) }))
    .sort((a, b) => b.score - a.score);

  return { window: win, now, eligible, total: customers.length, optOutCount: optOut.size };
}

module.exports = {
  loadCustomers, loadRecentContacts, loadOptOuts,
  rfmScore, isEligible, pickWindow, planRun, nowMartinique,
  normalizePhone, cleanName, TZ, DAY_MS
};
