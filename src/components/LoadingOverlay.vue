<template>
  <Teleport to="body">
    <div 
      v-if="loadingStore.isVisible" 
      class="fixed inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm flex items-center justify-center z-[10000] p-12"
    >
      <div class="bg-white border-2 border-black/15 rounded-2xl shadow-xl min-w-[320px] max-w-[420px]">
        <!-- Top spacing -->
        <div class="h-16"></div>
        
        <!-- Content area -->
        <div class="px-10 flex flex-col items-center">
          <div class="w-12 h-12 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-6"></div>
          <div class="text-gray-900 text-lg font-semibold mb-3 text-center">{{ loadingStore.message }}</div>
          <div 
            v-if="loadingStore.progress.total > 0" 
            class="text-gray-500 text-xs font-normal text-center"
          >
            Processing {{ loadingStore.progress.current }}/{{ loadingStore.progress.total }} cells...
          </div>
        </div>
        
        <!-- Bottom spacing -->
        <div class="h-16"></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useLoadingStore } from '@/stores/loadingStore'

const loadingStore = useLoadingStore()
</script>

<style scoped>
/* All styles migrated to Tailwind classes */
</style>
