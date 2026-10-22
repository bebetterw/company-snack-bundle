#!/usr/bin/env python3
"""Validate Muse's daily checks and atomically merge them into the price history."""
import argparse
import csv
import io
import json
import os
import tempfile
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
STATUSES = {'ok', 'failed', 'out_of_stock', 'configuration_mismatch'}
BASES = {'regular', 'wow', 'coupon', 'wow_coupon'}

def checked_time(value):
    if not isinstance(value,str): raise ValueError('checked_at must include a timezone')
    try: parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError: raise ValueError('Invalid checked_at')
    if parsed.tzinfo is None: raise ValueError('checked_at must include a timezone')
    return parsed

def local_day(record):
    return record.get('checkedDate') or checked_time(record['checkedAt']).astimezone(KST).date().isoformat()

def record_order(record):
    # A date-only memo has no claimed collection time. Precise checks on that day win.
    day=local_day(record)
    return (day, checked_time(record['checkedAt']).timestamp() if record.get('checkedAt') else float('-inf'))

def integer(value,name,minimum):
    if isinstance(value,bool): raise ValueError(f'{name} must be an integer')
    if isinstance(value,int): result=value
    elif isinstance(value,str) and value.isascii() and value.isdigit(): result=int(value)
    else: raise ValueError(f'{name} must be an integer without commas')
    if result<minimum or result>10**9: raise ValueError(f'{name} is outside its valid range')
    return result

def identity(url):
    p=urlparse(url);q=parse_qs(p.query)
    import re
    match=re.search(r'/products/(\d+)',p.path)
    product=(match.group(1) if match else (q.get('pageKey') or q.get('product_id') or [None])[0])
    item=(q.get('itemId') or q.get('item_id') or [None])[0]
    vendor=(q.get('vendorItemId') or [None])[0]
    return product,item,vendor

def source_matches(url,p):
    parsed=urlparse(url)
    if parsed.scheme!='https' or parsed.hostname not in {'link.coupang.com','www.coupang.com','coupang.com','m.coupang.com'}: return False
    if url==p['url']: return True
    expected=identity(p.get('trackingSourceUrl',p['url']))
    if not expected[0]: expected=identity(p.get('imageSourcePage',''))
    observed=identity(url)
    if not all(expected[:2]) or observed[:2]!=expected[:2]: return False
    return not expected[2] or observed[2]==expected[2]

def normalize(row,products,now):
    product_id=integer(row.get('product_id'),'product_id',1)
    if product_id not in products: raise ValueError(f'Unknown product_id: {product_id}')
    p=products[product_id];track=row.get('tracking_key')
    if track!=p['trackingKey']: raise ValueError(f'{product_id}: tracking_key does not match current product configuration')
    if row.get('checked_date'):
        if row.get('checked_at'): raise ValueError('Use checked_at or checked_date, not both')
        if row.get('source_kind')!='memo': raise ValueError('Date-only records require source_kind=memo')
        value=row['checked_date']
        if not isinstance(value,str) or date.fromisoformat(value).isoformat()!=value: raise ValueError('Invalid checked_date')
        if value>now.astimezone(KST).date().isoformat(): raise ValueError('checked_date is in the future')
        time_fields={'checkedDate':value,'sourceKind':'memo'}
    else:
        dt=checked_time(row.get('checked_at'))
        if dt>now+timedelta(minutes=5): raise ValueError(f'{product_id}: checked_at is in the future')
        time_fields={'checkedAt':dt.astimezone(KST).isoformat(timespec='seconds')}
    status=row.get('status')
    if status not in STATUSES: raise ValueError(f'{product_id}: invalid status')
    record={'productId':product_id,'trackingKey':track,**time_fields,'status':status}
    if status!='ok': return record
    if p.get('trackingPaused'): raise ValueError(f'{product_id}: configuration mismatch must be resolved before recording a price')
    if row.get('configuration')!=p['desc']: raise ValueError(f'{product_id}: configuration must exactly match products.json desc')
    price=integer(row.get('price'),'price',1)
    scope=row.get('price_scope') or 'total'
    if scope not in {'total','item'}: raise ValueError('Invalid price_scope')
    if scope=='item':
        if row.get('shipping_fee') not in (None,''): raise ValueError('Item-only records cannot specify a shipping fee')
        shipping=None
    else: shipping=integer(row.get('shipping_fee'),'shipping_fee',0)
    basis=row.get('basis')
    if basis not in BASES: raise ValueError(f'{product_id}: invalid basis')
    key=row.get('condition_key') or basis
    label=row.get('condition_label') or {'regular':'일반가','wow':'와우회원가'}.get(basis,'')
    if basis in {'coupon','wow_coupon'} and (not row.get('condition_key') or not label): raise ValueError(f'{product_id}: coupon prices need condition_key and condition_label')
    if not isinstance(key,str) or len(key)>160 or not isinstance(label,str) or len(label)>200: raise ValueError(f'{product_id}: invalid condition description')
    source=row.get('source_url')
    if not isinstance(source,str) or not source_matches(source,p): raise ValueError(f'{product_id}: source_url must identify this exact product and option')
    record.update(price=price,shippingFee=shipping,basis=basis,conditionKey=key,conditionLabel=label,configuration=p['desc'],sourceUrl=source)
    if scope=='item': record['priceScope']='item'
    return record

def merge(history,rows,products,now=None):
    now=now or datetime.now(timezone.utc)
    if history.get('schemaVersion')!=1: raise ValueError('Unsupported history schema')
    if not rows or len(rows)>500: raise ValueError('Provide between 1 and 500 records')
    lookup={p['id']:p for p in products}
    # Validate the whole report before changing any stored record.
    records=[normalize(row,lookup,now) for row in rows]
    observations={(r['productId'],r['trackingKey'],r['basis'],r['conditionKey'],r.get('priceScope','total'),local_day(r)):r for r in history['observations']}
    checks={(r['productId'],r['trackingKey'],local_day(r)):r for r in history['checks']}
    for r in records:
        ck=(r['productId'],r['trackingKey'],local_day(r))
        check={k:r[k] for k in ['productId','trackingKey','checkedAt','checkedDate','sourceKind','status'] if k in r}
        if ck not in checks or record_order(r)>=record_order(checks[ck]): checks[ck]=check
        if r['status']=='ok':
            key=(r['productId'],r['trackingKey'],r['basis'],r['conditionKey'],r.get('priceScope','total'),local_day(r))
            if key not in observations or record_order(r)>=record_order(observations[key]): observations[key]={k:v for k,v in r.items() if k!='status'}
    order=lambda r:(record_order(r),r['productId'],r.get('conditionKey',''),r.get('priceScope','total'))
    return {**history,'schemaVersion':1,'observations':sorted(observations.values(),key=order),'checks':sorted(checks.values(),key=order)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True,help='UTF-8 JSON or CSV report from Muse')
    parser.add_argument('--history',type=Path,default=ROOT/'price-history.json')
    parser.add_argument('--products',type=Path,default=ROOT/'products.json')
    args=parser.parse_args();path=Path(args.input);text=path.read_text(encoding='utf-8-sig')
    if path.suffix.lower()=='.csv': rows=list(csv.DictReader(io.StringIO(text)))
    else:
        data=json.loads(text);rows=data.get('records') if isinstance(data,dict) else data
    if not isinstance(rows,list): raise ValueError('Expected a records array')
    history=json.loads(args.history.read_text());products=json.loads(args.products.read_text())
    result=merge(history,rows,products)
    args.history.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.price-history-',suffix='.tmp',dir=args.history.parent)
    try:
        with os.fdopen(fd,'w') as f: json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
        os.replace(temp,args.history)
    finally:
        if os.path.exists(temp): os.unlink(temp)
    print(f'Accepted {len(rows)} checks. History: {len(result["observations"])} daily price observations; {len(result["checks"])} daily check results.')

if __name__=='__main__':
    try: main()
    except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e: raise SystemExit(f'Price report rejected: {e}')
