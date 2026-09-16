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
const parameterLabels = {
  period: "ช่วงคำนวณ RSI",
  buyThreshold: "ระดับซื้อ",
  sellThreshold: "ระดับขาย",
  fastPeriod: "EMA เร็ว",
  slowPeriod: "EMA ช้า",
  swingSize: "ช่วง Swing",
  internalSize: "ช่วง Internal",
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
  $("slippage").disabled = value || $("mode").value === "legacy";
  $("run").textContent = value ? "กำลังคำนวณ…" : "รันทดสอบ";
}
function parameters() {
  const id = $("strategy").value,
    s = strategy(id);
  $("description").textContent = s.descriptionTh;
  $("params").replaceChildren(
    ...Object.entries(params[id]).map(([key, value]) => {
      const label = node("label", parameterLabels[key] || key);
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
function sourceFields() {
  const range = $("source").value === "range";
  $("range-fields").hidden = !range;
  $("latest-fields").hidden = range;
  $("from").required = range;
  $("to").required = range;
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
    interval: $("interval").value,
    source: $("source").value,
    limit: Number($("limit").value),
    from: Date.parse($("from").value + ":00+07:00"),
    to: Date.parse($("to").value + ":00+07:00"),
    selected: $("strategy").value,
    strategy: $("compare").checked ? "all" : $("strategy").value,
    params: structuredClone(params),
    fee: Number($("fee").value),
    slippage: Number($("slippage").value),
    mode: $("mode").value,
  };
}
async function run() {
  if (active) throw Error("กำลังทำงานอยู่");
  if (!$("config").reportValidity()) throw Error("กรุณาตรวจค่าการทดสอบ");
  error("");
  busy(true);
  $("status").textContent = "กำลังโหลดแท่งที่ปิดแล้วและคำนวณกลยุทธ์…";
  try {
    const next = await post("/api/backtest", requestConfig());
    result = next;
    detail = result.results[0];
    chartEnd = result.klines.length;
    tradePage = 0;
    $("empty").hidden = true;
    $("output").hidden = false;
    $("dataset").textContent =
      `${result.klines.length.toLocaleString()} แท่ง · ${time(result.klines[0].openTime)} – ${time(result.klines.at(-1).closeTime)} · เตรียม indicator ${result.warmup} แท่ง`;
    $("warnings").replaceChildren(...result.warnings.map((w) => node("p", w)));
    $("bar").replaceChildren(
      ...result.klines.map(
        (k, i) => new Option(`${time(k.closeTime)} · ${fmt(+k.close)}`, i),
      ),
    );
    $("bar").value = String(result.klines.length - 1);
    selectDetail();
    $("status").textContent =
      `ทดสอบเสร็จ · ${result.results.length} กลยุทธ์ · ${new Date().toLocaleTimeString("th-TH")}`;
    return {
      runId: result.runId,
      bars: result.klines.length,
      strategies: result.results.length,
    };
  } catch (e) {
    error(e.message);
    $("status").textContent = "ทดสอบไม่สำเร็จ — ปรับค่าแล้วลองใหม่ได้";
    throw e;
  } finally {
    busy(false);
  }
}
function simulation() {
  return (
    detail.simulations.find((s) => s.mode === $("display-mode").value) ||
    detail.simulations[0]
  );
}
function selectDetail(mode) {
  $("result-title").textContent =
    `${result.config.symbol} / ${result.config.interval} · ${detail.name}`;
  const old = mode || $("display-mode").value;
  $("display-mode").replaceChildren(
    ...detail.simulations.map((s) => new Option(modeName[s.mode], s.mode)),
  );
  if (detail.simulations.some((s) => s.mode === old))
    $("display-mode").value = old;
  const numeric = Object.entries(detail.indicators).filter(([, v]) =>
    v.some((x) => typeof x === "number"),
  );
  $("overlay").replaceChildren(
    new Option("ไม่แสดงเส้น", ""),
    ...numeric.map(([key]) => new Option(key, key)),
  );
  const defaults = {
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
function renderComparison() {
  const rows = [];
  for (const r of result.results)
    for (const s of r.simulations) {
      const tr = node(
        "tr",
        undefined,
        r.id === detail.id && s.mode === simulation().mode ? "selected" : "",
      );
      const cell = node("td"),
        button = node("button", r.name);
      button.type = "button";
      button.append(node("small", modeName[s.mode]));
      button.addEventListener("click", () => changeDetail(r.id, s.mode));
      cell.append(button);
      tr.append(cell);
      for (const [text, c] of [
        [pct(s.returnPct), s.returnPct],
        [`${fmt(s.maxDrawdownPct)}${s.mode === "legacy" ? " pp" : "%"}`, 0],
        [`${fmt(s.winRate, 1)}%`, 0],
        [String(s.totalTrades), 0],
        [s.profitFactor === null ? "∞" : fmt(s.profitFactor), 0],
      ])
        tr.append(node("td", text, color(c)));
      rows.push(tr);
    }
  $("comparison").replaceChildren(...rows);
}
async function changeDetail(id, mode) {
  if (active) return;
  error("");
  busy(true);
  $("status").textContent = "กำลังเปิดรายละเอียดจากข้อมูลชุดเดิม…";
  try {
    let d = result.results.find((r) => r.id === id);
    if (!d?.signals.length) {
      d = await post("/api/detail", { runId: result.runId, strategy: id });
      const index = result.results.findIndex((r) => r.id === id);
      result.results[index] = d;
    }
    detail = d;
    tradePage = 0;
    selectDetail(mode);
    $("status").textContent = `แสดง ${d.name} · ใช้ข้อมูลชุดเดิม`;
  } catch (e) {
    error(e.message);
    $("status").textContent = "เปิดรายละเอียดไม่สำเร็จ";
  } finally {
    busy(false);
  }
}
function renderTrades() {
  const s = simulation(),
    count = s.trades.length,
    pages = Math.max(1, Math.ceil(count / 25));
  tradePage = Math.min(tradePage, pages - 1);
  $("trade-count").textContent = `${count} เทรด`;
  $("trade-page").textContent = `${tradePage + 1} / ${pages}`;
  $("trade-prev").disabled = tradePage === 0;
  $("trade-next").disabled = tradePage >= pages - 1;
  const rows = s.trades.slice(tradePage * 25, (tradePage + 1) * 25).map((t) => {
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
  const pad = (hi - lo) * 0.12 || hi * 0.01;
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
    const sig = detail.signals[i];
    if (sig !== "HOLD") {
      const cy = y(sig === "BUY" ? +k.low : +k.high) + (sig === "BUY" ? 9 : -9),
        direction = sig === "BUY" ? 1 : -1;
      c.fillStyle = sig === "BUY" ? chartColors.green : chartColors.red;
      c.beginPath();
      c.moveTo(cx, cy - direction * 4);
      c.lineTo(cx - 3, cy + direction * 3);
      c.lineTo(cx + 3, cy + direction * 3);
      c.closePath();
      c.fill();
    }
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
  const min = Math.min(0, ...a),
    max = Math.max(0, ...a),
    p = (max - min) * 0.1 || 1,
    lo = min - p,
    hi = max + p;
  axes(c, w, 15, h - 25, lo, hi);
  line(
    c,
    a,
    0,
    a.length,
    (i) => (i / Math.max(1, a.length - 1)) * (w - 82),
    (v) => 15 + ((hi - v) / (hi - lo)) * (h - 40),
    chartColors.line,
  );
  c.fillStyle = chartColors.muted;
  c.textAlign = "left";
  c.fillText(time(result.klines[0].openTime), 0, h - 4);
}
function drawCharts() {
  const styles = getComputedStyle(document.documentElement);
  for (const [name, token] of Object.entries({
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
async function init() {
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
    $("strategy").replaceChildren(
      ...metadata.strategies.map((s) => new Option(s.name, s.id)),
    );
    $("strategy").value = "supertrend";
    $("interval").replaceChildren(
      ...metadata.intervals.map((i) => new Option(i, i)),
    );
    $("interval").value = "1h";
    const local = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 16);
    $("to").value = local(Date.now());
    $("from").value = local(Date.now() - 30 * 86400000);
    parameters();
    sourceFields();
    $("config").addEventListener("submit", (e) => {
      e.preventDefault();
      run().catch(() => {});
    });
    $("strategy").addEventListener("change", parameters);
    $("source").addEventListener("change", sourceFields);
    $("mode").addEventListener("change", () => {
      $("slippage").disabled = $("mode").value === "legacy";
    });
    $("display-mode").addEventListener("change", () => {
      tradePage = 0;
      render();
    });
    $("overlay").addEventListener("change", drawPrice);
    $("window").addEventListener("change", drawPrice);
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
      tradePage--;
      renderTrades();
    });
    $("trade-next").addEventListener("click", () => {
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
      if (!chartBounds) return;
      const i =
        Math.floor(
          (e.clientX - e.currentTarget.getBoundingClientRect().left) /
            chartBounds.step,
        ) + chartBounds.start;
      if (i < chartBounds.start || i >= chartBounds.end) return;
      const k = result.klines[i];
      $("hover").textContent =
        `${time(k.closeTime)} · O ${fmt(+k.open)} H ${fmt(+k.high)} L ${fmt(+k.low)} C ${fmt(+k.close)} · ${detail.signals[i]} · คลิกเพื่อตรวจค่ารายแท่ง`;
    });
    $("price-chart").addEventListener("click", (e) => {
      if (!chartBounds) return;
      const i =
        Math.floor(
          (e.clientX - e.currentTarget.getBoundingClientRect().left) /
            chartBounds.step,
        ) + chartBounds.start;
      if (i < chartBounds.start || i >= chartBounds.end) return;
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
