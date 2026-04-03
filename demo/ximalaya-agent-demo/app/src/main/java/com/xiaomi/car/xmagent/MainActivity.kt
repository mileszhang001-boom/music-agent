package com.xiaomi.car.xmagent

import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.chip.Chip
import com.xiaomi.car.xmagent.databinding.ActivityMainBinding
import com.xiaomi.car.xmagent.model.UiState
import com.xiaomi.car.xmagent.player.MediaSessionPlayer
import com.xiaomi.car.xmagent.ui.PlaylistAdapter
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var viewModel: MainViewModel
    private lateinit var player: MediaSessionPlayer
    private lateinit var adapter: PlaylistAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        viewModel = ViewModelProvider(this)[MainViewModel::class.java]
        player = MediaSessionPlayer(this)
        viewModel.player = player

        setupRecyclerView()
        setupInput()
        observeUiState()
        observePlayerState()

        player.connect()

        // Support adb testing: am start -n ... --es query "郭德纲的相声"
        intent.getStringExtra("query")?.let { q ->
            binding.etQuery.setText(q)
            viewModel.query(q)
        }
    }

    private fun setupRecyclerView() {
        adapter = PlaylistAdapter { item -> viewModel.playItem(item) }
        binding.rvPlaylist.layoutManager = LinearLayoutManager(this)
        binding.rvPlaylist.adapter = adapter
    }

    private fun setupInput() {
        binding.btnSend.setOnClickListener { submitQuery() }
        binding.btnRecommend.setOnClickListener {
            viewModel.recommend()
            hideKeyboard()
        }
        binding.etQuery.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                submitQuery()
                true
            } else false
        }
    }

    private fun submitQuery() {
        val text = binding.etQuery.text?.toString()?.trim() ?: return
        if (text.isEmpty()) return
        viewModel.query(text)
        hideKeyboard()
    }

    private fun observeUiState() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                when (state) {
                    is UiState.Idle -> {
                        binding.progress.isVisible = false
                        binding.tvAnswer.isVisible = false
                        binding.tvError.isVisible = false
                        binding.svSuggestions.isVisible = false
                    }
                    is UiState.Loading -> {
                        binding.progress.isVisible = true
                        binding.tvAnswer.isVisible = false
                        binding.tvError.isVisible = false
                        binding.svSuggestions.isVisible = false
                        adapter.submitList(emptyList())
                    }
                    is UiState.Success -> {
                        binding.progress.isVisible = false
                        binding.tvError.isVisible = false

                        if (state.answerText.isNotEmpty()) {
                            binding.tvAnswer.isVisible = true
                            binding.tvAnswer.text = state.answerText
                        }

                        adapter.submitList(state.items)

                        if (state.suggestions.isNotEmpty()) {
                            showSuggestions(state.suggestions)
                        }
                    }
                    is UiState.Error -> {
                        binding.progress.isVisible = false
                        binding.tvAnswer.isVisible = false
                        binding.tvError.isVisible = true
                        binding.tvError.text = state.message
                    }
                }
            }
        }
    }

    private fun showSuggestions(suggestions: List<String>) {
        binding.svSuggestions.isVisible = true
        binding.llSuggestions.removeAllViews()
        for (suggestion in suggestions) {
            val chip = Chip(this).apply {
                text = suggestion
                isClickable = true
                setChipBackgroundColorResource(R.color.bg_card)
                setTextColor(resources.getColor(R.color.text_secondary, theme))
                setOnClickListener {
                    binding.etQuery.setText(suggestion)
                    submitQuery()
                }
            }
            binding.llSuggestions.addView(chip)
        }
    }

    private fun observePlayerState() {
        binding.btnPause.setOnClickListener { player.pause() }
        binding.btnStop.setOnClickListener { player.stop() }

        lifecycleScope.launch {
            player.state.collectLatest { ps ->
                val hasContent = ps.isConnected || ps.trackTitle.isNotEmpty()
                binding.llPlayerBar.isVisible = hasContent

                val displayText = if (ps.trackTitle.isNotEmpty()) {
                    "${ps.status}  ${ps.trackTitle}" +
                        if (ps.artist.isNotEmpty()) " - ${ps.artist}" else ""
                } else {
                    ps.status
                }
                binding.tvPlayerStatus.text = displayText
            }
        }
    }

    private fun hideKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(binding.etQuery.windowToken, 0)
    }

    override fun onDestroy() {
        super.onDestroy()
        player.disconnect()
    }
}
