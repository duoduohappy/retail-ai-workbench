"""Deterministic retail fixture, SQLite source of truth and temporal recommendation evaluation.
All customers, products, stores, competitor evidence and transactions are synthetic.
"""
import collections
import datetime as dt
import itertools
import json
import math
from pathlib import Path
import random
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
SEED = 20261123
TODAY = dt.date(2026, 11, 22)
START = TODAY - dt.timedelta(days=364)
random.seed(SEED)

def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

def recommendations(user, model, products, limit=5):
    bought = model['users'].get(str(user), {})
    scores = collections.defaultdict(float)
    for p, strength in bought.items():
        for other, similarity in model['similarities'].get(str(p), []):
            if str(other) not in bought:
                scores[other] += similarity * math.log1p(strength)
    ranked = sorted(scores, key=lambda p: (-scores[p], p))
    ranked += [p for p in model['popular'] if p not in ranked and str(p) not in bought]
    return ranked[:limit]

def build_model(orders):
    users = collections.defaultdict(collections.Counter)
    baskets = collections.Counter()
    pairs = collections.Counter()
    popular = collections.Counter()
    for o in orders:
        ids = set()
        for p, qty, price, returned in o['items']:
            if qty > returned:
                popular[p] += qty - returned
                ids.add(p)
                if o['member']:
                    users[str(o['member'])][str(p)] += qty - returned
        for p in ids:
            baskets[p] += 1
        for a, b in itertools.combinations(sorted(ids), 2):
            pairs[a, b] += 1
    sims = collections.defaultdict(list)
    for (a, b), n in pairs.items():
        value = round(n / math.sqrt(baskets[a] * baskets[b]), 6)
        sims[str(a)].append([b, value])
        sims[str(b)].append([a, value])
    return {'users': dict(users), 'similarities': {k: sorted(v, key=lambda x: -x[1]) for k, v in sims.items()}, 'popular': [p for p, _ in popular.most_common()]}

def main():
    DIST.mkdir(exist_ok=True)
    assets = DIST / 'assets'
    assets.mkdir(exist_ok=True)
    stores = [{'id': i+1, 'name': n, 'region': '东区' if i < 3 else '西区', 'area': 120+i*15, 'staff': 6+i%3} for i, n in enumerate(['国贸店', '朝阳店', '望京店', '西直门店', '中关村店', '五棵松店'])]
    goods = [
        ('鲜萃燕麦饮', '饮料', 1290, 650), ('无糖气泡水', '饮料', 690, 310), ('冷萃咖啡', '饮料', 1590, 790), ('茉莉轻茶', '饮料', 890, 380), ('鲜橙果汁', '饮料', 1490, 750), ('椰子水', '饮料', 1190, 590),
        ('海盐苏打饼', '零食', 1590, 780), ('每日坚果', '零食', 2990, 1700), ('黑巧能量棒', '零食', 1290, 600), ('蔓越莓曲奇', '零食', 2290, 1100), ('冻干草莓', '零食', 2590, 1400), ('原切薯片', '零食', 990, 430),
        ('有机鲜鸡蛋', '生鲜', 1990, 1390), ('鲜牛奶', '生鲜', 1690, 1080), ('希腊酸奶', '生鲜', 1190, 700), ('即食鸡胸肉', '生鲜', 1790, 1090), ('牛油果双果装', '生鲜', 2290, 1450), ('沙拉蔬菜盒', '生鲜', 1590, 900),
        ('竹纤维纸巾', '日用', 1990, 1100), ('柑橘洗手液', '日用', 2590, 1200), ('环保垃圾袋', '日用', 1290, 590), ('便携湿巾', '日用', 990, 460), ('厨房清洁巾', '日用', 1690, 780), ('旅行收纳袋', '日用', 2990, 1400)]
    products = [{'id': i+1, 'sku': f'SKU-{i+1:04}', 'name': n, 'category': c, 'price': p, 'cost': cost, 'unit': '250ml/瓶' if c == '饮料' else ('单份/件'), 'color': ['#127f78', '#c58537', '#dd775c', '#6b83b6'][['饮料', '零食', '生鲜', '日用'].index(c)]} for i, (n, c, p, cost) in enumerate(goods)]
    members = [{'id': i, 'name': f'会员 {i:04}', 'favorite': random.choice(['饮料', '零食', '生鲜', '日用']), 'joined': str(START+dt.timedelta(days=random.randrange(180)))} for i in range(1, 801)]
    orders, traffic, inventory, prices = [], [], [], []
    by_id = {p['id']: p for p in products}
    oid = 0
    for d in range(365):
        date = START + dt.timedelta(days=d)
        recent = (TODAY-date).days < 28
        previous = 28 <= (TODAY-date).days < 56
        for s in stores:
            visitors = round((175+s['id']*16) * (1.2 if date.weekday() >= 5 else 1) * random.uniform(.92, 1.08))
            # Three stores have a planted conversion shock, with recorded stockouts.
            conversion = .071 * (.76 if recent and s['region'] == '东区' else 1)
            count = max(1, round(visitors*conversion*random.uniform(.9, 1.1)))
            traffic.append({'date': str(date), 'store': s['id'], 'visitors': visitors})
            for _ in range(count):
                oid += 1
                member = random.choice(members) if random.random() < .78 else None
                if member and str(date) < member['joined']:
                    member = None
                category = member['favorite'] if member and random.random() < .8 else random.choice(['饮料', '零食', '生鲜', '日用'])
                pool = [p for p in products if p['category'] == category]
                primary = random.choice(pool)
                if recent and s['region'] == '东区' and primary['id'] in [1, 3]:
                    primary = by_id[2]
                chosen = [primary]
                if random.random() < .68:
                    partner = by_id[(primary['id']-1)//6*6+(primary['id']%6)+1]
                    chosen.append(partner)
                if random.random() < .2:
                    chosen.append(random.choice(products))
                lines = []
                for p in {p['id']: p for p in chosen}.values():
                    qty = 2 if random.random() < .18 else 1
                    discount = .79 if recent and p['category'] == '零食' else (1 if random.random() < .85 else .95)
                    paid = round(p['price']*discount)
                    returned = 1 if random.random() < .018 else 0
                    lines.append([p['id'], qty, paid, returned])
                orders.append({'id': oid, 'date': str(date), 'store': s['id'], 'member': member['id'] if member else None, 'items': lines})
            for p in products:
                stock = 0 if recent and s['region'] == '东区' and p['id'] in [1, 3] and d%7 < 4 else (180 if p['id'] == 24 else random.randint(8, 65))
                inventory.append([str(date), s['id'], p['id'], stock])
    for p in products:
        for d in range(0, 365, 7):
            date = START+dt.timedelta(days=d)
            prices.append({'date': str(date), 'product': p['id'], 'competitor': '邻里优选（虚构）', 'price': round(p['price']*(.88 if p['id'] in [1, 3] and (TODAY-date).days < 28 else .98)), 'condition': '同规格、单件活动价', 'source': 'E01' if p['id'] in [1, 3] else 'E02'})
    split = str(TODAY-dt.timedelta(days=28))
    train = [o for o in orders if o['date'] <= split]
    test = [o for o in orders if o['date'] > split]
    model = build_model(train)
    future = collections.defaultdict(set)
    for o in test:
        if o['member']:
            for p, q, _, r in o['items']:
                if q > r and str(p) not in model['users'].get(str(o['member']), {}):
                    future[o['member']].add(p)
    hit, base, recall, base_recall, ndcg, base_ndcg = [], [], [], [], [], []
    coverage = set()
    for uid, truth in future.items():
        if str(uid) not in model['users'] or not truth:
            continue
        rec = recommendations(uid, model, products)
        popular = [p for p in model['popular'] if str(p) not in model['users'][str(uid)]][:5]
        coverage.update(rec)
        def metrics(ranked):
            hits = len(set(ranked)&truth)
            ideal = sum(1/math.log2(i+2) for i in range(min(5, len(truth))))
            dcg = sum((1/math.log2(i+2)) for i, p in enumerate(ranked) if p in truth)
            return int(hits>0), hits/len(truth), dcg/ideal
        a, b, c = metrics(rec)
        x, y, z = metrics(popular)
        hit.append(a); recall.append(b); ndcg.append(c)
        base.append(x); base_recall.append(y); base_ndcg.append(z)
    avg = lambda xs: round(sum(xs)/len(xs), 4) if xs else 0
    evaluation = {'trainEnd': split, 'testStart': str(TODAY-dt.timedelta(days=27)), 'testEnd': str(TODAY), 'users': len(hit), 'k': 5, 'personalized': {'hitRate': avg(hit), 'recall': avg(recall), 'ndcg': avg(ndcg), 'coverage': round(len(coverage)/len(products), 4)}, 'baseline': {'hitRate': avg(base), 'recall': avg(base_recall), 'ndcg': avg(base_ndcg)}, 'note': '模拟偏好数据上的时间切分离线评估；排除已购商品；不代表线上转化或真实收益。'}
    evidence = [
        {'id': 'E01', 'title': '邻里优选饮品活动记录', 'publisher': '模拟竞品活动档案', 'published': '2026-11-16', 'expires': '2026-11-30', 'group': 'fixture-a', 'kind': '价格观察', 'text': '鲜萃燕麦饮250ml活动单价11.35元；冷萃咖啡250ml活动单价13.99元。活动限指定门店，非会员可参与。', 'synthetic': True},
        {'id': 'E02', 'title': '标准商品价格采样记录', 'publisher': '模拟采样档案', 'published': '2026-11-18', 'expires': '2026-11-30', 'group': 'fixture-b', 'kind': '价格观察', 'text': '同规格单件商品价格按周采样，价格不包含多件满减、运费及平台补贴；仅适用于记录的渠道与时间。', 'synthetic': True},
        {'id': 'E03', 'title': '东区门店缺货记录', 'publisher': '模拟库存快照', 'published': '2026-11-22', 'expires': None, 'group': 'fixture-c', 'kind': '内部记录', 'text': '最近28天，东区三店SKU-0001与SKU-0003存在重复零库存记录。缺货与转化率下降同期出现，尚不能据此单独认定因果。', 'synthetic': True},
        {'id': 'E04', 'title': '旧版饮料促销海报', 'publisher': '模拟历史营销档案', 'published': '2026-08-01', 'expires': '2026-08-31', 'group': 'fixture-a', 'kind': '历史活动', 'text': '燕麦饮第二件半价，仅限8月指定门店。当前已过期，不能作为11月有效促销依据。', 'synthetic': True},
        {'id': 'E05', 'title': '饮品活动信息转载', 'publisher': '模拟转载页面', 'published': '2026-11-17', 'expires': '2026-11-30', 'group': 'fixture-a', 'kind': '转载', 'text': '转载E01活动信息。与E01为同一原始信息，不构成独立交叉验证。', 'synthetic': True},
    ]
    data = {'meta': {'seed': SEED, 'asOf': str(TODAY), 'start': str(START), 'synthetic': True, 'currency': 'CNY', 'moneyUnit': '分', 'version': 1}, 'stores': stores, 'products': products, 'members': members, 'orders': orders, 'traffic': traffic, 'inventory': inventory, 'prices': prices, 'evidence': evidence, 'model': model, 'evaluation': evaluation}
    (DIST/'data.js').write_text('globalThis.RETAIL_DATA='+json.dumps(data, ensure_ascii=False, separators=(',', ':'))+';\n', encoding='utf-8')
    write_json(ROOT/'docs'/'evaluation.json', evaluation)
    dbpath = ROOT/'retail.sqlite'
    db = sqlite3.connect(dbpath)
    db.executescript('DROP TABLE IF EXISTS order_items; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS traffic; DROP TABLE IF EXISTS inventory; DROP TABLE IF EXISTS members; DROP TABLE IF EXISTS stores;')
    db.executescript('''CREATE TABLE stores(id INTEGER PRIMARY KEY,name TEXT,region TEXT,area REAL,staff INTEGER);
CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT,name TEXT,category TEXT,price_cents INTEGER,cost_cents INTEGER);
CREATE TABLE members(id INTEGER PRIMARY KEY,name TEXT,favorite TEXT,joined TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,date TEXT,store_id INTEGER REFERENCES stores(id),member_id INTEGER REFERENCES members(id));
CREATE TABLE order_items(order_id INTEGER REFERENCES orders(id),product_id INTEGER REFERENCES products(id),quantity INTEGER,unit_price_cents INTEGER,return_quantity INTEGER);
CREATE TABLE traffic(date TEXT,store_id INTEGER,visitors INTEGER);
CREATE TABLE inventory(date TEXT,store_id INTEGER,product_id INTEGER,quantity INTEGER);
CREATE INDEX idx_orders_date_store ON orders(date,store_id);
CREATE VIEW net_sales AS SELECT o.*,i.product_id,(i.quantity-i.return_quantity)*i.unit_price_cents AS net_sales_cents,(i.quantity-i.return_quantity)*p.cost_cents AS cogs_cents FROM orders o JOIN order_items i ON o.id=i.order_id JOIN products p ON i.product_id=p.id;
''')
    db.executemany('INSERT INTO stores VALUES(?,?,?,?,?)', [(s['id'],s['name'],s['region'],s['area'],s['staff']) for s in stores])
    db.executemany('INSERT INTO products VALUES(?,?,?,?,?,?)', [(p['id'],p['sku'],p['name'],p['category'],p['price'],p['cost']) for p in products])
    db.executemany('INSERT INTO members VALUES(?,?,?,?)',[(m['id'],m['name'],m['favorite'],m['joined']) for m in members])
    db.executemany('INSERT INTO orders VALUES(?,?,?,?)',[(o['id'],o['date'],o['store'],o['member']) for o in orders])
    db.executemany('INSERT INTO order_items VALUES(?,?,?,?,?)',[(o['id'],*i) for o in orders for i in o['items']])
    db.executemany('INSERT INTO traffic VALUES(?,?,?)',[(t['date'],t['store'],t['visitors']) for t in traffic])
    db.executemany('INSERT INTO inventory VALUES(?,?,?,?)',inventory)
    db.commit()
    totals = db.execute('SELECT SUM(net_sales_cents),SUM(cogs_cents) FROM net_sales').fetchone()
    db.close()
    print(json.dumps({'orders':len(orders),'items':sum(len(o['items']) for o in orders),'sales_cents':totals[0],'cogs_cents':totals[1],'evaluation':evaluation},ensure_ascii=False))

if __name__ == '__main__':
    main()
