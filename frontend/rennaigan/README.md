# Rennaigan

Frontend for a multimodal digital-forensics platform. Vite, React 19, TypeScript, Tailwind v4, GSAP, three.js.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## Demo data

There is no backend. Everything under `src/data` is fabricated and labelled as such in code, and the UI carries a "Demo data" badge.
Uploaded files never leave the browser and are not analysed. Detailed fixtures (timeline, graph, claims, audit trail) exist for one investigation, `RG-2026-00124`; other cases are listed for navigation and filtering.

To connect a backend, replace the function bodies in `src/services/api.ts`. Pages depend only on those signatures.

There is no real media either: `components/forensic/MediaFrame.tsx` draws a procedural stand-in frame from the playback clock, and `hooks/usePlayback.ts` is a simulated media clock. Swap both for a `<video>` element when media is available.

## Structure

```
src/
  app/            router, error boundary, lazy routes
  styles/         design tokens (@theme) and component classes
  lib/            motion tokens, formatting, class helper
  types/          domain types
  data/           demo fixtures
  services/       data access layer
  hooks/          prefs, async query, playback clock, hotkeys
  animations/     shared GSAP entrance hook
  shaders/        fresnel shader for the 3D lens
  components/
    background/   MatrixRain (canvas)
    glass/        the glass component system
    navigation/   app shell, breadcrumbs, page header
    forensic/     media frame, heatmap, spectrogram, pipeline, signals
    timeline/     ForensicTimeline
    graph/        EvidenceGraph (SVG, pan and zoom)
    three/        ForensicLens (three.js, lazy)
  pages/          one file per route
```

## Routes

`/` landing, `/overview`, `/investigations`, `/analyze`, `/analysis/:id`, `/timeline/:id`, `/evidence/:id`, `/verification/:id`, `/reports/:id`, `/audit/:id`, `/bulk`, `/cases`, `/review/:id`, `/models`, `/settings`.

## Design system

- Tokens live in `src/styles/index.css` (`@theme` plus `:root`): colour, radius, blur, shadow, z-index, durations, easings. Motion tokens for GSAP are in `src/lib/motion.ts`.
- Glass has four depth levels via `data-level` on `.glass`: 1 ambient, 2 interactive, 3 focused, 4 critical evidence.
- Radius rule: panels 20px, inner surfaces 14px, controls 10px.
- Pink is the accent and the investigation marker. Status colours (ok, warn, danger, info) stay distinct from it.
- Icons: Phosphor, light weight, nowhere else.

## Keyboard

`Ctrl/Cmd K` command palette, `/` search, `?` shortcut list. In the workstation: `Space` play or pause, arrow keys step a frame, `1 2 3` replay a flagged interval.

## Performance notes

- Matrix rain is one canvas at 30 fps with a DPR cap, an adaptive stream count, and it pauses when the tab is hidden.
- three.js loads only with the 3D lens (landing hero and the analyzer's processing view) and pauses off screen.
- ScrollTrigger ships with the landing chunk only. Every page is its own chunk.
- Settings has reduced motion, animation intensity, density and a switch that turns off rain, 3D and backdrop blur.
