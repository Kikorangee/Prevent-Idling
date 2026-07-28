import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button, ButtonType,
  SummaryTile, SummaryTileBar, SummaryTileType,
  Chart,
  Table,
  Select,
  TextInput,
  Waiting,
  Banner
} from "@geotab/zenith";

const DAY_MS = 864e5;

function durationToHours(d) {
  if (!d) return 0;
  let days = 0, rest = d;
  const dot = d.indexOf(".");
  if (dot > -1 && dot < d.indexOf(":")) {
    days = parseInt(d.slice(0, dot), 10) || 0;
    rest = d.slice(dot + 1);
  }
  const [h = 0, m = 0, s = 0] = rest.split(":").map(parseFloat);
  return days * 24 + h + m / 60 + s / 3600;
}

function isoWeekLabel(date) {
  const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / DAY_MS + 1) / 7);
  return "W" + String(week).padStart(2, "0");
}

function fmt(n, dp = 0) {
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

function apiCall(api, method, params) {
  return new Promise((resolve, reject) => api.call(method, params, resolve, reject));
}

function apiMultiCall(api, calls) {
  return new Promise((resolve, reject) => api.multiCall(calls, resolve, reject));
}

export default function App({ api: initialApi, registerFocus }) {
  const apiRef = useRef(initialApi);
  const [rules, setRules] = useState([]);
  const [ruleId, setRuleId] = useState("RulePreventableIdlingId");
  const [days, setDays] = useState("90");
  const [minMinutes, setMinMinutes] = useState("0");
  const [groupBy, setGroupBy] = useState("vehicle");
  const [litresPerHour, setLitresPerHour] = useState("3");
  const [pricePerLitre, setPricePerLitre] = useState("1.90");
  const [names, setNames] = useState({ device: {}, driver: {} });
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const loadLookups = useCallback(async () => {
    const api = apiRef.current;
    const [ruleList, devices, users] = await Promise.all([
      apiCall(api, "Get", { typeName: "Rule" }),
      apiCall(api, "Get", { typeName: "Device" }),
      apiCall(api, "Get", { typeName: "User" })
    ]);
    setRules(ruleList.filter(r => (r.name || "").toLowerCase().includes("idl")));
    const device = {}, driver = {};
    devices.forEach(d => { device[d.id] = d.name || d.id; });
    users.forEach(u => {
      driver[u.id] = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name || u.id;
    });
    setNames({ device, driver });
  }, []);

  const loadEvents = useCallback(async () => {
    const api = apiRef.current;
    setLoading(true);
    setError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - parseInt(days, 10) * DAY_MS);
      const calls = [];
      let cursor = from;
      while (cursor < to) {
        const next = new Date(Math.min(cursor.getTime() + 30 * DAY_MS, to.getTime()));
        calls.push(["Get", {
          typeName: "ExceptionEvent",
          search: {
            ruleSearch: { id: ruleId },
            fromDate: cursor.toISOString(),
            toDate: next.toISOString()
          },
          resultsLimit: 50000
        }]);
        cursor = next;
      }
      const chunks = await apiMultiCall(api, calls);
      setEvents(chunks.flat());
      setRefreshedAt(new Date());
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ruleId, days]);

  useEffect(() => {
    registerFocus(api => { apiRef.current = api; });
    loadLookups().then(loadEvents).catch(e => {
      setError(e && e.message ? e.message : String(e));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!loading) loadEvents(); /* eslint-disable-line */ }, [ruleId, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const lph = parseFloat(litresPerHour) || 0;
  const ppl = parseFloat(pricePerLitre) || 0;
  const minMin = parseInt(minMinutes, 10) || 0;

  const { rows, weekly, totalHours, totalEvents } = useMemo(() => {
    const byKey = new Map();
    const byWeek = new Map();
    let totalH = 0, totalN = 0;

    for (const e of events) {
      const h = durationToHours(e.duration);
      if (h * 60 < minMin) continue;
      totalH += h;
      totalN += 1;

      let key, label;
      if (groupBy === "driver") {
        const id = e.driver && e.driver.id ? e.driver.id : String(e.driver || "");
        key = id || "UnknownDriverId";
        label = key === "UnknownDriverId" ? "Unassigned" : (names.driver[key] || key);
      } else {
        key = e.device ? e.device.id : "?";
        label = names.device[key] || key;
      }
      const cur = byKey.get(key) || { id: key, name: label, events: 0, hours: 0, isVehicle: groupBy === "vehicle" };
      cur.events += 1;
      cur.hours += h;
      byKey.set(key, cur);

      const wk = isoWeekLabel(new Date(e.activeFrom));
      byWeek.set(wk, (byWeek.get(wk) || 0) + h);
    }

    const rows = [...byKey.values()].map(r => ({
      ...r,
      avg: r.events ? (r.hours / r.events) * 60 : 0
    }));
    const weekly = [...byWeek.entries()].sort().map(([label, hours]) => ({ label, hours }));
    return { rows, weekly, totalHours: totalH, totalEvents: totalN };
  }, [events, minMin, groupBy, names]);

  const avgMin = totalEvents ? (totalHours / totalEvents) * 60 : 0;
  const estCost = totalHours * lph * ppl;

  const chartData = useMemo(() => ({
    datasets: [{
      label: "Idle hours",
      data: weekly.map(w => ({ x: w.label, y: Math.round(w.hours) }))
    }]
  }), [weekly]);

  const tableEntities = useMemo(() =>
    rows.map(r => ({
      id: r.id,
      name: r.name,
      events: r.events,
      hours: Math.round(r.hours * 10) / 10,
      avg: Math.round(r.avg),
      cost: Math.round(r.hours * lph * ppl)
    })), [rows, lph, ppl]);

  const [sortValue, setSortValue] = useState({ sortColumn: "hours", sortDirection: "desc" });

  const columns = useMemo(() => [
    { id: "name", title: groupBy === "driver" ? "Driver" : "Vehicle", sortable: true,
      columnComponent: { render: r => r.name } },
    { id: "events", title: "Events", sortable: true,
      columnComponent: { render: r => r.events.toLocaleString() } },
    { id: "hours", title: "Hours", sortable: true,
      columnComponent: { render: r => r.hours.toLocaleString(undefined, { maximumFractionDigits: 1 }) } },
    { id: "avg", title: "Avg min/event", sortable: true,
      columnComponent: { render: r => r.avg.toLocaleString() } },
    { id: "cost", title: "Est. cost ($)", sortable: true,
      columnComponent: { render: r => "$" + r.cost.toLocaleString() } }
  ], [groupBy]);

  const sortedEntities = useMemo(() => {
    const dir = sortValue.sortDirection === "asc" ? 1 : -1;
    const k = sortValue.sortColumn;
    return tableEntities.slice().sort((a, b) =>
      k === "name" ? dir * a.name.localeCompare(b.name) : dir * (a[k] - b[k]));
  }, [tableEntities, sortValue]);

  const exportCsv = () => {
    const head = (groupBy === "driver" ? "Driver" : "Vehicle") + ",Events,Hours,AvgMinPerEvent,EstCost";
    const lines = [head, ...tableEntities
      .slice()
      .sort((a, b) => b.hours - a.hours)
      .map(r => `"${r.name.replace(/"/g, '""')}",${r.events},${r.hours},${r.avg},${r.cost}`)];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "idling-report.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  const allUnassigned = groupBy === "driver" && rows.length === 1 && rows[0].id === "UnknownDriverId";

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1200 }}>
      <Waiting isLoading={loading} description="Loading exception events" />

      {error && (
        <Banner type="error" header="Could not load data">{error}</Banner>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
        <Select
          label="Rule"
          title="Rule"
          value={ruleId}
          onChange={id => id && setRuleId(id)}
          items={rules.map(r => ({ id: r.id, children: r.name }))}
        />
        <Select
          label="Period"
          title="Period"
          value={days}
          onChange={id => id && setDays(id)}
          items={[
            { id: "7", children: "Last 7 days" },
            { id: "30", children: "Last 30 days" },
            { id: "90", children: "Last 90 days" }
          ]}
        />
        <Select
          label="Min event"
          title="Min event"
          value={minMinutes}
          onChange={id => id && setMinMinutes(id)}
          items={[
            { id: "0", children: "Any duration" },
            { id: "5", children: "\u2265 5 min" },
            { id: "15", children: "\u2265 15 min" },
            { id: "30", children: "\u2265 30 min" }
          ]}
        />
        <Select
          label="Group by"
          title="Group by"
          value={groupBy}
          onChange={id => id && setGroupBy(id)}
          items={[
            { id: "vehicle", children: "Vehicle" },
            { id: "driver", children: "Driver" }
          ]}
        />
        <TextInput label="Fuel L/h" value={litresPerHour} onChange={e => setLitresPerHour(e.target.value)} />
        <TextInput label="$ / L" value={pricePerLitre} onChange={e => setPricePerLitre(e.target.value)} />
        <Button type={ButtonType.Primary} onClick={loadEvents}>Refresh</Button>
        <Button type={ButtonType.Secondary} onClick={exportCsv}>Export CSV</Button>
      </div>

      <SummaryTileBar aria-label="Idling summary">
        <SummaryTile title="Idle hours" tileType={SummaryTileType.Warning}>{fmt(totalHours)}</SummaryTile>
        <SummaryTile title="Events">{fmt(totalEvents)}</SummaryTile>
        <SummaryTile title={groupBy === "driver" ? "Drivers" : "Vehicles"}>{fmt(rows.length)}</SummaryTile>
        <SummaryTile title="Avg / event">{fmt(avgMin)} min</SummaryTile>
        <SummaryTile title="Est. fuel cost" tileType={SummaryTileType.Error} tooltipText="Idle hours × fuel rate × price. Adjust L/h and $/L in the toolbar.">
          {"$" + fmt(estCost)}
        </SummaryTile>
      </SummaryTileBar>

      {allUnassigned && (
        <div style={{ margin: "12px 0" }}>
          <Banner type="info" header="No driver attribution yet">
            Every event in this database is currently unassigned. Driver grouping will populate once driver ID (key fobs or Geotab Drive) is rolled out.
          </Banner>
        </div>
      )}

      <div style={{ margin: "20px 0" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Idle hours by week</h3>
        <div style={{ height: 260 }}>
          <Chart type="bar" data={chartData} legend={false} />
        </div>
      </div>

      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
        {groupBy === "driver" ? "Drivers" : "Vehicles"} ranked by idle hours
      </h3>
      <Table
        entities={sortedEntities}
        columns={columns}
        sortable={{ pageName: "idlingmonitor", value: sortValue, onChange: setSortValue }}
      />

      {refreshedAt && (
        <p style={{ fontSize: 12, color: "#5b6b7b", marginTop: 10 }}>
          Last refreshed {refreshedAt.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
