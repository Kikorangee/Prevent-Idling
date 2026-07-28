# Idling Monitor — MyGeotab Add-In

A dashboard that monitors preventable idling across the fleet, inside MyGeotab. Uses the logged-in session, so no credentials are stored anywhere.

## What it shows

- KPI tiles: total idle hours, event count, vehicles involved, average minutes per event, and an estimated fuel cost (litres/hour and $/litre are editable in the toolbar so the estimate updates live).
- Weekly trend bar chart for the selected period.
- Sortable vehicle table (click column headers) with a "View" link that jumps to that vehicle's exceptions page in MyGeotab.
- Toolbar filters: rule (any rule with "idling" in the name — Preventable Idling, Unproductive Idling, stock Idling), period (7/30/90 days), and a minimum-event-duration filter to screen out short PTO-style idles.
- CSV export of the vehicle table.

## Files

- `idlingmonitor.html` — the page MyGeotab loads
- `idlingmonitor.css` — styles (external file; MyGeotab can strip inline `<style>` tags)
- `idlingmonitor.js` — logic (`geotab.addin.idlingmonitor`, matches the HTML filename)
- `config.json` — installation config

## Deploy

1. Host the three files (html/css/js) anywhere HTTPS-accessible — GitHub Pages is the usual zero-cost option:
   - push this folder to a repo, enable Pages, note the URL.
2. Edit `config.json` and replace `https://YOUR-HOST/idling-addin/` with the real URL.
3. In MyGeotab (hydrotech): **Administration → System… → System Settings → Add-Ins → New Add-In**, paste the contents of `config.json`, save, and allow unverified add-ins if prompted.
4. Refresh MyGeotab — "Idling monitor" appears under the Activity menu.

## Notes

- Events are fetched in 30-day chunks through one `multiCall`, so the 90-day view stays within API limits (~9k events in hydrotech currently).
- The rule dropdown is built from the database's own rules, so the custom "Unproductive Idling" rule shows up automatically and can be compared against the stock rule with two clicks.
- Add-in data respects the logged-in user's group scope — a client user sees only their vehicles.
