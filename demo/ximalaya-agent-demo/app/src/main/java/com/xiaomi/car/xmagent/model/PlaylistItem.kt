package com.xiaomi.car.xmagent.model

import java.net.URLDecoder
import org.json.JSONObject

data class PlaylistItem(
    val title: String,
    val coverUrl: String,
    val duration: Int,      // seconds
    val mediaId: String,
    val intro: String,
) {
    companion object {
        fun fromJson(obj: JSONObject): PlaylistItem {
            val title = obj.optString("title", "")

            // cover: try cover.large.url → image.url → cover_path
            val coverUrl = (obj.optJSONObject("cover")
                ?.optJSONObject("large")
                ?.optString("url", "")
                ?: obj.optJSONObject("image")?.optString("url", "")
                ?: obj.optString("cover_path", ""))
                .replace("http://", "https://")  // Android 9+ 禁止明文 HTTP

            // duration: item 顶层没有，在 track.duration 里
            val track = obj.optJSONObject("track")
            val duration = obj.optInt("duration", 0).let { d ->
                if (d > 0) d else track?.optInt("duration", 0) ?: 0
            }

            // mediaId: 优先 track.media_id (/track?...) 可直接播放，备选 item.media_id
            val rawMediaId = (track?.optString("media_id", "") ?: "").ifEmpty {
                obj.optString("media_id", "")
            }
            val mediaId = normalizeMediaId(rawMediaId)

            val intro = obj.optString("intro", "")

            return PlaylistItem(title, coverUrl, duration, mediaId, intro)
        }

        /**
         * proactive-recommend 接口的 item 结构不同：
         * - mediaId 在 track.mediaId（驼峰）
         * - duration 在 track.duration
         * - 有 rec_reason / sub_title 等字段
         */
        fun fromRecommendJson(obj: JSONObject): PlaylistItem {
            val title = obj.optString("title", "")
            val coverUrl = obj.optString("cover", "")
                .replace("http://", "https://")
            val track = obj.optJSONObject("track")
            val duration = track?.optInt("duration", 0) ?: 0

            // proactive-recommend 用驼峰 mediaId
            val mediaId = track?.optString("mediaId", "") ?: ""

            val intro = obj.optString("rec_reason", "").ifEmpty {
                obj.optString("sub_title", "")
            }

            return PlaylistItem(title, coverUrl, duration, mediaId, intro)
        }

        /**
         * 统一 mediaId 格式，确保是 /track?... 可直接播放的格式
         *
         * 三种来源格式：
         * 1. /track?album_id=xxx&track_id=xxx&play_source=xxx  → 直接可用
         * 2. /album?album_id=xxx&play_source=xxx               → 直接可用（专辑播放）
         * 3. /tracks_list?start_from=/track?album_id%3Dxxx%26track_id%3Dxxx  → 需提取并解码
         */
        private fun normalizeMediaId(raw: String): String {
            if (!raw.startsWith("/tracks_list?start_from=")) return raw
            val encoded = raw.removePrefix("/tracks_list?start_from=")
            return try {
                URLDecoder.decode(encoded, "UTF-8")
            } catch (_: Exception) {
                raw
            }
        }
    }

    fun formattedDuration(): String {
        val m = duration / 60
        val s = duration % 60
        return "%d:%02d".format(m, s)
    }
}
