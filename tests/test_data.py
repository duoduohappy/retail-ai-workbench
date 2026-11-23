import json
from pathlib import Path
import sqlite3
import unittest

ROOT=Path(__file__).resolve().parents[1]

class DataIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db=sqlite3.connect(ROOT/'retail.sqlite')
        js=(ROOT/'dist'/'data.js').read_text(encoding='utf-8')
        cls.fixture=json.loads(js[len('globalThis.RETAIL_DATA='):-2])

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def test_sqlite_matches_browser_snapshot(self):
        sales,cost=self.db.execute('SELECT SUM(net_sales_cents),SUM(cogs_cents) FROM net_sales').fetchone()
        products={p['id']:p for p in self.fixture['products']}
        self.assertEqual(sales,sum((q-r)*price for o in self.fixture['orders'] for pid,q,price,r in o['items']))
        self.assertEqual(cost,sum((q-r)*products[pid]['cost'] for o in self.fixture['orders'] for pid,q,price,r in o['items']))

    def test_reference_integrity_and_quantity_constraints(self):
        self.assertFalse(self.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertEqual(0,self.db.execute('SELECT COUNT(*) FROM order_items WHERE return_quantity<0 OR return_quantity>quantity OR unit_price_cents<=0').fetchone()[0])

    def test_no_purchase_before_membership(self):
        self.assertEqual(0,self.db.execute('SELECT COUNT(*) FROM orders o JOIN members m ON o.member_id=m.id WHERE o.date<m.joined').fetchone()[0])

    def test_source_evaluation_and_asset_present(self):
        evaluation=json.loads((ROOT/'docs'/'evaluation.json').read_text(encoding='utf-8'))
        self.assertEqual(evaluation,self.fixture['evaluation'])
        self.assertGreater((ROOT/'dist'/'assets'/'retail-demo.mp4').stat().st_size,10000)

if __name__=='__main__':
    unittest.main()
