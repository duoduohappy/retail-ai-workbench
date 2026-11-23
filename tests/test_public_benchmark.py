import datetime as dt
import json
import math
from pathlib import Path
import unittest
from scripts.build_public_benchmark import prepare_row,money_minor,evaluate,metric,score_recommendations

ROOT=Path(__file__).resolve().parents[1]

class PublicBenchmark(unittest.TestCase):
    def test_source_rows_and_exclusions_reconcile(self):
        p=json.loads((ROOT/'dist/assets/public-retail.json').read_text(encoding='utf-8'))
        self.assertEqual(p['quality']['rawRows'],541909)
        self.assertEqual(p['quality']['rawRows'],p['quality']['acceptedRows']+sum(p['quality']['excludedRows'].values()))
        self.assertFalse(p['meta']['synthetic']);self.assertEqual(p['meta']['currency'],'GBP')
        self.assertEqual(p['meta']['license'],'CC BY 4.0')

    def test_amounts_reconcile_across_months_countries_and_cancellations(self):
        p=json.loads((ROOT/'dist/assets/public-retail.json').read_text(encoding='utf-8'))
        self.assertEqual(sum(x['netAmount'] for x in p['monthly']),p['summary']['netAmount'])
        self.assertEqual(sum(x['netAmount'] for x in p['countries']),p['summary']['netAmount'])
        self.assertEqual(p['summary']['positiveSales']-p['summary']['cancellationAmount'],p['summary']['netAmount'])
        self.assertFalse(next(x for x in p['monthly'] if x['month']=='2010-12')['partial'])
        self.assertTrue(next(x for x in p['monthly'] if x['month']=='2011-12')['partial'])

    def test_currency_rounding_and_cancellation_sign(self):
        self.assertEqual(money_minor(2.675),268)
        reason,row=prepare_row(('C123','12345','sample',-3,dt.datetime(2011,1,1),2.5,12345,'UK'))
        self.assertIsNone(reason);self.assertTrue(row['cancelled']);self.assertEqual(row['price'],250)

    def test_missing_customers_remain_available_for_business_aggregation(self):
        reason,row=prepare_row(('123','12345','sample',1,dt.datetime(2011,1,1),2.5,None,'UK'))
        self.assertIsNone(reason);self.assertEqual(row['customer'],'')
        self.assertEqual(prepare_row(('123','12345','x',1,'bad',1,None,'UK'))[0],'invalid_date')
        self.assertEqual(prepare_row(('123','POST','x',1,dt.date(2011,1,1),1,None,'UK'))[0],'nonmerchandise')

    def test_future_only_products_do_not_enter_training_catalog(self):
        baskets=[{'date':'2011-11-01','customer':'a','products':{'A','B'}},{'date':'2011-11-02','customer':'b','products':{'A','C'}},{'date':'2011-11-20','customer':'a','products':{'C','FUTURE_ONLY'}},{'date':'2011-11-20','customer':'new','products':{'B'}}]
        e=evaluate(baskets,top_n=3,k=2)
        self.assertEqual(e['candidateProducts'],3);self.assertEqual(e['trainingInvoices'],2)
        self.assertEqual(e['eligibleUsers'],1)
        self.assertTrue(all('FUTURE_ONLY' not in ex['recommended'] for ex in e['examples']))
        self.assertEqual(e['candidateFutureItemCoverage'],.5)

    def test_ranking_metrics_and_purchase_filter_against_small_example(self):
        result=metric(['A','B'],{'B'},2)
        self.assertEqual(result['hitRate'],1);self.assertEqual(result['recall'],1)
        self.assertAlmostEqual(result['ndcg'],1/math.log2(3))
        ranking=score_recommendations({'A':2},{'A':[('B',.9),('C',.1)]},['A','C','B'],{'A','B','C'},2)
        self.assertEqual(ranking,['B','C'])

    def test_training_count_ties_have_stable_sku_order(self):
        train={'date':'2011-11-01','customer':'a','products':['B','A']}
        test={'date':'2011-11-20','customer':'a','products':['C']}
        other={'date':'2011-11-02','customer':'b','products':['C','D']}
        first=evaluate([train,other,test],top_n=3,k=2)
        second=evaluate([{**train,'products':['A','B']},other,test],top_n=3,k=2)
        self.assertEqual(first,second)
        self.assertTrue(all('D' not in ex['recommended'] for ex in first['examples']))

    def test_evaluation_discloses_candidate_coverage_and_time_windows(self):
        p=json.loads((ROOT/'dist/assets/public-retail.json').read_text(encoding='utf-8'))
        e=p['recommendation'];self.assertLess(e['trainEnd'],e['testStart'])
        self.assertTrue(0<e['candidateFutureItemCoverage']<1)
        self.assertEqual(e['eligibleUsers'],1019)
        for method in ['baseline','personalized']:
            self.assertTrue(all(0<=v<=1 for v in e[method].values()))

if __name__=='__main__':unittest.main()
