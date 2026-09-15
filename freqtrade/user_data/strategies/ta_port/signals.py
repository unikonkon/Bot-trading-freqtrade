"""
ta_port.signals — พอร์ต STRATEGY_FNS / STRATEGIES จาก lib/backtest.ts

ทุกฟังก์ชันรับ (df, params) และคืน pd.Series ค่า int:
    1 = BUY, -1 = SELL, 0 = HOLD
ชื่อ params ใช้ชื่อเดียวกับ TS (atrPeriod, multiplier, fastPeriod, ...)
params["confirmed"] (default True) ใช้กับ indicator ที่มี pivot มองไปข้างหน้า
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from . import indicators as I

SignalFn = Callable[[pd.DataFrame, dict], pd.Series]

# ─── ค่า default ต่อกลยุทธ์ (ตรงกับ STRATEGIES ใน backtest.ts) ──
STRATEGY_DEFAULTS: dict[str, dict] = {
    "rsi": {"period": 14, "buyThreshold": 30, "sellThreshold": 70},
    "cdc_actionzone": {"fastPeriod": 12, "slowPeriod": 26},
    "smc": {"swingSize": 50, "internalSize": 5},
    "squeeze_momentum": {"bbLength": 20, "bbMult": 2.0, "kcLength": 20, "kcMult": 1.5},
    "cm_macd": {"fastLength": 12, "slowLength": 26, "signalLength": 9},
    "supertrend": {"atrPeriod": 10, "multiplier": 3.0},
    "msb_ob": {"zigzagLen": 9, "fibFactor": 0.33},
    "support_resistance": {"leftBars": 15, "rightBars": 15, "volumeThresh": 20},
    "trendlines": {"trendLength": 14, "trendMult": 1.0},
    "ut_bot": {"keyValue": 1, "utAtrPeriod": 10},
}

STRATEGY_NAMES: dict[str, str] = {
    "rsi": "RSI Overbought/Oversold",
    "cdc_actionzone": "CDC ActionZone V3",
    "smc": "Smart Money Concepts (SMC)",
    "squeeze_momentum": "Squeeze Momentum [LazyBear]",
    "cm_macd": "CM MacD Ultimate MTF",
    "supertrend": "Supertrend",
    "msb_ob": "Market Structure Break & OB",
    "support_resistance": "Support & Resistance Breaks",
    "trendlines": "Trendlines with Breaks [LuxAlgo]",
    "ut_bot": "UT Bot Alerts",
}


def _p(params: dict | None, sid: str) -> dict:
    merged = dict(STRATEGY_DEFAULTS[sid])
    if params:
        merged.update(params)
    return merged


def _from_obj(sig: np.ndarray, index: pd.Index) -> pd.Series:
    """แปลง object array 'BUY'/'SELL'/None → int Series"""
    out = np.zeros(len(sig), dtype=int)
    out[sig == "BUY"] = 1
    out[sig == "SELL"] = -1
    return pd.Series(out, index=index, name="signal")


# ─── Strategy functions ─────────────────────────────────────────
def rsi_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "rsi")
    r = I.rsi(df["close"].to_numpy(dtype=float), int(p["period"]))
    out = np.zeros(len(r), dtype=int)
    valid = ~np.isnan(r)
    out[valid & (r < p["buyThreshold"])] = 1
    out[valid & (r > p["sellThreshold"])] = -1
    return pd.Series(out, index=df.index, name="signal")


def cdc_actionzone_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "cdc_actionzone")
    res = I.cdc_action_zone(df["close"].to_numpy(dtype=float), int(p["fastPeriod"]), int(p["slowPeriod"]), 1)
    return _from_obj(res["signal"], df.index)


def smc_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "smc")
    res = I.smart_money_concepts(df, int(p["swingSize"]), int(p["internalSize"]), confirmed=bool(p.get("confirmed", True)))
    return _from_obj(res["signal"], df.index)


def cm_macd_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "cm_macd")
    res = I.cm_macd_ult_mtf(df["close"].to_numpy(dtype=float), int(p["fastLength"]), int(p["slowLength"]), int(p["signalLength"]))
    return _from_obj(res["signal"], df.index)


def supertrend_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "supertrend")
    res = I.supertrend(df, int(p["atrPeriod"]), float(p["multiplier"]))
    return _from_obj(res["signal"], df.index)


def squeeze_momentum_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "squeeze_momentum")
    res = I.squeeze_momentum(df, int(p["bbLength"]), float(p["bbMult"]), int(p["kcLength"]), float(p["kcMult"]))
    return _from_obj(res["signal"], df.index)


def msb_ob_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "msb_ob")
    res = I.msb_order_block(df, int(p["zigzagLen"]), float(p["fibFactor"]))
    return _from_obj(res["signal"], df.index)


def support_resistance_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "support_resistance")
    res = I.support_resistance(df, int(p["leftBars"]), int(p["rightBars"]), float(p["volumeThresh"]),
                               confirmed=bool(p.get("confirmed", True)))
    return _from_obj(res["signal"], df.index)


def trendlines_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "trendlines")
    res = I.trendlines_with_breaks(df, int(p["trendLength"]), float(p["trendMult"]), "Atr",
                                   confirmed=bool(p.get("confirmed", True)))
    return _from_obj(res["signal"], df.index)


def ut_bot_strategy(df: pd.DataFrame, params: dict | None = None) -> pd.Series:
    p = _p(params, "ut_bot")
    res = I.ut_bot(df, float(p["keyValue"]), int(p["utAtrPeriod"]))
    return _from_obj(res["signal"], df.index)


STRATEGY_FNS: dict[str, SignalFn] = {
    "rsi": rsi_strategy,
    "cdc_actionzone": cdc_actionzone_strategy,
    "smc": smc_strategy,
    "cm_macd": cm_macd_strategy,
    "supertrend": supertrend_strategy,
    "squeeze_momentum": squeeze_momentum_strategy,
    "msb_ob": msb_ob_strategy,
    "support_resistance": support_resistance_strategy,
    "trendlines": trendlines_strategy,
    "ut_bot": ut_bot_strategy,
}

# ตัวที่ยืนยันแล้วว่า causal (ไม่มี lookahead) — ใช้ในลำดับพอร์ต 1–7 ตามแผน
CAUSAL_STRATEGIES = ["supertrend", "cdc_actionzone", "ut_bot", "cm_macd", "rsi", "squeeze_momentum", "msb_ob"]
# ตัวที่ผลต่างจาก TS โดยตั้งใจ (แก้ lookahead ด้วย confirmed pivot)
CHANGED_STRATEGIES = ["support_resistance", "trendlines", "smc"]


def compute_all_with_signals(df: pd.DataFrame, confirmed: bool = True) -> pd.DataFrame:
    """indicator ทุกคอลัมน์ + sig_<id> เป็น 'BUY'/'SELL'/'HOLD' ให้ harness เทียบกับ CSV ของ TS"""
    out = I.compute_all(df, confirmed=confirmed)
    label = np.array(["HOLD", "BUY", "SELL"], dtype=object)
    for sid, fn in STRATEGY_FNS.items():
        s = fn(df, {"confirmed": confirmed}).to_numpy()
        out[f"sig_{sid}"] = label[np.where(s == 1, 1, np.where(s == -1, 2, 0))]
    return out
