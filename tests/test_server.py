import contextlib
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

class APIIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Quiet(server.Handler):
            def log_message(self,*args):
                pass
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(server.ROOT/'dist')))
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join()

    def draft(self):
        return {'productId':1,'productName':'client-supplied-name','price':1290,'audience':'日常消费','tone':'克制','terms':'演示价格','scenes':[{'time':str(i),'caption':'商品介绍','voice':'欢迎选购'} for i in range(3)]}

    def request(self,data=None,origin=None,path='/api/script',content_type='application/json'):
        headers={'Content-Type':content_type}
        if origin:headers['Origin']=origin
        body=data if isinstance(data,bytes) else json.dumps(data).encode()
        req=urllib.request.Request(self.url+path,data=body,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=5) as res:return res.status,json.load(res)
        except urllib.error.HTTPError as err:
            return err.code,json.load(err)

    def config(self):
        return patch.dict(os.environ,{'RETAIL_LLM_ENDPOINT':'https://model.test/v1/chat/completions','RETAIL_LLM_MODEL':'test-model','RETAIL_LLM_API_KEY':'test-placeholder'},clear=True)

    def fake_provider(self,content):
        return io.BytesIO(json.dumps({'choices':[{'message':{'content':content}}],'usage':{'total_tokens':42}}).encode())

    def test_health_reports_configuration_without_claiming_connection(self):
        with patch.dict(os.environ,{},clear=True),urllib.request.urlopen(self.url+'/api/health') as res:
            data=json.load(res);self.assertFalse(data['modelConfigured']);self.assertFalse(data['connectionVerified'])

    def test_absent_model_returns_explicit_503(self):
        with patch.dict(os.environ,{},clear=True):
            code,data=self.request(self.draft());self.assertEqual(code,503);self.assertIn('模板',data['error'])

    def test_cross_origin_is_rejected(self):
        code,_=self.request(self.draft(),origin='https://untrusted.test');self.assertEqual(code,403)

    def test_render_hostname_accepts_same_origin_without_disabling_host_checks(self):
        with patch.dict(os.environ,{'RENDER_EXTERNAL_HOSTNAME':'retail-test.onrender.com'},clear=True):
            req=urllib.request.Request(self.url+'/api/script',data=json.dumps(self.draft()).encode(),headers={'Content-Type':'application/json','Host':'retail-test.onrender.com','Origin':'https://retail-test.onrender.com'})
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req,timeout=5)
            self.assertEqual(ctx.exception.code,503)
            self.assertIn('模板',json.load(ctx.exception)['error'])

    def test_unknown_cloud_hostname_remains_blocked(self):
        with patch.dict(os.environ,{'RENDER_EXTERNAL_HOSTNAME':'retail-test.onrender.com'},clear=True):
            req=urllib.request.Request(self.url+'/api/script',data=json.dumps(self.draft()).encode(),headers={'Content-Type':'application/json','Host':'unknown.onrender.com'})
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req,timeout=5)
            self.assertEqual(ctx.exception.code,403)

    def test_content_type_and_payload_limits(self):
        self.assertEqual(self.request(self.draft(),content_type='text/plain')[0],415)
        self.assertEqual(self.request(b'x'*12001)[0],413)

    def test_malformed_input_and_unknown_product(self):
        self.assertEqual(self.request(b'{bad')[0],400)
        for change in [{'price':-1},{'price':12.9},{'productId':999999},{'scenes':[]}]:
            draft=self.draft();draft.update(change);self.assertEqual(self.request(draft)[0],400)

    def test_local_ollama_configuration_does_not_require_external_key(self):
        with patch.dict(os.environ,{'RETAIL_LLM_ENDPOINT':'http://127.0.0.1:11434/v1/chat/completions','RETAIL_LLM_MODEL':'qwen3:4b'},clear=True):
            self.assertTrue(server.model_config()['configured'])
        with patch.dict(os.environ,{'RETAIL_LLM_ENDPOINT':'http://public.test/api','RETAIL_LLM_MODEL':'m','RETAIL_LLM_API_KEY':'test'},clear=True):
            self.assertFalse(server.model_config()['configured'])

    def test_valid_model_output_preserves_authoritative_product_and_price(self):
        content=json.dumps({'scenes':[{'caption':'日常选购','voice':'欢迎了解'} for _ in range(3)]})
        real_open=urllib.request.urlopen
        def route(req,*args,**kwargs):
            if isinstance(req,urllib.request.Request) and req.full_url.startswith('https://model.test'):
                sent=json.loads(req.data);self.assertIn('鲜萃燕麦饮',sent['messages'][1]['content']);return self.fake_provider(content)
            return real_open(req,*args,**kwargs)
        with self.config(),patch('server.urllib.request.urlopen',side_effect=route):
            code,data=self.request(self.draft())
        self.assertEqual(code,200);self.assertEqual(data['script']['productName'],'鲜萃燕麦饮');self.assertEqual(data['script']['price'],1290);self.assertEqual(data['script']['mode'],'llm');self.assertEqual(data['usage']['total_tokens'],42);self.assertNotIn('test-placeholder',json.dumps(data))

    def test_provider_invalid_json_is_explicit_failure(self):
        real_open=urllib.request.urlopen
        def route(req,*args,**kwargs):
            if isinstance(req,urllib.request.Request) and req.full_url.startswith('https://model.test'):return self.fake_provider('not-json')
            return real_open(req,*args,**kwargs)
        with self.config(),patch('server.urllib.request.urlopen',side_effect=route):self.assertEqual(self.request(self.draft())[0],502)

    def test_provider_timeout_is_recoverable_without_fake_success(self):
        real_open=urllib.request.urlopen
        def route(req,*args,**kwargs):
            if isinstance(req,urllib.request.Request) and req.full_url.startswith('https://model.test'):raise TimeoutError()
            return real_open(req,*args,**kwargs)
        with self.config(),patch('server.urllib.request.urlopen',side_effect=route):self.assertEqual(self.request(self.draft())[0],504)

if __name__=='__main__':unittest.main()
