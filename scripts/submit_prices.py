#!/usr/bin/env python3
"""Validate a Muse CSV/JSON report and submit it to the GitHub publishing workflow."""
import argparse,csv,io,json,subprocess
from pathlib import Path
from record_prices import ROOT,merge

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',type=Path)
    parser.add_argument('--validate-only',action='store_true')
    args=parser.parse_args();text=args.report.read_text(encoding='utf-8-sig')
    if args.report.suffix.lower()=='.csv':rows=list(csv.DictReader(io.StringIO(text)))
    else:
        data=json.loads(text);rows=data.get('records') if isinstance(data,dict) else data
    if not isinstance(rows,list):raise ValueError('Expected a records array')
    products=json.loads((ROOT/'products.json').read_text())
    merge(json.loads((ROOT/'price-history.json').read_text()),rows,products)
    print(f'Validated {len(rows)} checks.')
    if not args.validate_only:
        payload=json.dumps({'report':json.dumps({'records':rows},ensure_ascii=False)},ensure_ascii=False)
        subprocess.run(['gh','workflow','run','pages.yml','--repo','bebetterw/company-snack-bundle','--json'],input=payload,text=True,check=True)
        print('Submitted to GitHub. The workflow saves accepted history and republishes the site.')
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,TypeError) as e:raise SystemExit(f'Price report rejected: {e}')
