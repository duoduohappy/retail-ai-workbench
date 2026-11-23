"""Bounded OpenAI-compatible calls and source-quote validation for the demo.

No fallback is presented as a live model answer. Credentials stay in the server
environment; inference requires an explicit browser action.
"""
import json
import threading
import time
import urllib.request
import urllib.error
import uuid

class ModelError(Exception):
    def __init__(self,status,code,message):
        super().__init__(message);self.status=status;self.code=code

class CallBudget:
    def __init__(self):
        self.lock=threading.Lock();self.calls=0
    def reserve(self,limit):
        with self.lock:
            if self.calls>=limit:
                raise ModelError(429,'demo_call_limit','本进程演示调用次数已达上限；请先核对云端额度。')
            self.calls+=1
    def used(self):
        with self.lock:return self.calls

BUDGET=CallBudget()
CONCURRENCY=threading.BoundedSemaphore(2)

def parse_json(content):
    if not isinstance(content,str):
        raise ModelError(502,'invalid_model_output','模型未返回可用文本。')
    content=content.strip()
    if content.startswith('```') and '\n' in content:
        content=content.split('\n',1)[1].rsplit('```',1)[0]
    try:return json.loads(content)
    except (ValueError,TypeError):
        raise ModelError(502,'invalid_model_output','模型输出不是有效JSON，未将其作为成功结果。')

def invoke(config,messages):
    if not config.get('configured'):
        raise ModelError(503,'model_not_configured','模型服务尚未配置，规则与模板功能仍可使用。')
    if not CONCURRENCY.acquire(blocking=False):
        raise ModelError(429,'model_busy','已有模型任务执行中，请稍后再试。')
    started=time.monotonic();request_id='LLM-'+uuid.uuid4().hex[:12]
    try:
        BUDGET.reserve(config.get('maxCalls',20))
        payload={'model':config['model'],'messages':messages,'temperature':0.3}
        limit=config.get('maxOutputTokens',1400)
        if config['model'].lower().startswith('qwen4'):
            payload['enable_thinking']=False
            payload['max_completion_tokens']=limit
        else:
            payload['max_tokens']=limit
            if config.get('provider')=='aliyun' and config['model'].lower().startswith('qwen3'):
                payload['enable_thinking']=False
        headers={'Content-Type':'application/json'}
        if config.get('key'):headers['Authorization']='Bearer '+config['key']
        req=urllib.request.Request(config['endpoint'],data=json.dumps(payload,ensure_ascii=False).encode('utf-8'),headers=headers,method='POST')
        try:
            with urllib.request.urlopen(req,timeout=config.get('timeout',30)) as res:
                body=json.load(res)
        except urllib.error.HTTPError as err:
            try:
                error=json.loads(err.read(65536));code=str(error.get('code') or error.get('error',{}).get('code') or '')
            except Exception:code=''
            if code=='AllocationQuota.FreeTierOnly':
                raise ModelError(402,'free_quota_exhausted','百炼免费额度已用尽或过期，用完即停已生效；未自动切换模型或付费。')
            if err.code==429:
                raise ModelError(429,'provider_rate_limit','模型平台正在限流，请稍后手动重试。')
            if err.code in [401,403]:
                raise ModelError(502,'provider_authentication','模型平台拒绝调用，请检查同地域API Key、模型权限和剩余额度。')
            raise ModelError(502,'provider_http_error',f'模型平台返回HTTP {err.code}，未生成结果。')
        except TimeoutError:
            raise ModelError(504,'provider_timeout','模型请求超时，请手动重试；未自动重复调用。')
        except (OSError,ValueError):
            raise ModelError(502,'provider_unavailable','模型服务连接或响应异常，原结果保留。')
        try:content=body['choices'][0]['message']['content']
        except (KeyError,TypeError,IndexError):
            raise ModelError(502,'invalid_model_output','模型响应缺少有效内容。')
        raw_usage=body.get('usage')
        usage={k:v for k,v in (raw_usage if isinstance(raw_usage,dict) else {}).items() if k in ['prompt_tokens','completion_tokens','total_tokens'] and type(v) is int and v>=0}
        return content,{'requestId':request_id,'model':config['model'],'mode':'live-api','local':config.get('local',False),'latencyMs':round((time.monotonic()-started)*1000),'usage':usage,'callsUsed':BUDGET.used(),'maxCallsPerProcess':config.get('maxCalls',20),'thinkingEnabled':False if config['model'].lower().startswith('qwen4') else None}
    finally:
        CONCURRENCY.release()

def validate_research_output(output,sources):
    if not isinstance(output,dict) or not isinstance(output.get('summary'),str) or not output['summary'].strip() or len(output['summary'])>3000:
        raise ModelError(502,'invalid_research_output','研究摘要格式不符合要求。')
    source_map={s['id']:s for s in sources}
    findings=output.get('findings')
    if not isinstance(findings,list) or not 1<=len(findings)<=8:
        raise ModelError(502,'invalid_research_output','研究结果需要1至8条有来源的发现。')
    for finding in findings:
        if not isinstance(finding,dict) or not isinstance(finding.get('statement'),str) or not finding['statement'].strip() or len(finding['statement'])>1200:
            raise ModelError(502,'invalid_research_output','研究发现格式无效。')
        quotes=finding.get('quotes')
        if not isinstance(quotes,list) or not 1<=len(quotes)<=4:
            raise ModelError(502,'missing_citation','每条发现都需要原文引用。')
        for q in quotes:
            if not isinstance(q,dict) or q.get('sourceId') not in source_map:
                raise ModelError(502,'unknown_citation','模型引用了未提供的来源，结果未通过检查。')
            quote=q.get('quote')
            if not isinstance(quote,str) or len(quote.strip())<4 or quote not in source_map[q['sourceId']]['text']:
                raise ModelError(502,'quote_mismatch','模型引用与所提供原文不匹配，结果未通过检查。')
    for key in ['hypotheses','actions']:
        if not isinstance(output.get(key),list) or len(output[key])>8 or not all(isinstance(x,str) and 0<len(x)<=1500 for x in output[key]):
            raise ModelError(502,'invalid_research_output','研究假设或行动格式不符合要求。')
    return output
