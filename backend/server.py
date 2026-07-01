"""
AI PE Screener 全市场实时数据后端 v3.0
======================================
腾讯财经 API 批量获取全市场 A 股 PE(TTM) + PE(动)。
完全独立于WorkBuddy，浏览器/小程序直接调用。

数据源: 腾讯财经 qt.gtimg.cn (不封IP, 200只/批, ~0.2s/批)
字段: [1]=名称, [3]=价格, [39]=PE(TTM), [52]=PE(动/动态PE)

性能: 5783只全市场, 5线程并行, ~5秒完成

部署:
  pip install fastapi uvicorn
  uvicorn server:app --host 0.0.0.0 --port 8000
"""

import json
import os
import time
import urllib.request
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI PE Screener API v3", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

# ─── 文件路径 ───
DIR = os.path.dirname(__file__)
CODES_FILE = os.path.join(DIR, "valid_codes.json")
CONCEPT_FILE = os.path.join(DIR, "concept_membership.json")

# ─── 腾讯财经工具函数 ───
def to_qq_code(code):
    if code.startswith(("6", "9")): return f"sh{code}"
    elif code.startswith("8"): return f"bj{code}"
    return f"sz{code}"

def parse_qq_response(raw):
    """解析腾讯财经响应，返回 [{code, name, price, peTTM, peDyn, ratio, isLoss}, ...]
    
    包含全部股票（含亏损股）。亏损股 ratio=null, isLoss=true。
    """
    results = []
    for line in raw.strip().split("\n"):
        if "=" not in line or '"' not in line: continue
        if not line.strip().startswith("v_"): continue
        code_part = line.split("=")[0].strip()
        orig_code = code_part[2:][2:]  # "v_sh688110" → "sh688110" → "688110"
        if len(orig_code) != 6: continue
        fields = line.split('"')[1].split("~")
        if len(fields) < 53: continue
        name, price, peTTM_s, peDyn_s = fields[1], fields[3], fields[39], fields[52]
        try:
            peTTM, peDyn = float(peTTM_s), float(peDyn_s)
        except (ValueError, TypeError): continue
        if "退" in name: continue  # 仅排除退市股
        isLoss = (peTTM <= 0 or peDyn <= 0)
        isST = "*ST" in name or name.startswith("ST")
        ratio = round(peTTM / peDyn, 1) if not isLoss else None
        results.append({"code": orig_code, "name": name, "price": price,
                        "peTTM": peTTM, "peDyn": peDyn, "ratio": ratio,
                        "isLoss": isLoss, "isST": isST})
    return results

def fetch_batch_pe(codes_batch):
    """获取一批股票的PE数据"""
    qq_codes = [to_qq_code(c) for c in codes_batch]
    url = f"https://qt.gtimg.cn/q={','.join(qq_codes)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return parse_qq_response(resp.read().decode("gbk", errors="replace"))
    except Exception as e:
        print(f"PE batch failed: {e}")
        return []

# ─── 全市场PE获取 (并行) ───
BATCH_SIZE = 200
MAX_WORKERS = 5

def fetch_all_market_pe(codes):
    """并行批量获取全市场PE数据"""
    batches = [codes[i:i+BATCH_SIZE] for i in range(0, len(codes), BATCH_SIZE)]
    all_stocks = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_batch_pe, b): b for b in batches}
        for f in as_completed(futures):
            all_stocks.extend(f.result())
    return all_stocks

# ─── 代码列表 ───
def load_codes():
    if os.path.exists(CODES_FILE):
        with open(CODES_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("codes", [])
    return []

def load_concept_map():
    if os.path.exists(CONCEPT_FILE):
        with open(CONCEPT_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("stocks", {})
    return {}

# ─── 响应缓存 ───
_cache = {"data": None, "ts": 0, "lock": threading.Lock()}
CACHE_TTL = 300  # 5分钟

def get_cached_or_fetch():
    """缓存优先: 5分钟内返回缓存，否则重新拉取。返回全部有效PE数据，不做任何筛选。"""
    now = time.time()
    with _cache["lock"]:
        if _cache["data"] and (now - _cache["ts"]) < CACHE_TTL:
            return _build_response(_cache["data"])

    # 重新拉取
    codes = load_codes()
    if not codes:
        return _empty("无股票代码数据")

    t0 = time.time()
    concept_map = load_concept_map()
    stocks = fetch_all_market_pe(codes)
    elapsed = time.time() - t0

    # 标注概念
    ai_concepts_set = set()
    for s in stocks:
        info = concept_map.get(s["code"], {})
        s["sectors"] = info.get("sectors", [])
        s["isAiConcept"] = info.get("isAiConcept", False)
        for sec in s["sectors"]:
            ai_concepts_set.add(sec)

    meta_base = {
        "totalMarketStocks": len(codes),
        "peAvailable": len(stocks),
        "aiSectors": sorted(ai_concepts_set),
        "hotSectors": sorted(ai_concepts_set),
        "elapsed": round(elapsed, 1),
        "source": "qq_finance_realtime",
        "updated": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    with _cache["lock"]:
        _cache["data"] = (stocks, meta_base)
        _cache["ts"] = now

    return _build_response((stocks, meta_base))

def _build_response(cached):
    """构建响应: 返回全部有效PE数据，前端负责所有筛选/排序"""
    stocks, meta_base = cached
    # 按比值降序排列（盈利股在前，亏损股在末尾）
    stocks_sorted = sorted(stocks, key=lambda x: (x["ratio"] is None, -(x["ratio"] or 0)))
    return {
        "meta": {**meta_base, "returned": len(stocks_sorted)},
        "data": stocks_sorted,
    }

def _empty(msg=""):
    return {"meta": {}, "data": [], "updated": "", "source": "error", "error": msg}

# ─── API ───
@app.get("/")
async def root():
    return {
        "service": "AI PE Screener API v3 · 全市场",
        "dataSource": "腾讯财经 qt.gtimg.cn (PE_TTM + PE动, 200只/批, 5线程并行)",
        "coverage": "沪深北三交易所全A股 ~5800只",
        "cacheTTL": "5分钟",
        "endpoints": {
            "/api/data": "GET ?baseline=0.8&max=2000",
            "/api/health": "GET",
        },
    }

@app.get("/api/health")
async def health():
    codes = load_codes()
    return {"status": "ok", "time": time.strftime("%Y-%m-%d %H:%M:%S"), "totalCodes": len(codes)}

@app.get("/api/data")
async def get_data():
    """全市场A股实时PE比值数据 — 返回全部，前端做筛选"""
    return get_cached_or_fetch()


# ─── 图表数据代理 (解决浏览器CORS) ───
import httpx

_EM_UT = "f057cbc0c275a4e6f21e6a9c2f2e3e1e"

def _em_secid(code: str) -> str:
    """东方财富 secid: 0=深/创业板, 1=沪/北交所/科创板/B股"""
    if code.startswith(("6", "8", "9")):
        return f"1.{code}"
    return f"0.{code}"

async def _proxy_get(url: str, timeout: float = 10):
    """HTTP GET 代理, 绕过浏览器CORS"""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://quote.eastmoney.com/",
        })
        return resp.json()

@app.get("/api/chart/kline")
async def get_kline(code: str = Query(...), period: str = Query("day", enum=["day","week","month"])):
    """K线数据代理: 浏览器→Render→东财"""
    klt = {"day":101, "week":102, "month":103}[period]
    lmt = 60 if period == "month" else 120
    secid = _em_secid(code)
    url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get"
        f"?secid={secid}&klt={klt}&fqt=0&lmt={lmt}"
        f"&end=20500101&fields1=f1,f2,f3,f4,f5,f6"
        f"&fields2=f51,f52,f53,f54,f55,f56,f57&ut={_EM_UT}"
    )
    jd = await _proxy_get(url)
    if not jd or jd.get("rc") != 0 or not jd.get("data") or not jd["data"].get("klines"):
        raise HTTPException(502, f"东财API错误: rc={jd.get('rc','?')}")
    klines = []
    for line in jd["data"]["klines"]:
        p = line.split(",")
        klines.append({"date":p[0],"open":float(p[1]),"close":float(p[2]),
            "high":float(p[3]),"low":float(p[4]),
            "volume":int(p[5]) if p[5] else 0,
            "amount":float(p[6]) if len(p)>6 and p[6] else 0})
    return {"code":code,"period":period,"data":klines}

@app.get("/api/chart/minute")
async def get_minute(code: str = Query(...)):
    """分时数据代理: 浏览器→Render→东财"""
    secid = _em_secid(code)
    url = (
        f"https://push2.eastmoney.com/api/qt/stock/trends2/get"
        f"?secid={secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11"
        f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58&lmt=240&ut={_EM_UT}"
    )
    jd = await _proxy_get(url)
    if not jd or jd.get("rc") != 0 or not jd.get("data") or not jd["data"].get("trends"):
        raise HTTPException(502, f"东财API错误: rc={jd.get('rc','?')}")
    trends = []
    for line in jd["data"]["trends"]:
        p = line.split(",")
        trends.append({"time":p[0],"price":float(p[2]) if len(p)>2 else 0,
            "avg":float(p[6]) if len(p)>6 else 0,
            "volume":int(p[7]) if len(p)>7 else 0})
    return {"code":code,"data":trends}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
