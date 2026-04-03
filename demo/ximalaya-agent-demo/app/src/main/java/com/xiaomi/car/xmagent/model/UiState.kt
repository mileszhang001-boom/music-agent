package com.xiaomi.car.xmagent.model

sealed class UiState {
    object Idle : UiState()
    object Loading : UiState()
    data class Success(
        val answerText: String,
        val items: List<PlaylistItem>,
        val suggestions: List<String>,
    ) : UiState()
    data class Error(val message: String) : UiState()
}

sealed class AgentResponse {
    data class WrittenAnswer(val text: String) : AgentResponse()
    data class PlayList(val items: List<PlaylistItem>) : AgentResponse()
    data class Suggestions(val suggestions: List<String>) : AgentResponse()
}
