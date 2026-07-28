import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonType, TextInput } from "@geotab/zenith";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const SEVERITY = { high: "#d32f2f", mid: "#f0a000", low: "#2e9e44" };

const FLASH_CSS =
  "@keyframes idmSpeedFlash{0%,100%{fill-opacity:1;stroke-opacity:1}50%{fill-opacity:0.15;stroke-opacity:0.3}}" +
  ".idm-speeding{animation:idmSpeedFlash 0.8s linear infinite}";

function severityColor(hours, maxHours) {
  if (maxHours <= 0) return SEVERITY.low;
  const r = hours / maxHours;
  return r >= 0.66 ? SEVERITY.high : r >= 0.33 ? SEVERITY.mid : SEVERITY.low;
}

function fmtSince(sinceMs) {
  const s = Math.round((Date.now() - sinceMs) / 1000);
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
}

export default function MapPanel({
  api, vehicleRows, positions, events, minMin, lph, ppl,
  speeding, deviceNames,
  speedLimit, setSpeedLimit, overspeed, setOverspeed, speedDuration, setSpeedDuration
}) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const vehicleLayer = useRef(null);
  const dotLayer = useRef(null);
  const userMoved = useRef(false);
  const [dotsLoading, setDotsLoading] = useState(false);
  const [dotsInfo, setDotsInfo] = useState(null);

  useEffect(() => {
    if (!document.getElementById("idm-flash-style")) {
      const style = document.createElement("style");
      style.id = "idm-flash-style";
      style.textContent = FLASH_CSS;
      document.head.appendChild(style);
    }
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
    } catch (e) {
      // non-browser environment; leave map unmounted
    }
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
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
    const allIds = new Set([...idleById.keys(), ...Object.keys(speeding)]);

    allIds.forEach(id => {
      const pos = positions[id];
      if (!pos) return;
      const idle = idleById.get(id);
      const spd = speeding[id];
      const name = (idle && idle.name) || deviceNames[id] || id;

      const isSpeeding = !!spd;
      const color = isSpeeding ? SEVERITY.high : severityColor(idle ? idle.hours : 0, maxHours);

      const marker = L.circleMarker([pos.lat, pos.lon], {
        radius: isSpeeding || color === SEVERITY.high ? 10 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
        className: isSpeeding ? "idm-speeding" : ""
      });

      let html = `<div style="font-size:13px;line-height:1.5"><b>${name}</b><br>`;
      if (isSpeeding) {
        const zone = spd.posted !== null && spd.posted !== undefined
          ? `${spd.posted} zone +${Math.round(spd.speed - spd.posted)} km/h (trigger ${spd.effLimit})`
          : `limit unknown \u2014 fallback ${speedLimit} km/h`;
        html += `<span style="color:#d32f2f;font-weight:600">SPEEDING \u2014 ${Math.round(spd.speed)} km/h</span>` +
                ` (${zone}, over for ${fmtSince(spd.sinceMs)})<br>`;
      }
      if (idle) {
        html += `${idle.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} idle hours \u00b7 ${idle.events} events<br>` +
                `Est. idle cost $${Math.round(idle.hours * lph * ppl).toLocaleString()}<br>`;
      }
      if (!isSpeeding) {
        html += pos.driving ? `Driving \u00b7 ${Math.round(pos.speed)} km/h` : "Stopped";
      }
      html += "</div>";
      marker.bindPopup(html);

      marker.addTo(vehicleLayer.current);
      bounds.push([pos.lat, pos.lon]);
    });

    if (bounds.length && !userMoved.current) {
      mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }, [vehicleRows, positions, maxHours, lph, ppl, speeding, deviceNames, speedLimit]);

  const loadEventDots = async () => {
    if (!mapRef.current || dotsLoading) return;
    setDotsLoading(true);
    setDotsInfo(null);
    try {
      const top = vehicleRows.slice().sort((a, b) => b.hours - a.hours).slice(0, 5);
      const topIds = new Set(top.map(r => r.id));
      const nameById = Object.fromEntries(top.map(r => [r.id, r.name]));
      const candidates = events
        .filter(e => e.deviceId && topIds.has(e.deviceId) && e.minutes >= Math.max(minMin, 15))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 150);

      const calls = candidates.map(e => ["Get", {
        typeName: "LogRecord",
        search: {
          deviceSearch: { id: e.deviceId },
          fromDate: e.activeFrom,
          toDate: new Date(new Date(e.activeFrom).getTime() + 5 * 60000).toISOString()
        },
        resultsLimit: 1
      }]);

      const results = await new Promise((resolve, reject) => api.multiCall(calls, resolve, reject));

      dotLayer.current.clearLayers();
      let plotted = 0;
      results.forEach((recs, i) => {
        const rec = recs && recs[0];
        if (!rec || typeof rec.latitude !== "number" || (rec.latitude === 0 && rec.longitude === 0)) return;
        const e = candidates[i];
        L.circleMarker([rec.latitude, rec.longitude], {
          radius: 4, color: "#d32f2f", weight: 1, fillColor: "#d32f2f", fillOpacity: 0.5
        }).bindPopup(
          `<div style="font-size:13px"><b>${nameById[e.deviceId]}</b><br>` +
          `${Math.round(e.minutes)} min idle<br>${new Date(e.activeFrom).toLocaleString()}</div>`
        ).addTo(dotLayer.current);
        plotted += 1;
      });
      setDotsInfo(`${plotted} event locations plotted (top 5 vehicles, events \u2265 ${Math.max(minMin, 15)} min)`);
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

  const speedingCount = Object.keys(speeding).length;

  return (
    <div style={{ margin: "20px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: "0 6px 6px 0", fontSize: 15 }}>Where it's happening</h3>
        <TextInput label="Overspeed by (km/h)" value={overspeed} onChange={e => setOverspeed(e.target.value)} />
        <TextInput label="Fallback limit (km/h)" value={speedLimit} onChange={e => setSpeedLimit(e.target.value)} />
        <TextInput label="For at least (s)" value={speedDuration} onChange={e => setSpeedDuration(e.target.value)} />
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
      {speedingCount > 0 && (
        <p style={{ margin: "0 0 6px", fontSize: 13, color: "#d32f2f", fontWeight: 600 }}>
          {speedingCount} vehicle{speedingCount > 1 ? "s" : ""} speeding now
        </p>
      )}
      <div style={{ display: "flex", gap: 18, fontSize: 12, color: "#5b6b7b", marginBottom: 6, flexWrap: "wrap" }}>
        <span><i style={dotStyle(SEVERITY.high)} /> Flashing = over posted limit + margin</span>
        <span><i style={dotStyle(SEVERITY.high)} /> Top idle offenders (\u226566% of worst)</span>
        <span><i style={dotStyle(SEVERITY.mid)} /> Mid (\u226533%)</span>
        <span><i style={dotStyle(SEVERITY.low)} /> Lower</span>
        <span><i style={dotStyle("#d32f2f", true)} /> Individual idle events</span>
      </div>
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
