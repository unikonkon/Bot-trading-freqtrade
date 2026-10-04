"""Forward test ส่วนเพิ่ม (ลงทะเบียน 2026-10-02 · ผู้สมัครจากรอบ 7) — ใช้ engine/ข้อมูล/เวลาตัดเดียวกับ forward_test.py (ห้ามแก้ไฟล์นั้น)

  python3 forward_r7.py   # รันหลัง `python3 forward_test.py fetch` · ตัดสินพร้อมกับ forward_test.py (≥ 60 วัน)

ผู้สมัคร (เทียบกับ B_htf4h · กราฟ 30m และ 1h · กติกาเดียวกับ README):
  D_be2      B_htf4h + เลื่อน SL ไปจุดคุ้มทุน (ราคาเข้า ± 2.5 × fee) เมื่อราคาปิดไปทางกำไร ≥ 2 × ATR(4h)
  E_split    บัญชีย่อย 500 + 500: ป้าย 4h (ไม้แรก 125) + ป้าย 1D (ไม้แรก 125) · ผล = รวมสองบัญชีเป็น % ของ 1000
  F_stake400 B_htf4h ไม้แรก 400 → 800 → 1000 (ไม้ไม่เกินเงินที่มี · ไม่ใช้ leverage)
"""
import os, numpy as np
import forward_test as ft


def engine_be(o, h, l, c, ent, ext, A, TD, G, be_k=2.):
    N = len(c); pos = 0; e = tp = sl = ts = pk = 0.; i0 = 0; out = []; armed = False
    for i in range(N):
        if pos:
            px = None; adv = l[i] if pos == 1 else h[i]; fav = h[i] if pos == 1 else l[i]
            if sl and pos * (o[i] - sl) <= 0: px = o[i] * (1 - pos * ft.SLIP)
            elif tp and pos * (o[i] - tp) >= 0: px = o[i]
            elif sl and pos * (adv - sl) <= 0: px = sl * (1 - pos * ft.SLIP)
            elif tp and pos * (fav - tp) >= 0: px = tp
            elif ts:
                pk = max(pk, c[i]) if pos == 1 else min(pk, c[i])
                if pos * (c[i] - pk) < -ts * A[i]: px = c[i]
            if px is not None: out.append((i0, i, pos * (px - e) / e)); pos = 0
            elif not armed and pos * (c[i] - e) >= be_k * A[i]:
                armed = True; bep = e * (1 + pos * 2.5 * ft.FEE)
                sl = bep if not sl or pos * (bep - sl) > 0 else sl
        if pos and ext[i] == -pos: out.append((i0, i, pos * (c[i] - e) / e)); pos = 0
        s = ent[i]
        if not pos and s:
            tpm, slm, tsm = ft.profile(s, TD[i] == s, G); an = 0. if np.isnan(A[i]) else A[i]
            pos = s; e = c[i]; i0 = i; pk = c[i]; armed = False
            tp = c[i] + s * tpm * an if tpm and an else 0.
            sl = c[i] - s * slm * an if slm and an else 0.
            ts = tsm
    if pos: out.append((i0, N - 1, pos * (c[-1] - e) / e))
    return out


def money(rets, base=250., cap=1000.):
    eq, peak, dd, lvl = cap, cap, 0., 1
    for r in rets:
        if eq <= 0 or (lvl == 1 and eq < min(base, cap * 0.25)): break
        st = min(base * 2 ** (lvl - 1), eq)
        pnl = st * r - st * ft.FEE - st * (1 + r) * ft.FEE
        eq += pnl
        lvl = 1 if pnl > 0 else (lvl + 1 if lvl < 3 else 1)
        peak = max(peak, eq); dd = max(dd, (peak - eq) / peak)
    return (eq - cap) / cap * 100, dd * 100


def run():
    roots = sorted(d for d in os.listdir(ft.DATA) if d.startswith("forward-"))
    root = os.path.join(ft.DATA, roots[-1])
    res = {}
    for st in ft.SETS:
        d = os.path.join(root, st)
        for name in sorted(os.listdir(d)):
            tf = name.rsplit("-", 1)[-1].replace(".jsonl", "")
            if tf not in ("30m", "1h"): continue
            t, o, h, l, c = ft.load(os.path.join(d, name))
            f4 = ft.htf_on_chart(t, o, h, l, c, tf, "4h"); fd = ft.htf_on_chart(t, o, h, l, c, tf, "1d")
            W = lambda trs: ft.window(t, trs, ft.CUTOFF)
            b = W(ft.engine(o, h, l, c, f4["sig"], f4["sig"], f4["a"], f4["td"], f4["g"]))
            dtr = W(ft.engine(o, h, l, c, fd["sig"], fd["sig"], fd["a"], fd["td"], fd["g"]))
            V = {"B_htf4h": (money(b)[0], len(b)),
                 "D_be2": (money(W(engine_be(o, h, l, c, f4["sig"], f4["sig"], f4["a"], f4["td"], f4["g"])))[0], len(b)),
                 "E_split": ((money(b, 125., 500.)[0] + money(dtr, 125., 500.)[0]) / 2, len(b) + len(dtr)),
                 "F_stake400": (money(b, 400.)[0], len(b))}
            for k, v in V.items(): res.setdefault((tf, k), {})[name] = v
    for new in ("D_be2", "E_split", "F_stake400"):
        ok_all = True
        for tf in ("30m", "1h"):
            a, b = res[(tf, new)], res[(tf, "B_htf4h")]
            dlt = np.array([a[x][0] - b[x][0] for x in a]); ntr = np.median([a[x][1] for x in a])
            ok = np.median(dlt) > 0 and (dlt > 0).mean() > 0.55 and ntr >= ft.MIN_TRADES
            ok_all &= ok
            print(f"  {tf:4s} {new} − B_htf4h: median {np.median(dlt):+6.1f}% · ดีขึ้น {(dlt > 0).mean() * 100:3.0f}% · ไม้ med {ntr:.0f}" + ("" if ntr >= ft.MIN_TRADES else "  (ไม้น้อยเกินไป — สรุปไม่ได้)"))
        print(f"  → {new} {'ชนะ' if ok_all else 'ไม่ชนะ'} B_htf4h")


if __name__ == "__main__":
    run()
