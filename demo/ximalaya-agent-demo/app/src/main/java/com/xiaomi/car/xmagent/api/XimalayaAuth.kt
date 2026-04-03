package com.xiaomi.car.xmagent.api

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class XimalayaAuth(private val client: OkHttpClient) {

    companion object {
        private const val TAG = "XimalayaAuth"
        private const val TOKEN_URL = "https://api.ximalaya.com/oauth2/secure_access_token"
        private const val SAFETY_MARGIN_MS = 5 * 60 * 1000L // 提前 5 分钟刷新
    }

    private var cachedToken: String? = null
    private var expiresAt: Long = 0L
    private val mutex = Mutex()

    suspend fun getToken(): String = mutex.withLock {
        val now = System.currentTimeMillis()
        cachedToken?.let { token ->
            if (now < expiresAt - SAFETY_MARGIN_MS) return token
        }
        return fetchToken().also { Log.e(TAG, "Token refreshed") }
    }

    private suspend fun fetchToken(): String = withContext(Dispatchers.IO) {
        val params = mutableMapOf(
            "client_id" to XimalayaSigner.APP_KEY,
            "device_id" to XimalayaSigner.DEVICE_ID,
            "grant_type" to "client_credentials",
            "nonce" to XimalayaSigner.randomNonce(),
            "timestamp" to XimalayaSigner.timestamp(),
        )
        params["sig"] = XimalayaSigner.sign(params)

        val body = FormBody.Builder().apply {
            params.forEach { (k, v) -> add(k, v) }
        }.build()

        val request = Request.Builder().url(TOKEN_URL).post(body).build()
        val response = client.newCall(request).execute()

        if (!response.isSuccessful) {
            throw RuntimeException("Guest login failed: HTTP ${response.code}")
        }

        val bodyStr = response.body?.string()
            ?: throw RuntimeException("Empty body from token endpoint")
        val json = JSONObject(bodyStr)
        val token = json.getString("access_token")
        val expiresIn = json.optLong("expires_in", 7200)

        cachedToken = token
        expiresAt = System.currentTimeMillis() + expiresIn * 1000

        Log.e(TAG, "Got token, expires_in=${expiresIn}s")
        token
    }
}
