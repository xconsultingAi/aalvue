<template>
  <Teleport to="body">
    <div 
      class="fixed inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm flex items-center justify-center z-[1000] p-12"
      @click.self="handleClose"
    >
      <div class="bg-white border-2 border-black/15 rounded-2xl shadow-xl min-w-[800px] max-w-[1200px] max-h-[90vh] relative flex flex-col overflow-hidden outline-none">
        <!-- Header -->
        <div class="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h3 class="m-0 text-lg font-semibold">{{ modalTitle }}</h3>
          <button
            class="bg-transparent border-none text-2xl cursor-pointer text-gray-600 p-0 w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:bg-gray-100 hover:text-black"
            @click="handleClose"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        
        <!-- Body -->
        <div class="px-6 py-6 overflow-y-auto flex-1 min-h-0">
          <!-- Service Item Dropdown -->
          <div class="mb-5">
            <label class="block mb-2 text-sm font-medium text-gray-700">Service Item:</label>
            <select 
              v-model="selectedServiceItemIndex" 
              class="w-full h-9 px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm text-gray-900 font-medium shadow-sm transition-all hover:border-gray-400 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option v-for="si in serviceItems" :key="si.siIndex" :value="si.siIndex">
                {{ si.code }} - {{ si.name }}
              </option>
            </select>
          </div>
          
          <!-- Tabulator Grid -->
          <div ref="modalGridContainer" class="flex-1 min-h-[400px] my-5 border border-gray-300 rounded-lg overflow-hidden"></div>
          
          <!-- Action Buttons -->
          <div class="flex justify-end gap-3 mt-5 pt-5 border-t border-gray-300">
            <button 
              type="button"
              class="text-sm font-medium leading-5 px-4 py-2.5 text-gray-700 bg-gray-200 border border-gray-300 rounded-lg shadow-sm hover:bg-gray-300 hover:text-gray-900 focus:ring-4 focus:ring-gray-400 focus:outline-none transition-all"
              @click="handleClose"
            >
              Cancel
            </button>
            <button 
              type="button"
              class="text-sm font-medium leading-5 px-4 py-2.5 text-white bg-blue-600 border-none rounded-lg shadow-sm hover:bg-blue-700 focus:ring-4 focus:ring-blue-400 focus:outline-none transition-all disabled:bg-gray-400 disabled:cursor-not-allowed"
              @click="handleSubmit"
              :disabled="!isValid || isSubmitting"
            >
              {{ isSubmitting ? 'Submitting...' : 'Submit' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, inject } from 'vue'
import { TabulatorFull as Tabulator } from 'tabulator-tables'
import type { RowData } from '@/types'
import { useDataTableStore } from '@/stores/dataTableStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { showToast } from '@/stores/toastStore'
import { createApiClient } from '@/utils/apiClient'

interface RequestRow {
  id: string
  originalRowIndex: number
  seqNo: number
  sampleName: string
  materialType: string
  controlType: string
  sampleId: string
  position: number
  isDuplicate: boolean
}

interface Props {
  requestType: 'repeat' | 'overlimit' | null
  selectedRows: Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}>
  selectedServiceItemIndex: number
  apiEndpoint?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const store = useDataTableStore()
const loadingStore = useLoadingStore()

const modalGridContainer = ref<HTMLElement | null>(null)
let tabulatorInstance: Tabulator | null = null

const selectedServiceItemIndex = ref(props.selectedServiceItemIndex)
const requestRows = ref<RequestRow[]>([])
const isSubmitting = ref(false)

// Get service items from store
const serviceItems = computed(() => {
  return store.data?.metadata.schema.serviceItems || []
})

const modalTitle = computed(() => {
  const type = props.requestType === 'repeat' ? 'Repeat' : 'Overlimit'
  return `Generate ${type} Request`
})

// Initialize request rows from selected rows
function initializeRequestRows() {
  requestRows.value = props.selectedRows.map((item, index) => {
    const row = item.rowData
    const sampleId = (row as any).sampleId || (row as any).sampleID || row.travelerNo || ''
    
    return {
      id: `row_${item.rowIndex}_${index}`,
      originalRowIndex: item.rowIndex,
      seqNo: row.seqNo,
      sampleName: row.sampleName,
      materialType: row.materialType,
      controlType: row.controlType,
      sampleId: sampleId,
      position: index + 1, // 1-based
      isDuplicate: false
    }
  })
}

// Validate positions are unique and numeric
const isValid = computed(() => {
  const positions = requestRows.value.map(r => r.position)
  const uniquePositions = new Set(positions)
  
  return positions.every(p => typeof p === 'number' && !isNaN(p) && p > 0) &&
         uniquePositions.size === positions.length
})

// Initialize Tabulator grid
function initializeTabulator() {
  if (!modalGridContainer.value) return
  
  // Destroy existing instance
  if (tabulatorInstance) {
    tabulatorInstance.destroy()
    tabulatorInstance = null
  }
  
  tabulatorInstance = new Tabulator(modalGridContainer.value, {
    data: requestRows.value,
    columns: [
      {
        title: '',
        field: 'dragHandle',
        width: 40,
        headerSort: false,
        resizable: false,
        formatter: () => {
          return '<i class="drag-handle-icon">☰</i>'
        },
        frozen: true
      },
      {
        title: 'SEQ NO',
        field: 'seqNo',
        width: 100,
        editor: false,
        headerSort: false,
        hozAlign: 'center',
        formatter: (cell: any) => {
          return `<div style="text-align: center;">${cell.getValue() || ''}</div>`
        }
      },
      {
        title: 'Position',
        field: 'position',
        width: 100,
        editor: false, // Read-only, calculated from row order
        headerSort: false,
        hozAlign: 'center',
        formatter: (cell: any) => {
          const value = cell.getValue()
          return `<div style="text-align: center;">${value || ''}</div>`
        }
      },
      {
        title: 'Sample Name',
        field: 'sampleName',
        width: 150,
        editor: false,
        headerSort: false
      },
      {
        title: 'Material',
        field: 'materialType',
        width: 120,
        editor: false,
        headerSort: false
      },
      {
        title: 'Control',
        field: 'controlType',
        width: 100,
        editor: false,
        headerSort: false
      },
      {
        title: 'Sample ID',
        field: 'sampleId',
        width: 150,
        editor: false,
        headerSort: false
      },
      {
        title: 'Actions',
        width: 100,
        headerSort: false,
        hozAlign: 'center',
        formatter: () => {
          return '<div class="flex justify-center items-center w-full h-full"><button class="btn-duplicate bg-transparent border-none cursor-pointer p-1 rounded-sm flex items-center justify-center text-gray-600 transition-all hover:bg-gray-100 hover:text-blue-600 active:bg-gray-200" title="Duplicate Row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="block"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div>'
        },
        cellClick: (e: any, cell: any) => {
          const rowData = cell.getRow().getData() as RequestRow
          if (e.target.closest('.btn-duplicate')) {
            duplicateRow(rowData.id)
          }
        }
      }
    ],
    height: '400px',
    layout: 'fitColumns',
    movableRows: true, // Enable row dragging
    movableRowsHandle: '.drag-handle-icon', // Drag from handle icon only
    rowMoved: (row: any) => {
      // Update positions based on new row order after drag completes
      // Use setTimeout to ensure Tabulator has finished processing the move
      setTimeout(() => {
        updatePositionsFromOrder()
      }, 50)
    },
    placeholder: 'No samples selected'
  })
}

// Update positions from row order (row index + 1)
function updatePositionsFromOrder() {
  if (!tabulatorInstance) return
  
  const rows = tabulatorInstance.getRows()
  
  if (import.meta.env.DEV) {
    console.log('updatePositionsFromOrder: Processing', rows.length, 'rows')
  }
  
  rows.forEach((row, index) => {
    const rowData = row.getData() as RequestRow
    const newPosition = index + 1 // 1-based
    
    const rowInArray = requestRows.value.find(r => r.id === rowData.id)
    if (rowInArray) {
      rowInArray.position = newPosition
      if (import.meta.env.DEV) {
        console.log(`updatePositionsFromOrder: Row ${rowData.id} position updated to ${newPosition}`)
      }
    }
    
    try {
      row.updateCell('position', newPosition)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Error updating cell:', error)
      }
    }
  })
  
  tabulatorInstance.redraw(true)
}

// Duplicate a row
function duplicateRow(rowId: string) {
  if (!tabulatorInstance) return
  
  const row = tabulatorInstance.getRow(rowId)
  if (!row) return
  
  const originalRowData = row.getData() as RequestRow
  const duplicate: RequestRow = {
    ...originalRowData,
    id: `duplicate_${Date.now()}_${Math.random()}`,
    position: 0, // Recalculated by updatePositionsFromOrder
    isDuplicate: true
  }
  
  const rowIndex = requestRows.value.findIndex(r => r.id === rowId)
  if (rowIndex !== -1) {
    requestRows.value.splice(rowIndex + 1, 0, duplicate)
  } else {
    requestRows.value.push(duplicate)
  }
  
  tabulatorInstance.addRow(duplicate, false)
  setTimeout(() => {
    updatePositionsFromOrder()
  }, 50)
  
  showToast('success', 'Row duplicated')
}

// Handle close
function handleClose() {
  emit('close')
}

// Handle submit
async function handleSubmit() {
  if (!isValid.value || !props.apiEndpoint) {
    if (!props.apiEndpoint) {
      showToast('error', 'API endpoint not configured')
    } else {
      showToast('error', 'Please fix validation errors before submitting')
    }
    return
  }
  
  isSubmitting.value = true
  loadingStore.show('Submitting request...')
  
  try {
    const requestData = {
      requestType: props.requestType,
      serviceItemIndex: selectedServiceItemIndex.value,
      samples: requestRows.value.map(row => ({
        originalRowIndex: row.originalRowIndex,
        seqNo: row.seqNo,
        position: row.position,
        sampleName: row.sampleName,
        materialType: row.materialType,
        controlType: row.controlType,
        sampleId: row.sampleId
      }))
    }
    
    const endpoint = props.apiEndpoint.endsWith('/') 
      ? `${props.apiEndpoint}requests` 
      : `${props.apiEndpoint}/requests`
    
    const apiClient = createApiClient({ csrfToken: csrfToken || undefined })
    const response = await apiClient.post(endpoint, requestData)
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication required. Please log in.')
      } else if (response.status === 403) {
        throw new Error('Access denied. You do not have permission to submit this request.')
      } else {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API error: ${response.status} ${response.statusText}`)
      }
    }
    
    const result = await response.json()
    
    loadingStore.hide()
    showToast('success', `${props.requestType === 'repeat' ? 'Repeat' : 'Overlimit'} request submitted successfully`)
    handleClose()
  } catch (error: any) {
    loadingStore.hide()
    showToast('error', `Failed to submit request: ${error.message || 'Unknown error'}`)
    console.error('Submit error:', error)
  } finally {
    isSubmitting.value = false
  }
}

// Watch for data changes and update Tabulator
// NOTE: Disabled during position updates to avoid resetting row order
let isUpdatingPositions = false
watch(requestRows, () => {
  if (tabulatorInstance && !isUpdatingPositions) {
    // Replace data if not updating positions
    tabulatorInstance.replaceData(requestRows.value)
  }
}, { deep: true })

// Initialize on mount
onMounted(() => {
  initializeRequestRows()
  nextTick(() => {
    initializeTabulator()
  })
})

// Cleanup on unmount
onUnmounted(() => {
  if (tabulatorInstance) {
    tabulatorInstance.destroy()
    tabulatorInstance = null
  }
})
</script>

<style scoped>
/* Browser default overrides for select dropdown */
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
