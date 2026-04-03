package com.xiaomi.car.xmagent.api

import android.util.Log
import com.xiaomi.car.xmagent.model.AgentResponse
import com.xiaomi.car.xmagent.model.PlaylistItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

class XimalayaAgentApi(private val client: OkHttpClient) {

    companion object {
        private const val TAG = "XimalayaAgentApi"
        private const val QUERY_URL =
            "https://iovapi.ximalaya.com/iov-voice-service/iov-chat/text/query"
        private const val RECOMMEND_URL =
            "https://iovapi.ximalaya.com/iov-voice-service/iov-chat/proactive-recommend"

        private const val CONTEXT_JSON =
            """{"app":{"params":{"outputMode":"text","player":{"status":"Idle"},"content":{"paidFilter":true}}}}"""
    }

    fun textQuery(accessToken: String, query: String): Flow<AgentResponse> = flow {
        val params = mutableMapOf(
            "app_key" to XimalayaSigner.APP_KEY,
            "device_id" to XimalayaSigner.DEVICE_ID,
            "device_id_type" to "Android_ID",
            "pack_id" to XimalayaSigner.PACK_ID,
            "client_os_type" to "2",
            "access_token" to accessToken,
            "nonce" to XimalayaSigner.randomNonce(),
            "timestamp" to XimalayaSigner.timestamp(),
            "query" to query,
            "mode_type" to "2",
            "context" to CONTEXT_JSON,
        )
        params["sig"] = XimalayaSigner.sign(params)

        val body = FormBody.Builder().apply {
            params.forEach { (k, v) -> add(k, v) }
        }.build()

        val request = Request.Builder()
            .url(QUERY_URL)
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw RuntimeException("text/query failed: HTTP ${response.code}")
        }

        val responseBody = response.body
            ?: throw RuntimeException("Empty response body from SSE endpoint")
        val source = responseBody.source()
        var currentEvent = ""

        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break

            when {
                line.isEmpty() -> {
                    currentEvent = ""
                }
                line.startsWith("event:") -> {
                    currentEvent = line.removePrefix("event:").trim()
                }
                line.startsWith("data:") && currentEvent == "json" -> {
                    val data = line.removePrefix("data:").trim()
                    val parsed = parseDirective(data)
                    if (parsed != null) emit(parsed)
                }
            }
        }

        response.close()
    }.flowOn(Dispatchers.IO)

    /**
     * 主动推荐接口（非 SSE，普通 JSON 响应）
     * 不需要 query，根据 context 返回个性化推荐
     */
    suspend fun proactiveRecommend(accessToken: String): ProactiveResult =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val context = """{"env":{"current_time":"${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.CHINA).format(java.util.Date())}","weather":"晴天"},"scene":"通勤","cabin":{"occupant_summary":"仅主驾","occupants":[{"emotion":"平静","age":28,"gender":"男","position":"主驾"}]},"vehicle":{"nav_total_duration_min":30,"nav_remaining_duration_min":20,"traffic_status":"畅通"}}"""

            val params = mutableMapOf(
                "app_key" to XimalayaSigner.APP_KEY,
                "device_id" to XimalayaSigner.DEVICE_ID,
                "device_id_type" to "Android_ID",
                "pack_id" to XimalayaSigner.PACK_ID,
                "client_os_type" to "2",
                "access_token" to accessToken,
                "nonce" to XimalayaSigner.randomNonce(),
                "timestamp" to XimalayaSigner.timestamp(),
                "context" to context,
            )
            params["sig"] = XimalayaSigner.sign(params)

            val body = FormBody.Builder().apply {
                params.forEach { (k, v) -> add(k, v) }
            }.build()

            val request = Request.Builder().url(RECOMMEND_URL).post(body).build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                throw RuntimeException("proactive-recommend failed: HTTP ${response.code}")
            }

            val json = JSONObject(response.body?.string()
                ?: throw RuntimeException("Empty body"))

            val welcomeText = json.optString("welcome_text", "")
            val sugArray = json.optJSONArray("suggestions")
            val suggestions = if (sugArray != null) {
                (0 until sugArray.length()).map { sugArray.getString(it) }
            } else emptyList()

            val recList = json.optJSONObject("recommend_list")
            val itemsArray = recList?.optJSONArray("items")
            val items = if (itemsArray != null) {
                (0 until itemsArray.length()).map { i ->
                    PlaylistItem.fromRecommendJson(itemsArray.getJSONObject(i))
                }
            } else emptyList()

            ProactiveResult(welcomeText, items, suggestions)
        }

    data class ProactiveResult(
        val welcomeText: String,
        val items: List<PlaylistItem>,
        val suggestions: List<String>,
    )

    private fun parseDirective(data: String): AgentResponse? {
        return try {
            val json = JSONObject(data)
            val directive = json.optJSONObject("directive") ?: return null
            val name = directive.optString("name", "")
            val payload = directive.optJSONObject("payload") ?: return null

            when (name) {
                "WrittenAnswer" -> {
                    val text = payload.optString("text", "")
                    if (text.isNotEmpty()) AgentResponse.WrittenAnswer(text) else null
                }
                "PlayList" -> {
                    val itemsArray = payload.optJSONArray("items") ?: return null
                    val items = (0 until itemsArray.length()).map { i ->
                        PlaylistItem.fromJson(itemsArray.getJSONObject(i))
                    }
                    if (items.isNotEmpty()) AgentResponse.PlayList(items) else null
                }
                "Suggestions" -> {
                    val sugArray = payload.optJSONArray("suggestions") ?: return null
                    val suggestions = (0 until sugArray.length()).map { sugArray.getString(it) }
                    if (suggestions.isNotEmpty()) AgentResponse.Suggestions(suggestions) else null
                }
                else -> null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse directive: ${e.message}")
            null
        }
    }
}
