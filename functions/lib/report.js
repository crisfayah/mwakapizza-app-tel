'use strict';

const admin = require('firebase-admin');
const { TZ, DAY_MS, normalizePhone } = require('./agent');

function envv(k) { return process.env[k] || ''; }

/** "YYYY-MM-DD" in Martinique timezone. */
function mqDateKey(d) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function startOfDayMQ(date) {
  // Approximation suffisante : Martinique == UTC-4 toute l'année (pas de DST)
  const k = mqDateKey(date);
  return new Date(k + 'T04:00:00Z'); // 00:00 MQ == 04:00 UTC
}

/**
 * Compile KPIs for "today" in Martinique tz.
 */
async function compileReport(db, date = new Date()) {
  const startMQ = startOfDayMQ(date);
  const endMQ   = new Date(startMQ.getTime() + DAY_MS);
  const tsStart = admin.firestore.Timestamp.fromDate(startMQ);
  const tsEnd   = admin.firestore.Timestamp.fromDate(endMQ);

  const [reactSnap, orderSnap] = await Promise.all([
    db.collection('reactivations').where('createdAt', '>=', tsStart).where('createdAt', '<', tsEnd).get(),
    db.collection('commandes').where('createdAt', '>=', tsStart).where('createdAt', '<', tsEnd).get()
  ]);

  let sentSMS = 0, sentWA = 0, dryRun = 0, errors = 0, refus = 0;
  const contactedPhones = new Set();
  const bySegment = {};
  reactSnap.docs.forEach(d => {
    const r = d.data();
    if (r.source !== 'agent') return; // count only agent activity
    if (r.status === 'sent' && r.channel === 'sms') sentSMS++;
    else if (r.status === 'sent' && r.channel === 'whatsapp') sentWA++;
    else if (r.status === 'dry-run') dryRun++;
    else if (r.status === 'error') errors++;
    if (r.result === 'refus') refus++;
    const ph = normalizePhone(r.phone); if (ph) contactedPhones.add(ph);
    const s = r.segment || 'autre';
    bySegment[s] = (bySegment[s] || 0) + 1;
  });

  // Attribution : an order today from a phone we contacted in the last 14 days
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 14 * DAY_MS);
  const recentReact = await db.collection('reactivations')
    .where('createdAt', '>=', since).where('source', '==', 'agent').get();
  const contactedRecently = new Set();
  recentReact.docs.forEach(d => {
    const p = normalizePhone(d.data().phone);
    if (p) contactedRecently.add(p);
  });

  let attributedOrders = 0, attributedCA = 0;
  orderSnap.docs.forEach(d => {
    const o = d.data();
    const p = normalizePhone(o.phone);
    if (p && contactedRecently.has(p)) {
      attributedOrders++;
      attributedCA += Number(o.total) || 0;
    }
  });

  const sent = sentSMS + sentWA;
  const convRate = sent ? (attributedOrders / sent) * 100 : 0;

  return {
    date: mqDateKey(date),
    generatedAt: new Date(),
    sent, sentSMS, sentWA, dryRun, errors, refus,
    contacted: contactedPhones.size,
    bySegment,
    ordersToday: orderSnap.size,
    attributedOrders, attributedCA,
    conversionRate: Number(convRate.toFixed(1))
  };
}

function renderHtmlReport(r) {
  const segLines = Object.entries(r.bySegment).map(([k, v]) =>
    `<li><strong>${k}</strong> : ${v}</li>`).join('') || '<li>—</li>';
  return `
  <div style="font-family:Segoe UI,sans-serif;background:#0b0b0b;color:#fff;padding:24px;border-radius:12px;max-width:600px;">
    <h2 style="color:#2ecc71;margin:0 0 4px 0;">🍕 Rapport Agent Réactivation</h2>
    <div style="color:#888;font-size:.9em;margin-bottom:18px;">Mwaka Pizza — ${r.date}</div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr><td style="padding:8px;background:#1a1a1a;border-radius:8px;">📤 Messages envoyés</td>
          <td style="padding:8px;text-align:right;font-size:1.4em;color:#2ecc71;font-weight:bold;">${r.sent}</td></tr>
      <tr><td style="padding:8px;">SMS / WhatsApp</td>
          <td style="padding:8px;text-align:right;color:#ccc;">${r.sentSMS} / ${r.sentWA}</td></tr>
      <tr><td style="padding:8px;background:#1a1a1a;border-radius:8px;">👥 Clients contactés</td>
          <td style="padding:8px;text-align:right;font-size:1.2em;font-weight:bold;">${r.contacted}</td></tr>
      <tr><td style="padding:8px;background:#1a1a1a;border-radius:8px;">🛎️ Commandes attribuées</td>
          <td style="padding:8px;text-align:right;font-size:1.4em;color:#3498db;font-weight:bold;">${r.attributedOrders}</td></tr>
      <tr><td style="padding:8px;">CA généré (attribué)</td>
          <td style="padding:8px;text-align:right;color:#2ecc71;font-weight:bold;">${r.attributedCA.toFixed(2)} €</td></tr>
      <tr><td style="padding:8px;background:#1a1a1a;border-radius:8px;">📈 Taux de conversion</td>
          <td style="padding:8px;text-align:right;font-size:1.2em;color:#f39c12;font-weight:bold;">${r.conversionRate}%</td></tr>
      <tr><td style="padding:8px;">Erreurs / Refus / Dry-run</td>
          <td style="padding:8px;text-align:right;color:#999;">${r.errors} / ${r.refus} / ${r.dryRun}</td></tr>
    </table>

    <h4 style="color:#2ecc71;margin:0 0 6px 0;">Répartition par segment</h4>
    <ul style="color:#ccc;line-height:1.6;">${segLines}</ul>

    <hr style="border:none;border-top:1px solid #222;margin:18px 0;">
    <div style="color:#666;font-size:.8em;">
      Total commandes du jour : <strong style="color:#fff;">${r.ordersToday}</strong> ·
      Rapport généré ${r.generatedAt.toLocaleString('fr-FR')}
    </div>
  </div>`;
}

async function sendEmail(r) {
  const key = envv('SENDGRID_API_KEY');
  const to  = envv('REPORT_EMAIL_TO');
  const from = envv('REPORT_EMAIL_FROM') || 'agent@mwakapizza.local';
  if (!key || !to) return { sent: false, reason: 'email_not_configured' };
  try {
    const sg = require('@sendgrid/mail');
    sg.setApiKey(key);
    await sg.send({
      to, from,
      subject: `🍕 Rapport Mwaka Agent — ${r.date}`,
      html: renderHtmlReport(r)
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { compileReport, renderHtmlReport, sendEmail };
