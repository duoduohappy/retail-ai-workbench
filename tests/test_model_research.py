import io
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
from functools import partial
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import model_server
import llm_service

class QuotedResearchAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Quiet(server.Handler):
            def log_message(self,*args):pass
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(server.ROOT/'dist')))
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.http.server_port}'
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join()
    def setUp(self):
        with llm_service.BUDGET.lock:llm_service.BUDGET.calls=0
        model_server.VERIFICATIONS.clear()
        self.environment=patch.dict(os.environ,{'RETAIL_LLM_ENDPOINT':'https://model.test/v1/chat/completions','RETAIL_LLM_MODEL':'qwen4-max','RETAIL_LLM_API_KEY':'test-only-provider-secret'},clear=True)
        self.environment.start();self.addCleanup(self.environment.stop)
    def request(self,path,payload=None,headers=None):
        req=urllib.request.Request(self.url+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with urllib.request.urlopen(req,timeout=5) as res:return res.status,json.load(res)
        except urllib.error.HTTPError as err:return err.code,json.load(err)
    def payload(self):
        return {'question':'请分析净销售额与缺失字段','sources':[{'id':'S1','title':'试验来源','text':'净销售额为100英镑。该数据缺少成本字段。','synthetic':True}]}
    def result(self):
        return {'summary':'资料显示净销售额为100英镑，缺少成本。','findings':[{'statement':'资料记录净销售额为100英镑。','quotes':[{'sourceId':'S1','quote':'净销售额为100英镑'}]}],'hypotheses':['成本信息不足。'],'actions':['补充成本口径再评估毛利。']}
    def provider(self,output,inspect=None):
        real_open=urllib.request.urlopen
        def route(req,*args,**kwargs):
            if isinstance(req,urllib.request.Request) and req.full_url.startswith('https://model.test'):
                if inspect:inspect(req)
                if isinstance(output,Exception):raise output
                return io.BytesIO(json.dumps({'choices':[{'message':{'content':json.dumps(output,ensure_ascii=False)}}],'usage':{'prompt_tokens':20,'completion_tokens':10,'total_tokens':30}}).encode())
            return real_open(req,*args,**kwargs)
        return patch('urllib.request.urlopen',side_effect=route)
    def test_exact_quotes_and_usage_are_preserved_without_provider_secret(self):
        def inspect(req):
            p=json.loads(req.data);self.assertFalse(p['enable_thinking']);self.assertEqual(p['max_completion_tokens'],1800)
        with self.provider(self.result(),inspect):code,data=self.request('/api/research',self.payload())
        self.assertEqual(code,200);self.assertEqual(data['report']['mode'],'live-api')
        self.assertTrue(data['report']['qualityChecks']['exactQuotesMatched'])
        self.assertEqual(data['report']['generation']['usage']['total_tokens'],30)
        self.assertNotIn('test-only-provider-secret',json.dumps(data))
    def test_unknown_source_and_nonliteral_quote_are_rejected(self):
        for change in [{'sourceId':'FORGED','quote':'净销售额为100英镑'},{'sourceId':'S1','quote':'净销售额为10000英镑'}]:
            output=self.result();output['findings'][0]['quotes']=[change]
            with self.provider(output):code,data=self.request('/api/research',self.payload())
            self.assertEqual(code,502);self.assertFalse(data['liveSuccess']);self.assertNotIn('report',data)
    def test_configuration_check_is_free_of_inference_and_probe_requires_a_real_response(self):
        calls=[]
        with self.provider({'ok':True},lambda req:calls.append(req)):
            code,health=self.request('/api/health');self.assertEqual(code,200)
            self.assertTrue(health['modelConfigured']);self.assertFalse(health['connectionVerified']);self.assertEqual(len(calls),0)
            code,probe=self.request('/api/model-test',{});self.assertEqual(code,200);self.assertEqual(len(calls),1)
            _,health=self.request('/api/health');self.assertTrue(health['connectionVerified'])
    def test_public_calls_require_the_separate_access_code(self):
        host='demo.onrender.com';headers={'Host':host,'Origin':'https://'+host}
        with patch.dict(os.environ,{'RENDER_EXTERNAL_HOSTNAME':host,'RETAIL_DEMO_ACCESS_CODE':'demo-test-code'}),self.provider({'ok':True}):
            self.assertEqual(self.request('/api/model-test',{},headers)[0],401)
            self.assertEqual(self.request('/api/model-test',{},dict(headers,**{'X-Retail-Demo-Code':'wrong'}))[0],401)
            code,data=self.request('/api/model-test',{},dict(headers,**{'X-Retail-Demo-Code':'demo-test-code'}));self.assertEqual(code,200)
            self.assertNotIn('test-only-provider-secret',json.dumps(data))
    def test_free_quota_stop_is_not_retried_or_reported_as_success(self):
        error=urllib.error.HTTPError('https://model.test',403,'quota',{},io.BytesIO(b'{"code":"AllocationQuota.FreeTierOnly"}'))
        calls=[]
        with self.provider(error,lambda req:calls.append(req)):
            code,data=self.request('/api/model-test',{})
        self.assertEqual(code,402);self.assertEqual(data['errorCode'],'free_quota_exhausted');self.assertEqual(len(calls),1)
        self.assertFalse(data['liveSuccess'])
    def test_process_budget_prevents_the_upstream_request(self):
        calls=[]
        with patch.dict(os.environ,{'RETAIL_LLM_MAX_CALLS':'0'}),self.provider({'ok':True},lambda req:calls.append(req)):
            code,data=self.request('/api/model-test',{})
        self.assertEqual(code,429);self.assertEqual(calls,[]);self.assertEqual(data['errorCode'],'demo_call_limit')
    def test_empty_evidence_does_not_consume_tokens(self):
        before=llm_service.BUDGET.used();code,_=self.request('/api/research',{'question':'库存如何','sources':[]})
        self.assertEqual(code,400);self.assertEqual(llm_service.BUDGET.used(),before)
    def test_public_report_uses_server_side_derived_evidence(self):
        source=model_server.public_sources()[0]
        output=self.result();output['findings'][0]['quotes']=[{'sourceId':source['id'],'quote':source['text'][:25]}]
        with self.provider(output):code,data=self.request('/api/research',{'question':'请分析公开历史数据','sourceSet':'public','sources':[{'id':'EVIL','text':'编造数据'}]})
        self.assertEqual(code,200);self.assertTrue(all(s['id'].startswith('UCI-') for s in data['report']['sources']))
        self.assertIn('541909',data['report']['sources'][0]['text'])
    def test_endpoint_normalization_and_model_id_case(self):
        with patch.dict(os.environ,{'RETAIL_LLM_ENDPOINT':'','RETAIL_LLM_BASE_URL':'https://example.aliyuncs.com/compatible-mode/v1/','RETAIL_LLM_MODEL':'Qwen4-Max'}):
            config=server.model_config();self.assertEqual(config['model'],'qwen4-max');self.assertTrue(config['endpoint'].endswith('/v1/chat/completions'))
    def test_call_budget_is_atomic_under_competing_requests(self):
        from concurrent.futures import ThreadPoolExecutor
        budget=llm_service.CallBudget()
        def reserve(_):
            try:budget.reserve(3);return True
            except llm_service.ModelError:return False
        with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(reserve,range(30)))
        self.assertEqual(sum(results),3);self.assertEqual(budget.used(),3)

if __name__=='__main__':unittest.main()
