package com.xiaomi.car.xmagent.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import coil.load
import coil.transform.RoundedCornersTransformation
import com.xiaomi.car.xmagent.databinding.ItemPlaylistBinding
import com.xiaomi.car.xmagent.model.PlaylistItem

class PlaylistAdapter(
    private val onClick: (PlaylistItem) -> Unit
) : ListAdapter<PlaylistItem, PlaylistAdapter.ViewHolder>(DIFF) {

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<PlaylistItem>() {
            override fun areItemsTheSame(a: PlaylistItem, b: PlaylistItem) = a.mediaId == b.mediaId
            override fun areContentsTheSame(a: PlaylistItem, b: PlaylistItem) = a == b
        }
    }

    inner class ViewHolder(val binding: ItemPlaylistBinding) : RecyclerView.ViewHolder(binding.root) {
        init {
            binding.root.setOnClickListener {
                val pos = bindingAdapterPosition
                if (pos != RecyclerView.NO_POSITION) onClick(getItem(pos))
            }
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemPlaylistBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = getItem(position)
        with(holder.binding) {
            tvTitle.text = item.title
            tvIntro.text = item.intro.ifEmpty { "点击播放" }
            tvDuration.text = item.formattedDuration()
            ivCover.load(item.coverUrl) {
                crossfade(true)
                transformations(RoundedCornersTransformation(12f))
            }
        }
    }
}
