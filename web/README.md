# subtick.dev — public site

Static landing + live demo for Subtick. No build step, no framework.

```
web/
├── index.html        landing page
├── demo.html         live round-trip demo
├── styles.css        design system
├── main.js           landing — hero pill + WS live feed
├── demo.js           demo — fetch /health, time round-trip
├── LOGO.png          brand mark (full wordmark)
└── assets/
    ├── favicon.svg   favicon
    └── logo-placeholder.svg   (legacy placeholder — unused once LOGO.png is wired)
```

## Run locally

Any static server. From the repo root:

```bash
cd web
python -m http.server 5173
# http://localhost:5173
```

Or with Node:

```bash
npx serve web -l 5173
```

When run from `localhost`, the JS auto-points API + WebSocket calls at
`https://subtick.dev`. When deployed to `subtick.dev` itself, both fall
back to same-origin (`/health`, `/v1/events`).

## Deploy

The site is pure static files — anything that can serve a directory works:

- **Vercel / Cloudflare Pages / Netlify**: point them at this `web/` directory; no build command.
- **Same box as the validator**: serve `web/` from the same process / nginx
  in front of the API. Static files at `/`, API at `/health`, `/v1/*`.

## Notes

- The hero pill and live feed both call `subtick.dev` directly. The API
  must allow CORS from the origin you deploy to (the v0 contract uses
  permissive CORS, so this works out of the box).
- The big Send button on `/demo.html` measures a real round-trip to
  `/health`. It does NOT submit a transaction — that needs Ed25519
  signing in the browser (see `sdk/js/`) or a server-side helper. Wiring
  a real signed-tx button is a 30-line follow-up.
- Replace `assets/favicon.svg` and `LOGO.png` together if you change the
  palette — the colours in `styles.css` (`--accent`, `--accent2`) should
  also be re-tuned to match.
