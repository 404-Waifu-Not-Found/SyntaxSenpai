<script setup lang="ts">
import { computed } from 'vue'

interface ForecastDay {
  day?: string
  high_c?: number
  low_c?: number
  conditions?: string
  emoji?: string
}

const props = defineProps<{
  data: {
    location?: string
    temperature_c?: number
    conditions?: string
    emoji?: string
    humidity_pct?: number
    wind_kph?: number
    forecast?: ForecastDay[]
  }
}>()

const temp = computed(() =>
  typeof props.data.temperature_c === 'number' ? `${Math.round(props.data.temperature_c)}°C` : '—',
)
const emoji = computed(() => props.data.emoji || defaultEmoji(props.data.conditions))
const forecast = computed(() => (props.data.forecast ?? []).slice(0, 5))

function defaultEmoji(conditions?: string): string {
  if (!conditions) return '🌡️'
  const c = conditions.toLowerCase()
  if (/storm|thunder/.test(c)) return '⛈️'
  if (/rain|drizzle|shower/.test(c)) return '🌧️'
  if (/snow|sleet/.test(c)) return '❄️'
  if (/fog|mist|haze/.test(c)) return '🌫️'
  if (/cloud/.test(c)) return '☁️'
  if (/sun|clear/.test(c)) return '☀️'
  if (/wind/.test(c)) return '🌬️'
  return '🌡️'
}
</script>

<template>
  <div class="weather-card">
    <div class="weather-main">
      <div class="weather-emoji">{{ emoji }}</div>
      <div class="weather-info">
        <div class="weather-location">{{ data.location || 'Current location' }}</div>
        <div class="weather-temp">{{ temp }}</div>
        <div class="weather-conditions">{{ data.conditions || '—' }}</div>
      </div>
    </div>
    <div v-if="data.humidity_pct != null || data.wind_kph != null" class="weather-meta">
      <span v-if="data.humidity_pct != null">💧 {{ data.humidity_pct }}%</span>
      <span v-if="data.wind_kph != null">💨 {{ data.wind_kph }} km/h</span>
    </div>
    <div v-if="forecast.length" class="weather-forecast">
      <div v-for="(day, i) in forecast" :key="i" class="weather-day">
        <div class="weather-day-label">{{ day.day || `Day ${i + 1}` }}</div>
        <div class="weather-day-emoji">{{ day.emoji || defaultEmoji(day.conditions) }}</div>
        <div class="weather-day-temps">
          <span v-if="day.high_c != null" class="weather-day-high">{{ Math.round(day.high_c) }}°</span>
          <span v-if="day.low_c != null" class="weather-day-low">{{ Math.round(day.low_c) }}°</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.weather-card {
  margin: 0.25rem 0;
  padding: 1rem;
  border-radius: 0.85rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(147, 197, 253, 0.1));
  border: 1px solid rgba(147, 197, 253, 0.22);
  color: #f1f5f9;
  font-size: 0.9rem;
}
.weather-main { display: flex; align-items: center; gap: 0.9rem; }
.weather-emoji { font-size: 2.5rem; line-height: 1; }
.weather-info { display: flex; flex-direction: column; }
.weather-location { font-size: 0.78rem; color: rgba(241, 245, 249, 0.7); letter-spacing: 0.02em; }
.weather-temp { font-size: 1.6rem; font-weight: 700; line-height: 1.1; }
.weather-conditions { font-size: 0.85rem; color: rgba(241, 245, 249, 0.85); text-transform: capitalize; }
.weather-meta {
  display: flex; gap: 0.9rem; margin-top: 0.7rem; padding-top: 0.6rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.8rem; color: rgba(241, 245, 249, 0.75);
}
.weather-forecast {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(62px, 1fr));
  gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.65rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.weather-day { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; font-size: 0.75rem; }
.weather-day-label { color: rgba(241, 245, 249, 0.6); }
.weather-day-emoji { font-size: 1.3rem; }
.weather-day-temps { display: flex; gap: 0.35rem; }
.weather-day-high { font-weight: 600; }
.weather-day-low { color: rgba(241, 245, 249, 0.55); }
</style>
