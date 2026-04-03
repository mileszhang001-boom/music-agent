#!/usr/bin/env python3
"""喜马拉雅接口联调测试脚本 — Step 1: 游客登录 + Step 2: 主动推荐"""

import requests, hashlib, hmac, base64, time, random, string, json, sys

# ========== 凭证 ==========
APP_KEY = "3d17306243e47f16d21dd438f9d5e5aa"
APP_SECRET = "eed1faaec95bc415da5048a6b2190a4d"
DEVICE_ID = "xiaomi_car_test_001"  # 测试设备ID

# ========== 签名算法 ==========
def gen_sig(params: dict) -> str:
    """HMAC-SHA1 + MD5 签名 (6步)"""
    # Step 1-2: 按key字典序排序, value不做URL encode
    sorted_str = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()) if k != "sig")
    # Step 3: Base64
    b64 = base64.b64encode(sorted_str.encode("utf-8"))
    # Step 4-5: HMAC-SHA1
    sha1_bytes = hmac.new(APP_SECRET.encode("utf-8"), b64, hashlib.sha1).digest()
    # Step 6: MD5
    return hashlib.md5(sha1_bytes).hexdigest()

def random_nonce(length=16):
    return "".join(random.choices(string.ascii_letters + string.digits, k=length))

# ========== Step 1: 游客登录 ==========
def guest_login():
    print("=" * 60)
    print("Step 1: 游客登录 → access_token")
    print("=" * 60)
    
    params = {
        "client_id": APP_KEY,
        "device_id": DEVICE_ID,
        "grant_type": "client_credentials",
        "nonce": random_nonce(),
        "timestamp": str(int(time.time() * 1000)),
    }
    params["sig"] = gen_sig(params)
    
    print(f"POST https://api.ximalaya.com/oauth2/secure_access_token")
    print(f"Params: { {k: v[:20]+'...' if len(str(v))>20 else v for k, v in params.items()} }")
    
    try:
        resp = requests.post(
            "https://api.ximalaya.com/oauth2/secure_access_token",
            data=params,
            timeout=10
        )
        print(f"HTTP {resp.status_code}")
        print(f"Response: {resp.text[:500]}")
        
        if resp.status_code == 200:
            data = resp.json()
            if "access_token" in data:
                print(f"\n✅ 游客登录成功!")
                print(f"   access_token: {data['access_token']}")
                print(f"   expires_in: {data.get('expires_in', 'N/A')} 秒")
                return data["access_token"]
            else:
                print(f"\n❌ 响应无 access_token: {data}")
                return None
        else:
            print(f"\n❌ HTTP 错误: {resp.status_code}")
            return None
    except Exception as e:
        print(f"\n❌ 请求异常: {e}")
        return None

# ========== Step 2: 主动推荐 (非流式) ==========
def proactive_recommend(access_token):
    print("\n" + "=" * 60)
    print("Step 2: 主动推荐 (非流式)")
    print("=" * 60)
    
    context = json.dumps({
        "env": {
            "current_time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "weather": "晴天"
        },
        "scene": "通勤",
        "cabin": {
            "occupant_summary": "仅主驾",
            "occupants": [{"emotion": "平静", "age": 28, "gender": "男", "position": "主驾"}]
        },
        "vehicle": {
            "nav_total_duration_min": 30,
            "nav_remaining_duration_min": 20,
            "traffic_status": "畅通"
        }
    }, ensure_ascii=False)
    
    params = {
        "app_key": APP_KEY,
        "device_id": DEVICE_ID,
        "device_id_type": "Android_ID",
        "pack_id": "com.xiaomi.car.agent",
        "client_os_type": "2",
        "access_token": access_token,
        "nonce": random_nonce(),
        "timestamp": str(int(time.time() * 1000)),
        "context": context,
    }
    params["sig"] = gen_sig(params)
    
    url = "https://iovapi.ximalaya.com/iov-voice-service/iov-chat/proactive-recommend"
    print(f"POST {url}")
    
    try:
        resp = requests.post(
            url,
            data=params,
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
            timeout=15
        )
        print(f"HTTP {resp.status_code}")
        
        try:
            data = resp.json()
            print(f"Response (pretty):\n{json.dumps(data, ensure_ascii=False, indent=2)[:2000]}")
        except:
            print(f"Response (raw): {resp.text[:2000]}")
            
        return resp.status_code == 200
    except Exception as e:
        print(f"\n❌ 请求异常: {e}")
        return False

# ========== Step 3: AI Agent text/query (SSE) ==========
def text_query(access_token, query="推荐一些放松的内容"):
    print("\n" + "=" * 60)
    print(f"Step 3: AI Agent text/query — '{query}'")
    print("=" * 60)
    
    context = json.dumps({
        "app": {
            "params": {
                "outputMode": "text",
                "player": {"status": "Idle"},
                "content": {"paidFilter": True}
            }
        }
    }, ensure_ascii=False)
    
    params = {
        "app_key": APP_KEY,
        "device_id": DEVICE_ID,
        "device_id_type": "Android_ID",
        "pack_id": "com.xiaomi.car.agent",
        "client_os_type": "2",
        "access_token": access_token,
        "nonce": random_nonce(),
        "timestamp": str(int(time.time() * 1000)),
        "query": query,
        "mode_type": "2",
        "context": context,
    }
    params["sig"] = gen_sig(params)
    
    url = "https://iovapi.ximalaya.com/iov-voice-service/iov-chat/text/query"
    print(f"POST {url} (SSE)")
    
    try:
        resp = requests.post(
            url,
            data=params,
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
            stream=True,
            timeout=15
        )
        print(f"HTTP {resp.status_code}")
        
        event_count = 0
        for line in resp.iter_lines(decode_unicode=True):
            if line:
                event_count += 1
                if event_count <= 20:  # 只打前20条
                    print(f"  {line[:200]}")
                    
        print(f"\n共收到 {event_count} 条事件")
        return resp.status_code == 200
    except Exception as e:
        print(f"\n❌ 请求异常: {e}")
        return False

# ========== Main ==========
if __name__ == "__main__":
    print("🎧 喜马拉雅接口联调测试")
    print(f"时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"设备ID: {DEVICE_ID}")
    print()
    
    # Step 1
    token = guest_login()
    if not token:
        print("\n🚫 游客登录失败，终止测试")
        sys.exit(1)
    
    # Step 2
    proactive_recommend(token)
    
    # Step 3
    text_query(token, "郭德纲的相声")
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)
