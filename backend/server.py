"""
AI PE Screener 全市场实时数据后端 v3.0
======================================
腾讯财经 API 批量获取全市场 A 股 PE(TTM) + PE(动)。
完全独立于WorkBuddy，浏览器/小程序直接调用。

数据源: 腾讯财经 qt.gtimg.cn (不封IP, 200只/批, ~0.2s/批)
字段: [1]=名称, [3]=价格, [39]=PE(TTM), [52]=PE(动/动态PE)

性能: 5783只全市场, 5线程并行, ~5秒完成 | K线数据: 腾讯财经 web.ifzq.gtimg.cn

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


# ─── 图表数据代理 (腾讯财经API, 与PE数据同源, Render已验证可用) ───

def _fetch_json(url: str, timeout: int = 10) -> dict:
    """同步 HTTP GET → JSON"""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

@app.get("/api/chart/kline")
def get_kline(code: str = Query(...), period: str = Query("day")):
    """K线数据: Render→腾讯财经 (sync, 与PE同源)"""
    limit = {"day": 120, "week": 120, "month": 60}.get(period, 120)
    qq = to_qq_code(code)
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={qq},{period},,,{limit},qfq"
    try:
        jd = _fetch_json(url)
    except Exception as e:
        raise HTTPException(502, f"K线API请求失败: {e}")
    raw = (jd.get("data") or {}).get(qq, {}).get(f"qfq{period}", [])
    if not raw or not isinstance(raw, list):
        return {"code": code, "period": period, "data": []}
    klines = []
    for row in raw:
        # Tencent format: ["date","open","close","high","low","volume"]
        if not isinstance(row, list) or len(row) < 6: continue
        try:
            klines.append({
                "date": str(row[0]),
                "open": float(row[1]),
                "close": float(row[2]),
                "high": float(row[3]),
                "low": float(row[4]),
                "volume": int(float(row[5])),
                "amount": float(row[6]) if len(row) > 6 and row[6] else 0,
            })
        except (ValueError, TypeError):
            continue
    return {"code": code, "period": period, "data": klines}

@app.get("/api/chart/minute")
def get_minute(code: str = Query(...)):
    """分时数据: Render→腾讯财经"""
    qq = to_qq_code(code)
    url = f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code={qq}"
    try:
        # 腾讯分时API返回 JSONP 格式: "min_data={...}"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8")
        if text.startswith("min_data="):
            text = text[9:]
        jd = json.loads(text)
    except Exception as e:
        raise HTTPException(502, f"分时API请求失败: {e}")
    raw = (jd.get("data") or {}).get(qq, {}).get("data", {}).get("data", [])
    if not raw or not isinstance(raw, list):
        return {"code": code, "data": []}
    trends = []
    prev_vol = 0
    prev_amt = 0
    for row in raw:
        # Tencent format: "HHMM price cumulative_volume cumulative_amount"
        parts = str(row).split() if isinstance(row, str) else []
        if len(parts) < 3: continue
        try:
            t = parts[0]
            time_str = f"{t[:2]}:{t[2:]}" if len(t) >= 4 else t
            cum_vol = int(float(parts[2]))
            cum_amt = float(parts[3]) if len(parts) > 3 else 0
            # Convert cumulative → per-minute volume
            per_vol = cum_vol - prev_vol
            per_amt = cum_amt - prev_amt
            trends.append({
                "time": time_str,
                "price": float(parts[1]),
                "volume": max(0, per_vol),
                "amount": max(0, per_amt),
            })
            prev_vol = cum_vol
            prev_amt = cum_amt
        except (ValueError, IndexError):
            continue
    return {"code": code, "data": trends}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
