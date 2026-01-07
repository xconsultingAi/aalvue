import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLoadingStore = defineStore('loading', () => {
  const isVisible = ref(false)
  const message = ref('')
  const progress = ref({ current: 0, total: 0 })
  let showTime = 0
  let hideTimeout: ReturnType<typeof setTimeout> | null = null

  function show(msg: string) {
    // Clear any pending hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    
    message.value = msg
    isVisible.value = true
    progress.value = { current: 0, total: 0 }
    showTime = Date.now()
  }

  function updateProgress(current: number, total: number) {
    progress.value = { current, total }
  }

  function hide() {
    // Ensure overlay is visible for at least 300ms for better UX
    const elapsed = Date.now() - showTime
    const minDisplayTime = 300
    
    if (elapsed < minDisplayTime) {
      hideTimeout = setTimeout(() => {
        isVisible.value = false
        message.value = ''
        progress.value = { current: 0, total: 0 }
        hideTimeout = null
      }, minDisplayTime - elapsed)
    } else {
      isVisible.value = false
      message.value = ''
      progress.value = { current: 0, total: 0 }
    }
  }

  return {
    isVisible,
    message,
    progress,
    show,
    updateProgress,
    hide
  }
})
