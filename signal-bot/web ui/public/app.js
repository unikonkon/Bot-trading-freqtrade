"use strict";
const $ = (id) => document.getElementById(id);
let metadata,
  result,
  detail,
  chartEnd = 0,
  tradePage = 0,
  active = false;
const params = {};
let chartColors = {};
let exporting = false;
let snapshots = [], localRunId = null;
const selectedStrategies = new Set();
const selectedIntervals = new Set();
let mainStrategy = "";
let mainInterval = "";
let compareSort = { key: "returnPct", dir: -1 };
const TABS = ["chart", "compare", "trades", "inspect"];
const parameterLabels = {
  period: "ช่วงคำนวณ RSI",
  buyThreshold: "ระดับซื้อ",
  sellThreshold: "ระดับขาย",
  fastPeriod: "EMA เร็ว",
  slowPeriod: "EMA ช้า",
  swingSize: "ช่วง Swing",
  internalSize: "ช่วง Internal",
  trendPeriod: "EMA กรองทิศทาง",
  trendSlopeBars: "ระยะเทียบความชัน EMA เทรนด์ (แท่ง)",
  stopAtr: "ระยะ Stop × ATR (ตรวจราคาปิด)",
  trailAtr: "ระยะ Trailing × ATR",
  rewardRisk: "เป้าหมายต่อความเสี่ยง",
  maxHoldBars: "จำนวนแท่งถือสูงสุด",
  cooldownBars: "พักหลังออก (แท่ง)",
  rsiThreshold: "RSI สำหรับช่วงฟื้นตัว",
  trendThreshold: "เกณฑ์ความชัดเจนของเทรนด์ (0–1)",
  maxVolatilityRatio: "ATR เร็ว/ช้าสูงสุดก่อนงดเข้า",
  adxPeriod: "ช่วง ADX/DI",
  adxThreshold: "ADX ขั้นต่ำ",
  confluenceBars: "อายุสัญญาณ Trendlines (แท่ง)",
  breakEvenAtr: "เริ่มป้องกันกำไรเมื่อเพิ่ม × ATR",
  breakEvenBufferPct: "ระยะเหนือราคาสัญญาณเข้า (%)",
  minStopPct: "ระยะ Stop/Trailing ขั้นต่ำ (%)",
  volumePeriod: "ช่วงปริมาณซื้อขายอ้างอิง",
  minVolumeRatio: "ปริมาณซื้อขาย / เฉลี่ยก่อนหน้า ขั้นต่ำ",
  setupBars: "อายุจังหวะ sweep/retest (แท่ง)",
  shockBars: "พักหลังแท่งผันผวนรุนแรง (แท่ง)",
  shockAtr: "True Range สูงสุดก่อนพัก × ATR ก่อนหน้า",
  targetAtr: "ระยะเป้าหมายสูงสุด × ATR",
  minRiskPct: "ระยะ Stop เริ่มต้นขั้นต่ำ (%)",
  costPct: "ต้นทุนเผื่อไป–กลับ (%) ตั้งให้ครอบคลุม fee/slippage",
  minNetProfitPct: "ระยะกำไรหลังต้นทุนเผื่อขั้นต่ำ (%)",
  minNetRewardRisk: "Reward/Risk หลังต้นทุนเผื่อขั้นต่ำ",
  maxExtensionAtr: "ระยะห่าง EMA เร็วสูงสุด × ATR",
  bbLength: "ช่วง BB",
  bbMult: "ตัวคูณ BB",
  kcLength: "ช่วง KC",
  kcMult: "ตัวคูณ KC",
  fastLength: "ช่วง MACD เร็ว",
  slowLength: "ช่วง MACD ช้า",
  signalLength: "ช่วง Signal",
  atrPeriod: "ช่วง ATR",
  multiplier: "ตัวคูณ ATR",
  zigzagLen: "ช่วง Zigzag",
  fibFactor: "สัดส่วน Fibonacci",
  leftBars: "แท่งด้านซ้าย",
  rightBars: "แท่งยืนยันด้านขวา",
  volumeThresh: "เกณฑ์ Volume",
  trendLength: "ช่วงเส้นแนวโน้ม",
  trendMult: "ตัวคูณเส้นแนวโน้ม",
  keyValue: "ความไว (Key value)",
  utAtrPeriod: "ช่วง ATR",
};
const modeName = { next_open: "เปิดแท่งถัดไป", legacy: "ปิดแท่งสัญญาณ (เดิม)" };
const fmt = (v, d = 2) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      })
    : "—";
const pct = (v) => `${v > 0 ? "+" : ""}${fmt(v)}%`;
const time = (ms) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
const color = (v) => (v > 0 ? "buy" : v < 0 ? "sell" : "");
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const strategy = (id) => metadata.strategies.find((s) => s.id === id);
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function busy(value) {
  active = value;
  document
    .querySelectorAll("#config input,#config select,#config button")
    .forEach((e) => (e.disabled = value));
  $("export-open").disabled = value || !result || !!result.paged;
  $("export-open").title = result?.paged ? "ไฟล์ต้นฉบับอยู่ใน data-test; Export ZIP เดิมใช้กับโหมดออนไลน์" : "";
  $("cancel-run").disabled = !value || !localRunId;
  $("cancel-run").hidden = !value || !localRunId;
  $("slippage").disabled = value || $("mode").value === "legacy";
  $("run").textContent = value ? "กำลังคำนวณ…" : "รันทดสอบ";
  if (!value) sourceFields();
}
function parameters() {
  const id = $("param-target").value;
  if (!id) return;
  const s = strategy(id);
  $("description").textContent = s.descriptionTh;
  $("params").replaceChildren(
    ...Object.entries(params[id]).map(([key, value]) => {
      const shortLabel = id === "smc_adaptive_short"
        ? { rsiThreshold: "RSI สูงสุดก่อนงดเข้า", adxThreshold: "ADX ระดับขาลงแรงที่งดซื้อ" }[key]
        : null;
      const label = node("label", shortLabel || parameterLabels[key] || key);
      label.title = key;
      const input = node("input");
      input.type = "number";
      input.value = value;
      const period = /period|length|size|bars|len/i.test(key);
      input.step = period ? "1" : "0.01";
      input.min = period ? "2" : key === "volumeThresh" ? "0" : "0.01";
      input.max = period
        ? "200"
        : key.includes("Threshold")
          ? "100"
          : key === "volumeThresh"
            ? "1000"
            : key === "fibFactor"
              ? "1"
              : "20";
      input.required = true;
      input.addEventListener(
        "input",
        () => (params[id][key] = Number(input.value)),
      );
      label.append(input);
      return label;
    }),
  );
}
function intervalRecord(interval) {
  const snapshot = snapshots.find((s) => s.snapshot === $("snapshot").value);
  return snapshot?.records.find((r) => r.interval === interval);
}
function intervalAvailable(interval) {
  return $("source").value !== "local" || !!intervalRecord(interval)?.ready;
}
function buildIntervalPicker() {
  $("interval-list").replaceChildren(
    ...metadata.intervals.map((interval) => {
      const chip = node("span", undefined, "interval-chip");
      chip.dataset.id = interval;
      const toggle = node("button", interval, "interval-toggle");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        if (selectedIntervals.has(interval)) {
          selectedIntervals.delete(interval);
          if (mainInterval === interval) mainInterval = [...selectedIntervals][0] ?? "";
        } else selectedIntervals.add(interval);
        syncIntervals();
      });
      const star = node("button", "★", "interval-star");
      star.type = "button";
      star.title = `ตั้ง ${interval} เป็นช่วงหลัก`;
      star.setAttribute("aria-label", star.title);
      star.addEventListener("click", () => setMainInterval(interval));
      chip.append(toggle, star);
      return chip;
    }),
  );
}
// The main interval drives the chart, per-bar values and the Telegram preview,
// so it is always part of the run.
function setMainInterval(interval) {
  mainInterval = interval;
  selectedIntervals.add(interval);
  syncIntervals();
}
function syncIntervals() {
  for (const interval of [...selectedIntervals])
    if (!intervalAvailable(interval)) selectedIntervals.delete(interval);
  if (mainInterval && !selectedIntervals.has(mainInterval))
    mainInterval = [...selectedIntervals][0] ?? "";
  if (!mainInterval && selectedIntervals.size) mainInterval = [...selectedIntervals][0];
  for (const chip of [...$("interval-list").children]) {
    const interval = chip.dataset.id,
      on = selectedIntervals.has(interval),
      main = interval === mainInterval,
      available = intervalAvailable(interval);
    const record = intervalRecord(interval);
    chip.classList.toggle("is-on", on);
    chip.classList.toggle("is-main", main);
    chip.classList.toggle("is-off", !available);
    const toggle = chip.querySelector(".interval-toggle");
    toggle.setAttribute("aria-pressed", String(on));
    toggle.disabled = !available || active;
    toggle.title = !available
      ? `ชุดข้อมูลนี้ยังไม่มี ${interval}`
      : record
        ? `${interval} · ${record.bars.toLocaleString()} แท่ง`
        : interval;
    const star = chip.querySelector(".interval-star");
    star.setAttribute("aria-pressed", String(main));
    star.disabled = !available || active;
  }
  $("interval-count").textContent =
    `เลือก ${selectedIntervals.size} / ${metadata.intervals.filter(intervalAvailable).length}`;
  $("interval-error").hidden = selectedIntervals.size > 0;
  updateDatasetSummary();
}
function buildStrategyPicker() {
  $("strategy-list").replaceChildren(
    ...metadata.strategies.map((s) => {
      const item = node("div", undefined, "strategy-item");
      item.dataset.id = s.id;
      const label = node("label", undefined, "check");
      const input = node("input");
      input.type = "checkbox";
      input.value = s.id;
      input.addEventListener("change", () => {
        if (input.checked) selectedStrategies.add(s.id);
        else {
          selectedStrategies.delete(s.id);
          if (mainStrategy === s.id) mainStrategy = [...selectedStrategies][0] ?? "";
        }
        syncPicker();
      });
      const text = node("span", undefined, "strategy-name");
      text.append(node("strong", s.name), node("small", s.descriptionTh));
      label.append(input, text);
      const star = node("button", "★", "star");
      star.type = "button";
      star.title = `ตั้ง ${s.name} เป็นกลยุทธ์หลัก`;
      star.setAttribute("aria-label", star.title);
      star.addEventListener("click", () => setMainStrategy(s.id));
      item.append(label, star);
      return item;
    }),
  );
}
// The main strategy drives the chart, per-bar values and the Telegram preview,
// so it is always part of the run.
function setMainStrategy(id) {
  mainStrategy = id;
  selectedStrategies.add(id);
  syncPicker();
  if ([...$("param-target").options].some((o) => o.value === id)) {
    $("param-target").value = id;
    parameters();
  }
}
function syncPicker() {
  if (mainStrategy && !selectedStrategies.has(mainStrategy))
    selectedStrategies.add(mainStrategy);
  if (!mainStrategy && selectedStrategies.size)
    mainStrategy = [...selectedStrategies][0];
  for (const item of [...$("strategy-list").children]) {
    const id = item.dataset.id,
      main = id === mainStrategy;
    item.querySelector("input").checked = selectedStrategies.has(id);
    item.classList.toggle("is-main", main);
    item.querySelector(".star").setAttribute("aria-pressed", String(main));
  }
  $("strategy-count").textContent =
    `เลือก ${selectedStrategies.size} / ${metadata.strategies.length}`;
  $("strategy-error").hidden = selectedStrategies.size > 0;
  updateParamTarget();
}
function updateParamTarget() {
  const ids = metadata.strategies
    .map((s) => s.id)
    .filter((id) => !selectedStrategies.size || selectedStrategies.has(id));
  const previous = $("param-target").value;
  $("param-target").replaceChildren(
    ...ids.map((id) => new Option(strategy(id).name, id)),
  );
  $("param-target").value = ids.includes(previous)
    ? previous
    : ids.includes(mainStrategy)
      ? mainStrategy
      : ids[0];
  parameters();
}
function showTab(name) {
  for (const tab of TABS) {
    const button = $(`tab-${tab}`),
      panel = $(`panel-${tab}`),
      on = tab === name;
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
    button.classList.toggle("active", on);
    panel.hidden = !on;
  }
  if (name === "chart") drawCharts();
}
function sourceFields() {
  const local = $("source").value === "local";
  const range = $("source").value === "range" || (local && !$("local-full").checked);
  $("local-fields").hidden = !local;
  $("range-fields").hidden = !range;
  $("latest-fields").hidden = $("source").value !== "latest";
  $("from").required = range;
  $("to").required = range;
  $("from").disabled = !range;
  $("to").disabled = !range;
  $("limit").disabled = $("source").value !== "latest";
  $("range-help").textContent = local ? "เลือกช่วงภายในไฟล์; คำนวณจากแท่งจริงครบช่วง พร้อม warmup" : "สูงสุด 10,000 แท่ง ต่อช่วงแท่งเทียน พร้อมข้อมูลเตรียม indicator; ช่วงที่เกินจะถูกข้ามพร้อมคำเตือน";
  syncIntervals();
}
function updateDatasetSummary() {
  const chosen = [...selectedIntervals];
  const records = chosen.map(intervalRecord).filter(Boolean);
  $("local-summary").textContent = !chosen.length
    ? "ยังไม่ได้เลือกช่วงแท่งเทียน"
    : !records.length
      ? "ชุดข้อมูลนี้ยังไม่มีไฟล์ของช่วงที่เลือก"
      : `${records.length} ช่วง · ${records.reduce((sum, r) => sum + r.bars, 0).toLocaleString()} แท่งรวม · ช่วงหลัก ${mainInterval || "—"}` +
        (records.length > 1
          ? ` · ทุกช่วงมีข้อมูลร่วมกัน ${time(Math.max(...records.map(r => r.from)))} – ${time(Math.min(...records.map(r => r.to)))}`
          : ` · ${time(records[0].from)} – ${time(records[0].to)}`);
  // Date limits use the overlap of every selected interval so one range fits them all.
  if (records.length) {
    const localDate = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 16);
    $("from").min = localDate(Math.max(...records.map(r => r.from)));
    $("to").max = localDate(Math.min(...records.map(r => r.to)));
    if ($("source").value === "local") {
      if ($("from").value < $("from").min) $("from").value = $("from").min;
      if ($("to").value > $("to").max) $("to").value = $("to").max;
    }
  }
  if ($("source").value !== "local") { $("from").removeAttribute("min"); $("to").removeAttribute("max"); }
}
async function refreshDatasets() {
  const response = await fetch("/api/datasets");
  if (!response.ok) throw Error("อ่านรายการชุดข้อมูลไม่สำเร็จ");
  snapshots = (await response.json()).snapshots;
  const previous = $("snapshot").value;
  $("snapshot").replaceChildren(...snapshots.map(s => new Option(`${s.snapshot} · ${s.records.filter(r => r.ready).length}/9 ชุดพร้อม`, s.snapshot)));
  if (snapshots.some(s => s.snapshot === previous)) $("snapshot").value = previous;
  if (metadata) syncIntervals();
}
async function localBacktest(config) {
  const job = await post("/api/local/start", config);
  localRunId = job.runId;
  $("cancel-run").hidden = false; $("cancel-run").disabled = false;
  while (true) {
    const response = await fetch(`/api/local/status?id=${encodeURIComponent(job.runId)}`);
    const status = await response.json();
    if (!response.ok) throw Error(status.error);
    $("status").textContent = status.progress;
    if (status.status === "ready") return status.result;
    if (status.status === "error" || status.status === "cancelled") throw Error(status.error || "ยกเลิกแล้ว");
    await new Promise(resolve => setTimeout(resolve, 750));
  }
}
function fillBarOptions() {
  $("bar").replaceChildren(...result.klines.map((k, i) => new Option(`${(result.offset || 0) + i + 1} · ${time(k.closeTime)} · ${fmt(+k.close)}`, i)));
  $("bar").value = String(result.klines.length - 1);
  $("local-paging").hidden = !result.paged;
  $("equity-note").hidden = !result.paged;
  if (result.paged) {
    $("data-page").textContent = `${(result.offset + 1).toLocaleString()}–${(result.offset + result.klines.length).toLocaleString()} / ${result.totalBars.toLocaleString()} แท่ง`;
    $("data-prev").disabled = result.offset === 0;
    $("data-next").disabled = result.offset + result.klines.length >= result.totalBars;
    $("data-goto").max = result.totalBars;
    $("data-goto").value = result.offset + 1;
  }
}
async function localView(patch = {}) {
  if (active || !result?.paged) return;
  busy(true); error("");
  const selectedMode = $("display-mode").value, overlay = $("overlay").value;
  try {
    const next = await post("/api/local/view", { runId: result.runId, strategy: detail.id, interval: result.interval, offset: result.offset, tradePage, ...patch });
    result = next; detail = next.detail; chartEnd = result.klines.length;
    setMainInterval(result.interval); updateDataset();
    tradePage = detail.simulations.find(s => s.mode === selectedMode)?.tradePage ?? 0;
    fillBarOptions(); selectDetail(selectedMode);
    if ([...$("overlay").options].some(o => o.value === overlay)) { $("overlay").value = overlay; drawPrice(); }
  } catch (e) { error(e.message); }
  finally { busy(false); }
}
async function post(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `HTTP ${r.status}`);
  return data;
}
function requestConfig() {
  return {
    symbol: $("symbol").value.trim().toUpperCase(),
    interval: mainInterval,
    intervals: metadata.intervals.filter((i) => selectedIntervals.has(i)),
    source: $("source").value,
    limit: Number($("limit").value),
    snapshot: $("snapshot").value,
    from: $("source").value === "local" && $("local-full").checked ? null : Date.parse($("from").value + ":00+07:00"),
    to: $("source").value === "local" && $("local-full").checked ? null : Date.parse($("to").value + ":00+07:00"),
    selected: mainStrategy,
    strategies: metadata.strategies
      .map((s) => s.id)
      .filter((id) => selectedStrategies.has(id)),
    params: structuredClone(params),
    fee: Number($("fee").value),
    slippage: Number($("slippage").value),
    mode: $("mode").value,
  };
}
async function run() {
  if (active) throw Error("กำลังทำงานอยู่");
  error("");
  if (!selectedIntervals.size) {
    $("interval-error").hidden = false;
    $("interval-list").scrollIntoView({ block: "nearest" });
    const message = "เลือกอย่างน้อย 1 ช่วงแท่งเทียนก่อนรันทดสอบ";
    error(message);
    throw Error(message);
  }
  if (!selectedStrategies.size) {
    $("strategy-error").hidden = false;
    $("strategy-list").scrollIntoView({ block: "nearest" });
    const message = "เลือกอย่างน้อย 1 กลยุทธ์ก่อนรันทดสอบ";
    error(message);
    throw Error(message);
  }
  if (!$("config").reportValidity()) {
    const message = "กรุณาตรวจค่าการทดสอบที่ทำเครื่องหมายไว้";
    error(message);
    throw Error(message);
  }
  localRunId = null;
  busy(true);
  $("status").textContent = "กำลังโหลดแท่งที่ปิดแล้วและคำนวณกลยุทธ์…";
  try {
    const config = requestConfig();
    const next = config.source === "local" ? await localBacktest(config) : await post("/api/backtest", config);
    result = next;
    detail =
      result.detail ||
      result.results.find(
        (r) => r.interval === result.interval && r.id === result.config.selected,
      ) ||
      result.results[0];
    chartEnd = result.klines.length;
    tradePage = 0;
    // The run may have dropped intervals that could not be loaded.
    setMainInterval(result.interval);
    $("empty").hidden = true;
    $("output").hidden = false;
    showTab("chart");
    updateDataset();
    $("warnings").replaceChildren(...result.warnings.map((w) => node("p", w)));
    fillBarOptions();
    selectDetail();
    const ranIntervals = new Set(result.results.map((r) => r.interval)).size;
    $("status").textContent =
      `ทดสอบเสร็จ · ${new Set(result.results.map((r) => r.id)).size} กลยุทธ์ × ${ranIntervals} ช่วงแท่ง · ${new Date().toLocaleTimeString("th-TH")}`;
    return {
      runId: result.runId,
      bars: result.totalBars ?? result.klines.length,
      strategies: new Set(result.results.map((r) => r.id)).size,
      intervals: ranIntervals,
    };
  } catch (e) {
    error(e.message);
    $("status").textContent = "ทดสอบไม่สำเร็จ — ปรับค่าแล้วลองใหม่ได้";
    throw e;
  } finally {
    busy(false);
  }
}
function updateDataset() {
  const bars = result.totalBars ?? result.klines.length;
  const others = (result.intervals ?? [])
    .filter((i) => i.interval !== result.interval)
    .map((i) => `${i.interval} ${i.bars.toLocaleString()}`);
  $("dataset").textContent =
    `ช่วงหลัก ${result.interval} · ${bars.toLocaleString()} แท่ง · ${time(result.from ?? result.klines[0].openTime)} – ${time(result.to ?? result.klines.at(-1).closeTime)} · เตรียม indicator ${result.warmup} แท่ง` +
    (others.length ? ` · อีก ${others.length} ช่วง: ${others.join(", ")} แท่ง` : "");
}
function simulation() {
  return (
    detail.simulations.find((s) => s.mode === $("display-mode").value) ||
    detail.simulations[0]
  );
}
function selectDetail(mode) {
  $("result-title").textContent =
    `${result.config.symbol} / ${result.interval} · ${detail.name}`;
  const old = mode || $("display-mode").value;
  $("display-mode").replaceChildren(
    ...detail.simulations.map((s) => new Option(modeName[s.mode], s.mode)),
  );
  if (detail.simulations.some((s) => s.mode === old))
    $("display-mode").value = old;
  $("display-mode-field").hidden = detail.simulations.length < 2;
  syncModeFilter();
  const numeric = Object.entries(detail.indicators).filter(([, v]) =>
    v.some((x) => typeof x === "number"),
  );
  $("overlay").replaceChildren(
    new Option("ไม่แสดงเส้น", ""),
    ...numeric.map(([key]) => new Option(key, key)),
  );
  const defaults = {
    smc_adaptive: "smcAdaptive.stop",
    smc_adaptive_v2: "smcAdaptiveV2.stop",
    smc_adaptive_short: "smcAdaptiveShort.stop",
    supertrend: "supertrend.supertrend",
    cdc_actionzone: "cdcActionZone.fastMA",
    rsi: "rsi",
    cm_macd: "cmMacd.macdLine",
    ut_bot: "utBot.trailingStop",
    support_resistance: "supportResistance.resistance",
    trendlines: "trendlines.upper",
    squeeze_momentum: "squeezeMomentum.value",
  };
  if (numeric.some(([key]) => key === defaults[detail.id]))
    $("overlay").value = defaults[detail.id];
  else $("overlay").value = "";
  render();
}
function syncModeFilter() {
  const modes = [
    ...new Set(result.results.flatMap((r) => r.simulations.map((s) => s.mode))),
  ];
  const keep = $("compare-mode").value;
  $("compare-mode").replaceChildren(
    new Option("ทุกโหมด", ""),
    ...modes.map((m) => new Option(modeName[m], m)),
  );
  $("compare-mode").value = modes.includes(keep) ? keep : "";
  $("compare-mode-field").hidden = modes.length < 2;
  const intervals = metadata.intervals.filter((i) =>
    result.results.some((r) => r.interval === i),
  );
  const keepInterval = $("compare-interval").value;
  $("compare-interval").replaceChildren(
    new Option("ทุกช่วง", ""),
    ...intervals.map((i) => new Option(i, i)),
  );
  $("compare-interval").value = intervals.includes(keepInterval)
    ? keepInterval
    : "";
  $("compare-interval-field").hidden = intervals.length < 2;
}
function render() {
  const s = simulation();
  const metrics = [
    [
      "ผลตอบแทน",
      pct(s.returnPct),
      s.returnPct,
      s.mode === "legacy" ? "ผลรวม % รายเทรด" : "พอร์ตทบต้น เริ่ม 100 หน่วย",
    ],
    [
      "Max drawdown",
      `${fmt(s.maxDrawdownPct)}${s.mode === "legacy" ? " pp" : "%"}`,
      -s.maxDrawdownPct,
      s.mode === "legacy" ? "จากเทรดที่ปิดแล้ว" : "จากมูลค่าพอร์ต ณ ปิดแท่ง",
    ],
    [
      "Win rate",
      `${fmt(s.winRate, 1)}%`,
      0,
      `${s.totalTrades} เทรด รวมปิดท้ายข้อมูล`,
    ],
    [
      "Buy & hold",
      pct(s.buyAndHoldPct),
      s.buyAndHoldPct,
      "ราคาปิดแรกถึงสุดท้าย ไม่หักค่าใช้จ่าย",
    ],
  ];
  $("metrics").replaceChildren(
    ...metrics.map(([title, value, c, sub]) => {
      const d = node("div", undefined, "metric");
      d.append(
        node("p", title),
        node("strong", value, color(c)),
        node("small", sub),
      );
      return d;
    }),
  );
  $("method").textContent =
    s.mode === "legacy"
      ? `โหมดเดิม: ซื้อขายที่ราคาปิดแท่งสัญญาณ · ค่าธรรมเนียม ${result.config.fee}% ต่อขา · ไม่มี slippage · ผลตอบแทนเป็นผลรวมรายเทรด และ drawdown เป็นจุดเปอร์เซ็นต์ (pp) · เวลาเทรดแสดงตามเวลาเปิดแท่งจาก engine เดิม`
      : `เปิดแท่งถัดไป: ลงทุนเต็มพอร์ต 1 สถานะ · ค่าธรรมเนียม ${result.config.fee}% และ slippage ${result.config.slippage}% ต่อขา · ทบต้น · drawdown รวมสถานะที่ยังถือ ณ ราคาปิดแต่ละแท่ง`;
  renderComparison();
  renderTrades();
  renderBar();
  drawCharts();
}
function comparisonRows() {
  const modeFilter = $("compare-mode").value,
    intervalFilter = $("compare-interval").value,
    query = $("compare-search").value.trim().toLowerCase();
  const rows = [];
  for (const r of result.results)
    for (const sim of r.simulations) {
      if (modeFilter && sim.mode !== modeFilter) continue;
      if (intervalFilter && r.interval !== intervalFilter) continue;
      if (
        query &&
        !r.name.toLowerCase().includes(query) &&
        !r.id.toLowerCase().includes(query) &&
        r.interval !== query
      )
        continue;
      rows.push({ r, sim });
    }
  // Profit factor is null when a strategy never lost: sort it as the best value.
  const value = ({ r, sim }) =>
    compareSort.key === "name"
      ? r.name
      : compareSort.key === "interval"
        ? metadata.intervals.indexOf(r.interval)
        : compareSort.key === "profitFactor" && sim.profitFactor === null
          ? Infinity
          : sim[compareSort.key];
  rows.sort((a, b) => {
    const x = value(a),
      y = value(b);
    const cmp =
      typeof x === "string"
        ? x.localeCompare(y, "th")
        : x === y || (!Number.isFinite(x) && !Number.isFinite(y))
          ? 0
          : !Number.isFinite(x) && x !== Infinity
            ? -1
            : !Number.isFinite(y) && y !== Infinity
              ? 1
              : x > y
                ? 1
                : -1;
    return (
      cmp * compareSort.dir ||
      a.r.name.localeCompare(b.r.name, "th") ||
      metadata.intervals.indexOf(a.r.interval) -
        metadata.intervals.indexOf(b.r.interval)
    );
  });
  return rows;
}
function updateSortIndicators() {
  for (const th of document.querySelectorAll(".compare-table th[data-sort]")) {
    const active = th.dataset.sort === compareSort.key;
    th.setAttribute(
      "aria-sort",
      active ? (compareSort.dir < 0 ? "descending" : "ascending") : "none",
    );
    th.classList.toggle("sorted", active);
    th.querySelector("button").dataset.arrow = active
      ? compareSort.dir < 0
        ? "\u25bc"
        : "\u25b2"
      : "";
  }
  $("sort-key").value = compareSort.key;
  $("sort-dir").value = compareSort.dir < 0 ? "desc" : "asc";
}
function sortBy(key) {
  if (compareSort.key === key) compareSort.dir *= -1;
  else compareSort = { key, dir: key === "name" || key === "interval" ? 1 : -1 };
  renderComparison();
}
function renderComparison() {
  const rows = comparisonRows(),
    current = simulation().mode;
  const list = rows.map(({ r, sim }, index) => {
    const tr = node(
      "tr",
      undefined,
      r.id === detail.id && r.interval === result.interval && sim.mode === current
        ? "selected"
        : "",
    );
    tr.append(node("td", String(index + 1), "rank-col"));
    const cell = node("td"),
      button = node("button", r.name);
    button.type = "button";
    button.title = `แสดง ${r.name} ที่ช่วง ${r.interval} เป็นกลยุทธ์หลัก`;
    if (r.id === mainStrategy) button.append(node("span", "หลัก", "main-tag"));
    button.append(node("small", modeName[sim.mode]));
    button.addEventListener("click", () =>
      changeDetail(r.id, sim.mode, r.interval),
    );
    cell.append(button);
    tr.append(cell);
    const intervalCell = node("td", r.interval, "interval-cell");
    if (r.interval === result.interval)
      intervalCell.append(node("span", "★", "interval-main-tag"));
    tr.append(intervalCell);
    for (const [text, c] of [
      [pct(sim.returnPct), sim.returnPct],
      [
        `${fmt(sim.maxDrawdownPct)}${sim.mode === "legacy" ? " pp" : "%"}`,
        0,
      ],
      [`${fmt(sim.winRate, 1)}%`, 0],
      [String(sim.totalTrades), 0],
      [sim.profitFactor === null ? "\u221e" : fmt(sim.profitFactor), 0],
    ])
      tr.append(node("td", text, color(c)));
    return tr;
  });
  if (!list.length) {
    const tr = node("tr"),
      td = node("td", "ไม่พบกลยุทธ์ที่ตรงกับตัวกรอง");
    td.colSpan = 8;
    tr.append(td);
    list.push(tr);
  }
  $("comparison").replaceChildren(...list);
  $("compare-count").textContent =
    `${rows.length} แถว · ${new Set(rows.map((row) => row.r.id)).size} กลยุทธ์ × ${new Set(rows.map((row) => row.r.interval)).size} ช่วง`;
  $("tab-compare-count").textContent = String(result.results.length);
  updateSortIndicators();
}
async function changeDetail(id, mode, interval = result.interval) {
  if (active) return;
  if (result?.paged) {
    if ([...$("display-mode").options].some(o => o.value === mode)) $("display-mode").value = mode;
    setMainStrategy(id);
    // A different interval reloads its candles, so the bar offset restarts at the end.
    await localView(
      interval === result.interval
        ? { strategy: id, tradePage: 0 }
        : { strategy: id, interval, tradePage: 0, offset: undefined },
    );
    return;
  }
  error("");
  busy(true);
  $("status").textContent = "กำลังเปิดรายละเอียดจากข้อมูลชุดเดิม…";
  try {
    let d = result.results.find((r) => r.id === id && r.interval === interval);
    if (!d?.signals.length || interval !== result.interval) {
      const next = await post("/api/detail", {
        runId: result.runId,
        strategy: id,
        interval,
      });
      d = next.detail;
      const index = result.results.findIndex(
        (r) => r.id === id && r.interval === interval,
      );
      if (index >= 0) result.results[index] = d;
      if (interval !== result.interval) {
        result.interval = next.interval;
        result.warmup = next.warmup;
        result.klines = next.klines;
        result.from = next.klines[0].openTime;
        result.to = next.klines.at(-1).closeTime;
        chartEnd = result.klines.length;
        setMainInterval(next.interval);
        updateDataset();
        fillBarOptions();
      }
    }
    detail = d;
    tradePage = 0;
    setMainStrategy(id);
    selectDetail(mode);
    $("status").textContent = `แสดง ${d.name} · ช่วง ${result.interval} · ใช้ข้อมูลชุดเดิม`;
  } catch (e) {
    error(e.message);
    $("status").textContent = "เปิดรายละเอียดไม่สำเร็จ";
  } finally {
    busy(false);
  }
}
function renderTrades() {
  const s = simulation(),
    count = result.paged ? s.totalTrades : s.trades.length,
    pages = Math.max(1, Math.ceil(count / 25));
  tradePage = Math.min(tradePage, pages - 1);
  $("trade-count").textContent = `${count} เทรด`;
  $("tab-trades-count").textContent = count.toLocaleString();
  $("trade-page").textContent = `${tradePage + 1} / ${pages}`;
  $("trade-prev").disabled = tradePage === 0;
  $("trade-next").disabled = tradePage >= pages - 1;
  const rows = (result.paged ? s.trades : s.trades.slice(tradePage * 25, (tradePage + 1) * 25)).map((t) => {
    const tr = node("tr");
    const dates = node("td", time(t.entryTime));
    dates.append(node("small", `→ ${time(t.exitTime)}`));
    tr.append(
      dates,
      node("td", fmt(t.entryPrice, 4)),
      node("td", fmt(t.exitPrice, 4)),
      node("td", pct(t.pnlPct), color(t.pnlPct)),
      node("td", String(t.bars)),
      node("td", t.reason),
    );
    return tr;
  });
  if (!rows.length) {
    const tr = node("tr"),
      td = node("td", "ยังไม่มีเทรดในช่วงข้อมูลนี้");
    td.colSpan = 6;
    tr.append(td);
    rows.push(tr);
  }
  $("trades").replaceChildren(...rows);
}
function renderBar() {
  const i = Number($("bar").value),
    k = result.klines[i],
    signal = detail.signals[i];
  $("selected-price").textContent = fmt(
    +k.close,
    +k.close >= 1000 ? 2 : +k.close >= 1 ? 4 : 6,
  );
  $("selected-time").textContent =
    `${result.config.symbol} · ${time(k.closeTime)} (เวลาไทย)`;
  $("selected-signal").textContent =
    signal === "BUY" ? "▲ BUY" : signal === "SELL" ? "▼ SELL" : "HOLD · รอ";
  $("selected-signal").className =
    `signal-badge ${signal === "BUY" ? "buy" : signal === "SELL" ? "sell" : "hold"}`;
  $("bar-summary").textContent =
    `${signal} · O ${fmt(+k.open)} / H ${fmt(+k.high)} / L ${fmt(+k.low)} / C ${fmt(+k.close)} · Volume ${fmt(+k.volume)}`;
  $("indicator-values").replaceChildren(
    ...Object.entries(detail.indicators).map(([key, values]) => {
      const tr = node("tr");
      const v = values[i];
      tr.append(
        node("td", key),
        node(
          "td",
          v === null
            ? "— (ยังไม่มีค่า)"
            : typeof v === "number"
              ? fmt(v, 6)
              : String(v),
        ),
      );
      return tr;
    }),
  );
  const price = Number(k.close),
    digits = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
  $("telegram").textContent =
    signal === "HOLD"
      ? `HOLD · ${result.config.symbol} ${result.config.interval}\nกลยุทธ์: ${detail.name}\nแท่งปิด: ${time(k.closeTime)}\n\nแท่งนี้ไม่มีข้อความแจ้งเตือน BUY/SELL`
      : `${signal === "BUY" ? "🟢 BUY" : "🔴 SELL"}  ${result.config.symbol} ${result.config.interval}\nกลยุทธ์: ${detail.name}\nราคาปิด: ${fmt(price, digits)}\nแท่งปิด: ${time(k.closeTime)}\nแจ้งเตือนเท่านั้น บอทนี้ไม่ส่งออเดอร์`;
}
function surface(id) {
  const canvas = $(id),
    width = canvas.clientWidth,
    height = canvas.clientHeight,
    ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const c = canvas.getContext("2d");
  c.scale(ratio, ratio);
  c.font = '13px "Sarabun", sans-serif';
  return { c, width, height };
}
function axes(c, w, top, bottom, min, max) {
  c.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = top + ((bottom - top) * i) / 4;
    c.strokeStyle = chartColors.grid;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w - 78, y);
    c.stroke();
    c.fillStyle = chartColors.muted;
    c.fillText(fmt(max - ((max - min) * i) / 4, 2), w - 3, y + 4);
  }
}
function line(c, arr, start, end, x, y, color) {
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  let started = false;
  for (let i = start; i < end; i++) {
    const v = arr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      started = false;
      continue;
    }
    if (!started) {
      c.moveTo(x(i), y(v));
      started = true;
    } else c.lineTo(x(i), y(v));
  }
  c.stroke();
}
let chartBounds;
let signalHitAreas = [];
function chartIndex(event) {
  if (!chartBounds) return -1;
  const box = event.currentTarget.getBoundingClientRect();
  const px = event.clientX - box.left,
    py = event.clientY - box.top;
  const hit = signalHitAreas.find(
    (r) =>
      px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height,
  );
  if (hit) return hit.index;
  const index = Math.floor(px / chartBounds.step) + chartBounds.start;
  return index >= chartBounds.start && index < chartBounds.end ? index : -1;
}

// Every signal gets a marker. Text labels are staggered and omitted only when
// there is no free space; selecting a bar gives its label placement priority.
function drawSignalLabels(c, start, end, x, y, plotW, top, bottom) {
  signalHitAreas = [];
  const signals = [];
  for (let i = start; i < end; i++) {
    const action = detail.signals[i];
    if (action === "HOLD") continue;
    const buy = action === "BUY";
    const px = x(i),
      py = y(+(buy ? result.klines[i].low : result.klines[i].high));
    const tip = py + (buy ? 8 : -8);
    c.fillStyle = buy ? chartColors.green : chartColors.red;
    c.beginPath();
    c.moveTo(px, tip);
    c.lineTo(px - 6, tip + (buy ? 10 : -10));
    c.lineTo(px + 6, tip + (buy ? 10 : -10));
    c.closePath();
    c.fill();
    signals.push({ index: i, buy, px, py: tip });
    signalHitAreas.push({
      index: i,
      x: px - 8,
      y: tip + (buy ? 0 : -10),
      width: 16,
      height: 12,
    });
  }
  const selected = Number($("bar").value);
  signals.sort(
    (a, b) =>
      Number(b.index === selected) - Number(a.index === selected) ||
      b.index - a.index,
  );
  const occupied = [];
  c.save();
  c.font = '600 15px "Sarabun", sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const signal of signals) {
    const text = signal.buy ? "BUY" : "SELL";
    const width = Math.ceil(c.measureText(text).width) + 26,
      height = 32;
    const left = Math.max(
      2,
      Math.min(plotW - width - 2, signal.px - width / 2),
    );
    for (let lane = 0; lane < 3; lane++) {
      const labelY = signal.buy
        ? signal.py + 16 + lane * 38
        : signal.py - 16 - height - lane * 38;
      if (labelY < top || labelY + height > bottom) continue;
      const rect = { x: left, y: labelY, width, height, index: signal.index };
      if (
        occupied.some(
          (r) =>
            rect.x < r.x + r.width + 5 &&
            rect.x + width + 5 > r.x &&
            rect.y < r.y + r.height + 4 &&
            rect.y + height + 4 > r.y,
        )
      )
        continue;
      const color = signal.buy ? chartColors.green : chartColors.red;
      c.strokeStyle = color;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(signal.px, signal.py + (signal.buy ? 10 : -10));
      c.lineTo(left + width / 2, labelY + (signal.buy ? 0 : height));
      c.stroke();
      c.beginPath();
      c.roundRect(left, labelY, width, height, 9);
      c.fillStyle = chartColors.surface;
      c.fill();
      c.stroke();
      c.fillStyle = color;
      c.fillText(text, left + width / 2, labelY + height / 2);
      occupied.push(rect);
      break;
    }
  }
  c.restore();
  signalHitAreas = [...occupied, ...signalHitAreas];
  $("buy-count").textContent = `▲ ซื้อ ${signals.filter((s) => s.buy).length}`;
  $("sell-count").textContent = `▼ ขาย ${signals.filter((s) => !s.buy).length}`;
  $("signal-note").textContent =
    occupied.length < signals.length
      ? "สัญญาณอยู่ใกล้กัน: แสดงลูกศรครบทุกแท่ง เลือก 50 แท่งเพื่อขยาย หรือกดแท่งเพื่อดูสัญญาณ"
      : "กดป้ายซื้อ–ขายเพื่อดูราคาและเวลาเกิดสัญญาณ";
}
function drawPrice() {
  const { c, width: w, height: h } = surface("price-chart");
  const end = chartEnd,
    start = Math.max(0, end - Number($("window").value)),
    bars = result.klines.slice(start, end),
    n = bars.length;
  if (!n || w < 100) return;
  const key = $("overlay").value,
    overlay = detail.indicators[key];
  const priceLine =
    /^(supertrend\.(supertrend|upperBand|lowerBand)|cdcActionZone\.(fastMA|slowMA)|supportResistance\.(support|resistance)|trendlines\.(upper|lower)|utBot\.trailingStop|vwap)$/.test(
      key,
    );
  const extra = priceLine
    ? overlay.slice(start, end).filter((v) => typeof v === "number")
    : [];
  let lo = Math.min(...bars.map((k) => +k.low), ...extra),
    hi = Math.max(...bars.map((k) => +k.high), ...extra);
  const pad = (hi - lo) * 0.24 || hi * 0.01;
  lo -= pad;
  hi += pad;
  const bottom = overlay && !priceLine ? h * 0.6 : h - 26,
    top = 20,
    plotW = w - 82,
    step = plotW / n;
  const x = (i) => (i - start + 0.5) * step,
    y = (v) => top + ((hi - v) / (hi - lo)) * (bottom - top);
  axes(c, w, top, bottom, lo, hi);
  for (let i = start; i < end; i++) {
    const k = result.klines[i],
      cx = x(i),
      up = +k.close >= +k.open;
    c.strokeStyle = c.fillStyle = up ? chartColors.green : chartColors.red;
    c.beginPath();
    c.moveTo(cx, y(+k.high));
    c.lineTo(cx, y(+k.low));
    c.stroke();
    c.fillRect(
      cx - Math.max(1, step * 0.65) / 2,
      Math.min(y(+k.open), y(+k.close)),
      Math.max(1, step * 0.65),
      Math.max(1, Math.abs(y(+k.open) - y(+k.close))),
    );
  }
  if (overlay) {
    if (priceLine) line(c, overlay, start, end, x, y, chartColors.line);
    else {
      const values = overlay
        .slice(start, end)
        .filter((v) => typeof v === "number");
      if (values.length) {
        const min = Math.min(...values),
          max = Math.max(...values),
          p = (max - min) * 0.1 || 1,
          low = min - p,
          high = max + p;
        const t = h * 0.72,
          b = h - 25;
        axes(c, w, t, b, low, high);
        line(
          c,
          overlay,
          start,
          end,
          x,
          (v) => t + ((high - v) / (high - low)) * (b - t),
          chartColors.line,
        );
      }
    }
  }
  const selected = Number($("bar").value);
  if (selected >= start && selected < end) {
    c.strokeStyle = chartColors.crosshair;
    c.setLineDash([3, 4]);
    c.beginPath();
    c.moveTo(x(selected), 5);
    c.lineTo(x(selected), h - 24);
    c.stroke();
    c.setLineDash([]);
  }
  drawSignalLabels(c, start, end, x, y, plotW, top, bottom);
  c.fillStyle = chartColors.muted;
  c.textAlign = "left";
  c.fillText(time(bars[0].openTime), 0, h - 5);
  c.textAlign = "right";
  c.fillText(time(bars.at(-1).closeTime), plotW, h - 5);
  chartBounds = { start, end, step };
  $("chart-label").textContent =
    `แท่ง ${start + 1}–${end} / ${result.klines.length}`;
  $("chart-prev").disabled = start === 0;
  $("chart-next").disabled = end === result.klines.length;
}
function drawEquity() {
  const { c, width: w, height: h } = surface("equity-chart"),
    s = simulation(),
    a = s.equity;
  if (!a.length) return;
  const min = a.reduce((v, x) => Math.min(v, x), 0),
    max = a.reduce((v, x) => Math.max(v, x), 0),
    p = (max - min) * 0.1 || 1,
    lo = min - p,
    hi = max + p;
  axes(c, w, 15, h - 25, lo, hi);
  line(
    c,
    a,
    0,
    a.length,
    (i) => ((s.equityIndices ? s.equityIndices[i] / Math.max(1, result.totalBars - 1) : i / Math.max(1, a.length - 1))) * (w - 82),
    (v) => 15 + ((hi - v) / (hi - lo)) * (h - 40),
    chartColors.line,
  );
  c.fillStyle = chartColors.muted;
  c.textAlign = "left";
  c.fillText(time(result.from ?? result.klines[0].openTime), 0, h - 4);
}
function drawCharts() {
  const styles = getComputedStyle(document.documentElement);
  for (const [name, token] of Object.entries({
    surface: "--surface",
    grid: "--chart-grid",
    muted: "--muted",
    green: "--green",
    red: "--red",
    line: "--chart-line",
    crosshair: "--crosshair",
  })) {
    chartColors[name] = styles.getPropertyValue(token).trim();
  }
  if (result && detail) {
    drawPrice();
    drawEquity();
  }
}
function exportSelection() {
  return [...$("export-options").querySelectorAll("input:checked")].map(
    (input) => input.value,
  );
}
function updateExportSelection() {
  const count = exportSelection().length;
  $("export-count").textContent =
    `เลือก ${count} / ${metadata.strategies.length}`;
  $("export-download").disabled = exporting || count === 0;
}
function openExport() {
  if (active || !result) return;
  const selected = new Set(result.results.map((r) => r.id));
  $("export-options").replaceChildren(
    ...metadata.strategies.map((s) => {
      const label = node("label", undefined, "check");
      const input = node("input");
      input.type = "checkbox";
      input.value = s.id;
      input.checked = selected.has(s.id);
      input.addEventListener("change", updateExportSelection);
      label.append(input, node("span", s.name));
      return label;
    }),
  );
  const ranIntervals = result.intervals ?? [{ interval: result.interval, bars: result.klines.length }];
  $("export-dataset").textContent =
    `${result.config.symbol} · ${ranIntervals.length} ช่วงแท่งเทียน · ` +
    ranIntervals.map((i) => `${i.interval} ${i.bars.toLocaleString()} แท่ง`).join(" · ");
  $("export-status").textContent = "";
  updateExportSelection();
  $("export-dialog").showModal();
}
async function downloadExport() {
  const ids = exportSelection();
  if (active || exporting || !result || !ids.length) return;
  const runId = result.runId;
  exporting = true;
  busy(true);
  $("export-dialog")
    .querySelectorAll("input, button")
    .forEach((e) => (e.disabled = true));
  $("export-status").textContent = "กำลังคำนวณและจัดไฟล์ ZIP…";
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, strategies: ids }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Export ไม่สำเร็จ");
    }
    const blob = await response.blob();
    const filename =
      response.headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "signal-export.zip";
    const url = URL.createObjectURL(blob),
      link = node("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("export-status").textContent =
      `พร้อมดาวน์โหลด ${ids.length} กลยุทธ์ · ${filename}`;
  } catch (error) {
    $("export-status").textContent = error.message;
  } finally {
    exporting = false;
    busy(false);
    $("export-dialog")
      .querySelectorAll("input, button")
      .forEach((e) => (e.disabled = false));
    updateExportSelection();
  }
}

async function init() {
  $("refresh-datasets").addEventListener("click", () => refreshDatasets().catch(e => error(e.message)));
  $("snapshot").addEventListener("change", () => syncIntervals());
  $("interval-all").addEventListener("click", () => {
    for (const i of metadata.intervals) if (intervalAvailable(i)) selectedIntervals.add(i);
    syncIntervals();
  });
  $("interval-none").addEventListener("click", () => {
    selectedIntervals.clear();
    mainInterval = "";
    syncIntervals();
  });
  $("local-full").addEventListener("change", sourceFields);
  $("cancel-run").addEventListener("click", () => localRunId && post("/api/local/cancel", { runId: localRunId }).catch(e => error(e.message)));
  $("data-prev").addEventListener("click", () => localView({ offset: Math.max(0, result.offset - 2000) }));
  $("data-next").addEventListener("click", () => localView({ offset: result.offset + result.klines.length }));
  $("data-jump").addEventListener("click", () => localView({ offset: Math.max(0, Number($("data-goto").value) - 1) }));
  for (const tab of TABS)
    $(`tab-${tab}`).addEventListener("click", () => showTab(tab));
  $("goto-inspect").addEventListener("click", () => {
    showTab("inspect");
    $("bar").focus();
  });
  document.querySelector(".tabs").addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = TABS.findIndex((tab) => $(`tab-${tab}`).getAttribute("aria-selected") === "true");
    const next = !Number.isFinite(step)
      ? step < 0 ? 0 : TABS.length - 1
      : (at + step + TABS.length) % TABS.length;
    showTab(TABS[next]);
    $(`tab-${TABS[next]}`).focus();
  });
  for (const th of document.querySelectorAll(".compare-table th[data-sort]"))
    th.querySelector("button").addEventListener("click", () => sortBy(th.dataset.sort));
  $("sort-key").addEventListener("change", () => {
    compareSort.key = $("sort-key").value;
    renderComparison();
  });
  $("sort-dir").addEventListener("change", () => {
    compareSort.dir = $("sort-dir").value === "asc" ? 1 : -1;
    renderComparison();
  });
  $("compare-mode").addEventListener("change", renderComparison);
  $("compare-interval").addEventListener("change", renderComparison);
  $("compare-search").addEventListener("input", renderComparison);
  $("export-open").addEventListener("click", openExport);
  $("export-close").addEventListener("click", () => $("export-dialog").close());
  $("export-dialog").addEventListener("cancel", (event) => {
    if (exporting) event.preventDefault();
  });
  for (const [id, checked] of [
    ["export-all", true],
    ["export-clear", false],
  ]) {
    $(id).addEventListener("click", () => {
      $("export-options")
        .querySelectorAll("input")
        .forEach((input) => (input.checked = checked));
      updateExportSelection();
    });
  }
  $("export-download").addEventListener("click", downloadExport);
  const themeButton = $("theme-toggle");
  function updateThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    themeButton.textContent = dark ? "โหมดมืด" : "โหมดสว่าง";
    themeButton.setAttribute("aria-pressed", String(dark));
    drawCharts();
  }
  themeButton.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("signal-lab-theme", next);
    } catch {
      /* Private browsing may disable storage. */
    }
    updateThemeButton();
  });
  updateThemeButton();
  document.fonts.ready.then(drawCharts);

  $("config").addEventListener(
    "invalid",
    (event) => {
      const section = event.target.closest("details");
      if (section) section.open = true;
    },
    true,
  );
  try {
    const r = await fetch("/api/meta");
    if (!r.ok) throw Error("โหลดการตั้งค่าไม่สำเร็จ");
    metadata = await r.json();
    for (const s of metadata.strategies) params[s.id] = { ...s.params };
    buildStrategyPicker();
    for (const s of metadata.strategies) selectedStrategies.add(s.id);
    setMainStrategy("supertrend");
    buildIntervalPicker();
    setMainInterval("1h");
    const local = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 16);
    $("to").value = local(Date.now());
    $("from").value = local(Date.now() - 30 * 86400000);
    await refreshDatasets();
    if (snapshots.some(s => s.records.some(r => r.ready))) $("source").value = "local";
    sourceFields();
    $("config").addEventListener("submit", (e) => {
      e.preventDefault();
      run().catch(() => {});
    });
    $("param-target").addEventListener("change", parameters);
    $("strategy-all").addEventListener("click", () => {
      for (const s of metadata.strategies) selectedStrategies.add(s.id);
      syncPicker();
    });
    $("strategy-none").addEventListener("click", () => {
      selectedStrategies.clear();
      mainStrategy = "";
      syncPicker();
    });
    $("source").addEventListener("change", sourceFields);
    $("mode").addEventListener("change", () => {
      $("slippage").disabled = $("mode").value === "legacy";
    });
    $("display-mode").addEventListener("change", () => {
      if (result?.paged) { localView({ tradePage: 0 }); return; }
      tradePage = 0;
      render();
    });
    $("overlay").addEventListener("change", drawPrice);
    $("window").addEventListener("change", () => {
      chartEnd = Math.min(
        result.klines.length,
        Math.max(chartEnd, Number($("window").value)),
      );
      drawPrice();
    });
    $("chart-prev").addEventListener("click", () => {
      chartEnd = Math.max(
        Number($("window").value),
        chartEnd - Number($("window").value),
      );
      drawPrice();
    });
    $("chart-next").addEventListener("click", () => {
      chartEnd = Math.min(
        result.klines.length,
        chartEnd + Number($("window").value),
      );
      drawPrice();
    });
    $("trade-prev").addEventListener("click", () => {
      if (result?.paged) { localView({ tradePage: Math.max(0, tradePage - 1) }); return; }
      tradePage--;
      renderTrades();
    });
    $("trade-next").addEventListener("click", () => {
      if (result?.paged) { localView({ tradePage: tradePage + 1 }); return; }
      tradePage++;
      renderTrades();
    });
    $("bar").addEventListener("change", () => {
      const i = Number($("bar").value);
      if (i >= chartEnd || i < chartEnd - Number($("window").value))
        chartEnd = Math.min(
          result.klines.length,
          i + Math.ceil(Number($("window").value) / 2),
        );
      renderBar();
      drawPrice();
    });
    $("price-chart").addEventListener("pointermove", (e) => {
      const i = chartIndex(e);
      if (i < 0) return;
      const k = result.klines[i];
      $("hover").textContent =
        `${time(k.closeTime)} · O ${fmt(+k.open)} H ${fmt(+k.high)} L ${fmt(+k.low)} C ${fmt(+k.close)} · ${detail.signals[i]} · คลิกเพื่อตรวจค่ารายแท่ง`;
    });
    $("price-chart").addEventListener("click", (e) => {
      const i = chartIndex(e);
      if (i < 0) return;
      $("bar").value = String(i);
      renderBar();
      drawPrice();
    });
    new ResizeObserver(drawCharts).observe($("price-chart"));
    if (document.modelContext?.registerTool) {
      const lifecycle = new AbortController();
      window.addEventListener("pagehide", () => lifecycle.abort(), {
        once: true,
      });
      Promise.resolve()
        .then(() =>
          document.modelContext.registerTool(
            {
              name: "run_signal_backtest",
              description:
                "รัน Backtest ด้วยค่าที่ตั้งในฟอร์ม และแสดงผลบนหน้าจอ ไม่มีการส่ง Telegram",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
              annotations: { readOnlyHint: false },
              execute: async (input) => {
                if (
                  !input ||
                  typeof input !== "object" ||
                  Array.isArray(input) ||
                  Object.keys(input).length
                )
                  throw Error("ต้องส่ง object ว่าง");
                return run();
              },
            },
            { signal: lifecycle.signal },
          ),
        )
        .catch(() => {});
    }
  } catch (e) {
    error(e.message);
    $("run").disabled = true;
  }
}
init();
