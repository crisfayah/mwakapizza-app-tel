'use strict';

/**
 * Provider-agnostic sender.
 * Default implementation: Twilio (SMS + WhatsApp).
 * If no credentials configured -> "dry run" mode: only logs to Firestore,
 * nothing is actually sent. This is intentional: the agent never sends
 * blindly until the operator has set credentials via firebase functions:config.
 *
 * Required env / config (set via `firebase functions:config:set` OR env vars):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_SMS_FROM         e.g. "+15551234567"  (optional, enables SMS)
 *   TWILIO_WHATSAPP_FROM    e.g. "whatsapp:+14155238886" (optional, enables WA)
 */

function env(k) {
  return process.env[k] || (process.env[`SECRET_${k}`]) || '';
}

function toIntl(phone) {
  // Martinique default: 0696 -> +596696, 596... -> +596...
  const p = (phone || '').replace(/\D/g, '');
  if (!p) return null;
  if (p.startsWith('00')) return '+' + p.substring(2);
  if (p.startsWith('596')) return '+' + p;
  if (p.startsWith('0'))   return '+596' + p.substring(1);
  if (p.length === 9)      return '+596' + p;
  return '+' + p;
}

function isConfigured() {
  return !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN'));
}

function getClient() {
  const twilio = require('twilio');
  return twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
}

async function sendSMS(to, body) {
  if (!isConfigured() || !env('TWILIO_SMS_FROM')) {
    return { status: 'dry-run', provider: 'stub', channel: 'sms' };
  }
  const intl = toIntl(to);
  if (!intl) return { status: 'error', error: 'invalid_phone' };
  try {
    const m = await getClient().messages.create({
      from: env('TWILIO_SMS_FROM'), to: intl, body
    });
    return { status: 'sent', provider: 'twilio', channel: 'sms', sid: m.sid };
  } catch (e) {
    return { status: 'error', provider: 'twilio', channel: 'sms', error: e.message };
  }
}

async function sendWhatsApp(to, body) {
  if (!isConfigured() || !env('TWILIO_WHATSAPP_FROM')) {
    return { status: 'dry-run', provider: 'stub', channel: 'whatsapp' };
  }
  const intl = toIntl(to);
  if (!intl) return { status: 'error', error: 'invalid_phone' };
  try {
    const m = await getClient().messages.create({
      from: env('TWILIO_WHATSAPP_FROM'),
      to: 'whatsapp:' + intl,
      body
    });
    return { status: 'sent', provider: 'twilio', channel: 'whatsapp', sid: m.sid };
  } catch (e) {
    return { status: 'error', provider: 'twilio', channel: 'whatsapp', error: e.message };
  }
}

/**
 * Pick the best channel for a given customer.
 * Heuristic: WhatsApp if WA configured (cheaper, richer), SMS as fallback.
 */
async function sendAuto(customer, body) {
  const waReady = isConfigured() && env('TWILIO_WHATSAPP_FROM');
  if (waReady) return sendWhatsApp(customer.phone, body);
  return sendSMS(customer.phone, body);
}

module.exports = { sendSMS, sendWhatsApp, sendAuto, isConfigured, toIntl };
