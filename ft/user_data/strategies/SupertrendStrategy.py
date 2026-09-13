"""SupertrendStrategy — subclass ของ BaseSignalStrategy สำหรับกลยุทธ์ 'supertrend'
ใช้กับ backtesting / hyperopt / lookahead-analysis ทีละกลยุทธ์
(ตอน live ใช้ BaseSignalStrategy + pair_strategy_map แทน)
"""
import pathlib
import sys

_HERE = pathlib.Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from BaseSignalStrategy import BaseSignalStrategy  # noqa: E402


class SupertrendStrategy(BaseSignalStrategy):
    strategy_id = "supertrend"
    startup_candle_count = 100
