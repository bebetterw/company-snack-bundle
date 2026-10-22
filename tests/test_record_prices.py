import importlib.util,unittest,copy
from pathlib import Path
from datetime import datetime,timezone
spec=importlib.util.spec_from_file_location('prices',Path(__file__).resolve().parents[1]/'scripts/record_prices.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
NOW=datetime.fromisoformat('2026-10-21T12:00:00+09:00')
P={'id':33,'trackingKey':'p33-v1','desc':'250ml · 18개','url':'https://link.coupang.com/a/example','trackingSourceUrl':'https://www.coupang.com/vp/products/123?itemId=456&vendorItemId=789'}
ROW={'product_id':33,'tracking_key':'p33-v1','checked_at':'2026-10-21T09:00:00+09:00','status':'ok','price':24250,'shipping_fee':0,'basis':'regular','configuration':P['desc'],'source_url':P['url']}
EMPTY={'schemaVersion':1,'observations':[],'checks':[]}
class ImportTests(unittest.TestCase):
 def run_merge(self,rows,history=None,product=None):return mod.merge(copy.deepcopy(history or EMPTY),rows,[product or P],NOW)
 def test_valid_price_and_shipping(self):
  r=self.run_merge([{**ROW,'shipping_fee':'3000'}]);self.assertEqual(r['observations'][0]['shippingFee'],3000);self.assertEqual(len(r['checks']),1)
 def test_idempotent_and_same_day_replacement(self):
  first=self.run_merge([ROW]);self.assertEqual(self.run_merge([ROW],first),first)
  r=self.run_merge([{**ROW,'checked_at':'2026-10-21T10:00:00+09:00','price':23000}],first);self.assertEqual(len(r['observations']),1);self.assertEqual(r['observations'][0]['price'],23000)
 def test_old_report_does_not_overwrite_new(self):
  first=self.run_merge([ROW]);r=self.run_merge([{**ROW,'checked_at':'2026-10-21T08:00:00+09:00','price':1}],first);self.assertEqual(first,r)
 def test_failure_does_not_insert_zero_or_remove_valid_price(self):
  first=self.run_merge([ROW]);r=self.run_merge([{**ROW,'status':'failed','checked_at':'2026-10-21T11:00:00+09:00','price':0}],first);self.assertEqual(r['observations'],first['observations']);self.assertEqual(r['checks'][0]['status'],'failed')
 def test_30_days_are_not_backfilled(self):self.assertEqual(len(self.run_merge([ROW])['observations']),1)
 def test_reject_mismatched_option_and_source(self):
  for patch in [{'tracking_key':'p33-v2'},{'configuration':'250ml · 9개'},{'source_url':'https://www.coupang.com/vp/products/123?itemId=999&vendorItemId=789'},{'source_url':'https://www.coupang.com/vp/products/123?itemId=456&vendorItemId=999'}]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):self.run_merge([{**ROW,**patch}])
 def test_known_product_option_source(self):
  r=self.run_merge([{**ROW,'source_url':P['trackingSourceUrl']}]);self.assertEqual(len(r['observations']),1)
 def test_reject_unknown_product_zero_price_missing_shipping_future_and_naive_time(self):
  for patch in [{'product_id':26},{'price':0},{'price':True},{'price':123.4},{'shipping_fee':None},{'shipping_fee':-1},{'checked_at':'2026-10-21T09:00:00'},{'checked_at':'2026-10-22T09:00:00+09:00'}]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):self.run_merge([{**ROW,**patch}])
 def test_coupon_conditions_required_and_separate(self):
  with self.assertRaises(ValueError):self.run_merge([{**ROW,'basis':'coupon'}])
  r=self.run_merge([ROW,{**ROW,'basis':'coupon','condition_key':'coupon-A','condition_label':'회원 10% 쿠폰'}]);self.assertEqual(len(r['observations']),2)
 def test_batch_is_validated_before_any_changes(self):
  original=copy.deepcopy(EMPTY)
  with self.assertRaises(ValueError):mod.merge(original,[ROW,{**ROW,'product_id':999}],[P],NOW)
  self.assertEqual(original,EMPTY)
 def test_paused_configuration_rejects_success_but_accepts_status(self):
  p={**P,'trackingPaused':True}
  with self.assertRaises(ValueError):self.run_merge([ROW],product=p)
  self.assertEqual(self.run_merge([{**ROW,'status':'configuration_mismatch'}],product=p)['checks'][0]['status'],'configuration_mismatch')
 def test_korea_day_same_key(self):
  r=self.run_merge([ROW,{**ROW,'checked_at':'2026-10-20T16:00:00Z','price':24000}]);self.assertEqual(len(r['observations']),1);self.assertEqual(r['observations'][0]['price'],24250)
class MemoTests(unittest.TestCase):
 def memo(self,**patch):
  row={k:v for k,v in ROW.items() if k not in {'checked_at','shipping_fee'}}
  return {**row,'checked_date':'2026-10-21','source_kind':'memo','price_scope':'item',**patch}
 def merge(self,rows,history=None):return mod.merge(copy.deepcopy(history or EMPTY),rows,[P],NOW)
 def test_date_only_memo_never_claims_a_time_or_free_shipping(self):
  r=self.merge([self.memo()])['observations'][0]
  self.assertEqual(r['checkedDate'],'2026-10-21');self.assertNotIn('checkedAt',r);self.assertIsNone(r['shippingFee']);self.assertEqual(r['sourceKind'],'memo')
 def test_item_price_requires_explicit_scope(self):
  with self.assertRaises(ValueError):self.merge([self.memo(price_scope='total')])
 def test_date_only_source_time_and_future_validated(self):
  for patch in [{'source_kind':'unknown'},{'checked_at':ROW['checked_at']},{'checked_date':'2026-10-22'},{'checked_date':'2026-02-30'},{'checked_date':'20261021'},{'shipping_fee':0}]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):self.merge([self.memo(**patch)])
 def test_idempotent_memo_update_and_precise_checks_win(self):
  first=self.merge([self.memo()]);self.assertEqual(first,self.merge([self.memo()],first))
  newer=self.merge([ROW],first);self.assertEqual(newer['checks'][0]['checkedAt'],ROW['checked_at'])
  self.assertEqual(newer,self.merge([self.memo()],newer))
 def test_total_and_item_same_day_are_separate(self):
  r=self.merge([self.memo(),ROW]);self.assertEqual(len(r['observations']),2);self.assertEqual(len(r['checks']),1)
 def test_report_metadata_survives_future_imports(self):
  history={**EMPTY,'reportSummary':{'date':'2026-10-21'}}
  self.assertEqual(self.merge([self.memo()],history)['reportSummary'],history['reportSummary'])
 def test_date_only_failure_has_no_observation(self):
  r=self.merge([self.memo(status='configuration_mismatch')]);self.assertEqual(r['observations'],[]);self.assertEqual(r['checks'][0]['checkedDate'],'2026-10-21')
if __name__=='__main__':unittest.main()
