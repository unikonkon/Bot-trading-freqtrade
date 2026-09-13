"""
BaseSignalStrategy — strategy แม่ (แผนเฟส 3)

- เลือกกฎสัญญาณต่อคู่จาก config["pair_strategy_map"] ถ้าไม่มีใช้ class attribute strategy_id
- พารามิเตอร์ต่อกลยุทธ์จาก config["strategy_params"][strategy_id] (ชื่อเดียวกับ TS)
- ปิด stoploss / ROI / trailing ไว้ก่อน เพื่อให้ backtest เทียบกับ backtest.ts ได้ (เฟส 4 ค่อยเปิด + hyperopt)
"""
from __future__ import annotations

import pathlib
import sys

from pandas import DataFrame

from freqtrade.strategy import IStrategy

# ให้ import ta_port ได้ไม่ว่า freqtrade จะโหลดไฟล์นี้จากที่ไหน
_HERE = pathlib.Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from ta_port import signals as S  # noqa: E402


class BaseSignalStrategy(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = "1h"
    can_short = False
    # lookback ยาวสุดในชุด: SMC swing 50 ×2 + EMA warm-up → 300 พอสำหรับทุกตัว
    # ตรวจด้วย `freqtrade recursive-analysis` ในเฟส 4
    startup_candle_count = 300
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False
    ignore_roi_if_entry_signal = False

    # ── ปิดกลไกที่ TS ไม่มี (เปิดในเฟส 4 หลัง hyperopt) ──
    stoploss = -0.99
    minimal_roi = {}
    trailing_stop = False

    order_types = {
        "entry": "market",
        "exit": "market",
        "stoploss": "market",
        "stoploss_on_exchange": False,
    }

    # subclass override หรือ config.pair_strategy_map override ต่อคู่
    strategy_id: str = "supertrend"

    # ── Protections (freqtrade ≥ 2024 ต้องอยู่ใน strategy ไม่ใช่ config) ──
    # ปรับค่าได้จาก config["strategy_protections"] โดยไม่ต้องแก้โค้ด
    @property
    def protections(self) -> list[dict]:
        return self.config.get("strategy_protections", [
            {"method": "CooldownPeriod", "stop_duration_candles": 2},
            {"method": "StoplossGuard", "lookback_period_candles": 24, "trade_limit": 3,
             "stop_duration_candles": 12, "only_per_pair": False},
            {"method": "MaxDrawdown", "lookback_period_candles": 168, "trade_limit": 10,
             "stop_duration_candles": 24, "max_allowed_drawdown": 0.15},
        ])

    # ── helpers ──
    def _strategy_for(self, pair: str) -> str:
        sid = self.config.get("pair_strategy_map", {}).get(pair, self.strategy_id)
        if sid not in S.STRATEGY_FNS:
            raise ValueError(f"unknown strategy_id '{sid}' for {pair}; known: {list(S.STRATEGY_FNS)}")
        return sid

    def _params_for(self, sid: str) -> dict:
        return dict(self.config.get("strategy_params", {}).get(sid, {}))

    # ── freqtrade callbacks ──
    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        sid = self._strategy_for(metadata["pair"])
        params = self._params_for(sid)
        dataframe["signal"] = S.STRATEGY_FNS[sid](dataframe, params).to_numpy()
        dataframe["strategy_id"] = sid
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        sid = self._strategy_for(metadata["pair"])
        dataframe.loc[dataframe["signal"] == 1, ["enter_long", "enter_tag"]] = (1, sid)
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[dataframe["signal"] == -1, ["exit_long", "exit_tag"]] = (1, "signal")
        return dataframe
