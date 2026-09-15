"""
ta_port.indicators — พอร์ต 1:1 จาก lib/indicators.ts

กติกา (ดู freqtrade/freqtrade-migration-plan-th.md ข้อ 6.1)
- ชื่อฟังก์ชัน/พารามิเตอร์ตาม TS (แปลงเป็น snake_case)
- ค่า null ของ TS → NaN สำหรับตัวเลข, None สำหรับ string/bool (object array)
- indicator ที่มีสถานะข้ามแท่งเขียนเป็น loop คัดลอกจาก TS บรรทัดต่อบรรทัด
- pivot ที่ต้องมองไปข้างหน้า (S/R, Trendlines, SMC) มีพารามิเตอร์ `confirmed`
    confirmed=False → พฤติกรรมเดิมของ TS (ใช้ใน harness เพื่อพิสูจน์ว่าพอร์ตถูก)
    confirmed=True  → ยืนยัน pivot ที่แท่ง i + rightBars (ใช้จริงบน freqtrade ไม่มี lookahead)

ไม่ใช้ TA-Lib เพราะ ATR ของ TA-Lib seed ต่างจาก TS (เริ่มที่ TR[1] ไม่ใช่ TR[0]=high-low)
ทุกอย่างเขียนด้วย numpy ล้วนเพื่อให้ค่าตรงกับ TS ทุกตำแหน่ง
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

NAN = float("nan")
INF = float("inf")


# ─── Helpers ────────────────────────────────────────────────────
def _isnan(x: float) -> bool:
    return x != x


def _f(df: pd.DataFrame, col: str) -> np.ndarray:
    return df[col].to_numpy(dtype=float)


def _obj(n: int) -> np.ndarray:
    return np.full(n, None, dtype=object)


# ─── SMA ────────────────────────────────────────────────────────
def sma(data: Any, period: int) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    return pd.Series(d).rolling(period).mean().to_numpy(dtype=float)


# ─── EMA (seed ด้วย SMA เหมือน TS) ──────────────────────────────
def ema(data: Any, period: int) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    n = len(d)
    out = np.full(n, NAN)
    k = 2.0 / (period + 1)
    prev: float | None = None
    for i in range(n):
        if i < period - 1:
            continue
        if prev is None:
            prev = float(d[i - period + 1 : i + 1].sum()) / period
        else:
            prev = d[i] * k + prev * (1 - k)
        out[i] = prev
    return out


# ─── RSI (Wilder) ───────────────────────────────────────────────
def rsi(data: Any, period: int = 14) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    n = len(d)
    out = np.full(n, NAN)
    if n < period + 1:
        return out
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, period + 1):
        diff = d[i] - d[i - 1]
        if diff > 0:
            avg_gain += diff
        else:
            avg_loss -= diff
    avg_gain /= period
    avg_loss /= period
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        diff = d[i] - d[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


# ─── True Range (tr[0] = high - low เหมือน TS) ─────────────────
def true_range(df: pd.DataFrame) -> np.ndarray:
    h, l, c = _f(df, "high"), _f(df, "low"), _f(df, "close")
    n = len(df)
    tr = np.empty(n)
    for i in range(n):
        if i == 0:
            tr[i] = h[i] - l[i]
        else:
            tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    return tr


# ─── ATR (seed SMA ที่ period-1 แล้ว Wilder) ───────────────────
def atr(df: pd.DataFrame, period: int = 14) -> np.ndarray:
    tr = true_range(df)
    n = len(tr)
    out = np.full(n, NAN)
    prev: float | None = None
    for i in range(n):
        if i < period - 1:
            continue
        if prev is None:
            prev = float(tr[i - period + 1 : i + 1].sum()) / period
        else:
            prev = (prev * (period - 1) + tr[i]) / period
        out[i] = prev
    return out


# ─── OBV ────────────────────────────────────────────────────────
def obv(df: pd.DataFrame) -> np.ndarray:
    c, v = _f(df, "close"), _f(df, "volume")
    n = len(df)
    out = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i - 1]:
            out[i] = out[i - 1] + v[i]
        elif c[i] < c[i - 1]:
            out[i] = out[i - 1] - v[i]
        else:
            out[i] = out[i - 1]
    return out


# ─── VWAP (สะสมทั้งชุด เหมือน TS) ──────────────────────────────
def vwap(df: pd.DataFrame) -> np.ndarray:
    h, l, c, v = _f(df, "high"), _f(df, "low"), _f(df, "close"), _f(df, "volume")
    n = len(df)
    out = np.empty(n)
    cum_tpv = 0.0
    cum_vol = 0.0
    for i in range(n):
        tp = (h[i] + l[i] + c[i]) / 3
        cum_tpv += tp * v[i]
        cum_vol += v[i]
        out[i] = tp if cum_vol == 0 else cum_tpv / cum_vol
    return out


# ─── CDC ActionZone V3 ──────────────────────────────────────────
def cdc_action_zone(
    close: Any, fast_period: int = 12, slow_period: int = 26, smooth_period: int = 1
) -> dict[str, np.ndarray]:
    data = np.asarray(close, dtype=float)
    n = len(data)
    if smooth_period <= 1:
        x = data
    else:
        e = ema(data, smooth_period)
        x = np.where(np.isnan(e), data, e)

    fast = ema(x, fast_period)
    slow = ema(x, slow_period)

    zone = _obj(n)
    bull = _obj(n)
    signal = _obj(n)
    trend = _obj(n)
    last_buy_bar = -INF
    last_sell_bar = -INF

    for i in range(n):
        f, s, p = fast[i], slow[i], x[i]
        if _isnan(f) or _isnan(s):
            continue
        is_bull = f > s
        is_bear = f < s
        bull[i] = bool(is_bull)

        z = None
        if is_bull and p > f:
            z = "green"
        elif is_bear and p > f and p > s:
            z = "blue"
        elif is_bear and p > f and p < s:
            z = "lightblue"
        elif is_bear and p < f:
            z = "red"
        elif is_bull and p < f and p < s:
            z = "orange"
        elif is_bull and p < f and p > s:
            z = "yellow"
        zone[i] = z

        prev_zone = zone[i - 1] if i > 0 else None
        buy_cond = z == "green" and prev_zone != "green"
        sell_cond = z == "red" and prev_zone != "red"
        prev_trend = trend[i - 1] if i > 0 else None

        if buy_cond and prev_trend == "bearish":
            signal[i] = "BUY"
        elif sell_cond and prev_trend == "bullish":
            signal[i] = "SELL"

        if buy_cond:
            last_buy_bar = i
        if sell_cond:
            last_sell_bar = i
        if last_buy_bar > last_sell_bar:
            trend[i] = "bullish"
        elif last_sell_bar > last_buy_bar:
            trend[i] = "bearish"

    return {"fastMA": fast, "slowMA": slow, "zone": zone, "bull": bull, "signal": signal, "trend": trend}


# ─── CM MacD Ultimate MTF (signal line = SMA ของ MACD) ─────────
def cm_macd_ult_mtf(
    close: Any, fast_length: int = 12, slow_length: int = 26, signal_length: int = 9
) -> dict[str, np.ndarray]:
    d = np.asarray(close, dtype=float)
    n = len(d)
    fast = ema(d, fast_length)
    slow = ema(d, slow_length)
    macd = np.where(np.isnan(fast) | np.isnan(slow), NAN, fast - slow)

    non_null = macd[~np.isnan(macd)]
    sig_sma = sma(non_null, signal_length)

    signal_line = np.full(n, NAN)
    hist = np.full(n, NAN)
    idx = 0
    for i in range(n):
        if _isnan(macd[i]):
            continue
        s = sig_sma[idx] if idx < len(sig_sma) else NAN
        signal_line[i] = s
        hist[i] = macd[i] - s if not _isnan(s) else NAN
        idx += 1

    hist_color = _obj(n)
    above = _obj(n)
    cross_up = np.zeros(n, dtype=bool)
    cross_down = np.zeros(n, dtype=bool)
    signal = _obj(n)

    for i in range(n):
        h = hist[i]
        hp = hist[i - 1] if i > 0 else NAN
        if _isnan(h) or _isnan(hp):
            continue
        if h > hp and h > 0:
            hist_color[i] = "aqua"
        elif h < hp and h > 0:
            hist_color[i] = "blue"
        elif h < hp and h <= 0:
            hist_color[i] = "red"
        elif h > hp and h <= 0:
            hist_color[i] = "maroon"
        else:
            hist_color[i] = "blue"

        m, s = macd[i], signal_line[i]
        curr_above = None if (_isnan(m) or _isnan(s)) else bool(m >= s)
        above[i] = curr_above
        pm = macd[i - 1] if i > 0 else NAN
        ps = signal_line[i - 1] if i > 0 else NAN
        prev_above = None if (_isnan(pm) or _isnan(ps)) else bool(pm >= ps)

        is_up = prev_above is False and curr_above is True
        is_down = prev_above is True and curr_above is False
        cross_up[i] = is_up
        cross_down[i] = is_down
        if is_up:
            signal[i] = "BUY"
        elif is_down:
            signal[i] = "SELL"

    return {
        "macdLine": macd, "signalLine": signal_line, "histogram": hist, "histColor": hist_color,
        "macdAboveSignal": above, "crossUp": cross_up, "crossDown": cross_down, "signal": signal,
    }


# ─── Supertrend ─────────────────────────────────────────────────
def supertrend(df: pd.DataFrame, atr_period: int = 10, multiplier: float = 3.0) -> dict[str, np.ndarray]:
    h, l, c = _f(df, "high"), _f(df, "low"), _f(df, "close")
    n = len(df)
    a = atr(df, atr_period)

    st = np.full(n, NAN)
    trend = np.full(n, NAN)
    upper = np.full(n, NAN)
    lower = np.full(n, NAN)
    signal = _obj(n)

    prev_up = 0.0
    prev_dn = INF
    prev_trend = 1
    for i in range(n):
        av = a[i]
        if _isnan(av):
            continue
        src = (h[i] + l[i]) / 2
        up = src - multiplier * av
        dn = src + multiplier * av
        if i > 0 and c[i - 1] > prev_up:
            up = max(up, prev_up)
        if i > 0 and c[i - 1] < prev_dn:
            dn = min(dn, prev_dn)

        t = prev_trend
        if prev_trend == -1 and c[i] > prev_dn:
            t = 1
        elif prev_trend == 1 and c[i] < prev_up:
            t = -1

        lower[i] = up
        upper[i] = dn
        trend[i] = t
        st[i] = up if t == 1 else dn
        if t == 1 and prev_trend == -1:
            signal[i] = "BUY"
        elif t == -1 and prev_trend == 1:
            signal[i] = "SELL"

        prev_up, prev_dn, prev_trend = up, dn, t

    return {"supertrend": st, "trend": trend, "upperBand": upper, "lowerBand": lower, "signal": signal}


# ─── Squeeze Momentum [LazyBear] ────────────────────────────────
def stdev(data: Any, period: int) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    return pd.Series(d).rolling(period).std(ddof=0).to_numpy(dtype=float)


def highest(data: Any, period: int) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    return pd.Series(d).rolling(period).max().to_numpy(dtype=float)


def lowest(data: Any, period: int) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    return pd.Series(d).rolling(period).min().to_numpy(dtype=float)


def linreg(data: Any, period: int, offset: int) -> np.ndarray:
    d = np.asarray(data, dtype=float)
    n = len(d)
    out = np.full(n, NAN)
    xs = np.arange(period, dtype=float)
    sum_x = xs.sum()
    sum_x2 = (xs * xs).sum()
    denom = period * sum_x2 - sum_x * sum_x
    for i in range(n):
        end = i - offset
        start = end - period + 1
        if start < 0 or end < 0 or end >= n:
            continue
        y = d[start : end + 1]
        sum_y = y.sum()
        sum_xy = (xs * y).sum()
        if denom == 0:
            continue
        b = (period * sum_xy - sum_x * sum_y) / denom
        a = (sum_y - b * sum_x) / period
        out[i] = a + b * (period - 1 - offset)
    return out


def squeeze_momentum(
    df: pd.DataFrame, bb_length: int = 20, bb_mult: float = 2.0, kc_length: int = 20, kc_mult: float = 1.5
) -> dict[str, np.ndarray]:
    h, l, c = _f(df, "high"), _f(df, "low"), _f(df, "close")
    n = len(df)
    tr = true_range(df)

    basis = sma(c, bb_length)
    dev = stdev(c, bb_length)
    kc_ma = sma(c, kc_length)
    rangema = sma(tr, kc_length)
    hh = highest(h, kc_length)
    ll = lowest(l, kc_length)

    mom_source = np.empty(n)
    for i in range(n):
        if _isnan(hh[i]) or _isnan(ll[i]) or _isnan(kc_ma[i]):
            mom_source[i] = c[i]
        else:
            mom_source[i] = c[i] - ((hh[i] + ll[i]) / 2 + kc_ma[i]) / 2
    val_arr = linreg(mom_source, kc_length, 0)

    value = np.full(n, NAN)
    hist_color = _obj(n)
    sqz_on = np.zeros(n, dtype=bool)
    sqz_off = np.zeros(n, dtype=bool)
    no_sqz = np.zeros(n, dtype=bool)
    signal = _obj(n)

    for i in range(n):
        b, d, km, rm = basis[i], dev[i], kc_ma[i], rangema[i]
        if _isnan(b) or _isnan(d) or _isnan(km) or _isnan(rm):
            no_sqz[i] = True
            continue
        upper_bb = b + bb_mult * d
        lower_bb = b - bb_mult * d
        upper_kc = km + kc_mult * rm
        lower_kc = km - kc_mult * rm
        is_on = lower_bb > lower_kc and upper_bb < upper_kc
        is_off = lower_bb < lower_kc and upper_bb > upper_kc
        sqz_on[i] = is_on
        sqz_off[i] = is_off
        no_sqz[i] = not is_on and not is_off

        val = val_arr[i]
        value[i] = val
        if not _isnan(val):
            prev_val = val_arr[i - 1] if i > 0 else NAN
            if not _isnan(prev_val):
                if val > 0:
                    hist_color[i] = "lime" if val > prev_val else "green"
                else:
                    hist_color[i] = "red" if val < prev_val else "maroon"
            else:
                hist_color[i] = "lime" if val > 0 else "red"

        if not _isnan(val) and i > 0:
            pv = val_arr[i - 1]
            if not _isnan(pv):
                if pv <= 0 and val > 0:
                    signal[i] = "BUY"
                elif pv >= 0 and val < 0:
                    signal[i] = "SELL"

    return {"value": value, "histColor": hist_color, "sqzOn": sqz_on, "sqzOff": sqz_off, "noSqz": no_sqz, "signal": signal}


# ─── Market Structure Break & Order Block (ZigZag) ──────────────
def msb_order_block(df: pd.DataFrame, zigzag_len: int = 9, fib_factor: float = 0.33) -> dict[str, Any]:
    h, l, c, o = _f(df, "high"), _f(df, "low"), _f(df, "close"), _f(df, "open")
    n = len(df)
    highest_arr = highest(h, zigzag_len)
    lowest_arr = lowest(l, zigzag_len)

    trend = np.full(n, NAN)
    market = np.full(n, NAN)
    signal = _obj(n)
    msb_signals: list[dict] = []
    order_blocks: list[dict] = []
    swing_points: list[dict] = []
    high_points: list[dict] = []
    low_points: list[dict] = []

    cur_trend = 1
    cur_market = 1
    for i in range(zigzag_len, n):
        to_up = h[i] >= (0.0 if _isnan(highest_arr[i]) else highest_arr[i])
        to_down = l[i] <= (INF if _isnan(lowest_arr[i]) else lowest_arr[i])

        prev_trend = cur_trend
        if cur_trend == 1 and to_down:
            cur_trend = -1
        elif cur_trend == -1 and to_up:
            cur_trend = 1
        trend[i] = cur_trend

        if cur_trend != prev_trend:
            j0 = max(0, i - zigzag_len * 2)
            if cur_trend == 1:
                min_val, min_idx = INF, i
                for j in range(j0, i + 1):
                    if l[j] < min_val:
                        min_val, min_idx = l[j], j
                low_points.append({"price": min_val, "index": min_idx})
                swing_points.append({"index": min_idx, "price": min_val, "type": "low"})
            else:
                max_val, max_idx = -INF, i
                for j in range(j0, i + 1):
                    if h[j] > max_val:
                        max_val, max_idx = h[j], j
                high_points.append({"price": max_val, "index": max_idx})
                swing_points.append({"index": max_idx, "price": max_val, "type": "high"})

            if len(high_points) >= 2 and len(low_points) >= 1:
                h0 = high_points[-1]
                h1 = high_points[-2]
                l0 = low_points[-1]
                l1 = low_points[-2] if len(low_points) >= 2 else None
                prev_market = cur_market

                if (h1 is not None and l0 is not None and cur_market == -1 and h0["price"] > h1["price"]
                        and h0["price"] > h1["price"] + abs(h1["price"] - l0["price"]) * fib_factor):
                    cur_market = 1
                if (l1 is not None and h0 is not None and cur_market == 1 and l0["price"] < l1["price"]
                        and l0["price"] < l1["price"] - abs(h0["price"] - l1["price"]) * fib_factor):
                    cur_market = -1

                if cur_market != prev_market:
                    msb_signals.append({
                        "index": i,
                        "bias": "bullish" if cur_market == 1 else "bearish",
                        "level": (h1["price"] if h1 is not None else h0["price"]) if cur_market == 1
                                 else (l1["price"] if l1 is not None else l0["price"]),
                    })
                    if cur_market == 1 and h1 is not None:
                        for j in range(h1["index"], l0["index"] + 1):
                            if o[j] > c[j]:
                                order_blocks.append({"startIndex": j, "high": h[j], "low": l[j], "type": "Bu-OB", "broken": False})
                                break
                    elif cur_market == -1 and l1 is not None:
                        for j in range(l1["index"], h0["index"] + 1):
                            if o[j] < c[j]:
                                order_blocks.append({"startIndex": j, "high": h[j], "low": l[j], "type": "Be-OB", "broken": False})
                                break
                    signal[i] = "BUY" if cur_market == 1 else "SELL"

        market[i] = cur_market

    for ob in order_blocks:
        for i in range(ob["startIndex"] + 1, n):
            if ob["type"].startswith("Bu") and c[i] < ob["low"]:
                ob["broken"] = True
                break
            if ob["type"].startswith("Be") and c[i] > ob["high"]:
                ob["broken"] = True
                break

    return {"trend": trend, "market": market, "msbSignals": msb_signals, "orderBlocks": order_blocks,
            "swingPoints": swing_points, "signal": signal}


# ─── Pivot helper (ใช้ร่วม S/R, Trendlines, SMC) ───────────────
def pivot_events(
    h: np.ndarray, l: np.ndarray, left: int, right: int, confirmed: bool
) -> tuple[dict[int, tuple[float, int]], dict[int, tuple[float, int]]]:
    """
    คืน dict {แท่งที่ "รู้" ว่ามี pivot: (ราคา pivot, index ของแท่ง pivot)}
    confirmed=False → key = i (เหมือน TS: รู้ทันทีที่แท่ง pivot ทั้งที่ต้องดูอนาคต right แท่ง)
    confirmed=True  → key = i + right (รู้เมื่อเห็นแท่งขวาครบแล้ว = สิ่งที่ live เห็นจริง)
    """
    n = len(h)
    ph: dict[int, tuple[float, int]] = {}
    pl: dict[int, tuple[float, int]] = {}
    for i in range(left, n - right):
        is_high = True
        is_low = True
        for j in range(1, left + 1):
            if h[i] <= h[i - j]:
                is_high = False
            if l[i] >= l[i - j]:
                is_low = False
        for j in range(1, right + 1):
            if h[i] <= h[i + j]:
                is_high = False
            if l[i] >= l[i + j]:
                is_low = False
        key = i + right if confirmed else i
        if is_high:
            ph[key] = (h[i], i)
        if is_low:
            pl[key] = (l[i], i)
    return ph, pl


# ─── Support & Resistance with Breaks [LuxAlgo] ─────────────────
def support_resistance(
    df: pd.DataFrame, left_bars: int = 15, right_bars: int = 15, volume_thresh: float = 20, confirmed: bool = True
) -> dict[str, np.ndarray]:
    h, l, c, o, v = _f(df, "high"), _f(df, "low"), _f(df, "close"), _f(df, "open"), _f(df, "volume")
    n = len(df)
    ph, pl = pivot_events(h, l, left_bars, right_bars, confirmed)

    resistance = np.full(n, NAN)
    support = np.full(n, NAN)
    last_ph = NAN
    last_pl = NAN
    for i in range(n):
        if i in ph:
            last_ph = ph[i][0]
        if i in pl:
            last_pl = pl[i][0]
        resistance[i] = last_ph
        support[i] = last_pl

    vol_short = ema(v, 5)
    vol_long = ema(v, 10)
    vol_osc = np.full(n, NAN)
    for i in range(n):
        s, lg = vol_short[i], vol_long[i]
        if not _isnan(s) and not _isnan(lg) and lg != 0:
            vol_osc[i] = 100 * (s - lg) / lg

    break_up = np.zeros(n, dtype=bool)
    break_down = np.zeros(n, dtype=bool)
    bull_wick = np.zeros(n, dtype=bool)
    bear_wick = np.zeros(n, dtype=bool)
    signal = _obj(n)

    for i in range(1, n):
        res, sup = resistance[i], support[i]
        osc = 0.0 if _isnan(vol_osc[i]) else vol_osc[i]

        if not _isnan(sup) and c[i - 1] >= sup and c[i] < sup:
            is_bear_wick = (o[i] - c[i]) < (h[i] - o[i])
            if is_bear_wick:
                bear_wick[i] = True
            if not is_bear_wick and osc > volume_thresh:
                break_down[i] = True
                signal[i] = "SELL"

        if not _isnan(res) and c[i - 1] <= res and c[i] > res:
            is_bull_wick = (o[i] - l[i]) > (c[i] - o[i])
            if is_bull_wick:
                bull_wick[i] = True
            if not is_bull_wick and osc > volume_thresh:
                break_up[i] = True
                signal[i] = "BUY"

    return {"resistance": resistance, "support": support, "breakUp": break_up, "breakDown": break_down,
            "bullWick": bull_wick, "bearWick": bear_wick, "signal": signal}


# ─── Trendlines with Breaks [LuxAlgo] ───────────────────────────
def trendlines_with_breaks(
    df: pd.DataFrame, length: int = 14, mult: float = 1.0, calc_method: str = "Atr", confirmed: bool = True
) -> dict[str, np.ndarray]:
    h, l, c = _f(df, "high"), _f(df, "low"), _f(df, "close")
    n = len(df)
    ph, pl = pivot_events(h, l, length, length, confirmed)

    atr_arr = atr(df, length)
    stdev_arr = stdev(c, length)

    def slope_at(i: int) -> float:
        src = stdev_arr[i] if calc_method == "Stdev" else atr_arr[i]
        return ((0.0 if _isnan(src) else src) / length) * mult

    upper = np.full(n, NAN)
    lower = np.full(n, NAN)
    break_up = np.zeros(n, dtype=bool)
    break_down = np.zeros(n, dtype=bool)
    signal = _obj(n)

    cur_upper = 0.0
    cur_lower = 0.0
    slope_ph = 0.0
    slope_pl = 0.0
    upos = 0
    dnos = 0
    for i in range(n):
        slope = slope_at(i)
        has_ph = i in ph
        has_pl = i in pl

        if has_ph:
            cur_upper = ph[i][0]
            slope_ph = slope
            upos = 0
        else:
            cur_upper = cur_upper - slope_ph

        if has_pl:
            cur_lower = pl[i][0]
            slope_pl = slope
            dnos = 0
        else:
            cur_lower = cur_lower + slope_pl

        upper[i] = cur_upper
        lower[i] = cur_lower

        prev_upos, prev_dnos = upos, dnos
        if has_ph:
            upos = 0
        elif c[i] > cur_upper:
            upos = 1
        if has_pl:
            dnos = 0
        elif c[i] < cur_lower:
            dnos = 1

        if upos > prev_upos:
            break_up[i] = True
            signal[i] = "BUY"
        if dnos > prev_dnos:
            break_down[i] = True
            signal[i] = "SELL"

    return {"upper": upper, "lower": lower, "breakUp": break_up, "breakDown": break_down, "signal": signal}


# ─── Smart Money Concepts (SMC) — เฉพาะส่วนที่ใช้ทำสัญญาณ ───────
# ตัด Order Block / Fair Value Gap ออกตามแผน (ไม่ได้ใช้ในสัญญาณ) เหลือ
# structure (BOS/CHoCH), trend, swing points, premium/discount, signal
def _detect_structure(
    c: np.ndarray, ph: dict[int, tuple[float, int]], pl: dict[int, tuple[float, int]]
) -> tuple[list[dict], np.ndarray]:
    n = len(c)
    structures: list[dict] = []
    trend = _obj(n)
    current: str | None = None
    last_ph: dict | None = None
    last_pl: dict | None = None
    for i in range(n):
        if i in ph:
            last_ph = {"price": ph[i][0], "index": ph[i][1], "crossed": False}
        if i in pl:
            last_pl = {"price": pl[i][0], "index": pl[i][1], "crossed": False}

        if last_ph is not None and not last_ph["crossed"] and c[i] > last_ph["price"]:
            structures.append({"index": i, "type": "CHoCH" if current == "bearish" else "BOS",
                               "bias": "bullish", "level": last_ph["price"], "pivotIndex": last_ph["index"]})
            last_ph["crossed"] = True
            current = "bullish"

        if last_pl is not None and not last_pl["crossed"] and c[i] < last_pl["price"]:
            structures.append({"index": i, "type": "CHoCH" if current == "bullish" else "BOS",
                               "bias": "bearish", "level": last_pl["price"], "pivotIndex": last_pl["index"]})
            last_pl["crossed"] = True
            current = "bearish"

        trend[i] = current
    return structures, trend


def _premium_discount(
    c: np.ndarray, h: np.ndarray, l: np.ndarray,
    ph: dict[int, tuple[float, int]], pl: dict[int, tuple[float, int]],
) -> np.ndarray:
    n = len(c)
    out = _obj(n)
    trailing_high = -INF
    trailing_low = INF
    for i in range(n):
        if i in ph:
            trailing_high = ph[i][0]
        if i in pl:
            trailing_low = pl[i][0]
        if h[i] > trailing_high:
            trailing_high = h[i]
        if l[i] < trailing_low:
            trailing_low = l[i]
        if trailing_high == -INF or trailing_low == INF:
            continue
        rng = trailing_high - trailing_low
        if rng <= 0:
            continue
        eq = (trailing_high + trailing_low) / 2
        if c[i] >= eq + rng * 0.25:
            out[i] = "premium"
        elif c[i] <= eq - rng * 0.25:
            out[i] = "discount"
        else:
            out[i] = "equilibrium"
    return out


def _swing_points(ph: dict[int, tuple[float, int]], pl: dict[int, tuple[float, int]], n: int) -> list[dict]:
    points: list[dict] = []
    last_high: float | None = None
    last_low: float | None = None
    for i in range(n):
        if i in ph:
            price = ph[i][0]
            t = "H" if last_high is None else ("HH" if price > last_high else "LH")
            points.append({"index": ph[i][1], "price": price, "type": t})
            last_high = price
        if i in pl:
            price = pl[i][0]
            t = "L" if last_low is None else ("HL" if price > last_low else "LL")
            points.append({"index": pl[i][1], "price": price, "type": t})
            last_low = price
    return points


def smart_money_concepts(
    df: pd.DataFrame, swing_size: int = 50, internal_size: int = 5, confirmed: bool = True
) -> dict[str, Any]:
    h, l, c = _f(df, "high"), _f(df, "low"), _f(df, "close")
    n = len(df)

    swing_ph, swing_pl = pivot_events(h, l, swing_size, swing_size, confirmed)
    int_ph, int_pl = pivot_events(h, l, internal_size, internal_size, confirmed)

    swing_structs, swing_trend = _detect_structure(c, swing_ph, swing_pl)
    int_structs, int_trend = _detect_structure(c, int_ph, int_pl)
    pd_zone = _premium_discount(c, h, l, swing_ph, swing_pl)
    swing_points = _swing_points(swing_ph, swing_pl, n)

    signal = _obj(n)
    for s in int_structs:
        if s["type"] == "CHoCH":
            signal[s["index"]] = "BUY" if s["bias"] == "bullish" else "SELL"
        else:
            zone = pd_zone[s["index"]]
            if s["bias"] == "bullish" and zone in ("discount", "equilibrium"):
                signal[s["index"]] = "BUY"
            elif s["bias"] == "bearish" and zone in ("premium", "equilibrium"):
                signal[s["index"]] = "SELL"

    return {"swingTrend": swing_trend, "internalTrend": int_trend, "swingStructures": swing_structs,
            "internalStructures": int_structs, "swingPoints": swing_points, "premiumDiscount": pd_zone,
            "signal": signal}


# ─── UT Bot Alerts ──────────────────────────────────────────────
def ut_bot(df: pd.DataFrame, key_value: float = 1, atr_period: int = 10) -> dict[str, np.ndarray]:
    c = _f(df, "close")
    n = len(df)
    a = atr(df, atr_period)

    trailing = np.full(n, NAN)
    pos = np.zeros(n)
    signal = _obj(n)

    prev_stop = 0.0
    prev_pos = 0
    for i in range(n):
        x_atr = a[i]
        if _isnan(x_atr):
            continue
        n_loss = key_value * x_atr
        src = c[i]
        prev_src = c[i - 1] if i > 0 else src

        if src > prev_stop and prev_src > prev_stop:
            stop = max(prev_stop, src - n_loss)
        elif src < prev_stop and prev_src < prev_stop:
            stop = min(prev_stop, src + n_loss)
        elif src > prev_stop:
            stop = src - n_loss
        else:
            stop = src + n_loss
        trailing[i] = stop

        if prev_src < prev_stop and src > prev_stop:
            cur_pos = 1
        elif prev_src > prev_stop and src < prev_stop:
            cur_pos = -1
        else:
            cur_pos = prev_pos
        pos[i] = cur_pos

        above = src > stop and prev_src <= prev_stop
        below = src < stop and prev_src >= prev_stop
        if src > stop and above:
            signal[i] = "BUY"
        elif src < stop and below:
            signal[i] = "SELL"

        prev_stop = stop
        prev_pos = cur_pos

    return {"trailingStop": trailing, "pos": pos, "signal": signal}


# ─── computeAll: คอลัมน์ชื่อเดียวกับ freqtrade/scripts/dump-indicators.ts ─
def compute_all(df: pd.DataFrame, confirmed: bool = True) -> pd.DataFrame:
    """
    รวม indicator ทุกตัวเป็น DataFrame คอลัมน์เดียวกับ CSV ที่ TS dump ออกมา
    (ไม่รวม sig_* — ดู signals.compute_all_with_signals)
    """
    c = _f(df, "close")
    cdc = cdc_action_zone(c, 12, 26, 1)
    macd = cm_macd_ult_mtf(c, 12, 26, 9)
    st = supertrend(df, 10, 3.0)
    sqz = squeeze_momentum(df, 20, 2.0, 20, 1.5)
    ut = ut_bot(df, 1, 10)
    msb = msb_order_block(df, 9, 0.33)
    sr = support_resistance(df, 15, 15, 20, confirmed=confirmed)
    tl = trendlines_with_breaks(df, 14, 1.0, "Atr", confirmed=confirmed)
    smc = smart_money_concepts(df, 50, 5, confirmed=confirmed)

    return pd.DataFrame({
        "rsi": rsi(c, 14),
        "atr": atr(df, 14),
        "cdc_fast": cdc["fastMA"], "cdc_slow": cdc["slowMA"], "cdc_zone": cdc["zone"],
        "macd": macd["macdLine"], "macd_signal": macd["signalLine"], "macd_hist": macd["histogram"],
        "st_line": st["supertrend"], "st_trend": st["trend"],
        "sqz_val": sqz["value"], "sqz_on": sqz["sqzOn"],
        "ut_stop": ut["trailingStop"], "ut_pos": ut["pos"],
        "msb_market": msb["market"],
        "sr_res": sr["resistance"], "sr_sup": sr["support"],
        "tl_upper": tl["upper"], "tl_lower": tl["lower"],
        "smc_internal_trend": smc["internalTrend"], "smc_pd": smc["premiumDiscount"],
    }, index=df.index)
