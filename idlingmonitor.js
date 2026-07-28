"use strict";

geotab.addin.idlingmonitor = function () {
  var api = null;
  var elems = {};
  var state = {
    rules: [],
    deviceNames: {},
    rows: [],          // aggregated per-vehicle rows
    weekly: [],        // [{label, hours}]
    totalHours: 0,
    totalEvents: 0,
    sortKey: "hours",
    sortDir: -1,
    loading: false
  };

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, isError) {
    elems.status.textContent = msg || "";
    elems.status.className = "idm-status" + (isError ? " error" : "");
  }

  function durationToHours(d) {
    // API returns "hh:mm:ss[.fff]" or "d.hh:mm:ss"
    if (!d) { return 0; }
    var days = 0, rest = d;
    if (d.indexOf(".") > -1 && d.indexOf(".") < d.indexOf(":")) {
      var parts = d.split(".");
      days = parseInt(parts[0], 10) || 0;
      rest = parts.slice(1).join(".");
    }
    var hms = rest.split(":");
    var h = parseFloat(hms[0]) || 0;
    var m = parseFloat(hms[1]) || 0;
    var s = parseFloat(hms[2]) || 0;
    return days * 24 + h + m / 60 + s / 3600;
  }

  function fmt(n, dp) {
    return n.toLocaleString(undefined, { maximumFractionDigits: dp === undefined ? 1 : dp, minimumFractionDigits: 0 });
  }

  function loadRules() {
    return new Promise(function (resolve, reject) {
      api.call("Get", { typeName: "Rule" }, function (rules) {
        state.rules = rules.filter(function (r) {
          return (r.name || "").toLowerCase().indexOf("idl") > -1;
        });
        elems.rule.innerHTML = "";
        state.rules.forEach(function (r) {
          var opt = document.createElement("option");
          opt.value = r.id;
          opt.textContent = r.name;
          if (r.id === "RulePreventableIdlingId") { opt.selected = true; }
          elems.rule.appendChild(opt);
        });
        resolve();
      }, reject);
    });
  }

  function loadDevices() {
    return new Promise(function (resolve, reject) {
      api.call("Get", { typeName: "Device" }, function (devices) {
        state.deviceNames = {};
        devices.forEach(function (d) { state.deviceNames[d.id] = d.name || d.id; });
        resolve();
      }, reject);
    });
  }

  function fetchEvents(ruleId, fromDate, toDate) {
    // chunk into <=30 day windows via one multiCall
    var calls = [];
    var cursor = new Date(fromDate.getTime());
    while (cursor < toDate) {
      var next = new Date(Math.min(cursor.getTime() + 30 * 864e5, toDate.getTime()));
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
    return new Promise(function (resolve, reject) {
      api.multiCall(calls, function (results) {
        var all = [];
        results.forEach(function (chunk) { all = all.concat(chunk || []); });
        resolve(all);
      }, reject);
    });
  }

  function isoWeekLabel(d) {
    var dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((dt - yearStart) / 864e5) + 1) / 7);
    return dt.getUTCFullYear() + "-W" + (week < 10 ? "0" : "") + week;
  }

  function aggregate(events, minMinutes, lph, ppl) {
    var byDev = {};
    var byWeek = {};
    var totalH = 0, totalN = 0;

    events.forEach(function (e) {
      var h = durationToHours(e.duration);
      if (h * 60 < minMinutes) { return; }
      totalH += h;
      totalN += 1;

      var devId = e.device ? e.device.id : "?";
      if (!byDev[devId]) { byDev[devId] = { events: 0, hours: 0 }; }
      byDev[devId].events += 1;
      byDev[devId].hours += h;

      var start = new Date(e.activeFrom);
      var wk = isoWeekLabel(start);
      byWeek[wk] = (byWeek[wk] || 0) + h;
    });

    state.totalHours = totalH;
    state.totalEvents = totalN;

    state.rows = Object.keys(byDev).map(function (id) {
      var s = byDev[id];
      return {
        id: id,
        name: state.deviceNames[id] || id,
        events: s.events,
        hours: s.hours,
        avg: s.events ? (s.hours / s.events) * 60 : 0,
        cost: s.hours * lph * ppl
      };
    });

    state.weekly = Object.keys(byWeek).sort().map(function (wk) {
      return { label: wk, hours: byWeek[wk] };
    });
  }

  function renderKpis(lph, ppl) {
    $("k-hours").textContent = fmt(state.totalHours, 0);
    $("k-events").textContent = fmt(state.totalEvents, 0);
    $("k-vehicles").textContent = fmt(state.rows.length, 0);
    var avg = state.totalEvents ? (state.totalHours / state.totalEvents) * 60 : 0;
    $("k-avg").textContent = fmt(avg, 0) + " min";
    $("k-cost").textContent = "$" + fmt(state.totalHours * lph * ppl, 0);
  }

  function renderTrend() {
    var host = elems.trend;
    host.innerHTML = "";
    if (!state.weekly.length) {
      host.textContent = "No events in this period.";
      return;
    }
    var max = 0;
    state.weekly.forEach(function (w) { if (w.hours > max) { max = w.hours; } });
    state.weekly.forEach(function (w) {
      var bar = document.createElement("div");
      bar.className = "bar";
      var val = document.createElement("div");
      val.className = "val";
      val.textContent = fmt(w.hours, 0);
      var fill = document.createElement("div");
      fill.className = "fill";
      fill.style.height = Math.max(2, Math.round((w.hours / max) * 110)) + "px";
      fill.title = w.label + ": " + fmt(w.hours, 1) + " h";
      var lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = w.label.replace(/^\d+-/, "");
      bar.appendChild(val);
      bar.appendChild(fill);
      bar.appendChild(lbl);
      host.appendChild(bar);
    });
  }

  function renderTable() {
    var tbody = elems.table.querySelector("tbody");
    tbody.innerHTML = "";
    var rows = state.rows.slice().sort(function (a, b) {
      var k = state.sortKey;
      if (k === "name") { return state.sortDir * a.name.localeCompare(b.name); }
      return state.sortDir * (a[k] - b[k]);
    });
    var maxH = rows.reduce(function (m, r) { return Math.max(m, r.hours); }, 0) || 1;

    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      var tdName = document.createElement("td");
      tdName.textContent = r.name;
      tr.appendChild(tdName);

      ["events", "hours", "avg", "cost"].forEach(function (k) {
        var td = document.createElement("td");
        td.className = "num";
        if (k === "hours") {
          var bar = document.createElement("span");
          bar.className = "idm-hbar";
          bar.style.width = Math.max(2, Math.round((r.hours / maxH) * 90)) + "px";
          td.appendChild(bar);
          td.appendChild(document.createTextNode(fmt(r.hours, 1)));
        } else if (k === "cost") {
          td.textContent = "$" + fmt(r.cost, 0);
        } else {
          td.textContent = fmt(r[k], k === "avg" ? 0 : 0);
        }
        tr.appendChild(td);
      });

      var tdLink = document.createElement("td");
      var a = document.createElement("a");
      a.href = "#exceptions,assets:!(" + r.id + ")";
      a.textContent = "View";
      tdLink.appendChild(a);
      tr.appendChild(tdLink);

      tbody.appendChild(tr);
    });
  }

  function exportCsv() {
    var lines = ["Vehicle,Events,Hours,AvgMinPerEvent,EstCost"];
    state.rows.slice().sort(function (a, b) { return b.hours - a.hours; }).forEach(function (r) {
      lines.push('"' + r.name.replace(/"/g, '""') + '",' + r.events + "," +
        r.hours.toFixed(2) + "," + r.avg.toFixed(1) + "," + r.cost.toFixed(2));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "idling-report.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function refresh() {
    if (state.loading || !api) { return; }
    state.loading = true;
    setStatus("Loading exception events…");

    var days = parseInt(elems.range.value, 10);
    var minMin = parseInt(elems.min.value, 10);
    var lph = parseFloat(elems.lph.value) || 0;
    var ppl = parseFloat(elems.ppl.value) || 0;
    var ruleId = elems.rule.value;
    var to = new Date();
    var from = new Date(to.getTime() - days * 864e5);

    fetchEvents(ruleId, from, to).then(function (events) {
      aggregate(events, minMin, lph, ppl);
      renderKpis(lph, ppl);
      renderTrend();
      renderTable();
      setStatus(fmt(state.totalEvents, 0) + " events · last refreshed " + new Date().toLocaleTimeString());
      state.loading = false;
    }).catch(function (err) {
      setStatus("Failed to load events: " + (err && err.message ? err.message : err), true);
      state.loading = false;
    });
  }

  return {
    initialize: function (freshApi, freshState, initializeCallback) {
      api = freshApi;

      elems = {
        rule: $("idm-rule"),
        range: $("idm-range"),
        min: $("idm-min"),
        lph: $("idm-lph"),
        ppl: $("idm-ppl"),
        status: $("idm-status"),
        trend: $("idm-trend"),
        table: $("idm-table")
      };

      $("idm-refresh").addEventListener("click", refresh);
      $("idm-export").addEventListener("click", exportCsv);
      [elems.rule, elems.range, elems.min].forEach(function (el) {
        el.addEventListener("change", refresh);
      });
      [elems.lph, elems.ppl].forEach(function (el) {
        el.addEventListener("change", function () {
          var lph = parseFloat(elems.lph.value) || 0;
          var ppl = parseFloat(elems.ppl.value) || 0;
          state.rows.forEach(function (r) { r.cost = r.hours * lph * ppl; });
          renderKpis(lph, ppl);
          renderTable();
        });
      });

      elems.table.querySelectorAll("th[data-sort]").forEach(function (th) {
        th.addEventListener("click", function () {
          var k = th.getAttribute("data-sort");
          if (state.sortKey === k) { state.sortDir = -state.sortDir; }
          else { state.sortKey = k; state.sortDir = k === "name" ? 1 : -1; }
          renderTable();
        });
      });

      Promise.all([loadRules(), loadDevices()])
        .then(function () {
          initializeCallback();
          refresh();
        })
        .catch(function (err) {
          setStatus("Initialisation failed: " + (err && err.message ? err.message : err), true);
          initializeCallback();
        });
    },

    focus: function (freshApi) {
      api = freshApi;
      if (state.rules.length) { refresh(); }
    },

    blur: function () { }
  };
};
