<template>
  <div class="flex flex-col items-center justify-center gap-4 p-xl text-center" :class="containerClass">
    <div 
      class="rounded-full animate-spin"
      :style="spinnerStyle"
    ></div>
    <div :style="messageStyle">{{ message }}</div>
    <div v-if="subtitle" :style="subtitleStyle">{{ subtitle }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  message?: string
  subtitle?: string
  containerClass?: string
}>(), {
  message: 'Loading...',
  subtitle: '',
  containerClass: ''
})

// Matches loaderHelpers.ts styling
const spinnerStyle = computed(() => ({
  width: '48px',
  height: '48px',
  border: '3px solid rgba(0, 158, 247, 0.2)',
  borderTopColor: 'rgb(0, 158, 247)',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite'
}))

const messageStyle = computed(() => ({
  color: 'rgb(0, 158, 247)',
  fontSize: '15px',
  fontWeight: '500',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif'
}))

const subtitleStyle = computed(() => ({
  color: 'rgba(94, 98, 120, 0.7)',
  fontSize: '14px',
  fontWeight: 'normal',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif'
}))
</script>

<style scoped>
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
