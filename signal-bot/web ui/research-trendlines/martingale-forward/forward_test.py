"""Forward test (pre-registered 2026-10-02) — Martingale ×2 · 3 ไม้ · ทุน 1000 · ไม้แรก 250 · บัญชีสองฝั่ง

ทดสอบบนข้อมูลหลัง CUTOFF (เวลาตัดของ snapshot tl-20260928) ซึ่งไม่เคยใช้ในการค้นหาแบบใดเลย
ห้ามแก้ engine / ค่า / กติกาตัดสินในไฟล์นี้หลังจากโหลดข้อมูลใหม่ (ดู README.md · SHA-256 ของไฟล์นี้ถูกบันทึกไว้)

  python3 forward_test.py fetch      # ต่อข้อมูลหลัง CUTOFF จาก Binance → data-test/trendlines/forward-<YYYYMMDD>/
  python3 forward_test.py run        # รันกติกาที่ลงทะเบียนไว้บน snapshot forward ล่าสุด
  python3 forward_test.py backcheck  # ตรวจว่า engine ให้ผลเท่างานวิจัย (BTC 274 วันก่อน CUTOFF)

แบบที่ทดสอบ (ตรงกับไฟล์ Pine ใน lib/martingale/):
  A  old     — "Martingale x2 [3 ไม้] backtest.pine" ชุดเหมือน rsi.pine · ป้าย TF กราฟ        (กราฟ 30m · 1h · 4h)
  B  htf4h   — "Martingale x2 [3 ไม้] HTF 4h signal.pine" · ป้าย 4h ออกบน TF กราฟ           (กราฟ 30m · 1h)
  C  2h12h   — ป้าย 2h เข้าเฉพาะเมื่อทิศของ 12h ตรงกัน (ผู้สมัครจากรอบ 6 · ยังไม่มีไฟล์ Pine) (กราฟ 30m · 1h)
"""
import json, os, sys, time, hashlib, urllib.request, urllib.parse
from datetime import datetime, timezone
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view as sw

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "data-test", "trendlines"))
SETS = ["tl-20260928", "tl-20260928-holdout", "tl-20260928-holdout2", "tl-20260928-holdout3", "tl-20260928-holdout5"]
CUTOFF = 1790570401260          # asOf ของ tl-20260928 (2026-09-28 04:00 UTC)
FEE, SLIP = 0.10 / 100, 0.05 / 100
CAP, BASE, MULT, LEVELS = 1000., 250., 2., 3
MS = {"30m": 1800000, "1h": 3600000, "2h": 7200000, "4h": 14400000, "12h": 43200000, "1d": 86400000}
CHARTS = ["30m", "1h", "4h"]
MIN_DAYS = 60                    # ลงทะเบียนไว้: รันจริงเมื่อข้อมูลใหม่ยาว ≥ 60 วัน
MIN_TRADES = 5                   # median ไม้ต่อเหรียญของ B และ C ต่ำกว่านี้ = สรุปไม่ได้


# ───────────────────────── data ─────────────────────────
def load(path):
    rows = [json.loads(x) for x in open(path) if x.strip()]
    a = np.array([[float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])] for r in rows])
    return np.array([r["openTime"] for r in rows], dtype=np.int64), a[:, 0], a[:, 1], a[:, 2], a[:, 3]


def fetch_after(symbol, tf, start, end):
    out, cur = [], start
    while cur <= end:
        q = urllib.parse.urlencode(dict(symbol=symbol, interval=tf, limit=1000, startTime=cur, endTime=end))
        for attempt in range(8):
            try:
                with urllib.request.urlopen(f"https://data-api.binance.vision/api/v3/klines?{q}", timeout=30) as r:
                    rows = json.load(r); break
            except Exception as e:
                print(f"  retry {attempt + 1} {symbol} {tf}: {e}"); time.sleep(min(60, 2 * 2 ** attempt))
        else:
            raise RuntimeError(f"fetch failed {symbol} {tf}")
        if not rows: break
        for k in rows:
            out.append(dict(openTime=k[0], open=k[1], high=k[2], low=k[3], close=k[4], volume=k[5], closeTime=k[6],
                            quoteAssetVolume=k[7], numberOfTrades=k[8], takerBuyBaseVolume=k[9], takerBuyQuoteVolume=k[10]))
        cur = rows[-1][0] + MS[tf]; time.sleep(0.25)
    return out


def cmd_fetch():
    now = int(time.time() * 1000)
    tag = datetime.now(timezone.utc).strftime("%Y%m%d")
    root = os.path.join(DATA, f"forward-{tag}")
    man = dict(cutoff=CUTOFF, asOf=now, files={})
    for st in SETS:
        os.makedirs(os.path.join(root, st), exist_ok=True)
        for name in sorted(os.listdir(os.path.join(DATA, st))):
            tf = name.rsplit("-", 1)[-1].replace(".jsonl", "")
            if tf not in CHARTS or not name.endswith(".jsonl"): continue
            old = [x for x in open(os.path.join(DATA, st, name)) if x.strip()]
            last = json.loads(old[-1])["openTime"]
            end = (now // MS[tf]) * MS[tf] - 1                       # เฉพาะแท่งที่ปิดแล้ว
            new = [r for r in fetch_after(name.split("-")[0], tf, last + MS[tf], end) if r["closeTime"] <= end]
            text = "".join(old) + "".join(json.dumps(r) + "\n" for r in new)
            open(os.path.join(root, st, name), "w").write(text)
            man["files"][f"{st}/{name}"] = dict(new_bars=len(new), sha256=hashlib.sha256(text.encode()).hexdigest())
            print(f"{st:22s} {name:22s} +{len(new)} แท่ง")
    json.dump(man, open(os.path.join(root, "manifest.json"), "w"), indent=1)
    print("saved", root)


# ───────────────────────── engine (frozen) ─────────────────────────
def rma(x, n):
    out = np.full(len(x), np.nan)
    if len(x) < n: return out
    out[n - 1] = np.nanmean(x[:n])
    for i in range(n, len(x)): out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def atr(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pc), abs(l - pc))); tr[0] = h[0] - l[0]
    return rma(tr, n)


def sma_ema(c, n):
    out = np.full(len(c), np.nan)
    if len(c) < n: return out
    out[n - 1] = c[:n].mean(); a = 2 / (n + 1)
    for i in range(n, len(c)): out[i] = c[i] * a + out[i - 1] * (1 - a)
    return out


def grp(ms): return 0 if ms < 3600000 else 1 if ms < 14400000 else 2 if ms < 86400000 else 3


def tl_feats(h, l, c, length=14):
    """rsi.pine: strict pivots · close > upper / close < lower · SELL ทับ BUY · กฎสลับ · EMA200 เริ่มด้วย SMA"""
    N = len(c); a = atr(h, l, c, length); slope = np.nan_to_num(a) / length
    W = 2 * length + 1; isph = np.zeros(N, bool); ispl = np.zeros(N, bool)
    if N >= W:
        wh, wl = sw(h, W), sw(l, W)
        isph[W - 1:] = wh[:, length] > np.maximum(wh[:, :length].max(1), wh[:, length + 1:].max(1))
        ispl[W - 1:] = wl[:, length] < np.minimum(wl[:, :length].min(1), wl[:, length + 1:].min(1))
    upper = lower = sph = spl = 0.; upos = dnos = 0; alt = 0
    sig = np.zeros(N, np.int8); state = np.zeros(N, np.int8)
    for i in range(N):
        j = i - length
        if isph[i]: upper = h[j]; sph = slope[i]
        else: upper -= sph
        if ispl[i]: lower = l[j]; spl = slope[i]
        else: lower += spl
        pu, pd = upos, dnos
        upos = 0 if isph[i] else (1 if c[i] > upper else upos)
        dnos = 0 if ispl[i] else (1 if c[i] < lower else dnos)
        r = -1 if dnos > pd else (1 if upos > pu else 0)
        if alt == 0 and r == 1: sig[i] = 1; alt = 1
        elif alt == 1 and r == -1: sig[i] = -1; alt = 0
        state[i] = 1 if alt == 1 else -1
    ema = sma_ema(c, 200)
    return dict(sig=sig, state=state, td=np.where(np.isnan(ema), 0, np.where(c > ema, 1, -1)), a=a)


def htf_on_chart(t, o, h, l, c, tf_chart, tf_sig):
    """แท่ง TF ป้ายรวมจากแท่งกราฟ (UTC) · ค่าออกที่แท่งกราฟที่ปิดพร้อมแท่ง TF ป้าย · ATR/เทรนด์ ค้างไว้จนแท่งถัดไป"""
    ms = MS[tf_sig]; k = t // ms
    s = np.r_[0, np.nonzero(np.diff(k))[0] + 1]; e = np.r_[s[1:], len(t)]
    if t[-1] + MS[tf_chart] < k[s[-1]] * ms + ms: s, e = s[:-1], e[:-1]       # ตัดแท่งที่ยังไม่ปิด
    last = e - 1
    fh = tl_feats(np.maximum.reduceat(h, s)[:len(s)], np.minimum.reduceat(l, s)[:len(s)], c[last])
    N = len(c); sig = np.zeros(N, np.int8); sig[last] = fh["sig"]
    st = np.zeros(N, np.int8); a = np.full(N, np.nan); td = np.zeros(N, int)
    cs, ca, ct, p = 0, np.nan, 0, 0
    for i in range(N):
        while p < len(last) and last[p] == i: cs, ca, ct = fh["state"][p], fh["a"][p], fh["td"][p]; p += 1
        st[i], a[i], td[i] = cs, ca, ct
    return dict(sig=sig, state=st, a=a, td=td, g=grp(ms))


def profile(side, wt, g):
    """กฎออก Auto ของ rsi.pine"""
    tp = sl = ts = 0.
    if side == 1:
        if g >= 2: ts = 6. if wt else 0.; sl = 0. if wt else 3.
    else:
        wide = wt or g == 0 or g == 3
        tp = 8. if wide else 5.; sl = 3. if wide else 2.
    return tp, sl, ts


def engine(o, h, l, c, ent, ext, A, TD, G):
    """บัญชีสองฝั่ง: TP/SL → Trail ที่ราคาปิด → ป้ายตรงข้ามปิด → เข้าไม้ใหม่ที่ราคาปิด"""
    N = len(c); pos = 0; e = tp = sl = ts = pk = 0.; i0 = 0; out = []
    for i in range(N):
        if pos:
            px = None; adv = l[i] if pos == 1 else h[i]; fav = h[i] if pos == 1 else l[i]
            if sl and pos * (o[i] - sl) <= 0: px = o[i] * (1 - pos * SLIP)
            elif tp and pos * (o[i] - tp) >= 0: px = o[i]
            elif sl and pos * (adv - sl) <= 0: px = sl * (1 - pos * SLIP)
            elif tp and pos * (fav - tp) >= 0: px = tp
            elif ts:
                pk = max(pk, c[i]) if pos == 1 else min(pk, c[i])
                if pos * (c[i] - pk) < -ts * A[i]: px = c[i]
            if px is not None: out.append((i0, i, pos * (px - e) / e)); pos = 0
        if pos and ext[i] == -pos:
            out.append((i0, i, pos * (c[i] - e) / e)); pos = 0
        s = ent[i]
        if not pos and s:
            tpm, slm, tsm = profile(s, TD[i] == s, G)
            an = 0. if np.isnan(A[i]) else A[i]
            pos = s; e = c[i]; i0 = i; pk = c[i]
            tp = c[i] + s * tpm * an if tpm and an else 0.
            sl = c[i] - s * slm * an if slm and an else 0.
            ts = tsm
    if pos: out.append((i0, N - 1, pos * (c[-1] - e) / e))
    return out


def money(rets):
    """Martingale ×2 · 3 ไม้ · ไม้แรก 250 · ไม่ใช้ leverage · ชนะ = กำไรหลังหัก fee > 0"""
    eq, peak, dd, lvl = CAP, CAP, 0., 1
    for r in rets:
        if eq <= 0 or (lvl == 1 and eq < BASE): break
        st = min(BASE * MULT ** (lvl - 1), eq)
        pnl = st * r - st * FEE - st * (1 + r) * FEE
        eq += pnl
        lvl = 1 if pnl > 0 else (lvl + 1 if lvl < LEVELS else 1)
        peak = max(peak, eq); dd = max(dd, (peak - eq) / peak)
    return (eq - CAP) / CAP * 100, dd * 100


def variants(path, tf):
    t, o, h, l, c = load(path)
    fc = tl_feats(h, l, c)
    V = {"A_old": engine(o, h, l, c, fc["sig"], fc["sig"], fc["a"], fc["td"], grp(MS[tf]))}
    if tf in ("30m", "1h"):
        f4 = htf_on_chart(t, o, h, l, c, tf, "4h")
        V["B_htf4h"] = engine(o, h, l, c, f4["sig"], f4["sig"], f4["a"], f4["td"], f4["g"])
        f2 = htf_on_chart(t, o, h, l, c, tf, "2h"); f12 = htf_on_chart(t, o, h, l, c, tf, "12h")
        ent = np.where(f2["sig"] == f12["state"], f2["sig"], 0).astype(np.int8)
        V["C_2h12h"] = engine(o, h, l, c, ent, f2["sig"], f2["a"], f2["td"], f2["g"])
    return t, V


def window(t, trs, start):
    """ไม้ที่เข้าหลัง start (เปิดบัญชีใหม่ทุน 1000 ที่ start) · ไม้ที่ยังถืออยู่คิดที่ราคาปิดล่าสุด"""
    return [r for (i0, _, r) in trs if t[i0] >= start]


# ───────────────────────── commands ─────────────────────────
def cmd_backcheck():
    exp = {("30m", "A_old"): 20.6, ("30m", "B_htf4h"): 2.6, ("30m", "C_2h12h"): -10.9}
    for tf in ("30m",):
        t, V = variants(os.path.join(DATA, SETS[0], f"BTCUSDT-{tf}.jsonl"), tf)
        start = t[-1] - 274 * 86400000
        for k, trs in V.items():
            got = money(window(t, trs, start))[0]
            print(f"BTC {tf} 274d {k:8s} {got:+6.1f}%  (งานวิจัย {exp.get((tf, k), float('nan')):+.1f}%)")


def cmd_run():
    roots = sorted(d for d in os.listdir(DATA) if d.startswith("forward-"))
    if not roots: sys.exit("ยังไม่มีข้อมูล forward — รัน: python3 forward_test.py fetch")
    root = os.path.join(DATA, roots[-1]); man = json.load(open(os.path.join(root, "manifest.json")))
    days = (man["asOf"] - CUTOFF) / 86400000
    print(f"snapshot {roots[-1]} · ข้อมูลใหม่ {days:.0f} วันหลัง CUTOFF")
    if days < MIN_DAYS: print(f"⚠ ข้อมูลใหม่ยังไม่ถึง {MIN_DAYS} วันตามที่ลงทะเบียนไว้ — ผลด้านล่างเป็นแค่ดูเบื้องต้น ไม่ใช้ตัดสิน")
    res = {}
    for st in SETS:
        d = os.path.join(root, st)
        for name in sorted(os.listdir(d)):
            tf = name.rsplit("-", 1)[-1].replace(".jsonl", "")
            if tf not in CHARTS: continue
            t, V = variants(os.path.join(d, name), tf)
            for k, trs in V.items():
                w = window(t, trs, CUTOFF)
                res.setdefault((tf, k), []).append((name, *money(w), len(w)))
    print(f"\n{'กราฟ':4s} {'แบบ':8s} {'เหรียญ':>6s} {'median %':>9s} {'บวก':>7s} {'DD med':>7s} {'ไม้ med':>7s}")
    for (tf, k), rows in sorted(res.items()):
        p = np.array([r[1] for r in rows]); dd = np.array([r[2] for r in rows]); n = np.array([r[3] for r in rows])
        print(f"{tf:4s} {k:8s} {len(p):6d} {np.median(p):+8.1f}% {(p > 0).sum():3d}/{len(p):<3d} {np.median(dd):6.1f}% {np.median(n):7.0f}")
    print("\nกติกาตัดสินที่ลงทะเบียนไว้ (paired ต่อเหรียญ · ต้องผ่านทั้งกราฟ 30m และ 1h):")
    for new, old in (("C_2h12h", "B_htf4h"), ("B_htf4h", "A_old")):
        ok_all = True
        for tf in ("30m", "1h"):
            a = {r[0]: r for r in res.get((tf, new), [])}; b = {r[0]: r for r in res.get((tf, old), [])}
            keys = sorted(set(a) & set(b))
            dlt = np.array([a[x][1] - b[x][1] for x in keys])
            ntr = np.median([a[x][3] for x in keys]) if keys else 0
            ok = len(dlt) > 0 and np.median(dlt) > 0 and (dlt > 0).mean() > 0.55
            enough = ntr >= MIN_TRADES
            ok_all &= ok and enough
            print(f"  {tf:4s} {new} − {old}: median {np.median(dlt):+6.1f}% · ดีขึ้น {(dlt > 0).mean() * 100:3.0f}% ของ {len(dlt)} เหรียญ · ไม้ med {ntr:.0f}"
                  + ("" if enough else "  (ไม้น้อยเกินไป — สรุปไม่ได้)"))
        print(f"  → {new} {'ชนะ' if ok_all else 'ไม่ชนะ'} {old}" + ("" if days >= MIN_DAYS else " (ยังไม่ครบ 60 วัน · ไม่ใช้ตัดสิน)"))


if __name__ == "__main__":
    {"fetch": cmd_fetch, "run": cmd_run, "backcheck": cmd_backcheck}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: print(__doc__))()
