# Mwaka Pizza — Agent de Réactivation Autonome

Agent serveur (Firebase Cloud Functions) qui relance automatiquement les clients
froids de la base `commandes`, **sans aucune intervention humaine**.

## Architecture

| Composant | Rôle |
|-----------|------|
| `reactivationAgent` (cron horaire) | Charge les clients, calcule un score RFM, applique les règles anti-spam, envoie via SMS/WhatsApp. Ne tourne qu'aux créneaux 11h-13h et 18h-20h (Martinique). |
| `dailyReport` (20h Martinique) | Compile les KPI du jour, écrit dans `reports/`, envoie un email si SendGrid configuré. |
| `agentPreview` (HTTP) | Renvoie un aperçu temps réel des prochaines cibles pour le dashboard. |
| `lib/messages.js` | Génère une copie variée et humaine (rotation salutation/signature/template, mention de la pizza favorite, créneaux midi/soir, jamais de mention "agent" ou "automatique"). |
| `lib/agent.js` | Décision : RFM, segmentation, cooldown 21 j, plafond journalier. |
| `lib/sender.js` | Adaptateur Twilio (SMS + WhatsApp). En mode "dry-run" tant que les secrets ne sont pas posés : rien n'est envoyé, tout est juste journalisé. |
| `agent.html` | Tableau de bord supervision : statut, KPI, derniers envois, rapport, **bouton pause**. |

## Collections Firestore utilisées

- `commandes` (existante) — source de vérité des achats
- `reactivations` — log de chaque envoi (manuel ou agent)
- `agent_runs` — log de chaque passage de cron
- `reports` — rapport journalier
- `config/agent` — réglages (enabled, cooldown, plafonds...) modifiables depuis le dashboard
- `reactivation_optouts` — liste noire (un doc par téléphone à exclure)

## Premier déploiement

```bash
# 1. Outils
npm i -g firebase-tools
firebase login

# 2. Dépendances
cd functions && npm install && cd ..

# 3. Plan Blaze requis (les Functions sortantes nécessitent un plan facturé)
#    https://console.firebase.google.com/project/mwakaphone-e8c5b/usage/details

# 4. Secrets — pose-les UNE FOIS (l'agent reste en dry-run sinon)
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_WHATSAPP_FROM   # ex: whatsapp:+14155238886
firebase functions:secrets:set TWILIO_SMS_FROM        # ex: +15551234567
# Rapport email (optionnel) :
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set REPORT_EMAIL_TO        # ex: chef@mwakapizza.fr
firebase functions:secrets:set REPORT_EMAIL_FROM      # ex: agent@mwakapizza.fr

# 5. Déploiement
firebase deploy --only functions
```

## Comportement par défaut (avant secrets)

- Tout est **dry-run** : les messages sont calculés et logués dans `reactivations`
  avec `status: "dry-run"` mais **rien n'est envoyé**. Permet de vérifier la
  qualité de la copie avant d'activer la facturation Twilio.

## Stratégie de "discrétion"

Pour que le client ne perçoive pas l'envoi automatique :

- **Pool de 30+ variantes** par segment (Soft / Medium / Long / Prospect / VIP)
- Salutation tirée selon l'heure (Bonjour/Bonsoir/Coucou/Hello/Salut/Hey)
- Signature variable (Mwaka Pizza / L'équipe Mwaka / À bientôt – Mwaka...)
- Mention contextuelle de la **pizza préférée** du client (basée sur historique)
- Envoi uniquement aux **horaires humains** (déjeuner, dîner)
- **Cooldown 21 jours** : jamais 2 fois le même client dans la quinzaine
- **Plafond journalier 25** : volume crédible d'un humain
- Plafond par passage = 8 : pas de "rafale" suspecte
- Respect du `result: "refus"` : exclusion définitive
- Liste noire `reactivation_optouts` honorée

## Réglages live

Modifier `config/agent` (depuis `agent.html` ou directement Firestore) :
```json
{
  "enabled": true,
  "minDays": 30,
  "maxDays": 540,
  "cooldownDays": 21,
  "dailyMax": 25,
  "perRunMax": 8
}
```

## Rapport journalier

À 20h00 (Martinique), `dailyReport` :
1. Calcule sent / contacted / conversion / CA attribué / répartition segments
2. Écrit `reports/report-YYYY-MM-DD`
3. Envoie un email HTML (si SendGrid configuré)

Le rapport est aussi consultable dans `agent.html`.
