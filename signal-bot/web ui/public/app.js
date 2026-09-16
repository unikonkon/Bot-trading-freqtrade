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
  $("export-open").disabled = value || !result;
  $("slippage").disabled = value || $("mode").value === "legacy";
  $("run").textContent = value ? "กำลังคำนวณ…" : "รันทดสอบ";
}
function parameters() {
  const id = $("strategy").value,
    s = strategy(id);
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
  $("export-dataset").textContent =
    `${result.config.symbol} / ${result.config.interval} · ${result.klines.length} แท่ง · ${time(result.klines[0].openTime)} – ${time(result.klines.at(-1).closeTime)}`;
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
