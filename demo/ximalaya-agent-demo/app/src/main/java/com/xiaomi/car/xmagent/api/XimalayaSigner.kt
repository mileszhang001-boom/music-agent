package com.xiaomi.car.xmagent.api

import android.util.Base64
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object XimalayaSigner {

    const val APP_KEY = "3d17306243e47f16d21dd438f9d5e5aa"
    const val APP_SECRET = "eed1faaec95bc415da5048a6b2190a4d"
    const val DEVICE_ID = "xiaomi_car_test_001"
    const val PACK_ID = "com.xiaomi.car.agent"

    /**
     * 喜马拉雅签名算法 (6步):
     * 1. 按 key 字典序排序（排除 sig）
     * 2. "&" 拼接（value 不做 URL encode）
     * 3. Base64 编码
     * 4. HMAC-SHA1（key=APP_SECRET）→ byte[]
     * 5. MD5(byte[]) → 32位 hex 小写
     */
    fun sign(params: Map<String, String>): String {
        // Step 1-2: sort by key, join with &
        val sortedStr = params.keys
            .filter { it != "sig" }
            .sorted()
            .joinToString("&") { "$it=${params[it]}" }

        // Step 3: Base64
        val b64 = Base64.encode(sortedStr.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)

        // Step 4: HMAC-SHA1
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(APP_SECRET.toByteArray(Charsets.UTF_8), "HmacSHA1"))
        val sha1Bytes = mac.doFinal(b64)

        // Step 5: MD5
        val md5 = MessageDigest.getInstance("MD5").digest(sha1Bytes)
        return md5.joinToString("") { "%02x".format(it) }
    }

    fun randomNonce(length: Int = 16): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        return (1..length).map { chars.random() }.joinToString("")
    }

    fun timestamp(): String = System.currentTimeMillis().toString()
}
