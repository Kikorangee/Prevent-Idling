import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonType } from "@geotab/zenith";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const SEVERITY = { high: "#d32f2f", mid: "#f0a000", low: "#2e9e44" };

function severityColor(hours, maxHours) {
  if (maxHours <= 0) return SEVERITY.low;
  const r = hours / maxHours;
  return r >= 0.66 ? SEVERITY.high : r >= 0.33 ? SEVERITY.mid : SEVERITY.low;
}

export default function MapPanel({
  api, vehicleRows, positions, events, minMin, lph, ppl, deviceNames
}) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const vehicleLayer = useRef(null);
  const dotLayer = useRef(null);
  const userMoved = useRef(false);
  const [dotsLoading, setDotsLoading] = useState(false);
  const [dotsInfo, setDotsInfo] = useState(null);
  const [mapError, setMapError] = useState(null);

  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    try {
      const map = L.map(mapEl.current).setView([-38.5, 175.5], 6);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);
      vehicleLayer.current = L.layerGroup().addTo(map);
      dotLayer.current = L.layerGroup().addTo(map);
      map.on("dragstart zoomstart", () => { userMoved.current = true; });
      mapRef.current = map;
      const resizeMap = () => map.invalidateSize({ pan: false });
      requestAnimationFrame(resizeMap);
      setTimeout(resizeMap, 250);
      const observer = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resizeMap)
        : null;
      if (observer) observer.observe(mapEl.current);
      map._idmResizeObserver = observer;
    } catch (err) {
      setMapError("Map could not start: " + (err && err.message ? err.message : String(err)));
    }
    return () => {
      if (mapRef.current) {
        if (mapRef.current._idmResizeObserver) mapRef.current._idmResizeObserver.disconnect();
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const maxHours = useMemo(
    () => vehicleRows.reduce((m, r) => Math.max(m, r.hours), 0),
    [vehicleRows]
  );

  useEffect(() => {
    if (!mapRef.current || !vehicleLayer.current) return;
    vehicleLayer.current.clearLayers();
    const bounds = [];
    const idleById = new Map(vehicleRows.map(r => [r.id, r]));
    idleById.forEach((idle, id) => {
      const pos = positions[id];
      if (!pos) return;
      const name = (idle && idle.name) || deviceNames[id] || id;
      const color = severityColor(idle.hours, maxHours);

      const marker = L.circleMarker([pos.lat, pos.lon], {
        radius: color === SEVERITY.high ? 10 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95
      });

      let html = `<div style="font-size:13px;line-height:1.5"><b>${name}</b><br>`;
      if (idle) {
        html += `${idle.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} idle hours \u00b7 ${idle.events} events<br>` +
                `Est. idle cost $${Math.round(idle.hours * lph * ppl).toLocaleString()}<br>`;
      }
      html += pos.driving ? "Driving" : "Stopped";
      html += "</div>";
      marker.bindPopup(html);

      marker.addTo(vehicleLayer.current);
      bounds.push([pos.lat, pos.lon]);
    });

    if (bounds.length && !userMoved.current) {
      mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }, [vehicleRows, positions, maxHours, lph, ppl, deviceNames]);

  const loadEventDots = async () => {
    if (!mapRef.current || dotsLoading) return;
    setDotsLoading(true);
    setDotsInfo(null);
    try {
      const nameById = Object.fromEntries(vehicleRows.map(r => [r.id, r.name]));
      const candidates = events
        .filter(e => e.deviceId && e.minutes >= minMin)
        .sort((a, b) => b.minutes - a.minutes);

      const calls = candidates.map(e => ["Get", {
        typeName: "LogRecord",
        search: {
          deviceSearch: { id: e.deviceId },
          fromDate: e.activeFrom,
          toDate: new Date(new Date(e.activeFrom).getTime() + 5 * 60000).toISOString()
        },
        resultsLimit: 1
      }]);

      const results = [];
      for (let start = 0; start < calls.length; start += 50) {
        const batch = calls.slice(start, start + 50);
        const batchResults = await new Promise((resolve, reject) => api.multiCall(batch, resolve, reject));
        results.push(...batchResults);
        setDotsInfo(`Loading event locations: ${Math.min(start + 50, calls.length)} of ${calls.length}`);
      }

      dotLayer.current.clearLayers();
      let plotted = 0;
      const coordinateCounts = new Map();
      results.forEach((recs, i) => {
        const rec = recs && recs[0];
        if (!rec || typeof rec.latitude !== "number" || (rec.latitude === 0 && rec.longitude === 0)) return;
        const e = candidates[i];
        const key = `${rec.latitude.toFixed(5)},${rec.longitude.toFixed(5)}`;
        const overlap = coordinateCounts.get(key) || 0;
        coordinateCounts.set(key, overlap + 1);
        const ring = Math.floor(overlap / 8) + 1;
        const angle = (overlap % 8) * Math.PI / 4;
        const offset = overlap ? ring * 0.000035 : 0;
        const lat = rec.latitude + Math.sin(angle) * offset;
        const lon = rec.longitude + Math.cos(angle) * offset;
        L.circleMarker([lat, lon], {
          radius: 4, color: "#d32f2f", weight: 1, fillColor: "#d32f2f", fillOpacity: 0.5
        }).bindPopup(
          `<div style="font-size:13px"><b>${nameById[e.deviceId]}</b><br>` +
          `${Math.round(e.minutes)} min idle<br>${new Date(e.activeFrom).toLocaleString()}</div>`
        ).addTo(dotLayer.current);
        plotted += 1;
      });
      setDotsInfo(`${plotted} of ${candidates.length} idling event locations plotted`);
    } catch (err) {
      setDotsInfo("Could not load event locations: " + (err && err.message ? err.message : err));
    } finally {
      setDotsLoading(false);
    }
  };

  const clearDots = () => {
    if (dotLayer.current) dotLayer.current.clearLayers();
    setDotsInfo(null);
  };

  return (
    <div style={{ margin: "20px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: "0 6px 6px 0", fontSize: 15 }}>Where it's happening</h3>
        <Button type={ButtonType.Secondary} onClick={loadEventDots} disabled={dotsLoading}>
          {dotsLoading ? "Loading\u2026" : "Load event locations"}
        </Button>
        {dotsInfo && (
          <>
            <span style={{ fontSize: 12, color: "#5b6b7b", paddingBottom: 8 }}>{dotsInfo}</span>
            <Button type={ButtonType.Tertiary} onClick={clearDots}>Clear</Button>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 18, fontSize: 12, color: "#5b6b7b", marginBottom: 6, flexWrap: "wrap" }}>
        <span><i style={dotStyle(SEVERITY.high)} /> Top idle offenders (\u226566% of worst)</span>
        <span><i style={dotStyle(SEVERITY.mid)} /> Mid (\u226533%)</span>
        <span><i style={dotStyle(SEVERITY.low)} /> Lower</span>
        <span><i style={dotStyle("#d32f2f", true)} /> Individual idle events</span>
      </div>
      {mapError && <p style={{ color: "#d32f2f", fontSize: 13 }}>{mapError}</p>}
      <div ref={mapEl} style={{ height: 680, borderRadius: 6, border: "1px solid #dfe4e9", background: "#e8ecef" }} />
    </div>
  );
}

function dotStyle(color, small) {
  return {
    display: "inline-block",
    width: small ? 8 : 12,
    height: small ? 8 : 12,
    borderRadius: "50%",
    background: color,
    opacity: small ? 0.6 : 1,
    marginRight: 5,
    verticalAlign: -1
  };
}
