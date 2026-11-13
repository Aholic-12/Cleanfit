#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 ANSUR II 全量公开数据（6,068 人）构建 Cleanfit 的「人体测量参考库」。

产物：
  train/output/reference.json   —— 完整统计 + 分位数 + 比例先验（均值/协方差）
  demo/js/reference.js          —— 前端可直接引用的模块（含 percentileOf / mahalanobis / shrink）
  train/data/ansur2_reference.csv —— 6,068 人 × 14 项派生输出（cm），可作项目参考数据

映射原则：优先用 ANSUR 的直接测量列；无直接列的纵向段用两列解剖差值（差值关系在脚本内注释）。
单位：ANSUR 原始为 mm，统一 /10 转 cm。
"""
import csv
import io
import json
import os
import zipfile

import numpy as np

ZIP = 'train/data/ANSUR2Distribution.zip'
OUT_JSON = 'train/output/reference.json'
OUT_JS = 'demo/js/reference.js'
OUT_CSV = 'train/data/ansur2_reference.csv'

SEED = 20261112

# ---------------------------------------------------------------- 映射
# 项目 14 项输出 -> ANSUR 列（多于 1 列表示解剖差值）
#  - height   : stature                                   （直接）
#  - headNeck : stature - acromialheight                  （肩峰到头顶 = 头+颈）
#  - torso    : acromialheight - trochanterionheight       （肩峰到大转子 = 肩到髋）
#  - legLength: crotchheight                              （会阴到地面）
#  - thigh    : trochanterionheight - kneeheightmidpatella （大转子到膝）
#  - shank    : kneeheightmidpatella - lateralmalleolusheight （膝到外踝）
#  - shoulder : bideltoidbreadth                          （三角肌外缘肩宽）
#  - hipWidth : hipbreadth                                （臀宽）
#  - upperArm : shoulderelbowlength                       （肩峰到肘）
#  - forearm  : radialestylionlength                      （桡骨点到茎突 = 前臂）
#  - armSpan  : span                                      （臂展）
#  - chestCirc: chestcircumference                        （胸围）
#  - waistCirc: waistcircumference                        （腰围）
#  - hipCirc  : buttockcircumference                      （臀围）
MAPPING = {
    'height':    ['stature'],
    'headNeck':  ['stature', 'acromialheight'],
    'torso':     ['acromialheight', 'trochanterionheight'],
    'legLength': ['crotchheight'],
    'thigh':     ['trochanterionheight', 'kneeheightmidpatella'],
    'shank':     ['kneeheightmidpatella', 'lateralmalleolusheight'],
    'shoulder':  ['bideltoidbreadth'],
    'hipWidth':  ['hipbreadth'],
    'upperArm':  ['shoulderelbowlength'],
    'forearm':   ['radialestylionlength'],
    'armSpan':   ['span'],
    'chestCirc': ['chestcircumference'],
    'waistCirc': ['waistcircumference'],
    'hipCirc':   ['buttockcircumference'],
}

ORDER = ['height', 'headNeck', 'torso', 'legLength', 'thigh', 'shank',
         'shoulder', 'hipWidth', 'upperArm', 'forearm', 'armSpan',
         'chestCirc', 'waistCirc', 'hipCirc']

LABELS = {
    'height': '身高', 'headNeck': '头颈高', 'torso': '躯干长', 'legLength': '腿长',
    'thigh': '大腿长', 'shank': '小腿长', 'shoulder': '肩宽', 'hipWidth': '胯宽',
    'upperArm': '上臂长', 'forearm': '前臂长', 'armSpan': '臂展',
    'chestCirc': '胸围', 'waistCirc': '腰围', 'hipCirc': '臀围',
}

NEED = sorted({c for v in MAPPING.values() for c in v})

PCTS = [0, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 100]


# ---------------------------------------------------------------- 读入
def load():
    rows = []
    z = zipfile.ZipFile(ZIP)
    for sex, fn in [('M', 'Distribution/ANSUR II MALE Public.csv'),
                    ('F', 'Distribution/ANSUR II FEMALE Public.csv')]:
        raw = z.read(fn).decode('utf-8-sig', errors='replace')
        for r in csv.DictReader(io.StringIO(raw)):
            d = {k.strip().lower(): v for k, v in r.items() if k}
            rec = {'sex': sex}
            ok = True
            for c in NEED:
                try:
                    rec[c] = float(d[c]) / 10.0      # mm -> cm
                except (KeyError, ValueError):
                    ok = False
                    break
            if ok:
                rows.append(rec)
    return rows


def derive(r):
    """14 项输出（cm）。"""
    return {
        'height':    r['stature'],
        'headNeck':  r['stature'] - r['acromialheight'],
        'torso':     r['acromialheight'] - r['trochanterionheight'],
        'legLength': r['crotchheight'],
        'thigh':     r['trochanterionheight'] - r['kneeheightmidpatella'],
        'shank':     r['kneeheightmidpatella'] - r['lateralmalleolusheight'],
        'shoulder':  r['bideltoidbreadth'],
        'hipWidth':  r['hipbreadth'],
        'upperArm':  r['shoulderelbowlength'],
        'forearm':   r['radialestylionlength'],
        'armSpan':   r['span'],
        'chestCirc': r['chestcircumference'],
        'waistCirc': r['waistcircumference'],
        'hipCirc':   r['buttockcircumference'],
    }


def clean(rows):
    """去掉解剖上不可能的记录（身高越界、任一派生段 <=0 或极端）。"""
    out = []
    for r in rows:
        d = derive(r)
        if not (130.0 <= d['height'] <= 220.0):
            continue
        if any(v <= 0 for v in d.values()):
            continue
        # 极宽松的合理性闸门，只滤录入错误
        if not (20.0 <= d['headNeck'] <= 45.0):   continue
        if not (30.0 <= d['torso'] <= 75.0):      continue
        if not (55.0 <= d['legLength'] <= 115.0): continue
        if not (25.0 <= d['thigh'] <= 60.0):      continue
        if not (25.0 <= d['shank'] <= 60.0):      continue
        out.append(dict(sex=r['sex'], **d))
    return out


# ---------------------------------------------------------------- 统计
def pct_map(vals):
    arr = np.asarray(vals, dtype=float)
    return {str(p): round(float(np.percentile(arr, p)), 3) for p in PCTS}


def describe(vals):
    a = np.asarray(vals, dtype=float)
    return dict(
        n=int(a.size),
        mean=round(float(a.mean()), 3),
        sd=round(float(a.std(ddof=1)), 3),
        min=round(float(a.min()), 3),
        max=round(float(a.max()), 3),
        p=pct_map(a),
    )


def ratio_stats(sub):
    """比例（值/身高）统计。"""
    h = np.array([r['height'] for r in sub])
    out = {}
    for k in ORDER:
        if k == 'height':
            continue
        v = np.array([r[k] for r in sub]) / h
        out[k] = dict(
            mean=round(float(v.mean()), 5),
            sd=round(float(v.std(ddof=1)), 5),
            p={str(p): round(float(np.percentile(v, p)), 5) for p in PCTS},
        )
    return out


def prior(sub):
    """14 维比例向量的均值与协方差（含对角正则，保证可逆）。"""
    h = np.array([r['height'] for r in sub])
    X = np.column_stack([[r[k] for r in sub] for k in ORDER]) / h[:, None]
    mu = X.mean(axis=0)
    cov = np.cov(X, rowvar=False, ddof=1)
    # 轻微收缩到对角，避免近奇异
    cov = cov * 0.98 + np.diag(np.diag(cov)) * 0.02
    return dict(
        mu=[round(float(v), 6) for v in mu],
        cov=[[round(float(v), 10) for v in row] for row in cov],
    )


def main():
    rows = load()
    data = clean(rows)
    print(f'loaded {len(rows)} subjects, kept {len(data)} after cleaning')

    by = {'all': data, 'M': [r for r in data if r['sex'] == 'M'],
          'F': [r for r in data if r['sex'] == 'F']}

    stats = {}
    for k in ORDER:
        stats[k] = {g: describe([r[k] for r in sub]) for g, sub in by.items()}
        stats[k]['ratio'] = ratio_stats(by['all'])[k] if k != 'height' else None

    ref = dict(
        meta=dict(
            source='ANSUR II (2012) Public Distribution, U.S. Army',
            url='https://mreed.umtri.umich.edu/mreed/downloads/anthro/ANSUR2Distribution.zip',
            citation='Gordon et al. (2012) 2012 Anthropometric Survey of U.S. Army Personnel: Methods and Summary Statistics',
            units='cm',
            n=len(data), n_male=len(by['M']), n_female=len(by['F']),
            note='军事人群样本，不代表普通/中国消费者分布，仅作方法与量级参考。',
        ),
        labels=LABELS,
        order=ORDER,
        stats=stats,
        prior={g: prior(sub) for g, sub in by.items()},
    )

    os.makedirs('train/output', exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(ref, f, ensure_ascii=False, indent=1)

    # 参考 CSV（全量 6,068 人 × 14 项）
    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['sex'] + ORDER)
        for r in data:
            w.writerow([r['sex']] + [round(r[k], 2) for k in ORDER])
    print(f'wrote {OUT_CSV}')

    # 前端模块
    js = build_js(ref)
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f'wrote {OUT_JS}')

    # 控制台摘要
    print('\n=== 全量参考（cm，all）===')
    for k in ORDER:
        s = stats[k]['all']
        print(f'{LABELS[k]:8s} n={s["n"]:5d} mean={s["mean"]:7.2f} sd={s["sd"]:5.2f} '
              f'p5={s["p"]["5"]:7.2f} p50={s["p"]["50"]:7.2f} p95={s["p"]["95"]:7.2f}')


def build_js(ref):
    body = json.dumps(ref, ensure_ascii=False, separators=(',', ':'))
    return (
        '/* 自动生成，请勿手改。来源 train/build_reference.py */\n'
        '/* ANSUR II (2012) 全量公开数据 n=%d，人体测量参考库（cm） */\n'
        'export const REFERENCE = %s;\n\n'
        '/* 分位数：value 在参考分布中的百分位（0~100），按存储分位点线性插值 */\n'
        'export function percentileOf(key, value, sex = "all") {\n'
        '  const st = REFERENCE.stats[key]; if (!st) return null;\n'
        '  const p = st[sex] ? st[sex].p : st.all.p;\n'
        '  const xs = Object.keys(p).map(Number).sort((a, b) => a - b);\n'
        '  if (value <= p[xs[0]]) return 0;\n'
        '  if (value >= p[xs[xs.length - 1]]) return 100;\n'
        '  for (let i = 0; i < xs.length - 1; i++) {\n'
        '    const a = xs[i], b = xs[i + 1];\n'
        '    if (value >= p[a] && value <= p[b]) {\n'
        '      const t = (value - p[a]) / (p[b] - p[a] || 1);\n'
        '      return +(a + t * (b - a)).toFixed(1);\n'
        '    }\n'
        '  }\n'
        '  return null;\n'
        '}\n\n'
        '/* z 分数：value 偏离人群均值多少个标准差 */\n'
        'export function zScore(key, value, sex = "all") {\n'
        '  const st = REFERENCE.stats[key]; if (!st) return null;\n'
        '  const s = st[sex] || st.all;\n'
        '  return s.sd > 0 ? +((value - s.mean) / s.sd).toFixed(2) : null;\n'
        '}\n\n'
        '/* 是否落在 p1~p99 合理区间（用 p0~p100 端点近似） */\n'
        'export function isPlausible(key, value, sex = "all") {\n'
        '  const st = REFERENCE.stats[key]; if (!st) return true;\n'
        '  const s = st[sex] || st.all;\n'
        '  return value >= s.min && value <= s.max;\n'
        '}\n\n'
        '/* 马氏距离：14 维比例向量相对人群先验的偏离度（越小越典型） */\n'
        'export function mahalanobis(ratios, sex = "all") {\n'
        '  const pr = REFERENCE.prior[sex] || REFERENCE.prior.all;\n'
        '  const mu = pr.mu, cov = pr.cov, n = mu.length;\n'
        '  const d = new Array(n);\n'
        '  for (let i = 0; i < n; i++) d[i] = (ratios[REFERENCE.order[i]] ?? mu[i]) - mu[i];\n'
        '  // 高斯消元解 cov * x = d\n'
        '  const A = cov.map((row, i) => row.concat([d[i]]));\n'
        '  for (let c = 0; c < n; c++) {\n'
        '    let piv = c;\n'
        '    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;\n'
        '    [A[c], A[piv]] = [A[piv], A[c]];\n'
        '    const pv = A[c][c] || 1e-12;\n'
        '    for (let r = 0; r < n; r++) {\n'
        '      if (r === c) continue;\n'
        '      const f = A[r][c] / pv;\n'
        '      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];\n'
        '    }\n'
        '  }\n'
        '  let q = 0;\n'
        '  for (let i = 0; i < n; i++) q += d[i] * (A[i][n] / (A[i][i] || 1e-12));\n'
        '  return +Math.sqrt(Math.max(q, 0)).toFixed(3);\n'
        '}\n\n'
        '/* 收缩：把测得比例向人群均值拉近 strength（0~1），降低噪声 */\n'
        'export function shrink(ratios, sex = "all", strength = 0.3) {\n'
        '  const pr = REFERENCE.prior[sex] || REFERENCE.prior.all;\n'
        '  const out = {};\n'
        '  REFERENCE.order.forEach((k, i) => {\n'
        '    const v = ratios[k];\n'
        '    out[k] = (v == null) ? pr.mu[i] : (1 - strength) * v + strength * pr.mu[i];\n'
        '  });\n'
        '  return out;\n'
        '}\n'
    ) % (ref['meta']['n'], body)


if __name__ == '__main__':
    main()
