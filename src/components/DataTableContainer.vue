<template>
  <div class="w-full h-full flex flex-col flex-1 min-h-0 bg-white">
    <DataLoader 
      v-if="store.loading"
      message="Loading data..."
      subtitle="Please wait while we fetch the data"
      container-class="min-h-[400px]"
    />
    <div 
      v-else-if="store.error" 
      class="text-error bg-error-bg rounded-md m-xl p-lg px-xl text-[15px] font-medium"
    >
      {{ store.error }}
    </div>
    <div v-else-if="store.data" class="flex-1 flex flex-col overflow-hidden min-h-0 bg-white relative">
      <DataTableFilters />
      <DataTableGrid />
      <LoadingOverlay />
      <!-- Filter loading overlay - shows feedback during filter operations -->
      <div 
        v-if="store.isFiltering"
        class="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-50"
      >
        <div class="flex flex-col items-center gap-3">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <span class="text-sm font-medium text-gray-700">Filtering data...</span>
        </div>
      </div>
    </div>
    <div v-else class="p-xl text-center text-text text-[15px] font-medium opacity-70">
      No data available
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, inject } from 'vue'
import { useDataTableStore } from '@/stores/dataTableStore'
import DataTableFilters from './DataTableFilters.vue'
import DataTableGrid from './DataTableGrid.vue'
import LoadingOverlay from './LoadingOverlay.vue'
import DataLoader from './DataLoader.vue'

const store = useDataTableStore()
const initialData = inject<any>('initialData')

onMounted(() => {
  console.log('[DataTableContainer] onMounted called', {
    hasInitialData: !!initialData,
    hasApiEndpoint: !!store.apiEndpoint,
    currentLoading: store.loading
  })
  
  if (initialData) {
    store.setInitialData(initialData)
  }
  
  // loadData() called from App.vue after endpoint is set (prevents race condition)
  // Only call here if initialData exists without endpoint (backward compatibility)
  if (initialData && !store.apiEndpoint) {
    console.log('[DataTableContainer] Calling loadData() with initialData only')
    store.loadData()
  } else {
    console.log('[DataTableContainer] Skipping loadData() - will be called from App.vue after endpoint is set')
  }
})
</script>

<style scoped>
/* All styles migrated to Tailwind classes */
</style>
