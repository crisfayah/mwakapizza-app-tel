'use strict';

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

// Secrets (declared so they're injected into the runtime env)
const TWILIO_ACCOUNT_SID    = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN     = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_SMS_FROM       = defineSecret('TWILIO_SMS_FROM');
const TWILIO_WHATSAPP_FROM  = defineSecret('TWILIO_WHATSAPP_FROM');
const SENDGRID_API_KEY      = defineSecret('SENDGRID_API_KEY');
const REPORT_EMAIL_TO       = defineSecret('REPORT_EMAIL_TO');
const REPORT_EMAIL_FROM     = defineSecret('REPORT_EMAIL_FROM');

const allSecrets = [
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, TWILIO_WHATSAPP_FROM,
  SENDGRID_API_KEY, REPORT_EMAIL_TO, REPORT_EMAIL_FROM
];

const agent    = require('./lib/agent');
const messages = require('./lib/messages');
const sender   = require('./lib/sender');
const report   = require('./lib/report');

/** Operator-tunable config (Firestore doc: config/agent). */
async function loadConfig() {
  const def = {
    enabled: true,
    minDays: 30,       // start contacting after N days of inactivity
    maxDays: 540,      // beyond ~18 months: stop trying
    cooldownDays: 21,  // never re-contact a customer within N days
    dailyMax: 25,      // cap contacts per day
    perRunMax: 8       // cap per cron run (smooths bursts)
  };
  const snap = await db.doc('config/agent').get();
  return snap.exists ? { ...def, ...snap.data() } : def;
}

async function dailyAlreadySent(date) {
  const startMQ = new Date(new Intl.DateTimeFormat('fr-CA', {
    timeZone: agent.TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date) + 'T04:00:00Z');
  const snap = await db.collection('reactivations')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startMQ))
    .where('source', '==', 'agent')
    .get();
  return snap.size;
}

/**
 * Autonomous reactivation agent.
 * Runs every hour. Decides whether the current slot is a good send window
 * (lunch / dinner Martinique time), then picks top-RFM eligible customers
 * and sends personalized messages — no human in the loop.
 */
exports.reactivationAgent = onSchedule({
  schedule: 'every 60 minutes',
  timeZone: 'America/Martinique',
  secrets: allSecrets,
  timeoutSeconds: 300,
  memory: '512MiB'
}, async () => {
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    await logRun({ skipped: 'disabled', cfg }); return;
  }

  const plan = await agent.planRun(db, cfg);
  if (!plan.window.ready) {
    await logRun({ skipped: 'off-window', window: plan.window, eligibleCount: plan.eligible.length });
    return;
  }

  const alreadyToday = await dailyAlreadySent(new Date());
  const remainingDay = Math.max(0, cfg.dailyMax - alreadyToday);
  const budget = Math.min(cfg.perRunMax, remainingDay, plan.eligible.length);
  if (budget === 0) {
    await logRun({ skipped: 'budget-exhausted', alreadyToday, cfg });
    return;
  }

  const targets = plan.eligible.slice(0, budget);
  const results = [];

  for (const c of targets) {
    const { body, template } = messages.buildMessage(c, plan.now);
    const res = await sender.sendAuto(c, body);
    const entry = {
      source: 'agent',
      phone: c.phone,
      clientName: c.name,
      segment: c.seg,
      template,
      channel: res.channel,
      status: res.status,
      error: res.error || null,
      sid: res.sid || null,
      body,
      score: c.score,
      daysCold: c.daysCold,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    try { await db.collection('reactivations').add(entry); } catch (_) {}
    results.push({ phone: c.phone, status: res.status, channel: res.channel });
  }

  await logRun({
    window: plan.window,
    eligibleCount: plan.eligible.length,
    sent: results.filter(r => r.status === 'sent').length,
    dryRun: results.filter(r => r.status === 'dry-run').length,
    errors: results.filter(r => r.status === 'error').length,
    targets: results
  });
});

/** Daily KPI report — 20:00 Martinique. */
exports.dailyReport = onSchedule({
  schedule: '0 20 * * *',
  timeZone: 'America/Martinique',
  secrets: allSecrets,
  timeoutSeconds: 120
}, async () => {
  const r = await report.compileReport(db);
  const id = `report-${r.date}`;
  await db.collection('reports').doc(id).set({
    ...r,
    generatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const mail = await report.sendEmail(r);
  await db.collection('reports').doc(id).set({ emailStatus: mail }, { merge: true });
});

/** Manual ping endpoint for the dashboard (read-only run preview). */
exports.agentPreview = onRequest({ cors: true, secrets: allSecrets }, async (_req, res) => {
  const cfg = await loadConfig();
  const plan = await agent.planRun(db, cfg);
  res.json({
    enabled: cfg.enabled,
    window: plan.window,
    totalCustomers: plan.total,
    eligibleNow: plan.eligible.length,
    next10: plan.eligible.slice(0, 10).map(c => ({
      name: c.name, phone: c.phone.replace(/.(?=.{2})/g, '*'),
      seg: c.seg, daysCold: c.daysCold, score: c.score
    })),
    optOuts: plan.optOutCount,
    senderConfigured: sender.isConfigured()
  });
});

async function logRun(payload) {
  try {
    await db.collection('agent_runs').add({
      ...payload,
      at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.warn('logRun failed', e); }
}
