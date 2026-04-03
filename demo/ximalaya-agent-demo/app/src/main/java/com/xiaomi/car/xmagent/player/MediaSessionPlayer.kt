package com.xiaomi.car.xmagent.player

import android.content.ComponentName
import android.content.Context
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class MediaSessionPlayer(private val context: Context) {

    companion object {
        private const val TAG = "MediaSessionPlayer"
        private const val XM_PACKAGE = "com.ximalaya.ting.android.car"
        private const val XM_SERVICE = "com.ximalaya.ting.android.car.sdk.XmMediaBrowserService"
    }

    data class PlayerState(
        val status: String = "未连接",
        val trackTitle: String = "",
        val artist: String = "",
        val isPlaying: Boolean = false,
        val isConnected: Boolean = false,
    )

    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state

    private var mediaBrowser: MediaBrowserCompat? = null
    private var mediaController: MediaControllerCompat? = null
    private var pendingMediaId: String? = null

    fun connect() {
        if (mediaBrowser?.isConnected == true) return
        Log.e(TAG, "Connecting to Ximalaya MediaSession...")
        _state.value = _state.value.copy(status = "连接中...")

        mediaBrowser = MediaBrowserCompat(
            context,
            ComponentName(XM_PACKAGE, XM_SERVICE),
            connectionCallback,
            null
        ).apply { connect() }
    }

    fun disconnect() {
        mediaController?.unregisterCallback(controllerCallback)
        mediaBrowser?.disconnect()
        mediaBrowser = null
        mediaController = null
        _state.value = PlayerState()
    }

    fun playFromMediaId(mediaId: String) {
        if (mediaController != null) {
            Log.e(TAG, "playFromMediaId: ${mediaId.take(80)}...")
            mediaController!!.transportControls.playFromMediaId(mediaId, null)
        } else {
            Log.e(TAG, "Not connected, queuing mediaId and connecting...")
            pendingMediaId = mediaId
            connect()
        }
    }

    fun pause() {
        mediaController?.transportControls?.pause()
    }

    fun stop() {
        mediaController?.transportControls?.stop()
    }

    private val connectionCallback = object : MediaBrowserCompat.ConnectionCallback() {
        override fun onConnected() {
            Log.e(TAG, "MediaSession connected!")
            val browser = mediaBrowser ?: return

            mediaController = MediaControllerCompat(context, browser.sessionToken).also {
                it.registerCallback(controllerCallback)
            }

            _state.value = _state.value.copy(status = "已连接", isConnected = true)

            pendingMediaId?.let { mediaId ->
                pendingMediaId = null
                playFromMediaId(mediaId)
            }
        }

        override fun onConnectionSuspended() {
            Log.w(TAG, "Connection suspended")
            _state.value = _state.value.copy(status = "连接中断", isConnected = false)
        }

        override fun onConnectionFailed() {
            Log.e(TAG, "Connection failed — check Ximalaya APK installed & whitelisted")
            _state.value = _state.value.copy(
                status = "连接失败 — 请确认喜马拉雅 APK 已安装",
                isConnected = false
            )
        }
    }

    private val controllerCallback = object : MediaControllerCompat.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackStateCompat?) {
            val (statusText, playing) = when (state?.state) {
                PlaybackStateCompat.STATE_PLAYING -> "播放中" to true
                PlaybackStateCompat.STATE_PAUSED -> "已暂停" to false
                PlaybackStateCompat.STATE_STOPPED -> "已停止" to false
                PlaybackStateCompat.STATE_BUFFERING -> "缓冲中..." to false
                PlaybackStateCompat.STATE_ERROR -> "错误: ${state.errorMessage}" to false
                else -> "空闲" to false
            }
            _state.value = _state.value.copy(status = statusText, isPlaying = playing)
        }

        override fun onMetadataChanged(metadata: MediaMetadataCompat?) {
            val title = metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE) ?: ""
            val artist = metadata?.getString(MediaMetadataCompat.METADATA_KEY_ARTIST) ?: ""
            _state.value = _state.value.copy(trackTitle = title, artist = artist)
        }
    }
}
