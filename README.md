# Peters Data & Automations — portfolio site

A single-page portfolio for Casper Peters' freelance automation business (Eindhoven, NL), built to be linked from an Upwork profile. It is a static site: no build step, no dependencies, no tracking.

## What's on the page

| Section | Purpose |
|---|---|
| Hero | Positioning in one line, three calls to action (demo, Upwork, work) |
| Services | Four small, scoped offers with "good fit if" and "you get" |
| **Live demo** | A messy order export turned into a validated report, in the browser |
| Proof of work | Three real projects, each with "what this shows" for a client |
| Process | Scope → build small → hand over → support, plus how data is handled |
| About / FAQ / Hire | Short bio, honest answers, one clear next step (Upwork) |

## The live demo

`pipeline.js` is the engine, `sample-data.js` generates a synthetic, deliberately messy export (a fictional coffee roaster), and `demo.js` is the interface. It:

- parses CSV (quotes, `;` or `,` delimiters, header aliases),
- fixes what is safe to fix (date formats, `€18,50` prices, `nederland` → Netherlands, whitespace and casing, exact duplicates) and logs each change as before → after,
- **sets aside** what needs a person (missing customer, negative quantity, impossible date, conflicting duplicate order ID) instead of guessing,
- flags unusual prices without removing them,
- builds the report in whole cents (no floating-point drift) and offers clean CSV, set-aside CSV and a standalone HTML report.

Everything runs in the visitor's browser; nothing is uploaded. User text is inserted with `textContent` (never `innerHTML`), and exported CSV cells are guarded against spreadsheet formula injection.

```bash
npm test        # node --test tests/  (12 tests, no dependencies)
npm run serve   # http://127.0.0.1:4173
```

## Files

```
index.html          page
styles.css          design system (dark, mono labels, cyan accent)
app.js              hero animation (canvas), controls
pipeline.js         pure data pipeline (browser + Node)
sample-data.js      synthetic sample generator
demo.js             demo UI (tabs, tables, charts, downloads)
tests/              unit tests for the pipeline
tools/og-cover.html source of assets/og-cover.jpg (render with headless Chromium, 1200x630)
assets/             portrait, share image, project screenshots
```

## Deploying to GitHub Pages

Create a repository named `peters-automatisering-portfolio`, push this branch as `main`, then enable Pages for the root of `main`. `.nojekyll` is included.

## Not tested

Real devices and screen readers, and performance on slow phones (the hero animation is canvas-based; there is a Pause control and `prefers-reduced-motion` is honoured).
