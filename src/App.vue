<template>
  <DataTableContainer />
</template>

<script setup lang="ts">
import { provide } from 'vue'
import DataTableContainer from '@/components/DataTableContainer.vue'

const props = defineProps<{
  initialData?: any
  apiEndpoint?: string
}>()

console.log('App.vue setup:', { 
  hasInitialData: !!props.initialData,
  initialDataType: typeof props.initialData,
  hasApiEndpoint: !!props.apiEndpoint
})

provide('initialData', props.initialData)
provide('apiEndpoint', props.apiEndpoint)
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
