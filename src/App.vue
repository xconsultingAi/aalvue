<template>
  <DataTableContainer />
</template>

<script setup lang="ts">
import { provide, onMounted } from 'vue'
import DataTableContainer from '@/components/DataTableContainer.vue'
import { useDataTableStore } from '@/stores/dataTableStore'

const props = defineProps<{
  initialData?: any
  apiEndpoint?: string
  csrfToken?: string
}>()

const store = useDataTableStore()

// Set API endpoint and CSRF token in store if provided
// Also set loading state immediately if we'll be loading from API (for instant UI feedback)
onMounted(() => {
  console.log('[App.vue] onMounted called', {
    apiEndpoint: props.apiEndpoint,
    hasCsrfToken: !!props.csrfToken,
    csrfToken: props.csrfToken,
    hasInitialData: !!props.initialData
  })
  
  if (props.apiEndpoint) {
    console.log('[App.vue] Setting API endpoint:', props.apiEndpoint)
    store.setApiEndpoint(props.apiEndpoint)
    // Set loading immediately if we have API endpoint but no initial data
    // This ensures loader shows up instantly, not after Vue mounts
    if (!props.initialData) {
      console.log('[App.vue] Setting loading to true')
      store.setLoading(true)
    }
  }
  if (props.csrfToken) {
    console.log('[App.vue] Setting CSRF token')
    store.setCsrfToken(props.csrfToken)
  }
  
  console.log('[App.vue] Store state after setup:', {
    apiEndpoint: store.apiEndpoint,
    csrfToken: store.csrfToken,
    loading: store.loading
  })
  
  // Call loadData() after setting endpoint to ensure it has the correct values
  // This fixes the race condition where DataTableContainer.onMounted() runs first
  // REASONING: Always call loadData() - it will fall back to sample data if no apiEndpoint or initialData
  console.log('[App.vue] Calling loadData()')
  store.loadData()
})

console.log('App.vue setup:', { 
  hasInitialData: !!props.initialData,
  initialDataType: typeof props.initialData,
  hasApiEndpoint: !!props.apiEndpoint,
  hasCsrfToken: !!props.csrfToken
})

provide('initialData', props.initialData)
provide('apiEndpoint', props.apiEndpoint)
provide('csrfToken', props.csrfToken)
</script>

<style>
/* Global reset styles */
* {
  margin: 0;
  box-sizing: border-box;
}
/* Note: padding removed from universal reset to allow Tailwind padding classes to work */

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  color: rgb(33, 37, 41);
  background: #f8f9fa;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
}
</style>
