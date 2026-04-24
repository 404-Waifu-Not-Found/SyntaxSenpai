<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: {
    url?: string
    title?: string
    description?: string
    site?: string
    image_url?: string
  }
}>()

const hostname = computed(() => {
  if (props.data.site) return props.data.site
  try {
    return new URL(props.data.url || '').hostname
  } catch {
    return ''
  }
})

const safeUrl = computed(() => {
  const u = props.data.url || ''
  return /^https?:\/\//i.test(u) ? u : ''
})
</script>

<template>
  <a
    v-if="safeUrl"
    class="link-preview-card"
    :href="safeUrl"
    target="_blank"
    rel="noreferrer noopener"
  >
    <img
      v-if="data.image_url"
      class="link-preview-image"
      :src="data.image_url"
      alt=""
      @error="(e: any) => (e.target.style.display = 'none')"
    />
    <div class="link-preview-body">
      <div class="link-preview-site">{{ hostname }}</div>
      <div class="link-preview-title">{{ data.title || safeUrl }}</div>
      <div v-if="data.description" class="link-preview-description">{{ data.description }}</div>
    </div>
  </a>
  <div v-else class="link-preview-card link-preview-invalid">
    <div class="link-preview-body">
      <div class="link-preview-title">{{ data.title || 'Invalid link preview' }}</div>
      <div class="link-preview-description">URL missing or not an http(s) link.</div>
    </div>
  </div>
</template>

<style scoped>
.link-preview-card {
  display: flex;
  margin: 0.25rem 0;
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
  text-decoration: none;
  overflow: hidden;
  transition: background 0.15s ease;
}
.link-preview-card:hover { background: rgba(15, 23, 42, 0.75); }
.link-preview-image {
  width: 96px; height: 96px; object-fit: cover; flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);
}
.link-preview-body { padding: 0.75rem 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.link-preview-site { font-size: 0.72rem; color: rgba(147, 197, 253, 0.9); text-transform: lowercase; letter-spacing: 0.02em; }
.link-preview-title { font-weight: 700; font-size: 0.9rem; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.link-preview-description { font-size: 0.8rem; color: rgba(241, 245, 249, 0.7); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.link-preview-invalid { opacity: 0.65; }
</style>
