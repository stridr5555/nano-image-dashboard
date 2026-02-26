# Nano Banana Prompt Dashboard

UX/Branding cues from the `superdesign` skill (layered cards, neo-noir color palette, clipped buttons) and backend hardening inspired by the `backend` skill's error-handling/observability mindset. This dashboard packages:

- Four curated Midjourney-style prompts refreshed on demand.
- A "Generate from prompts" action that queues a Nano Banana image build powered by Gemini 2.5.
- A Replicate-powered upscaler endpoint using the Real-ESRGAN model.
- A headed-browser trigger that fires `mcporter`/Chrome DevTools to land on the Adobe Stock contributor page.

## Structure

```
projects/image-dashboard
├── public/            # Static SPA
├── prompts.json       # Midjourney-inspired prompt library
├── server.js          # Express API + automation hooks
├── package.json       # Dependencies & scripts
└── README.md          # This guide
```

## Getting started

1. Install dependencies:
   ```bash
   cd projects/image-dashboard
   npm install
   ```
2. Provide secrets (see below).
3. Launch the dashboard:
   ```bash
   npm start
   ```
4. Visit `http://localhost:3001` and interact with the prompt grid, generation, upscale, and upload buttons.

## Secrets

The dashboard reads the Replicate token (`REPLICATE_API_TOKEN`) from `process.env` or from `/home/<user>/.openclaw/api.txt`. To set it explicitly:
```bash
export REPLICATE_API_TOKEN=REPLICATE_TOKEN_FROM_API.TXT
```

The Nano Banana CLI (via `uv run scripts`) is expected to be wired separately when you process queued prompts. The dashboard simply logs the chosen prompts for the CLI to pick up.

### Gemini 2.5 model

The Gemini generation script defaults to the `gemini-2.5-pro-image-preview` model. If you need to try a different Gemini variant, set the `GEMINI_IMAGE_MODEL` environment variable before running the script:

```bash
export GEMINI_IMAGE_MODEL=gemini-2.5-pro-image-preview
```

## Automation hooks

| Endpoint | Action |
| --- | --- |
| `POST /api/generate` | Logs prompt selection and keeps a short job history.
| `POST /api/upscale` | Calls Replicate (Real-ESRGAN, version `b3ef...ea8`) and records prediction metadata.
| `POST /api/upload` | Executes `mcporter call chrome-devtools.navigate_page` to land on Adobe Stock Contributor.

## UI notes

- Designed with card-based layout, subtle gradients, and pill buttons inspired by the `superdesign` guidelines.
- Responsive grid ensures four prompts stay readable on desktop and compress gracefully to mobile breakpoints.
- Status area and job log surface the latest actions.

## Next steps

- Hook `uv`/Nano Banana script to the queued job log for hands-free generation.
- Expand prompt sources by syncing with your favorite prompt database.
- Plug in actual upload automation (Chrome flows) via the job history entries.
