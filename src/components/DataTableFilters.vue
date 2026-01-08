<template>
  <nav class="h-16 flex items-center justify-between gap-6 px-6 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
    <!-- Left section: Filters -->
    <div class="flex items-center gap-6">
      <!-- Service Item Dropdown -->
      <div class="flex items-center gap-3">
        <label class="text-sm font-semibold text-gray-700 whitespace-nowrap">Service Item:</label>
        <select 
          v-model="selectedServiceItem"
          :disabled="store.isFiltering"
          class="h-9 px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm text-gray-900 font-medium shadow-sm transition-all min-w-[200px] hover:border-gray-400 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option :value="null">All</option>
          <option v-for="item in store.availableServiceItems" :key="item.siIndex" :value="item.siIndex">
            {{ item.name }}
          </option>
        </select>
      </div>
      
      <!-- Checkbox Filter -->
      <div class="flex items-center">
        <label class="flex items-center gap-3 cursor-pointer select-none group">
          <input 
            type="checkbox" 
            v-model="showReportableOnly"
            :disabled="store.isFiltering"
            class="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span class="text-sm font-medium text-gray-700 group-hover:text-gray-900">Reporting Analytes Only</span>
        </label>
      </div>
    </div>
    
    <!-- Right section: View Mode and Actions -->
    <div class="flex items-center gap-4">
      <!-- Save Button -->
      <button 
        type="button"
        :disabled="store.isFiltering || !store.hasUnsavedChanges"
        class="text-sm font-medium leading-5 px-4 py-2 text-white bg-blue-600 border border-blue-600 rounded-lg shadow-sm hover:bg-blue-700 hover:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        @click="handleSave"
      >
        Save
      </button>
      
      <!-- View Mode Toggle Buttons - Button Group -->
      <div class="inline-flex rounded-lg shadow-sm -space-x-px" role="group">
        <button 
          type="button"
          :disabled="store.isFiltering"
          :class="[
            'text-sm font-medium leading-5 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-l-lg',
            store.viewMode === 'qc' 
              ? 'text-blue-600 bg-white border-blue-500 z-10' 
              : 'text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900',
            store.isFiltering ? 'opacity-50 cursor-not-allowed' : ''
          ]"
          @click="store.setViewMode('qc')"
        >
          QC Detail
        </button>
        <button 
          type="button"
          :disabled="store.isFiltering"
          :class="[
            'text-sm font-medium leading-5 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10',
            store.viewMode === 'report' 
              ? 'text-blue-600 bg-white border-blue-500 z-10' 
              : 'text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900',
            store.isFiltering ? 'opacity-50 cursor-not-allowed' : ''
          ]"
          @click="store.setViewMode('report')"
        >
          QC Summary
        </button>
        <button 
          type="button"
          :disabled="store.isFiltering"
          :class="[
            'text-sm font-medium leading-5 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-r-lg',
            store.viewMode === 'customer' 
              ? 'text-blue-600 bg-white border-blue-500 z-10' 
              : 'text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900',
            store.isFiltering ? 'opacity-50 cursor-not-allowed' : ''
          ]"
          @click="store.setViewMode('customer')"
        >
          Customer View
        </button>
      </div>
      
      <!-- Clear Filters Button -->
      <button 
        v-if="store.hasActiveFilters"
        type="button"
        :disabled="store.isFiltering"
        class="text-sm font-medium leading-5 px-4 py-2.5 text-gray-700 bg-gray-200 border border-gray-300 rounded-lg shadow-sm hover:bg-gray-300 hover:text-gray-900 focus:ring-4 focus:ring-gray-400 focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        @click="store.clearAllFilters()"
      >
        Clear Filters
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDataTableStore } from '@/stores/dataTableStore'
import { showToast } from '@/stores/toastStore'

const store = useDataTableStore()

const selectedServiceItem = computed({
  get: () => store.selectedServiceItemIndex,
  set: (value) => store.setServiceItemFilter(value)
})

const showReportableOnly = computed({
  get: () => store.showReportableOnly,
  set: (value) => store.setReportableOnlyFilter(value)
})

async function handleSave() {
  console.log('[DataTableFilters] handleSave called', {
    isFiltering: store.isFiltering,
    hasUnsavedChanges: store.hasUnsavedChanges,
    hasApiEndpoint: !!store.apiEndpoint,
    apiEndpoint: store.apiEndpoint
  })
  
  try {
    const success = await store.saveData()
    if (success) {
      showToast('success', 'Data saved successfully')
    } else {
      showToast('error', 'Failed to save data')
    }
  } catch (error) {
    console.error('[DataTableFilters] handleSave error:', error)
    showToast('error', `Error saving data: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
</script>

<style scoped>
/* Browser default overrides for consistent appearance */
select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
  background-position: right 0.5rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  padding-right: 2.5rem;
}

button {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
</style>
