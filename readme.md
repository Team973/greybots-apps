# Team 973 greybots-apps

npm-workspaces monorepo:

- `apps/greyscout`: GreyScout, the scouting app
- `apps/preflight`: Preflight, the offline-first pit crew app (see `apps/preflight/docs/architecture.md`)
- `packages/common`: shared Vue components, styles, and the Supabase client
- `supabase/`: the shared Supabase project

## Installation

1. Clone the repo
2. Install all npm dependencies: 
```bash
npm install
```
3. (optional) Install all python util dependencies:
```bash
cd util
uv sync
```
4. Set the `TBA_API_KEY` secret on the linked Supabase project — required for the `tba-proxy` Edge Function (in-app TBA sync and OPR/DPR display) to work. Use the same key as `util/private_credentials.json`'s `tba.api_key`:
```bash
supabase secrets set TBA_API_KEY=<your-tba-api-key>
```

## Development 

To start GreyScout in development mode:
```bash
npm run dev
```

To start Preflight in development mode (or use `serve:preflight` to test the offline service worker at http://localhost:4173):
```bash
npm run dev:preflight
```

To format the code:
```bash
npm run format
```

To update the event/team database:
```bash
cd util
uv run python main.py
```

## Running in Production

To start in production mode:
```bash
npm start
```
