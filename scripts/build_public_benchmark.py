"""Reproducible analysis of the real UCI Online Retail dataset (CC BY 4.0).

Runtime dependency for rebuilding only: openpyxl==3.1.5. The deployed app reads
the prebuilt aggregate JSON and requires no Excel library or raw customer IDs.
"""
import argparse
import collections
import calendar
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
import itertools
import json
import math
from pathlib import Path
import random
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://archive.ics.uci.edu/static/public/352/online+retail.zip'
PAGE = 'https://archive.ics.uci.edu/dataset/352/online+retail'
EXPECTED_SHA256 = 'f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b'
CUTOFF = '2011-11-09'
EXCLUDE_CODES = {'POST','DOT','M','D','C2','BANK CHARGES','AMAZONFEE','CRUK','PADS','S'}

def money_minor(value):
    return int((Decimal(str(value))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))

def prepare_row(row):
    """Return an exclusive rejection reason, or a normalized real transaction."""
    invoice, sku, description, quantity, timestamp, price, customer, country = row
    if not invoice or sku is None or timestamp is None or price is None or quantity is None:
        return 'missing_required', None
    if not isinstance(timestamp,(dt.date,dt.datetime)):
        return 'invalid_date', None
    try:
        qty=int(quantity);minor=money_minor(price)
    except (ValueError,TypeError,ArithmeticError):
        return 'invalid_numeric',None
    if qty != quantity:
        return 'invalid_numeric',None
    if minor<=0:
        return 'nonpositive_price',None
    sku=str(sku).strip()
    if sku.upper() in EXCLUDE_CODES:
        return 'nonmerchandise',None
    cancelled=str(invoice).upper().startswith('C') or qty<0
    if qty==0:
        return 'zero_quantity',None
    return None, {'invoice':str(invoice),'sku':sku,'name':str(description or sku).strip(),'quantity':qty,'price':minor,'date':timestamp.isoformat()[:10],'customer':str(int(customer)) if isinstance(customer,(int,float)) else str(customer or '').strip(),'country':str(country or 'Unknown'),'cancelled':cancelled}

def score_recommendations(history,pairs,popular,catalog,k=10):
    scores=collections.defaultdict(float)
    for a,strength in history.items():
        for b,similarity in pairs.get(a,[]):
            if b not in history and b in catalog:
                scores[b]+=similarity*math.log1p(strength)
    ranked=sorted(scores,key=lambda p:(-scores[p],p))
    ranked += [p for p in popular if p not in history and p not in scores]
    return ranked[:k]

def metric(ranking,truth,k):
    hits=len(set(ranking)&truth)
    dcg=sum(1/math.log2(i+2) for i,p in enumerate(ranking) if p in truth)
    ideal=sum(1/math.log2(i+2) for i in range(min(k,len(truth))))
    return {'hitRate':float(hits>0),'recall':hits/len(truth),'ndcg':dcg/ideal if ideal else 0}

def evaluate(baskets,top_n=500,k=10):
    training=[b for b in baskets if b['date']<=CUTOFF]
    test=[b for b in baskets if b['date']>CUTOFF]
    counts=collections.Counter(p for b in training for p in b['products'])
    # Candidate space is selected using training data only, never future sales.
    # Explicit SKU tie-breaking keeps the candidate set stable across Python
    # hash seeds and platforms when training invoice counts are equal.
    popular=sorted(counts,key=lambda p:(-counts[p],p))[:top_n]
    catalog=set(popular)
    users=collections.defaultdict(collections.Counter)
    all_history=collections.defaultdict(set)
    frequency=collections.Counter()
    cooccurrence=collections.Counter()
    skipped=0
    for b in training:
        all_history[b['customer']].update(b['products'])
        products=sorted(set(b['products'])&catalog)
        for p in products:
            users[b['customer']][p]+=1
        # Wholesale baskets with >100 candidate SKUs are excluded from pair
        # learning; all quantities remain included in business aggregates.
        if len(products)>100:
            skipped+=1
            continue
        frequency.update(products)
        cooccurrence.update(itertools.combinations(products,2))
    sims=collections.defaultdict(list)
    for (a,b),n in cooccurrence.items():
        score=n/math.sqrt(frequency[a]*frequency[b])
        sims[a].append((b,score));sims[b].append((a,score))
    future=collections.defaultdict(set)
    for b in test:
        future[b['customer']].update(b['products'])
    per_user=[]
    candidate_future=all_future=0
    for uid,items in future.items():
        if uid not in users:
            continue
        unseen=items-all_history[uid]
        all_future+=len(unseen)
        truth=unseen&catalog
        candidate_future+=len(truth)
        if not truth:
            continue
        rec=score_recommendations(users[uid],sims,popular,catalog,k)
        baseline=[p for p in popular if p not in users[uid]][:k]
        per_user.append((metric(rec,truth,k),metric(baseline,truth,k)))
    def average(which):
        return {m:round(sum(row[which][m] for row in per_user)/len(per_user),6) if per_user else None for m in ['hitRate','recall','ndcg']}
    diffs=[row[0]['ndcg']-row[1]['ndcg'] for row in per_user]
    random.seed(20261123)
    bootstrap=sorted(sum(random.choices(diffs,k=len(diffs)))/len(diffs) for _ in range(1000)) if diffs else []
    ci=[round(bootstrap[24],6),round(bootstrap[974],6)] if bootstrap else [None,None]
    examples=[]
    for uid in sorted(future):
        if uid not in users:
            continue
        rec=score_recommendations(users[uid],sims,popular,catalog,k)
        truth=(future[uid]-set(users[uid]))&catalog
        if not truth:
            continue
        # Export a display digest instead of a raw ID; this is not a claim of
        # privacy-preserving anonymization of the public source.
        examples.append({'customer':'公开会员-'+hashlib.sha256(('uci-demo:'+uid).encode()).hexdigest()[:8],'history':users[uid].most_common(5),'recommended':rec,'heldOut':sorted(truth),'hits':sorted(set(rec)&truth)})
        if len(examples)==5:
            break
    return {'trainEnd':CUTOFF,'testStart':'2011-11-10','testEnd':max((b['date'] for b in test),default=None),'trainingInvoices':len(training),'testInvoices':len(test),'eligibleUsers':len(per_user),'candidateProducts':len(catalog),'k':k,'personalized':average(0),'baseline':average(1),'pairedNdcgDifference95CI':ci,'bootstrapResamples':1000,'candidateFutureItemCoverage':round(candidate_future/all_future,6) if all_future else None,'skippedLargeBasketsForPairs':skipped,'examples':examples,'scope':'UK positive purchase invoices with a CustomerID; candidate catalog is top products by training invoice frequency; both methods exclude training purchases. Metrics are macro averaged over warm users with eligible held-out items.','limits':['This is a historical single-retailer offline benchmark, not online uplift.','Returns/cancellations are reported separately and excluded from positive-purchase recommendation evaluation.','No product cost, inventory, impression or promotion assignment is available.','Users whose future unseen items fall outside the training top catalog do not enter metric denominators; coverage is shown explicitly.','Bootstrap intervals describe variability across evaluated users, not causal business effects.']}

def build(archive,top_n=500):
    from openpyxl import load_workbook
    archive=Path(archive)
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest!=EXPECTED_SHA256:
        raise ValueError('UCI archive hash differs from the reviewed source; inspect the new file before rebuilding')
    with zipfile.ZipFile(archive) as z:
        names=[n for n in z.namelist() if n.endswith('.xlsx')]
        if len(names)!=1:
            raise ValueError('Expected exactly one source workbook')
        book=load_workbook(io.BytesIO(z.read(names[0])),read_only=True,data_only=True)
    sheet=book.active
    iterator=sheet.iter_rows(values_only=True)
    headers=next(iterator)
    if list(headers)!=['InvoiceNo','StockCode','Description','Quantity','InvoiceDate','UnitPrice','CustomerID','Country']:
        raise ValueError('Unexpected source schema')
    raw=0;rejected=collections.Counter();monthly=collections.defaultdict(lambda:{'positiveSales':0,'cancellationAmount':0,'rows':0});countries=collections.defaultdict(lambda:{'positiveSales':0,'cancellationAmount':0,'rows':0});catalog={};baskets={};positive_invoices=set();cancelled_invoices=set();customers=set();positive_sales=cancel_amount=positive_units=0;missing_customer=0;min_date=max_date=None
    for source in iterator:
        raw+=1
        reason,row=prepare_row(source)
        if reason:
            rejected[reason]+=1
            continue
        d=row['date'];min_date=min(min_date,d) if min_date else d;max_date=max(max_date,d) if max_date else d
        amount=abs(row['quantity'])*row['price'];month=d[:7]
        group=monthly[month];country=countries[row['country']];group['rows']+=1;country['rows']+=1
        catalog[row['sku']]=row['name']
        if not row['customer']:
            missing_customer+=1
        else:
            customers.add(row['customer'])
        if row['cancelled']:
            cancel_amount+=amount;cancelled_invoices.add(row['invoice']);group['cancellationAmount']+=amount;country['cancellationAmount']+=amount
        else:
            positive_sales+=amount;positive_units+=row['quantity'];positive_invoices.add(row['invoice']);group['positiveSales']+=amount;country['positiveSales']+=amount
            if row['country']=='United Kingdom' and row['customer']:
                key=(row['invoice'],row['customer'])
                b=baskets.setdefault(key,{'date':d,'customer':row['customer'],'products':set()})
                b['products'].add(row['sku'])
    book.close()
    accepted=raw-sum(rejected.values())
    first=dt.date.fromisoformat(min_date);last=dt.date.fromisoformat(max_date)
    partial_months=set()
    if first.day>1:partial_months.add(min_date[:7])
    if last.day<calendar.monthrange(last.year,last.month)[1]:partial_months.add(max_date[:7])
    monthly_rows=[{'month':m,**x,'netAmount':x['positiveSales']-x['cancellationAmount'],'partial':m in partial_months} for m,x in sorted(monthly.items())]
    country_rows=[{'country':c,**x,'netAmount':x['positiveSales']-x['cancellationAmount']} for c,x in sorted(countries.items(),key=lambda t:-(t[1]['positiveSales']-t[1]['cancellationAmount']))]
    benchmark=evaluate(list(baskets.values()),top_n)
    referenced=set(p for e in benchmark['examples'] for p in list(e['recommended'])+list(e['heldOut'])+[h[0] for h in e['history']])
    output={'meta':{'name':'UCI Online Retail','sourceUrl':PAGE,'downloadUrl':URL,'license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','attribution':'Chen, D. (2015). Online Retail [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33','archiveSha256':digest,'generatedOn':'2026-11-23','start':min_date,'end':max_date,'currency':'GBP','moneyUnit':'pence','historical':True,'synthetic':False},'quality':{'rawRows':raw,'acceptedRows':accepted,'excludedRows':dict(rejected),'acceptedRowsMissingCustomerId':missing_customer,'positiveInvoices':len(positive_invoices),'cancellationInvoices':len(cancelled_invoices),'distinctCustomerIds':len(customers),'products':len(catalog)},'summary':{'positiveSales':positive_sales,'cancellationAmount':cancel_amount,'netAmount':positive_sales-cancel_amount,'positiveUnits':positive_units},'monthly':monthly_rows,'countries':country_rows,'recommendation':benchmark,'productNames':{p:catalog[p] for p in sorted(referenced)},'methodology':{'rowFilter':'Exclude missing required values, invalid numerics/dates, non-positive prices, zero quantities and listed non-merchandise StockCodes. Source duplicate rows are retained; the dataset does not identify them as accidental duplicates.','excludedStockCodes':sorted(EXCLUDE_CODES),'amounts':'Quantity × unit price, integer pence after per-unit decimal rounding. Cancellation amounts recorded on their own invoice dates; not matched back to original purchases.','missingCustomer':'Included in business aggregates but excluded from user-level recommendation evaluation.','knownLimits':'No margin/cost, inventory, store traffic, pricing treatment or current market information. December 2011 is incomplete; do not compare it as a full month.'}}
    path=ROOT/'dist'/'assets'/'public-retail.json'
    path.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'dist'/'public-data.js').write_text('globalThis.PUBLIC_RETAIL='+json.dumps(output,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    (ROOT/'docs'/'public-benchmark.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'quality':output['quality'],'summary':output['summary'],'evaluation':{k:v for k,v in benchmark.items() if k!='examples'}},ensure_ascii=False))
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--archive',type=Path);parser.add_argument('--download',action='store_true');parser.add_argument('--top-products',type=int,default=500);args=parser.parse_args()
    archive=args.archive
    if args.download:
        archive=archive or Path('work/online-retail.zip');archive.parent.mkdir(parents=True,exist_ok=True)
        urllib.request.urlretrieve(URL,archive)
    if not archive:
        parser.error('provide --archive or --download')
    build(archive,args.top_products)
