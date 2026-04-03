package com.xiaomi.car.xmagent

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xiaomi.car.xmagent.api.XimalayaAgentApi
import com.xiaomi.car.xmagent.api.XimalayaAuth
import com.xiaomi.car.xmagent.model.AgentResponse
import com.xiaomi.car.xmagent.model.PlaylistItem
import com.xiaomi.car.xmagent.model.UiState
import com.xiaomi.car.xmagent.player.MediaSessionPlayer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

class MainViewModel : ViewModel() {

    companion object {
        private const val TAG = "MainViewModel"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS) // SSE can be long
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val auth = XimalayaAuth(client)
    private val agentApi = XimalayaAgentApi(client)

    var player: MediaSessionPlayer? = null

    private val _uiState = MutableStateFlow<UiState>(UiState.Idle)
    val uiState: StateFlow<UiState> = _uiState

    fun query(text: String) {
        if (text.isBlank()) return

        viewModelScope.launch {
            _uiState.value = UiState.Loading

            try {
                val token = auth.getToken()
                Log.e(TAG, "Token acquired, querying: $text")

                var answerText = ""
                var items = listOf<PlaylistItem>()
                var suggestions = listOf<String>()

                agentApi.textQuery(token, text).collect { response ->
                    when (response) {
                        is AgentResponse.WrittenAnswer -> {
                            answerText += response.text
                            Log.e(TAG, "WrittenAnswer: ${response.text.take(100)}")
                        }
                        is AgentResponse.PlayList -> {
                            items = response.items
                            Log.e(TAG, "PlayList: ${response.items.size} items")
                            response.items.take(2).forEach { item ->
                                Log.e(TAG, "  [${item.title}] dur=${item.duration}s mediaId=${item.mediaId.take(80)}")
                            }
                        }
                        is AgentResponse.Suggestions -> {
                            suggestions = response.suggestions
                            Log.e(TAG, "Suggestions: ${response.suggestions}")
                        }
                    }
                    // Update UI progressively
                    _uiState.value = UiState.Success(answerText, items, suggestions)
                }

                // Final state after stream ends
                _uiState.value = UiState.Success(answerText, items, suggestions)
                Log.e(TAG, "Query complete: ${items.size} items, answer=${answerText.take(50)}")

            } catch (e: Exception) {
                Log.e(TAG, "Query failed", e)
                _uiState.value = UiState.Error(e.message ?: "未知错误")
            }
        }
    }

    fun recommend() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading
            try {
                val token = auth.getToken()
                Log.e(TAG, "Token acquired, fetching proactive-recommend")
                val result = agentApi.proactiveRecommend(token)
                Log.e(TAG, "Recommend: ${result.items.size} items, welcome=${result.welcomeText.take(50)}")
                result.items.take(2).forEach { item ->
                    Log.e(TAG, "  [${item.title}] dur=${item.duration}s mediaId=${item.mediaId.take(80)}")
                }
                _uiState.value = UiState.Success(result.welcomeText, result.items, result.suggestions)
            } catch (e: Exception) {
                Log.e(TAG, "Recommend failed", e)
                _uiState.value = UiState.Error(e.message ?: "未知错误")
            }
        }
    }

    fun playItem(item: PlaylistItem) {
        if (item.mediaId.isEmpty()) {
            Log.w(TAG, "No mediaId for: ${item.title}")
            return
        }
        Log.e(TAG, "Playing: ${item.title}")
        player?.playFromMediaId(item.mediaId)
    }
}
