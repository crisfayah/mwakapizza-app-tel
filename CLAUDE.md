# CLAUDE.md — Mwaka Pizza App

## Project Overview

Mwaka Pizza is a progressive web app (PWA) for a pizza restaurant in Martinique, France. It provides customer ordering, kitchen display (KDS), and real-time order tracking — all built as static HTML files with Firebase backend.

**Language**: All UI text is in French.

## Architecture

### Tech Stack

- **Frontend**: Vanilla HTML5 / CSS3 / JavaScript (ES6+) — no frameworks, no build tools
- **Backend**: Firebase Firestore (real-time NoSQL database)
- **Icons**: Font Awesome 6.4.0 (CDN)
- **Firebase SDK**: v9.22.1 (compat mode via CDN)
- **Deployment**: Static files — no build step, no bundler, no package.json

### File Structure

```
index.html            # Customer ordering interface + order tracking
cuisine.html          # Kitchen Display System (KDS) for staff
suivi.html            # Customer tracking page with GPS departure assistant
manifest.json         # PWA manifest for ordering app
manifest-cuisine.json # PWA manifest for kitchen app
logo.png              # Restaurant logo (512x512)
```

Each HTML file is **self-contained** — all CSS and JavaScript are inline. There are no external JS/CSS files, no `src/` directory, and no modules.

## Key Application Pages

### index.html — Customer Ordering

- Two tabs: "Commander" (order) and "Suivi" (track)
- Order types: "Emporter" (takeout) or "Livraison" (delivery)
- Restaurant selection for takeout: Valmenière, Centre-ville
- Pizza autocomplete search with supplement selection
- Dessert and drink dropdowns
- Real-time total calculation
- Order submission to Firestore
- Live order tracking with status badges

### cuisine.html — Kitchen Display System

- 4-tab workflow: À FAIRE → EN COURS → AU FOUR → TERMINÉES
- Status flow: `en_attente` → `production` → `cuisson` → `termine`
- Real-time order cards with elapsed timers
- Flux delay estimation (estimated prep time)
- Oven saturation alerts (8+ items triggers warning)
- Audio alerts on new orders
- Print support
- Delay/priority system: FAST / 15M / HOT

### suivi.html — Customer Tracking + GPS

- Order lookup by ID (URL param: `?id=orderId`)
- 4-step progress indicator
- Real-time Firestore listener for status updates
- GPS "Drive Predict" for optimal departure timing (takeout only)
- Shop coordinates hardcoded for Valmenière and Centre-ville

## Firestore Data Model

**Collection: `commandes`**

```javascript
{
  clientName: string,
  type: "LIVRAISON" | "EMPORTER",
  restaurant: "Valmenière" | "Centre-ville" | "Livraison",
  phone: string,
  address: string,
  paymentMethod: "Espèces" | "Carte" | "Chèque",
  items: [{ qty: number, name: string, notes: string, supps: string[] }],
  desserts: [{ qty: number, name: string }],
  drinks: [{ qty: number, name: string }],
  total: number,
  status: "en_attente" | "production" | "cuisson" | "termine",
  createdAt: Timestamp,      // server timestamp
  ovenAt: Timestamp,         // set when moved to oven
  delay: string,             // optional time delay
  source: string             // "PRESTASHOP" for web orders
}
```

## Code Conventions

### JavaScript Patterns

- **State**: Global variables (`currentType`, `currentRes`, `allOrders`, etc.) — no state management library
- **Firestore**: Real-time listeners via `.onSnapshot()`, updates via `.update()`, inserts via `.add()`
- **DOM**: Direct `innerHTML` for rendering, `createElement()` for dynamic elements, inline `onclick` handlers
- **Timezone**: All date filtering uses `America/Martinique` timezone via `toLocaleDateString()`
- **Calculations**: `calcTotal()` for order totals, `updateFluxDelay()` for KDS timing

### Styling Patterns

- Dark theme base: `#000`, `#1a1a1a`, `#222`
- Status colors: red (`#e74c3c`) for actions, orange (`#f39c12`) for oven, green (`#2ecc71`) for completed, blue (`#3498db`) for web/tracking
- Sans-serif typography
- Responsive design with CSS media queries

### Menu Data

All menu items and prices are **hardcoded** in `index.html` JavaScript:
- 18 pizzas (11€–17.90€)
- 9 desserts (2.90€–9.90€)
- 15 drinks (2€–45€)
- 12 supplements (1€–4€)

Pizza prep times are configured in `cuisine.html` via the `pizzaCatalog` object.

## Development Workflow

### No Build Process

This project has no `package.json`, no bundler, no test framework, and no linter. To develop:

1. Edit HTML files directly
2. Open in a browser or serve with any static file server
3. Firebase credentials are embedded in each HTML file (client-side keys)

### Testing

No automated tests exist. Test changes manually by:
1. Opening the relevant HTML file in a browser
2. Verifying Firestore reads/writes in the Firebase console
3. Testing across the ordering → kitchen → tracking workflow

### Deployment

Files are served as static assets. No build step required — just deploy the HTML files and `logo.png`.

## Important Notes

- Firebase config is embedded in all three HTML files — keep them in sync when updating credentials
- The `manifest.json` references `"start_url": "pizza-orders v1.2.html"` which appears outdated (actual file is `index.html`)
- Orders from PrestaShop web store are identified by `source: "PRESTASHOP"` and displayed with a blue badge in the KDS
- The KDS uses an audio element for new-order alerts — ensure the audio source is accessible
