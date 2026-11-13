"""Cleanfit · ANSUR II 公开人体测量数据准备

来源：UMTRI / Matthew Reed 公开的 ANSUR 2 (2012) Distribution
      https://mreed.umtri.umich.edu/mreed/downloads.html
      ANSUR2Distribution.zip 内 Distribution/ANSUR II {MALE,FEMALE} Public.csv

数据为 2012 年美军人体测量调查的公开样本（军方人群，不代表普通总体）。
原始单位 mm（weightkg 为 kg），本脚本统一转成 cm 并做异常值清洗。

输出 train/data/ansur2_clean.csv，供 train_calibration.py 使用。
"""
import csv
import io
import os
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(BASE, 'train', 'data', 'ANSUR2Distribution.zip')
OUT = os.path.join(BASE, 'train', 'data', 'ansur2_clean.csv')

# 与 Cleanfit 14 项输出 / 3D 骨架段长对应的解剖学测量
COLS = [
    'stature',                 # 身高
    'biacromialbreadth',       # 肩峰宽（骨性，≈ BlazePose 11-12 关节中心距）
    'bideltoidbreadth',        # 三角肌外缘肩宽（服装语境的「肩宽」）
    'bicristalbreadth',        # 髂嵴宽（≈ 髋关节中心相关）
    'hipbreadth',              # 立姿臀宽（服装语境的「胯宽」）
    'chestbreadth', 'chestdepth', 'chestcircumference',
    'waistbreadth', 'waistdepth', 'waistcircumference',
    'buttockdepth', 'buttockcircumference',
    'span',                    # 臂展
    'acromionradialelength',   # 肩峰→桡骨头（上臂）
    'shoulderelbowlength',     # 肩→肘（上臂）
    'radialestylionlength',    # 桡骨头→茎突（前臂）
    'forearmhandlength', 'handlength',
    'crotchheight',            # 胯高（下肢长）
    'buttockkneelength',       # 臀→膝（大腿）
    'kneeheightmidpatella',    # 膝高（小腿）
    'poplitealheight',
    'cervicaleheight', 'suprasternaleheight', 'sittingheight', 'tragiontopofhead',
    'weightkg',                # 注意：原始值单位是 0.1 kg（815 = 81.5kg）
]

# 合理范围（原始单位 mm / 0.1kg），超出视为录入异常
RANGE = {
    'stature': (1300, 2100),
    'weightkg': (350, 2000),
}


def load_csv(z, name, sex):
    raw = z.read(name).decode('utf-8-sig', errors='replace')
    rows = csv.DictReader(io.StringIO(raw))
    out = []
    for r in rows:
        row = {k.lower().strip(): v for k, v in r.items() if k}
        rec = {'sex': sex}
        ok = True
        for c in COLS:
            v = row.get(c, '')
            try:
                x = float(v)
            except (TypeError, ValueError):
                ok = False
                break
            if not (x > 0):
                ok = False
                break
            if c in RANGE and not (RANGE[c][0] <= x <= RANGE[c][1]):
                ok = False
                break
            rec[c] = x
        if ok:
            out.append(rec)
    return out


def main():
    if not os.path.exists(ZIP):
        raise SystemExit(f'missing {ZIP}')
    z = zipfile.ZipFile(ZIP)
    data = []
    data += load_csv(z, 'Distribution/ANSUR II MALE Public.csv', 'M')
    data += load_csv(z, 'Distribution/ANSUR II FEMALE Public.csv', 'F')
    print(f'loaded: {len(data)} subjects (M={sum(d["sex"]=="M" for d in data)}, '
          f'F={sum(d["sex"]=="F" for d in data)})')

    # 极温和的逐列截尾（0.1%~99.9%）：只去录入错误，保留极端体型
    # —— 高/矮/胖个体恰恰是「模型先验压缩」最严重、对精度研究最有价值的样本
    for c in COLS:
        vals = sorted(d[c] for d in data)
        lo = vals[int(len(vals) * 0.001)]
        hi = vals[int(len(vals) * 0.999)]
        for d in data:
            if not (lo <= d[c] <= hi):
                d['_bad'] = True
    clean = [d for d in data if not d.get('_bad')]
    n_drop = len(data) - len(clean)
    print(f'after 0.1–99.9% trimming: {len(clean)} subjects (dropped {n_drop})')

    # 所有原始测量统一 /10：mm → cm；weightkg 的 0.1kg → kg
    for d in clean:
        for c in COLS:
            d[c] = d[c] / 10.0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['sex'] + COLS)
        w.writeheader()
        for d in clean:
            w.writerow({k: (d[k] if k == 'sex' else round(d[k], 3)) for k in ['sex'] + COLS})
    print(f'written: {OUT}')

    # 关键列的描述性统计
    import statistics as st
    print('\n=== 关键测量（cm）===')
    for c in ['stature', 'biacromialbreadth', 'bideltoidbreadth',
              'bicristalbreadth', 'hipbreadth', 'chestcircumference',
              'waistcircumference', 'buttockcircumference', 'span']:
        v = sorted(d[c] for d in clean)
        print(f'{c:24s} mean={st.mean(v):6.2f}  sd={st.stdev(v):5.2f}  '
              f'p5={v[int(len(v)*.05)]:6.2f}  p50={v[len(v)//2]:6.2f}  p95={v[int(len(v)*.95)]:6.2f}')

    diff = st.mean(d['bideltoidbreadth'] - d['biacromialbreadth'] for d in clean)
    print(f'\n肩峰宽 → 三角肌宽 平均差: {diff:.2f} cm  '
          f'(anthro.js 当前硬编码只加 5.00 cm)')


if __name__ == '__main__':
    main()
