"""
Harness เทียบผล TypeScript ↔ Python (แผนเฟส 1)

ใช้:
  python user_data/scripts/compare_with_ts.py <fixture.json> <ts.csv> [--mode ts|live] [--warmup 300]

  --mode ts    → confirmed=False: พฤติกรรมเดิมของ TS ทุกตัว ใช้พิสูจน์ว่าพอร์ตถูก 100%
  --mode live  → confirmed=True (default): S/R, Trendlines, SMC ยืนยัน pivot ที่ i+rightBars
                 คอลัมน์ของ 3 ตัวนี้จะ DIFF "โดยตั้งใจ" ส่วนที่เหลือต้อง OK

exit code 0 = ทุกคอลัมน์ที่ต้องตรงตรงหมด, 1 = มีคอลัมน์ที่ต้องตรงแต่ไม่ตรง
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "strategies"))
from ta_port import signals as S  # noqa: E402

# คอลัมน์ที่ "ต่างโดยตั้งใจ" เมื่อ mode=live
CHANGED_COLS = {
    "sr_res", "sr_sup", "sig_support_resistance",
    "tl_upper", "tl_lower", "sig_trendlines",
    "smc_internal_trend", "smc_pd", "sig_smc",
}


def load_fixture(path: str) -> pd.DataFrame:
    raw = json.load(open(path))
    df = pd.DataFrame(raw).iloc[:, :6]
    df.columns = ["date", "open", "high", "low", "close", "volume"]
    df["date"] = pd.to_datetime(df["date"].astype("int64"), unit="ms", utc=True)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    return df


def to_str(s: pd.Series) -> pd.Series:
    """ทำให้ string/bool/None เทียบกันได้: NaN/None → '' , True/False → 'true'/'false'"""
    def conv(v):
        if v is None:
            return ""
        if isinstance(v, (bool, np.bool_)):
            return "true" if v else "false"
        if isinstance(v, float) and v != v:
            return ""
        return str(v)
    return s.map(conv)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("fixture")
    ap.add_argument("ts_csv")
    ap.add_argument("--mode", choices=["ts", "live"], default="live")
    ap.add_argument("--warmup", type=int, default=300)
    args = ap.parse_args()

    df = load_fixture(args.fixture)
    py = S.compute_all_with_signals(df, confirmed=(args.mode == "live"))
    ts = pd.read_csv(args.ts_csv, keep_default_na=True, na_values=[""])

    if len(ts) != len(py):
        print(f"length mismatch: ts={len(ts)} py={len(py)}")
        return 1

    warm = args.warmup
    failures = 0
    print(f"mode={args.mode} warmup={warm} bars={len(df)}")
    print(f"{'status':<8}{'column':<24}{'detail'}")
    for col in ts.columns:
        if col == "openTime":
            continue
        if col not in py.columns:
            print(f"{'MISSING':<8}{col:<24}ไม่มีคอลัมน์นี้ฝั่ง Python")
            failures += 1
            continue
        a = ts[col].iloc[warm:].reset_index(drop=True)
        b = py[col].iloc[warm:].reset_index(drop=True)

        numeric = a.dtype.kind in "fi" and b.dtype.kind in "fi"
        if numeric:
            af = a.to_numpy(dtype=float)
            bf = b.to_numpy(dtype=float)
            nan_match = np.array_equal(np.isnan(af), np.isnan(bf))
            both = ~np.isnan(af) & ~np.isnan(bf)
            ok = nan_match and (not both.any() or np.allclose(af[both], bf[both], rtol=1e-6, atol=1e-8))
            diff = float(np.max(np.abs(af[both] - bf[both]))) if both.any() else 0.0
            detail = f"max_abs_diff={diff:.3g} nan_match={nan_match}"
        else:
            sa, sb = to_str(a), to_str(b)
            mism = int((sa != sb).sum())
            ok = mism == 0
            detail = f"mismatch_rows={mism}"

        expected_diff = args.mode == "live" and col in CHANGED_COLS
        if ok:
            status = "OK"
        elif expected_diff:
            status = "CHANGED"      # ต่างโดยตั้งใจ ไม่นับเป็น failure
        else:
            status = "DIFF"
            failures += 1
        print(f"{status:<8}{col:<24}{detail}")

    print()
    if failures == 0:
        print("PASS: ทุกคอลัมน์ที่ต้องตรง ตรงหมด")
    else:
        print(f"FAIL: {failures} คอลัมน์ไม่ตรง")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
