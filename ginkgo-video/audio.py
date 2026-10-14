import json
import sys
import wave

import numpy as np
from scipy import signal

SR = 44100
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
E = json.load(open(sys.argv[1]))
OFF = E['offset']
OUT = sys.argv[2]

mus = np.zeros((N, 2))
sfx = np.zeros((N, 2))
amb = np.zeros((N, 2))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n):
    return np.arange(n) / SR


def add(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N:
        return
    if x.ndim == 1:
        x = np.stack([x * np.sqrt(0.5 * (1 - pan)), x * np.sqrt(0.5 * (1 + pan))], 1)
    j0 = max(0, -i)
    i = max(i, 0)
    n = min(len(x) - j0, N - i)
    if n > 0:
        buf[i:i + n] += x[j0:j0 + n] * gain


def filt(x, kind, f, order=2):
    sos = signal.butter(order, f, btype=kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


# ------------------------------------------------------------------ instruments
def piano(m, dur, vel=0.6):
    f = mtof(m)
    L = dur + 2.2
    t = tt(int(L * SR))
    x = np.zeros_like(t)
    for k in range(1, 10):
        fk = k * f * np.sqrt(1 + 0.0004 * k * k)
        if fk > 16000:
            break
        amp = (1 / k ** 1.25) * (1.0 if k == 1 else 0.55)
        dec = np.exp(-t * (0.7 + 0.5 * k) * (1 + max(0, m - 60) / 36))
        x += amp * dec * np.sin(2 * np.pi * fk * t + rng.random() * 6)
    x *= np.minimum(1, t / 0.003)
    rel = np.ones_like(t)
    idx = t > dur
    rel[idx] = np.exp(-(t[idx] - dur) / 0.35)
    x *= rel
    nz = filt(rng.standard_normal(int(0.012 * SR)), 'bandpass', [800, 5000]) * np.exp(-tt(int(0.012 * SR)) / 0.002) * 0.08
    x[:len(nz)] += nz
    return x * vel * 0.32


def pad(ms, dur, gain=0.1):
    L = dur + 2.5
    t = tt(int(L * SR))
    x = np.zeros((len(t), 2))
    for m in ms:
        f = mtof(m)
        for det, pan in ((-7, -0.7), (0, 0.0), (7, 0.7)):
            fd = f * 2 ** (det / 1200)
            v = np.zeros_like(t)
            for k in range(1, 7):
                v += (0.55 ** (k - 1)) * np.sin(2 * np.pi * fd * k * t + rng.random() * 6)
            x[:, 0] += v * np.sqrt(0.5 * (1 - pan))
            x[:, 1] += v * np.sqrt(0.5 * (1 + pan))
    e = np.minimum(1, t / 0.9)
    idx = t > dur
    e[idx] *= np.exp(-(t[idx] - dur) / 0.8)
    x *= (e * (1 + 0.06 * np.sin(2 * np.pi * 0.23 * t)))[:, None]
    return filt(x, 'lowpass', 2600) * gain / len(ms)


def bass(m, dur, vel=0.5):
    f = mtof(m)
    t = tt(int((dur + 0.6) * SR))
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    e = np.minimum(1, t / 0.03) * (0.75 + 0.25 * np.exp(-t * 3))
    idx = t > dur
    e[idx] *= np.exp(-(t[idx] - dur) / 0.2)
    return x * e * vel * 0.3


def bell(m, dur=2.5, vel=0.4):
    f = mtof(m)
    t = tt(int(dur * SR))
    idx = 2.6 * np.exp(-t * 4)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 2.2) * np.minimum(1, t / 0.002)
    return x * vel * 0.25


def marimba(m, vel=0.4):
    f = mtof(m)
    t = tt(int(0.7 * SR))
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 8) + 0.35 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t * 26) + 0.1 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 60)
    return x * np.minimum(1, t / 0.0015) * vel * 0.3


def ks(m, dur=1.6, vel=0.5, bend=0.0):
    f = mtof(m)
    P = int(SR / f)
    n = int(dur * SR)
    y = np.zeros(n + P + 1)
    y[:P + 1] = filt(rng.uniform(-1, 1, P + 1), 'lowpass', min(9000, f * 14))
    i = P + 1
    while i < n + P + 1:
        j = min(i + P, n + P + 1)
        y[i:j] = 0.9965 * (0.5 * y[i - P:j - P] + 0.5 * y[i - P - 1:j - P - 1])
        i = j
    y = y[P + 1:]
    ratio = f / (SR / (P + 0.5))
    t = tt(n)
    rate = ratio * (1 + bend * np.minimum(1, t / 0.25) + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.4))
    pos = np.cumsum(rate)
    pos = pos[pos < len(y) - 1]
    x = np.interp(pos, np.arange(len(y)), y)
    x *= np.minimum(1, tt(len(x)) / 0.002)
    return x * vel * 0.5


def kick(vel=0.6):
    t = tt(int(0.45 * SR))
    ph = 2 * np.pi * np.cumsum(45 + 90 * np.exp(-t * 28)) / SR
    return (np.sin(ph) * np.exp(-t * 7) + 0.3 * filt(rng.standard_normal(len(t)), 'highpass', 2000) * np.exp(-t * 120)) * vel * 0.5


def clap(vel=0.4):
    t = tt(int(0.3 * SR))
    nz = filt(rng.standard_normal(len(t)), 'bandpass', [900, 4500])
    e = np.exp(-t * 22)
    for d in (0.008, 0.017):
        e += 0.6 * np.exp(-np.maximum(0, t - d) * 140) * (t > d)
    return nz * e * vel * 0.25


def shaker(vel=0.2):
    t = tt(int(0.08 * SR))
    return filt(rng.standard_normal(len(t)), 'highpass', 6500) * np.exp(-t * 60) * np.minimum(1, t / 0.008) * vel * 0.3


def knock(f0=200, vel=0.5):
    t = tt(int(0.25 * SR))
    x = np.sin(2 * np.pi * f0 * t) * np.exp(-t * 30) + 0.5 * np.sin(2 * np.pi * f0 * 2.7 * t) * np.exp(-t * 50)
    x += 0.4 * filt(rng.standard_normal(len(t)), 'bandpass', [1500, 6000]) * np.exp(-t * 200)
    return x * vel * 0.4


def thud(vel=0.5):
    t = tt(int(0.6 * SR))
    x = np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-t * 20)) / SR) * np.exp(-t * 9)
    x += 0.5 * filt(rng.standard_normal(len(t)), 'lowpass', 900) * np.exp(-t * 14)
    return x * vel * 0.5


def noise_swell(dur, lo, hi, rise=True):
    t = tt(int(dur * SR))
    x = filt(rng.standard_normal(len(t)), 'bandpass', [lo, hi])
    e = (t / dur) ** 3 if rise else np.exp(-t * 3)
    return x * e


def chirp_bird(vel=0.2):
    out = []
    for _ in range(rng.integers(2, 5)):
        d = rng.uniform(0.05, 0.09)
        t = tt(int(d * SR))
        f = rng.uniform(2800, 3600) + rng.uniform(800, 1600) * np.sin(np.pi * t / d)
        out.append(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / d) ** 2)
        out.append(np.zeros(int(rng.uniform(0.03, 0.08) * SR)))
    return np.concatenate(out) * vel * 0.25


def boom(dist, vel=1.0):
    t = tt(int(2.2 * SR))
    x = 0.9 * filt(rng.standard_normal(len(t)), 'lowpass', 180) * np.exp(-t * 2.6)
    x += 0.6 * np.sin(2 * np.pi * np.cumsum(55 + 40 * np.exp(-t * 12)) / SR) * np.exp(-t * 5)
    x += 0.5 * filt(rng.standard_normal(len(t)), 'bandpass', [600, 3500]) * np.exp(-t * 25)
    return x * vel * 0.7 * min(1.3, 45 / max(dist, 20))


def crackle(dur, vel=0.4):
    n = int(dur * SR)
    x = np.zeros(n)
    k = int(dur * 180)
    for _ in range(k):
        i = rng.integers(0, n - 200)
        a = rng.uniform(0.2, 1) * (1 - i / n)
        x[i:i + 120] += filt(rng.standard_normal(120), 'highpass', 2500) * np.exp(-np.arange(120) / 25) * a
    return x * vel


def whistle(dur, vel=0.25):
    t = tt(int(dur * SR))
    f = 1500 - 500 * (t / dur) + 30 * np.sin(2 * np.pi * 9 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * np.minimum(1, t / dur)) ** 0.7
    x += 0.4 * filt(rng.standard_normal(len(t)), 'bandpass', [2000, 7000]) * np.exp(-t * 3)
    return x * vel * 0.18


def firecracker_run(dur, vel=0.5):
    n = int(dur * SR)
    x = np.zeros(n)
    tcur = 0.0
    while tcur < dur - 0.02:
        i = int(tcur * SR)
        big = rng.random() < 0.08
        L = int((0.03 if big else 0.012) * SR)
        burst = filt(rng.standard_normal(L), 'bandpass', [500 if big else 1200, 7000]) * np.exp(-np.arange(L) / ((0.006 if big else 0.0018) * SR))
        a = rng.uniform(0.4, 1.0) * (1.8 if big else 1.0)
        x[i:i + L] += burst[:max(0, min(L, n - i))] * a
        tcur += rng.exponential(0.028)
    return x * vel * 0.5


# ------------------------------------------------------------------ music
BEAT, BAR = 0.75, 3.0
CH = [(48, [60, 64, 67]), (47, [59, 62, 67]), (45, [57, 60, 64]), (41, [57, 60, 65])]


def bt(b, beat=0.0):
    return OFF + b * BAR + beat * BEAT


def chord(b):
    return (48, [60, 64, 67]) if b >= 18 else CH[b % 4]


MEL_A = [[(0, 1, 76), (1, 1, 79), (2, 1, 76), (3, 1, 74)], [(0, 2, 74), (2, 1, 71), (3, 1, 67)],
         [(0, 1.5, 72), (1.5, 0.5, 76), (2, 2, 81)], [(0, 1, 79), (1, 1, 77), (2, 1, 76), (3, 1, 72)]]
MEL_B = [[(0, 1.5, 76), (1.5, 0.5, 74), (2, 1, 72), (3, 1, 79)], [(0, 2, 79), (2, 1, 81), (3, 1, 79)],
         [(0, 2, 76), (2, 1, 74), (3, 1, 72)], [(0, 3, 74), (3, 1, 72)]]

# hook: soft golden chord, then a reversed chord pulling into the rewind
hook_ch = [57, 60, 64, 67, 71]
add(mus, pad([45, 57, 64, 71], 2.0, 0.09), 0.0)
for i, m in enumerate(hook_ch):
    add(mus, piano(m, 1.6, 0.42), 0.02 + i * 0.05, pan=(i - 2) * 0.15)
rev = np.zeros(int(2.4 * SR))
for m in (48, 55, 60, 64, 67, 72):
    p = piano(m, 1.8, 0.5)[:len(rev)]
    rev[:len(p)] += p
rev = rev[::-1][-int(1.25 * SR):]
add(mus, rev * np.linspace(0.3, 1, len(rev)), HOOK_HOLD := 1.8 - 0.05, 0.9)
add(sfx, noise_swell(1.2, 3000, 12000), 1.8, 0.16)
add(sfx, noise_swell(1.2, 200, 1200), 1.8, 0.10)
# ticking odometer during rewind (accelerating then decelerating)
tcur = 1.82
while tcur < 2.98:
    u = (tcur - 1.8) / 1.2
    add(sfx, knock(2200, 0.18), tcur, 1.0, pan=0.3 if int(tcur * 100) % 2 else -0.3)
    tcur += max(0.022, 0.09 * (1 - np.sin(np.pi * u)))
add(sfx, thud(0.45), 3.0, 0.8)

for b in range(19):
    root, tri = chord(b)
    # pad everywhere (softer at start)
    pg = 0.085 if b < 2 else 0.11 if b < 9 else 0.08 if b == 9 else 0.1
    add(mus, pad([root + 12] + tri, BAR + 0.4, pg), bt(b))
    # arpeggio
    if 2 <= b <= 16 and b != 9:
        a, c, e = tri
        pat = [a, c, e, a + 12, c + 12, e, a + 12, c]
        vel = 0.4 if b < 5 else 0.38 if b < 13 else 0.42
        for k, m in enumerate(pat):
            add(mus, piano(m, 0.5, vel * (1.0 if k % 2 == 0 else 0.8)), bt(b, k * 0.5), pan=((k % 4) - 1.5) * 0.25)
    # bass
    if 5 <= b <= 17:
        add(mus, bass(root - 12 if root > 44 else root, BAR - 0.1, 0.55 if b != 9 else 0.4), bt(b))
    # melody
    if 5 <= b <= 8:
        for be, du, m in MEL_A[b % 4]:
            add(mus, piano(m, du * BEAT, 0.5), bt(b, be), pan=0.1)
    if 10 <= b <= 12:
        for be, du, m in MEL_B[b % 4]:
            add(mus, piano(m, du * BEAT, 0.55), bt(b, be), pan=0.1)
    if 13 <= b <= 14:
        for be, du, m in MEL_A[b % 4]:
            add(mus, piano(m + 12, du * BEAT, 0.5), bt(b, be), pan=0.1)
            add(mus, bell(m + 12, 1.8, 0.35), bt(b, be), pan=-0.2)
    # drums
    if 11 <= b <= 16:
        dv = 0.4 if b < 13 else 0.5 if b < 15 else 0.62
        for be in (0, 2) + ((2.5,) if b >= 15 else ()):
            add(mus, kick(dv), bt(b, be))
        for be in (1, 3):
            add(mus, clap(dv * 0.8), bt(b, be))
        if b >= 13:
            for k in range(8):
                add(mus, shaker(0.25 if k % 2 else 0.15), bt(b, k * 0.5), pan=0.4)

# seed + sprout
add(mus, piano(79, 1.5, 0.5), OFF + 0.75)
add(sfx, knock(150, 0.55), OFF + 0.75)
add(mus, piano(76, 1.5, 0.45), bt(1, 0))
add(mus, piano(74, 1.0, 0.4), bt(1, 2))
for i, m in enumerate((72, 76, 79, 84, 88)):
    add(mus, bell(m, 2.0, 0.3), OFF + 4.1 + i * 0.22, pan=(i - 2) * 0.2)
# power: suspense notes, then lights
add(mus, piano(67, 1.5, 0.35), bt(9, 0))
add(mus, piano(71, 1.5, 0.35), bt(9, 2))
# golden: descending run as the leaves drop
for i, m in enumerate((96, 93, 91, 88, 86, 84, 81, 79, 76, 74, 72)):
    add(mus, piano(m, 0.4, 0.32), OFF + 42.6 + i * 0.09, pan=0.5 - i * 0.09)
# new year's eve: guzheng glissando + festive riff
penta = [60, 62, 64, 67, 69]
gl = [p + 12 * o for o in range(3) for p in penta][:14]
for i, m in enumerate(gl):
    add(mus, ks(m, 1.4, 0.55), OFF + 45.0 + i * 0.035, pan=-0.5 + i * 0.07)
RIFF = {15: [(0, 0.5, 81), (0.5, 0.5, 79), (1, 0.5, 76), (1.5, 0.5, 74), (2, 1, 72), (3, 0.5, 74), (3.5, 0.5, 76)],
        16: [(0, 1, 79), (1, 0.5, 76), (1.5, 0.5, 79), (2, 1, 84), (3, 1, 81)]}
for b, notes in RIFF.items():
    for be, du, m in notes:
        add(mus, ks(m, 1.6, 0.6, bend=0.012 if du >= 1 else 0), bt(b, be), pan=-0.15)
# outro
add(mus, piano(74, 1.5, 0.45), bt(17, 0))
add(mus, piano(71, 1.5, 0.4), bt(17, 2))
for i, m in enumerate((36, 48, 55, 60, 64, 67, 72, 76)):
    add(mus, piano(m, 5.5, 0.55 if m > 40 else 0.7), bt(18, 0) + i * 0.012)
add(mus, pad([48, 60, 64, 67, 72], 6.0, 0.12), bt(18, 0))
add(mus, bell(84, 4.0, 0.3), bt(18, 0) + 0.02)
add(mus, bell(91, 4.0, 0.22), bt(18, 1))

# ------------------------------------------------------------------ sfx from events
scale_hi = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93]
for h in E['houses']:
    tb = OFF + h['build']
    if h['first']:
        for k in range(6):
            add(sfx, knock(rng.uniform(170, 240), 0.6), tb + 0.25 + k * 0.21, pan=0.2)
        for k, a in enumerate((0.36, 0.73, 0.91)):
            add(sfx, thud(0.6 / (k + 1)), tb + h['dur'] * (0.6 + a * 0.32), pan=0.2)
        continue
    if h['build'] < 0 or h['build'] > 60:
        continue
    land = tb + h['dur'] * (0.45 + 0.36 * 0.5)
    v = 0.32 if h['kind'] == 'hut' else 0.24
    m = scale_hi[int(rng.integers(0, 6 if h['kind'] == 'hut' else 10))] - (12 if h['kind'] == 'hut' else 0)
    add(sfx, marimba(m, v), land, pan=float(np.clip(rng.normal(0, 0.45), -0.9, 0.9)))
    add(sfx, thud(0.12), land, pan=0)
for tp in E['poles']:
    add(sfx, knock(110, 0.35), OFF + tp + 0.18, pan=float(rng.uniform(-0.5, 0.5)))
# first bulb + lights ripple
bulb = OFF + E['bulb']
add(sfx, knock(3000, 0.4), bulb)
tb_ = tt(int(0.35 * SR))
add(sfx, (np.sin(2 * np.pi * 100 * tb_) + 0.5 * np.sin(2 * np.pi * 200 * tb_)) * np.exp(-tb_ * 6) * 0.05, bulb)
ons = sorted(h['on'] for h in E['houses'] if h['on'] is not None and h['on'] < 32)
for k, o in enumerate(ons):
    add(sfx, bell(scale_hi[(k * 3) % len(scale_hi)], 1.6, 0.16), OFF + o, pan=float(rng.uniform(-0.8, 0.8)))
# lanterns pop
for i, lt in enumerate(sorted(E['lanterns'])[::4]):
    add(sfx, marimba(84 + (i % 5) * 2, 0.12), OFF + lt + 0.2, pan=float(rng.uniform(-0.6, 0.6)))
# firecrackers
for k, (t0, t1, d) in enumerate(E['crackers']):
    add(sfx, firecracker_run(t1 - t0, 0.9 * min(1.2, 20 / d)), OFF + t0, pan=-0.7 + k * 0.22)
# fireworks
for fw in E['fireworks']:
    d = fw['dist']
    add(sfx, whistle(fw['explode'] - fw['launch'], 1.0 * min(1.0, 45 / d)), OFF + fw['launch'], pan=float(rng.uniform(-0.6, 0.6)))
    delay = d * 0.5 / 343
    add(sfx, boom(d, 0.9), OFF + fw['explode'] + delay, pan=float(rng.uniform(-0.5, 0.5)))
    if fw['type'] in ('willow', 'ring') or rng.random() < 0.4:
        add(sfx, crackle(1.8, 0.25 * min(1, 45 / d)), OFF + fw['explode'] + delay + 0.25, pan=float(rng.uniform(-0.6, 0.6)))

# ------------------------------------------------------------------ ambience
t = tt(N)
wind_n = filt(rng.standard_normal((N, 2)), 'lowpass', 500)
gust = 0.6 + 0.4 * np.sin(2 * np.pi * 0.11 * t + 1) * np.sin(2 * np.pi * 0.047 * t)
T = t - OFF
wl = np.interp(t, [0, 1.8, 3.0, 3.2, 15, 27, 33, 39, 41, 45, 47, 60], [0.5, 0.5, 0.1, 0.25, 0.25, 0.2, 0.12, 0.2, 0.45, 0.5, 0.15, 0.12])
amb += wind_n * (gust * wl)[:, None] * 0.6
rustle = filt(rng.standard_normal((N, 2)), 'bandpass', [2500, 7000])
rus_mod = np.clip(filt(np.abs(rng.standard_normal(N)), 'lowpass', 6) * 3, 0, 2)
rl = np.interp(t, [0, 1.8, 2.0, OFF + 39.5, OFF + 41, OFF + 44.6, OFF + 45.2, 60], [0.5, 0.5, 0.0, 0.0, 0.25, 0.45, 0.0, 0.0])
amb += rustle * (rus_mod * rl)[:, None] * 0.12
for tb0, tb1 in ((OFF + 0.3, OFF + 6), (OFF + 15, OFF + 21), (OFF + 39, OFF + 44)):
    tc = tb0
    while tc < tb1:
        add(amb, chirp_bird(0.5), tc, pan=float(rng.uniform(-0.8, 0.8)))
        tc += rng.uniform(0.6, 1.6)

# ------------------------------------------------------------------ mix
def reverb_ir(sec=3.2, seed=3):
    r = np.random.default_rng(seed)
    n = int(sec * SR)
    tt_ = np.arange(n) / SR
    ir = r.standard_normal((n, 2)) * np.exp(-tt_ * 2.2)[:, None]
    ir = filt(ir, 'lowpass', 5500)
    ir[: int(0.012 * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum(0))


ir = reverb_ir()
wet_m = np.stack([signal.fftconvolve(mus[:, c], ir[:, c])[:N] for c in range(2)], 1)
wet_s = np.stack([signal.fftconvolve(sfx[:, c], ir[:, c])[:N] for c in range(2)], 1)
mix = mus * 0.85 + wet_m * 0.32 + sfx * 0.75 + wet_s * 0.18 + amb * 0.5
mix = filt(mix, 'highpass', 30)
# slow loudness leveling (~2:1 toward the mean)
env = np.sqrt(filt(np.mean(mix ** 2, 1), 'lowpass', 0.8) + 1e-9)
ref = np.sqrt(np.mean(mix ** 2))
gain = np.clip((env / ref) ** -0.45, 0.6, 2.6)
gain[: int(0.2 * SR)] = gain[int(0.2 * SR)]
mix *= gain[:, None]
fade = np.ones(N)
fo = int(1.6 * SR)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
mix *= fade[:, None]
rms = np.sqrt(np.mean(mix ** 2))
mix *= 10 ** (-16 / 20) / rms
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix *= 0.93 / np.max(np.abs(mix))
pcm = (mix * 32767).astype(np.int16)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', OUT, 'rms dB', 20 * np.log10(np.sqrt(np.mean(mix ** 2))), 'peak', np.max(np.abs(mix)))
