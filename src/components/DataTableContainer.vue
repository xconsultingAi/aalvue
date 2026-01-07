<template>
  <div class="w-full h-full flex flex-col flex-1 min-h-0 bg-white">
    <div 
      v-if="store.loading" 
      class="flex items-center justify-center gap-3 p-xl text-center text-primary text-[15px] font-medium"
    >
      <div class="w-5 h-5 border-[3px] border-primary/20 border-t-primary rounded-full animate-spin"></div>
      Loading data...
    </div>
    <div 
      v-else-if="store.error" 
      class="text-error bg-error-bg rounded-md m-xl p-lg px-xl text-[15px] font-medium"
    >
      {{ store.error }}
    </div>
    <div v-else-if="store.data" class="flex-1 flex flex-col overflow-hidden min-h-0 bg-white">
      <DataTableFilters />
      <DataTableGrid />
      <LoadingOverlay />
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

const store = useDataTableStore()
const initialData = inject<any>('initialData')

onMounted(() => {
  if (initialData) {
    store.setInitialData(initialData)
  }
  store.loadData()
})
</script>

<style scoped>
/* All styles migrated to Tailwind classes */
</style>
