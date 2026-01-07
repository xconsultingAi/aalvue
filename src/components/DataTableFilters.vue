<template>
  <nav class="h-16 flex items-center justify-between gap-6 px-6 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
    <!-- Left section: Filters -->
    <div class="flex items-center gap-6">
      <!-- Service Item Dropdown -->
      <div class="flex items-center gap-3">
        <label class="text-sm font-semibold text-gray-700 whitespace-nowrap">Service Item:</label>
        <select 
          v-model="selectedServiceItem"
          class="h-9 px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm text-gray-900 font-medium shadow-sm transition-all min-w-[200px] hover:border-gray-400 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
            class="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer transition-colors"
          />
          <span class="text-sm font-medium text-gray-700 group-hover:text-gray-900">Reporting Analytes Only</span>
        </label>
      </div>
    </div>
    
    <!-- Right section: View Mode and Actions -->
    <div class="flex items-center gap-4">
      <!-- View Mode Toggle Buttons - Button Group -->
      <div class="inline-flex rounded-lg shadow-sm -space-x-px" role="group">
        <button 
          type="button"
          :class="[
            'text-sm font-medium leading-5 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-l-lg',
            store.viewMode === 'qc' 
              ? 'text-blue-600 bg-white border-blue-500 z-10' 
              : 'text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900'
          ]"
          @click="store.setViewMode('qc')"
        >
          QC Detail
        </button>
        <button 
          type="button"
          :class="[
            'text-sm font-medium leading-5 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10',
            store.viewMode === 'report' 
              ? 'text-blue-600 bg-white border-blue-500 z-10' 
              : 'text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900'
          ]"
          @click="store.setViewMode('report')"
        >
          QC Summary
        </button>
        <button 
          type="button"
          :class="[
            'text-sm font-medium leading-5 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-r-lg',
            store.viewMode === 'customer' 
              ? 'text-blue-600 bg-white border-blue-500 z-10' 
              : 'text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900'
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
        class="text-sm font-medium leading-5 px-4 py-2.5 text-gray-700 bg-gray-200 border border-gray-300 rounded-lg shadow-sm hover:bg-gray-300 hover:text-gray-900 focus:ring-4 focus:ring-gray-400 focus:outline-none transition-all"
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

const store = useDataTableStore()

const selectedServiceItem = computed({
  get: () => store.selectedServiceItemIndex,
  set: (value) => store.setServiceItemFilter(value)
})

const showReportableOnly = computed({
  get: () => store.showReportableOnly,
  set: (value) => store.setReportableOnlyFilter(value)
})
</script>

<style scoped>
/* Tailwind classes used for all component styling */
/* Browser default overrides below (necessary for consistent appearance) */
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
