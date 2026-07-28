# Idling Monitor v2 (Zenith) — MyGeotab Add-In

The Idling Monitor rebuilt in React with Geotab's official **Zenith** component library (`@geotab/zenith` 3.12), so it matches MyGeotab's current look — plus a **driver dimension**.

## What's new in v2.1

- **"Where it's happening" map** (Leaflet + OpenStreetMap, bundled): every vehicle with idling events in the selected period is plotted at its current position, coloured by severity relative to the worst offender (red ≥66%, amber ≥33%, green below; red markers drawn larger). Popups show idle hours, event count, estimated cost, and driving state. Markers respect the period/rule/min-duration filters and refresh with the data.
- **"Load event locations" button**: on demand, plots the actual locations of individual idle events for the top 5 vehicles (events ≥15 min, capped at 150 LogRecord lookups in one multiCall) as small red dots — shows exactly which yards, depots, or sites the idling happens at. Loaded lazily so the page stays fast; a Clear button removes them.

## What's new over v1

- **Zenith UI throughout**: `SummaryTileBar`/`SummaryTile` KPIs (warning/error tinting on idle hours and cost), Zenith `Chart` for the weekly trend, Zenith `Table` with click-to-sort columns, `Select`/`TextInput`/`Button` toolbar, `Waiting` loading overlay, `Banner` errors. Native MyGeotab fonts ship with the bundle.
- **Group by Vehicle or Driver**: one toolbar switch re-aggregates every idle event by driver instead of vehicle. Events with no driver ID roll up under "Unassigned".
  - hydrotech currently has **no driver attribution** (all events are `UnknownDriverId`, one user flagged as driver), so driver mode shows an informational banner explaining that it will populate once driver ID (key fobs or Geotab Drive) is rolled out. The feature is built and waiting.
- Everything from v1 remains: rule selector (built from the database's own idling rules), 7/30/90-day period, minimum-event-duration filter, live-editable fuel L/h and $/L cost model, CSV export, 30-day-chunked `multiCall` fetching, session-token auth with the user's own group scope.

## Files

- `idlingmonitor.html` — loads the bundle
- `idlingmonitor.js` — the built React + Zenith app (IIFE; registers `geotab.addin.idlingmonitor`)
- `idlingmonitor.css` + font files — Zenith styles; keep them next to the JS so relative font URLs resolve
- `config.json` — installation config

## Deploy

1. Host the **whole folder** (JS, CSS, fonts, HTML together) at any HTTPS URL — GitHub Pages works.
2. Replace `https://YOUR-HOST/idling-addin-zenith/` in `config.json`.
3. MyGeotab → Administration → System Settings → Add-Ins → New Add-In → paste `config.json`.

## Rebuilding from source

Source lives in the `src/` folder of the dev project (Vite + React 19):

```
npm install
npm run build   # outputs to dist/ with fixed filenames
```

Two build decisions that matter if you modify it:
- **IIFE output format** (`vite.config.js`) — a plain module build leaks top-level `var`s (e.g. Chart.js's `getComputedStyle`) onto `window` when MyGeotab injects the script, causing infinite recursion. The IIFE wrapper prevents this.
- **`cssCodeSplit: false`** — keeps CSS as a separate file so Zenith's relative font URLs resolve against your hosting server, not my.geotab.com.
