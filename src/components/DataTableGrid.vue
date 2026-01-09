<template>
  <div class="flex-1 flex flex-col overflow-hidden min-h-0 h-full bg-white" ref="gridWrapperRef">
    <div ref="gridContainerRef" class="w-full h-full flex-1 bg-white"></div>
    
    <!-- Manual Correction Dialog -->
    <ManualCorrectionDialog
      :is-visible="showManualCorrectionDialog"
      :column="manualCorrectionColumn"
      :row-index="manualCorrectionRowIndex"
      @close="closeManualCorrectionDialog"
      @apply-baseline="applyBaselineCorrection"
      @apply-multiplier="applyMultiplier"
    />
    
    <!-- Request Modal -->
    <RequestModal
      v-if="showRequestModal"
      :request-type="requestModalType"
      :selected-rows="requestModalRows"
      :selected-service-item-index="requestModalServiceItemIndex"
      :api-endpoint="apiEndpoint"
      @close="closeRequestModal"
      :job-code="store.data?.metadata.job.code || ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, inject } from 'vue'
import { TabulatorFull as Tabulator } from 'tabulator-tables'
import type { ColumnDefinition, RowData } from '@/types'
import { useDataTableStore } from '@/stores/dataTableStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { showToast } from '@/stores/toastStore'
import { STATIC_COLUMN_COUNT } from '@/types'
import RequestModal from './RequestModal.vue'
import ManualCorrectionDialog from './ManualCorrectionDialog.vue'
import { useContextMenu } from '@/composables/useContextMenu'
import { useGridActions } from '@/composables/useGridActions'
import { useCellFormatters } from '@/composables/useCellFormatters'
import { extractCellsFromRanges } from '@/utils/tabulatorHelpers'
import { validateTabulatorOperation } from '@/utils/validationHelpers'
import { createApiClient } from '@/utils/apiClient'
import { generateTabulatorLoaderHTML } from '@/utils/loaderHelpers'

const store = useDataTableStore()
const loadingStore = useLoadingStore()
const gridWrapperRef = ref<HTMLElement | null>(null)
const gridContainerRef = ref<HTMLElement | null>(null)
let tabulatorInstance: Tabulator | null = null

// Loading state for copy operations
const isCopyingToResult = ref(false)

// Manual correction dialog state moved to composable

// Request modal state
const showRequestModal = ref(false)
const requestModalType = ref<'repeat' | 'overlimit' | null>(null)
const requestModalRows = ref<Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}>>([])
const requestModalServiceItemIndex = ref<number>(-1)

// Get API endpoint from inject
const apiEndpoint = inject<string | undefined>('apiEndpoint')

const lastColumnFields = ref<string[]>([])

// Row cache for tabulatorData memoization - O(rows × columns) to O(changed_rows × columns)
const rowCache = new Map<number, any>()
const lastFilteredColumns = ref<ColumnDefinition[]>([])
const lastFilteredRowsCount = ref<number | null>(null)
const lastDataRef = ref<any>(null)
// Cache previous result array (non-reactive to avoid reactivity loops)
let previousTabulatorData: any[] = []

// Track formatter refresh needed (final indicator changes only, not value updates)
const needsFormatterRefresh = ref(false)

// Cache filteredColumns to avoid computed recalculation
let cachedFilteredColumns: ColumnDefinition[] = []
let cachedColumnIndicesString: string = ''

// Cache for tabulatorColumns memoization (rebuilding nested structure is expensive)
let cachedTabulatorColumns: any[] = []
let cachedTabulatorColumnIndices: string = ''

// Extract field names from nested column structure for watch comparison
function extractColumnFields(columns: any[]): string[] {
  const fields: string[] = []
  columns.forEach(col => {
    if (col.field) {
      fields.push(col.field)
    }
    if (col.columns && Array.isArray(col.columns)) {
      // Handle grouped columns (Service Item → Analyte → Column)
      col.columns.forEach(group => {
        if (group.columns && Array.isArray(group.columns)) {
          // Nested groups: Analyte → Column
          group.columns.forEach(subCol => {
            if (subCol.field) fields.push(subCol.field)
          })
        } else if (group.field) {
          // Direct column
          fields.push(group.field)
        }
      })
    }
  })
  return fields
}

// Get Service Item Code using cached map (O(1) lookup)
function getServiceItemCode(col: ColumnDefinition): string {
  if (col.serviceItemIndex < 0) return ''
  
  return store.serviceItemCodeMap.get(col.serviceItemIndex) || ''
}

// Get Analyte Code using cached map (O(1) lookup)
function getAnalyteCode(col: ColumnDefinition): string {
  if (col.analyteIndex < 0) return ''
  
  return store.analyteCodeMap.get(col.analyteIndex) || ''
}

// Get Analyte properties (lowerLimit, upperLimit, unit)
function getAnalyteProperties(col: ColumnDefinition): { lowerLimit: string; upperLimit: string; unit: string } | null {
  if (col.analyteIndex < 0 || !store.data?.metadata?.schema?.analytes) return null
  
  const analyte = store.data.metadata.schema.analytes.find(a => a.analyteIndex === col.analyteIndex)
  if (!analyte) return null
  
  return {
    lowerLimit: analyte.lowerLimit || '',
    upperLimit: analyte.upperLimit || '',
    unit: analyte.unit || ''
  }
}

// Format Analyte header with properties in compact, creative format
function formatAnalyteHeader(col: ColumnDefinition): string {
  const analyteCode = getAnalyteCode(col)
  const props = getAnalyteProperties(col)
  
  if (!props || (!props.lowerLimit && !props.upperLimit && !props.unit)) {
    return analyteCode
  }
  
  // Creative compact format using HTML for better visual structure
  // Two-line format: AnalyteCode (bold) on top, [LL-UL] unit (smaller) below
  const parts: string[] = []
  
  // Build limits string - compact format: [LL-UL]
  if (props.lowerLimit || props.upperLimit) {
    const limits = []
    if (props.lowerLimit) limits.push(props.lowerLimit)
    if (props.upperLimit) limits.push(props.upperLimit)
    parts.push(`[${limits.join('-')}]`)
  }
  
  // Add unit if available
  if (props.unit) {
    parts.push(props.unit)
  }
  
  // Create two-line format for better readability
  if (parts.length > 0) {
    const propsLine = parts.join(' ')
    return `<div class="analyte-header">
      <div class="analyte-code">${analyteCode}</div>
      <div class="analyte-props">${propsLine}</div>
    </div>`
  }
  
  return analyteCode
}

// Check if column is a selected wavelength
function isSelectedWavelength(col: ColumnDefinition): boolean {
  return col.columnType === 'rawdata' && col.isSelected === true
}

// Build row data map for O(1) row lookups
function buildRowDataMap(): Map<number, any> {
  const rowDataMap = new Map<number, any>()
  tabulatorData.value.forEach((row: any) => {
    if (row.rowIndex !== undefined) {
      rowDataMap.set(row.rowIndex, row)
    }
  })
  return rowDataMap
}

// Get unique row indices from cell references
function getAffectedRows(cells: Array<{rowIndex: number, columnIndex: number}>): Set<number> {
  const rowIndices = new Set<number>()
  cells.forEach(cell => {
    if (cell.rowIndex !== undefined) {
      rowIndices.add(cell.rowIndex)
    }
  })
  return rowIndices
}

// Build single row data for Tabulator format (allows incremental row updates)
function buildSingleRowData(rowIndex: number): any | null {
  if (!store.data) {
    return null
  }
  
  // Use cache directly to avoid triggering computed property recalculation
  const row = store.data.rows.find(r => r.rowIndex === rowIndex)
  if (!row) {
    return null
  }
  
  // Build cell value map for O(1) lookup
  const cellValueMap = new Map<number, string | number>()
  if (!row.values || !Array.isArray(row.values)) {
    return null
  }
  
  row.values.forEach(cell => {
    if (cell && cell.columnIndex !== undefined) {
      cellValueMap.set(cell.columnIndex, cell.value)
    }
  })
  
  const rowObj: any = {
    rowIndex: row.rowIndex,
    // Static columns
    col_0: row.seqNo,
    col_1: row.sampleName,
    col_2: row.travelerNo,
    col_3: row.materialType,
    col_4: row.controlType
  }
  
  // Dynamic columns - use cached filteredColumns to avoid computed recalculation
  // If cache is empty, try to use store.filteredColumns directly (fallback)
  let columnsToUse = cachedFilteredColumns
  if (cachedFilteredColumns.length === 0) {
    columnsToUse = store.filteredColumns
    // Update cache for next time
    cachedFilteredColumns = [...columnsToUse]
  }
  
  if (columnsToUse.length === 0) {
    return rowObj // Return early with only static columns
  }
  
  columnsToUse.forEach((col: ColumnDefinition) => {
    if (col.columnIndex >= STATIC_COLUMN_COUNT) {
      const cellValue = cellValueMap.get(col.columnIndex)
      rowObj[`col_${col.columnIndex}`] = cellValue ?? null
    }
  })
  
  return rowObj
}

// Performance measurement helper (DEV only)
function measurePerformance<T>(operationName: string, operation: () => T): T {
  if (import.meta.env.DEV) {
    const startTime = performance.now()
    const result = operation()
    const endTime = performance.now()
    const duration = endTime - startTime
    console.log(`[Performance] ${operationName}: ${duration.toFixed(2)}ms`)
    return result
  }
  return operation()
}

// Manual Correction dialog functions moved to composable

// Getter for tabulator instance (used by composables)
function getTabulatorInstance(): Tabulator | null {
  return tabulatorInstance
}

// Context menu functions - initialized after tabulatorData is defined
let getCellContextMenu: ((e: MouseEvent, cell: any) => any[]) | null = null

// Convert columns to Tabulator format with grouped headers
// Rebuilds only when filters/schema change, not on cell value changes
const tabulatorColumns = computed(() => {
  // Memoize based on column indices (rebuilding nested structure is expensive)
  const currentColumnIndices = store.filteredColumns.map(c => c.columnIndex).join(',')
  
  // If column indices haven't changed, return cached columns
  if (currentColumnIndices === cachedTabulatorColumnIndices && cachedTabulatorColumns.length > 0) {
    if (import.meta.env.DEV) {
      console.log('tabulatorColumns using cache', {
        filteredColumnsLength: store.filteredColumns.length,
        timestamp: new Date().toISOString()
      })
    }
    return cachedTabulatorColumns
  }
  
  if (import.meta.env.DEV) {
    console.log('tabulatorColumns computed recalculating', {
      filteredColumnsLength: store.filteredColumns.length,
      timestamp: new Date().toISOString()
    })
  }
  
  const columns: any[] = []
  
  // Static columns: 3-level grouped structure (Job/Customer/Columns)
  const staticColumns: any[] = []
  
  // MinWidth for each static column
  const staticColumnMinWidths: Record<number, number> = {
    0: 60,   // SeqNo: numbers
    1: 150,  // SampleName: longest name + note icon
    2: 80,   // TravelerNo: codes
    3: 100,  // MaterialType: codes
    4: 100   // ControlType: codes
  }
  
  store.filteredColumns.forEach(col => {
    if (col.columnIndex < STATIC_COLUMN_COUNT) {
      const staticCol: any = {
        title: col.label,
        field: `col_${col.columnIndex}`,
        // frozen set on parent group, not individual columns (Tabulator requirement)
        minWidth: staticColumnMinWidths[col.columnIndex] || 100,
        widthShrink: 0,
        headerTooltip: col.label,
        cssClass: 'static-column',
        headerSort: false,
      }
      
      // Formatter for SampleName (tooltip and note icon)
      if (col.columnIndex === 1) {
        staticCol.formatter = (cell: any) => cellFormatters.formatSampleName(cell)
      }
      
      staticColumns.push(staticCol)
    }
  })
  
  // Create 3-level nested groups for fixed columns
  if (staticColumns.length > 0 && store.data?.metadata.job) {
    const job = store.data.metadata.job
    // Format date to show only date part (YYYY-MM-DD)
    const formatDate = (dateString: string): string => {
      if (!dateString) return ''
      // Extract date part from ISO string (YYYY-MM-DD)
      const dateMatch = dateString.match(/^(\d{4}-\d{2}-\d{2})/)
      return dateMatch ? dateMatch[1] : dateString
    }
    const formattedDate = formatDate(job.dueDate)
    
    // Level 1: Job/Due Date, Level 2: Customer, Level 3: Columns
    // Note: frozen must be on topmost parent only, not nested groups
    columns.push({
      title: `Job: ${job.code}, Due Date: ${formattedDate}`, // Row 1
      frozen: true, // Only topmost parent should have frozen
      headerSort: false,
      cssClass: 'static-columns-group',
      columns: [{
        title: `Customer: ${job.customerName} (${job.customerCode})`, // Row 2
        // Note: Do NOT set frozen here - only topmost parent has frozen
        headerSort: false,
        columns: staticColumns // Row 3: Individual columns
      }]
    })
  } else if (staticColumns.length > 0) {
    // Fallback: if no job info, wrap in a frozen group
    // Tabulator requires frozen to be on parent group, not individual columns
    columns.push({
      title: 'Static Columns',
      frozen: true,
      headerSort: false,
      cssClass: 'static-columns-group',
      columns: staticColumns
    })
  }
  
  // Dynamic columns: three-level header (Service Item → Analyte → Column)
  const serviceItemGroups = new Map<number, ColumnDefinition[]>()
  
  store.filteredColumns.forEach(col => {
    if (col.columnIndex >= STATIC_COLUMN_COUNT) {
      const siIndex = col.serviceItemIndex
      if (!serviceItemGroups.has(siIndex)) {
        serviceItemGroups.set(siIndex, [])
      }
      serviceItemGroups.get(siIndex)!.push(col)
    }
  })
  
  // Create column groups for each Service Item
  serviceItemGroups.forEach((cols, siIndex) => {
    const serviceItemCode = getServiceItemCode(cols[0])
    
    // Group by Analyte
    const analyteGroups = new Map<number, ColumnDefinition[]>()
    cols.forEach(col => {
      const analyteIndex = col.analyteIndex
      if (!analyteGroups.has(analyteIndex)) {
        analyteGroups.set(analyteIndex, [])
      }
      analyteGroups.get(analyteIndex)!.push(col)
    })
    
    // Create nested groups: Service Item → Analyte → Column
    const analyteColumnGroups: any[] = []
    
    analyteGroups.forEach((analyteCols, analyteIndex) => {
      const analyteHeader = formatAnalyteHeader(analyteCols[0])
      
      const columnsForAnalyte = analyteCols.map(col => {
        const headerLabel = isSelectedWavelength(col) ? `${col.label} *` : col.label
        
        const columnDef: any = {
          title: headerLabel,
          field: `col_${col.columnIndex}`,
          width: 120,
          headerTooltip: col.label,
          cssClass: `column-type-${col.columnType}`,
          headerSort: false,
          resizable: true,
          contextMenu: getCellContextMenu || undefined
        }
        
        // Formatter for result columns (final indicator)
        if (col.columnType === 'result') {
          columnDef.formatter = (cell: any) => cellFormatters.formatResultCell(cell, col)
        }
        
        return columnDef
      })
      
      analyteColumnGroups.push({
        title: analyteHeader,
        columns: columnsForAnalyte
      })
    })
    
    // Add Service Item group with Analyte subgroups
    columns.push({
      title: serviceItemCode,
      columns: analyteColumnGroups,
      headerSort: false // Disable sorting on group headers
    })
  })
  
  // Cache result for next time
  cachedTabulatorColumns = columns
  cachedTabulatorColumnIndices = store.filteredColumns.map(c => c.columnIndex).join(',')
  
  return columns
})

// Helper to compare arrays logically (for computed stability)
function arraysEqual(arr1: any[], arr2: any[]): boolean {
  if (arr1.length !== arr2.length) return false
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i].rowIndex !== arr2[i].rowIndex) return false
    // Compare row data keys
    const keys1 = Object.keys(arr1[i])
    const keys2 = Object.keys(arr2[i])
    if (keys1.length !== keys2.length) return false
    for (const key of keys1) {
      if (arr1[i][key] !== arr2[i][key]) return false
    }
  }
  return true
}

// Convert row data to Tabulator format (memoized - only rebuilds changed rows)
const tabulatorData = computed((oldValue: any[] | undefined) => {
  if (!store.data) {
    // Clear cache when data is cleared
    rowCache.clear()
    lastDataRef.value = null
    lastFilteredColumns.value = []
    lastFilteredRowsCount.value = null
    previousTabulatorData = []
    cachedFilteredColumns = []
    cachedColumnIndicesString = ''
    // Clear tabulatorColumns cache
    cachedTabulatorColumns = []
    cachedTabulatorColumnIndices = ''
    return []
  }
  
  // Check if data reference changed (new data loaded - must clear cache)
  if (store.data !== lastDataRef.value) {
    rowCache.clear()
    lastDataRef.value = store.data
    lastFilteredColumns.value = []
    lastFilteredRowsCount.value = null
  }
  
  // Detect filteredColumns changes using column indices comparison
  let filteredColsChanged = false
  let currentFilteredColumns: ColumnDefinition[] = []
  
  if (cachedFilteredColumns.length === 0) {
    // First load - must access store.filteredColumns to initialize cache
    currentFilteredColumns = store.filteredColumns
    cachedFilteredColumns = [...currentFilteredColumns]
    cachedColumnIndicesString = currentFilteredColumns.map(col => col.columnIndex).join(',')
    filteredColsChanged = true // Treat first load as column change to rebuild all rows
  } else {
    // Compare column indices for accurate change detection
    const currentColumnIndices = store.filteredColumns.map(col => col.columnIndex).join(',')
    
    if (currentColumnIndices !== cachedColumnIndicesString) {
      // Columns changed - update cache
      currentFilteredColumns = store.filteredColumns
      cachedFilteredColumns = [...currentFilteredColumns]
      cachedColumnIndicesString = currentColumnIndices
      filteredColsChanged = true
    } else {
      // Columns unchanged - use cached columns
      currentFilteredColumns = cachedFilteredColumns
      filteredColsChanged = false
    }
  }
  
  // Detect filteredRows changes (row filtering by service item traveler numbers)
  // Track previous filtered rows count to detect changes
  const currentFilteredRowsCount = store.filteredRows.length
  const previousFilteredRowsCount = lastFilteredRowsCount.value ?? -1
  const filteredRowsChanged = currentFilteredRowsCount !== previousFilteredRowsCount
  
  if (filteredColsChanged || filteredRowsChanged) {
    // Columns or rows changed - rebuild all rows
    rowCache.clear()
    lastFilteredColumns.value = [...currentFilteredColumns]
    lastFilteredRowsCount.value = currentFilteredRowsCount
    previousTabulatorData = [] // Clear previous result on column/row change
    // Clear tabulatorColumns cache when columns change
    if (filteredColsChanged) {
      cachedTabulatorColumns = []
      cachedTabulatorColumnIndices = ''
    }
  }
  
  // Optimize: reuse previous result and only update changed rows
  let result: any[] = []
  let rebuiltCount = 0
  let reusedCount = 0
  
  // If no rows changed and columns didn't change, reuse previous result entirely
  const changedRowCount = store.changedRowIndices.size
  if (!filteredColsChanged && changedRowCount === 0 && previousTabulatorData.length === store.filteredRows.length) {
    // No changes - reuse previous result
    result = previousTabulatorData
    reusedCount = result.length
  } else if (filteredColsChanged || filteredRowsChanged || previousTabulatorData.length === 0) {
    // Columns changed or first load - must rebuild all rows (unavoidable - O(rows))
    store.filteredRows.forEach(row => {
      const rowIndex = row.rowIndex
      const rowObj = buildSingleRowData(rowIndex)
      if (rowObj) {
        rowCache.set(rowIndex, rowObj)
        result.push(rowObj)
        rebuiltCount++
      }
    })
  } else {
    // Only some rows changed - reuse previous result and update changed rows
    // Start with shallow copy of previous result
    result = [...previousTabulatorData]
    
    // Update only changed rows - iterate only changedRowIndices, not all rows
    store.changedRowIndices.forEach(rowIndex => {
      const rowObj = buildSingleRowData(rowIndex)
      if (rowObj) {
        rowCache.set(rowIndex, rowObj)
        // Find and replace the row in result array
        const index = result.findIndex(r => r.rowIndex === rowIndex)
        if (index >= 0) {
          result[index] = rowObj
        } else {
          // Row not in previous result (safety check)
          result.push(rowObj)
        }
        rebuiltCount++
      }
    })
    
    // Count reused rows (all rows minus changed rows)
    reusedCount = result.length - rebuiltCount
  }
  
  // Update previous result for next computation
  previousTabulatorData = result
  lastFilteredRowsCount.value = currentFilteredRowsCount
  
  // Vue 3 computed stability: return oldValue if data is logically unchanged
  // CRITICAL: Skip stability check if formatter refresh is needed (isFinal flag changes don't affect row data values)
  // REASONING: When marking cells as final, the cell value doesn't change, only metadata (isFinal flag) changes.
  // The formatter reads isFinal from the store, not from row data. So arraysEqual returns true (data appears unchanged),
  // but we still need the watch to trigger to refresh formatters. Skip stability check when needsFormatterRefresh is true.
  if (!needsFormatterRefresh.value && oldValue && Array.isArray(oldValue) && oldValue.length === result.length && arraysEqual(oldValue, result)) {
    return oldValue // Prevents unnecessary watch triggers
  }
  
  // Performance logging to verify cache effectiveness
  if (import.meta.env.DEV && (rebuiltCount > 0 || reusedCount > 0)) {
    const totalRows = store.filteredRows.length
    if (rebuiltCount < totalRows * 0.1) { // Only log if cache is effective (<10% rebuild)
      const reuseRate = totalRows > 0 ? ((reusedCount / totalRows) * 100).toFixed(1) : '0'
      console.log(`[Performance] tabulatorData optimization: ${rebuiltCount} rebuilt, ${reusedCount} reused (${reuseRate}% reuse rate)`)
    }
  }
  
  return result
})

// Initialize grid actions composable (must be after tabulatorData is defined)
const gridActions = useGridActions({
  getTabulatorInstance,
  tabulatorData,
  isCopyingToResult,
  needsFormatterRefresh,
  isCellFinal
})

// Extract Manual Correction dialog state from composable
const {
  showManualCorrectionDialog,
  manualCorrectionColumn,
  manualCorrectionRowIndex,
  openManualCorrectionDialog,
  closeManualCorrectionDialog,
  applyBaselineCorrection,
  applyMultiplier
} = gridActions

// Initialize context menu composable (must be after gridActions is defined)
const contextMenuResult = useContextMenu({
  getTabulatorInstance,
  isCopyingToResult,
  isCellFinal,
  extractSelectedResultRows,
  hasAnyFinalResult,
  openRequestModal,
  handleCopyToResultCell: gridActions.handleCopyToResultCell,
  handleUseWavelengthCell: gridActions.handleUseWavelengthCell,
  handleManualCorrectionCell: gridActions.handleManualCorrectionCell,
  handleMarkFinalCell: gridActions.handleMarkFinalCell,
  handleClearResultsCell: gridActions.handleClearResultsCell
})

// Assign context menu functions to variables for use in tabulatorColumns
getCellContextMenu = contextMenuResult.getCellContextMenu

// Initialize cell formatters composable
const cellFormatters = useCellFormatters()

// Initialize Tabulator
function initializeTabulator() {
  // Allow initialization if container exists
  // We always use ajaxRequestFunc now (even in dev mode), so we can initialize without data
  if (!gridContainerRef.value) return
  
  // Destroy existing instance if any
  if (tabulatorInstance) {
    tabulatorInstance.destroy()
    tabulatorInstance = null
  }
  
  // Create custom ajax function that uses our apiClient (works in both dev and production)
  // REASONING: apiClient is smart - returns sample data in dev mode, real API in production
  // This allows ajaxRequestFunc to be blind to the data source
  const customAjaxRequest = async (url: string, config: any, params: any) => {
    if (import.meta.env.DEV) {
      console.log('[ajaxRequestFunc] Called with:', { url, hasStoreData: !!store.data, hasApiEndpoint: !!store.apiEndpoint })
    }
    
    try {
      // Use pre-loaded data if available (dev mode) - allows loader to show
      if (store.data && !store.apiEndpoint) {
        if (import.meta.env.DEV) {
          console.log('[ajaxRequestFunc] Data already in store, using it directly')
        }
        
        // Small delay to ensure loader is visible
        await new Promise(resolve => setTimeout(resolve, 100))
        await nextTick()
        
        const transformedData = tabulatorData.value
        
        if (import.meta.env.DEV) {
          console.log('[ajaxRequestFunc] Using pre-loaded data from store:', {
            rowsCount: transformedData.length,
            columnsCount: tabulatorColumns.value.length,
            sampleRow: transformedData[0]
          })
        }
        
        return transformedData
      }
      
      // Use apiClient (handles dev/production automatically)
      const apiClient = createApiClient({ 
        csrfToken: store.csrfToken || undefined,
        useSampleData: !store.apiEndpoint
      })
      
      if (import.meta.env.DEV) {
        console.log('[ajaxRequestFunc] Fetching data via apiClient:', url)
      }
      
      const response = await apiClient.get(url)
      
      if (!response.ok) {
        throw new Error(`Failed to load data: ${response.status} ${response.statusText}`)
      }
      
      const payload = await response.json()
      
      store.data = payload
      await nextTick()
      
      const transformedData = tabulatorData.value
      
      if (import.meta.env.DEV) {
        console.log('[ajaxRequestFunc] Data loaded and transformed:', {
          rowsCount: transformedData.length,
          columnsCount: tabulatorColumns.value.length
        })
      }
      
      return transformedData
    } catch (error: any) {
      console.error('[ajaxRequestFunc] Error loading data:', error)
      throw error
    }
  }
  
  // Determine if we should use ajaxRequestFunc
  // REASONING: Always use ajaxRequestFunc to ensure loader shows (even in dev mode with pre-loaded data)
  // This ensures consistent UX - loader always appears during data loading
  const shouldUseAjax = true // Always use ajaxRequestFunc for loader support
  
  // Priority 1: Use Tabulator's built-in loader with ajaxRequestFunc
  // REASONING: Tabulator's dataLoader automatically shows loader when ajaxRequestFunc is used
  // Reference: Tabulator 6.3 docs - ajaxRequestFunc option
  // Build Tabulator config object
  const tabulatorConfig: any = {
    data: [], // Start with empty data - no blocking during initialization
    dataLoader: true, // Enable built-in loader (default: true, but explicit for clarity)
    dataLoaderLoading: generateTabulatorLoaderHTML('Rendering grid...'), // Consistent loader design - matches DataLoader.vue
    columns: tabulatorColumns.value,
    index: 'rowIndex', // Use rowIndex as the unique identifier for rows (required for updateData)
    layout: 'fitColumns', // Fit columns to available width
    layoutColumnsOnNewData: true, // Recalculate column widths when data changes
    height: '100%',
    virtualDom: true, // Enable virtualization
    selectableRange: true, // Enable cell range selection
    selectableRangeColumns: true,
    selectableRangeRows: true,
    // Note: Warning about frozen columns with selectRange is expected
    // Static columns (frozen) are not part of range selection and are informational only.
    // Range selection only applies to dynamic columns (columnIndex >= STATIC_COLUMN_COUNT).
    resizableColumns: true,
    movableColumns: false,
    placeholder: 'No Data Available',
    // Disable sorting globally to avoid warnings with selectableRangeColumns
    initialSort: [],
    sortable: false, // Disable sorting on all columns by default
    columnDefaults: {
      headerSort: false, // Explicitly disable sorting on all columns (including group headers)
      resizable: true // Make all columns resizable
    },
    // Performance optimizations
    renderStart: () => {
      if (import.meta.env.DEV) {
        console.time('tabulator-render')
      }
    },
    renderComplete: () => {
      if (import.meta.env.DEV) {
        console.timeEnd('tabulator-render')
        const rowCount = tabulatorInstance && typeof tabulatorInstance.getRowsCount === 'function'
          ? tabulatorInstance.getRowsCount()
          : 'N/A'
        const colCount = tabulatorInstance && typeof tabulatorInstance.getColumns === 'function'
          ? tabulatorInstance.getColumns().length
          : tabulatorColumns.value.length
        console.log('Tabulator render complete:', {
          rows: rowCount,
          columns: colCount
        })
      }
    }
  }
  
  // Use ajaxRequestFunc to ensure loader shows (works in dev and production)
  tabulatorConfig.ajaxURL = store.apiEndpoint || '/dev-data'
  tabulatorConfig.ajaxRequestFunc = customAjaxRequest
  
  if (import.meta.env.DEV) {
    console.log('[Priority 1] Tabulator initialized with ajaxRequestFunc, loader will show automatically', {
      apiEndpoint: store.apiEndpoint || 'dev mode (using pre-loaded data)',
      columnsCount: tabulatorColumns.value.length,
      hasPreLoadedData: !!store.data
    })
  }
  
  tabulatorInstance = new Tabulator(gridContainerRef.value, tabulatorConfig)
  
  // Manually trigger data load after tableBuilt to ensure ajaxRequestFunc is called
  tabulatorInstance.on("tableBuilt", () => {
    if (import.meta.env.DEV) {
      console.log('[Priority 1] Table built, triggering data load via setData() to ensure ajaxRequestFunc is called', {
        ajaxURL: tabulatorConfig.ajaxURL,
        hasAjaxRequestFunc: !!tabulatorConfig.ajaxRequestFunc
      })
    }
    
    const urlToLoad = store.apiEndpoint || '/dev-data'
    tabulatorInstance.setData(urlToLoad)
      .then(() => {
        if (import.meta.env.DEV) {
          const rowCount = tabulatorInstance && typeof tabulatorInstance.getRowsCount === 'function'
            ? tabulatorInstance.getRowsCount()
            : 'N/A'
          const colCount = tabulatorInstance && typeof tabulatorInstance.getColumns === 'function'
            ? tabulatorInstance.getColumns().length
            : tabulatorColumns.value.length
          console.log('[Priority 1] Data loaded successfully via ajaxRequestFunc', {
            rows: rowCount,
            columns: colCount
          })
        }
      })
      .catch((error: any) => {
        console.error('[Priority 1] Error loading data via ajaxRequestFunc:', error)
      })
  })
}

// Update Tabulator when data or columns change (smart watch - only update what actually changed)
watch([tabulatorData, tabulatorColumns], (newVals, oldVals) => {
  if (!tabulatorInstance) return
  
  const [newData, newColumns] = newVals
  const [oldData, oldColumns] = oldVals || [[], []]
  
  // Compare column structure (extract field names since functions can't be stringified)
  const currentFields = extractColumnFields(newColumns)
  // Initialize lastColumnFields if empty (first watch after initialization)
  if (lastColumnFields.value.length === 0 && newColumns.length > 0) {
    lastColumnFields.value = currentFields
  }
  const columnsChanged = !oldColumns || 
    oldColumns.length === 0 ||
    newColumns.length !== oldColumns.length ||
    JSON.stringify(currentFields) !== JSON.stringify(lastColumnFields.value)
  
  // Use incremental updates when possible (optimizing DOM updates, not data computation)
  
  // Performance measurement - track watch trigger time
  const watchStartTime = import.meta.env.DEV ? performance.now() : 0
  
  if (import.meta.env.DEV) {
    console.log('Watch triggered: tabulatorData changed', {
      newLength: newData?.length,
      oldLength: oldData?.length,
      columnsChanged,
      changedRowCount: store.changedRowIndices.size,
      needsFormatterRefresh: needsFormatterRefresh.value,
      sampleRow: newData?.[0]
    })
  }
  
  // For single cell changes, update immediately (nextTick adds ~16ms delay)
  const changedRowCount = store.changedRowIndices.size
  const isSingleCellChange = changedRowCount === 1 && !columnsChanged && oldData && oldData.length > 0
  
  if (isSingleCellChange) {
    // Immediate update for single cell
    const buildStart = import.meta.env.DEV ? performance.now() : 0
    const changedRows = Array.from(store.changedRowIndices)
    const rowsToUpdate = changedRows
      .map(rowIndex => buildSingleRowData(rowIndex))
      .filter(row => row !== null)
    const buildEnd = import.meta.env.DEV ? performance.now() : 0
    
    if (rowsToUpdate.length > 0) {
      const immediateUpdateStart = import.meta.env.DEV ? performance.now() : 0
      const updateDataStart = import.meta.env.DEV ? performance.now() : 0
      
      tabulatorInstance.updateData(rowsToUpdate)
        .then(() => {
          const updateDataEnd = import.meta.env.DEV ? performance.now() : 0
          
          if (import.meta.env.DEV) {
            const immediateUpdateEnd = performance.now()
            const immediateDuration = immediateUpdateEnd - immediateUpdateStart
            const totalWatchDuration = immediateUpdateEnd - watchStartTime
            console.log(`[Performance] Immediate update breakdown:`, {
              buildRowData: `${(buildEnd - buildStart).toFixed(2)}ms`,
              updateData: `${(updateDataEnd - updateDataStart).toFixed(2)}ms`,
              total: `${immediateDuration.toFixed(2)}ms`,
              totalWatch: `${totalWatchDuration.toFixed(2)}ms`
            })
          }
          
          // Formatter refresh after update completes
          if (needsFormatterRefresh.value) {
            nextTick(() => {
              const reformatStart = import.meta.env.DEV ? performance.now() : 0
              let reformattedCount = 0
              let failedCount = 0
              for (const rowIndex of changedRows) {
                const rowComponent = tabulatorInstance.getRow(rowIndex)
                if (rowComponent) {
                  rowComponent.reformat()
                  reformattedCount++
                } else {
                  failedCount++
                  if (import.meta.env.DEV) {
                    console.warn(`[Formatter] Row ${rowIndex} not found for reformat() - will use fallback`)
                  }
                }
              }
              if (failedCount > 0) {
                if (import.meta.env.DEV) {
                  console.warn(`[Formatter] ${failedCount} row(s) failed to reformat, using redraw(true) fallback`)
                }
                // Fallback: use redraw(true) if reformat() fails (will reset scroll, but better than nothing)
                tabulatorInstance.redraw(true)
              }
              const reformatDuration = import.meta.env.DEV ? performance.now() - reformatStart : 0
              if (import.meta.env.DEV && reformattedCount > 0) {
                console.log(`[Formatter] Reformatted ${reformattedCount} row(s) in ${reformatDuration.toFixed(2)}ms`)
              }
              needsFormatterRefresh.value = false
            })
          }
          
          store.clearChangedRows()
        })
        .catch((error: any) => {
          console.error('Error updating Tabulator:', error)
          // Fallback to full update
          tabulatorInstance.setData(newData)
            .then(() => {
              if (import.meta.env.DEV) {
                const fallbackEnd = performance.now()
                const fallbackDuration = fallbackEnd - immediateUpdateStart
                const totalWatchDuration = fallbackEnd - watchStartTime
                console.log(`[Performance] Immediate update failed, used fallback (setData): ${fallbackDuration.toFixed(2)}ms (total watch: ${totalWatchDuration.toFixed(2)}ms)`)
              }
              store.clearChangedRows()
            })
            .catch((fallbackError: any) => {
              console.error('Fallback setData also failed:', fallbackError)
              store.clearChangedRows()
            })
        })
      
      return // Skip nextTick path
    }
  }
  
  // For batch operations or column changes, use nextTick
  nextTick(() => {
    if (columnsChanged) {
      const columnUpdateStart = import.meta.env.DEV ? performance.now() : 0
      lastColumnFields.value = currentFields
      
      // setColumns() is synchronous in Tabulator 6.3, doesn't return a promise
      const setColumnsStart = import.meta.env.DEV ? performance.now() : 0
      tabulatorInstance.setColumns(newColumns)
      const setColumnsEnd = import.meta.env.DEV ? performance.now() : 0
      
      // Force header redraw after columns set
      nextTick(() => {
        if (tabulatorInstance) {
          tabulatorInstance.redraw(true)
        }
      })
      
      // When columns change, must use setData (structure changed)
      const setDataStart = import.meta.env.DEV ? performance.now() : 0
      tabulatorInstance.setData(newData)
        .then(() => {
          const setDataEnd = import.meta.env.DEV ? performance.now() : 0
          store.clearChangedRows()
          
          // Clear filtering state after column update
          nextTick(() => {
            store.isFiltering = false
          })
          
          if (import.meta.env.DEV) {
            const columnUpdateEnd = performance.now()
            const columnUpdateDuration = columnUpdateEnd - columnUpdateStart
            const totalWatchDuration = columnUpdateEnd - watchStartTime
            console.log(`[Performance] Column update breakdown:`, {
              setColumns: `${(setColumnsEnd - setColumnsStart).toFixed(2)}ms`,
              setData: `${(setDataEnd - setDataStart).toFixed(2)}ms`,
              total: `${columnUpdateDuration.toFixed(2)}ms`,
              totalWatch: `${totalWatchDuration.toFixed(2)}ms`
            })
          }
        })
        .catch((error: any) => {
          console.error('Error updating columns/data:', error)
          store.clearChangedRows()
          nextTick(() => {
            store.isFiltering = false
          })
        })
    } else {
      // Columns unchanged - use incremental update when possible
      if (!oldData || oldData.length === 0) {
        // First load - use replaceData() to preserve state
        const firstLoadStart = import.meta.env.DEV ? performance.now() : 0
        tabulatorInstance.replaceData(newData)
          .then(() => {
            store.clearChangedRows()
            
            // Clear filtering state after first load completes
            nextTick(() => {
              store.isFiltering = false
            })
            
            if (import.meta.env.DEV) {
              const firstLoadEnd = performance.now()
              const firstLoadDuration = firstLoadEnd - firstLoadStart
              const totalWatchDuration = firstLoadEnd - watchStartTime
              console.log(`[Performance] First load (replaceData): ${firstLoadDuration.toFixed(2)}ms (total watch: ${totalWatchDuration.toFixed(2)}ms)`)
            }
          })
          .catch((error: any) => {
            console.error('Error loading data:', error)
            store.clearChangedRows()
            nextTick(() => {
              store.isFiltering = false
            })
          })
      } else {
        // Existing data - use incremental update if applicable
        const changedRows = Array.from(store.changedRowIndices)
        
        // Skip update if no rows changed (tabulatorData may recalculate even when nothing changed)
        if (changedRows.length === 0) {
          // Clear filtering state when no changes detected
          store.isFiltering = false
          if (import.meta.env.DEV) {
            console.log(`[Performance] Watch triggered but no changes - skipping update`)
          }
          return // Exit early - no update needed
        }
        
        if (changedRows.length > 0 && changedRows.length < newData.length * 0.5) {
          // Update only changed rows (if < 50% of rows changed)
          const rowsToUpdate = changedRows
            .map(rowIndex => buildSingleRowData(rowIndex))
            .filter(row => row !== null)
          if (rowsToUpdate.length > 0) {
            const incrementalUpdateStart = import.meta.env.DEV ? performance.now() : 0
            let reformatDuration = 0
            
            // Block redraw for bulk operations (multiple rows)
            const isBulkUpdate = rowsToUpdate.length > 1
            if (isBulkUpdate) {
              tabulatorInstance.blockRedraw()
            }
            
            tabulatorInstance.updateData(rowsToUpdate)
              .then(() => {
                // Restore redraw FIRST (triggers automatic redraw if needed)
                // CRITICAL: Must restore before calling redraw(true) for formatter refresh
                if (isBulkUpdate) {
                  tabulatorInstance.restoreRedraw()
                }
                
                // Formatter refresh after redraw is restored
                if (needsFormatterRefresh.value) {
                  nextTick(() => {
                    const reformatStart = import.meta.env.DEV ? performance.now() : 0
                    // Use reformat() on each row to refresh formatters while preserving scroll position
                    // reformat() preserves both horizontal and vertical scroll, unlike redraw() or refreshData()
                    let reformattedCount = 0
                    let failedCount = 0
                    for (const row of rowsToUpdate) {
                      const rowComponent = tabulatorInstance.getRow(row.rowIndex)
                      if (rowComponent) {
                        rowComponent.reformat()
                        reformattedCount++
                      } else {
                        failedCount++
                        if (import.meta.env.DEV) {
                          console.warn(`[Formatter] Row ${row.rowIndex} not found for reformat()`)
                        }
                      }
                    }
                    
                    // Fallback to redraw(true) only if all rows failed
                    if (failedCount === rowsToUpdate.length) {
                      if (import.meta.env.DEV) {
                        console.warn(`[Formatter] All rows failed to reformat, using redraw(true) fallback`)
                      }
                      tabulatorInstance.redraw(true)
                    }
                    
                    reformatDuration = import.meta.env.DEV ? performance.now() - reformatStart : 0
                    if (import.meta.env.DEV) {
                      console.log(`[Formatter] Reformatted ${reformattedCount} row(s) in ${reformatDuration.toFixed(2)}ms`)
                    }
                    needsFormatterRefresh.value = false
                  })
                }
                
                if (import.meta.env.DEV) {
                  const incrementalUpdateEnd = performance.now()
                  const incrementalDuration = incrementalUpdateEnd - incrementalUpdateStart
                  const totalWatchDuration = incrementalUpdateEnd - watchStartTime
                  console.log(`[Performance] Incremental update (${rowsToUpdate.length} rows): ${incrementalDuration.toFixed(2)}ms (reformat: ${reformatDuration.toFixed(2)}ms, total watch: ${totalWatchDuration.toFixed(2)}ms)`)
                }
                
                store.clearChangedRows()
              })
              .catch((error: any) => {
                console.error('Error updating data:', error)
                
                // Restore redraw before fallback
                if (isBulkUpdate) {
                  tabulatorInstance.restoreRedraw()
                }
                
                // Fallback to full update with replaceData() to preserve state
                tabulatorInstance.replaceData(newData)
                  .then(() => {
                    store.clearChangedRows()
                  })
                  .catch((fallbackError: any) => {
                    console.error('Fallback replaceData also failed:', fallbackError)
                    store.clearChangedRows()
                  })
              })
          } else {
            store.clearChangedRows()
          }
        } else {
          // Too many rows changed - use full update with replaceData() to preserve state
          const fullUpdateStart = import.meta.env.DEV ? performance.now() : 0
          let reformatDuration = 0
          
          tabulatorInstance.replaceData(newData)
            .then(() => {
              // For full updates, use reformat() on changed rows to preserve scroll position
              if (needsFormatterRefresh.value) {
                nextTick(() => {
                  const reformatStart = import.meta.env.DEV ? performance.now() : 0
                  // Use reformat() on changed rows to refresh formatters while preserving scroll position
                  // reformat() preserves both horizontal and vertical scroll, unlike redraw() or refreshData()
                  const changedRows = Array.from(store.changedRowIndices)
                  let reformattedCount = 0
                  let failedCount = 0
                  
                  for (const rowIndex of changedRows) {
                    const rowComponent = tabulatorInstance.getRow(rowIndex)
                    if (rowComponent) {
                      rowComponent.reformat()
                      reformattedCount++
                    } else {
                      failedCount++
                    }
                  }
                  
                  // Fallback to redraw(true) only if all rows failed
                  if (failedCount === changedRows.length && changedRows.length > 0) {
                    if (import.meta.env.DEV) {
                      console.warn(`[Formatter] All rows failed to reformat, using redraw(true) fallback`)
                    }
                    tabulatorInstance.redraw(true)
                  }
                  
                  reformatDuration = import.meta.env.DEV ? performance.now() - reformatStart : 0
                  if (import.meta.env.DEV) {
                    console.log(`[Formatter] Reformatted ${reformattedCount} row(s) in ${reformatDuration.toFixed(2)}ms`)
                  }
                  needsFormatterRefresh.value = false
                })
              }
              
              store.clearChangedRows()
              
              // Clear filtering state after full update
              nextTick(() => {
                store.isFiltering = false
              })
              
              if (import.meta.env.DEV) {
                const fullUpdateEnd = performance.now()
                const fullUpdateDuration = fullUpdateEnd - fullUpdateStart
                const totalWatchDuration = fullUpdateEnd - watchStartTime
                console.log(`[Performance] Full update (replaceData, ${changedRows.length} changed rows): ${fullUpdateDuration.toFixed(2)}ms (reformat: ${reformatDuration.toFixed(2)}ms, total watch: ${totalWatchDuration.toFixed(2)}ms)`)
              }
            })
            .catch((error: any) => {
              console.error('Error updating data:', error)
              store.clearChangedRows()
              nextTick(() => {
                store.isFiltering = false
              })
            })
        }
      }
    }
  })
})

// Set grid height to fill container
function setGridHeight() {
  if (!gridWrapperRef.value || !gridContainerRef.value || !tabulatorInstance) return
  
  try {
    const filtersEl = gridWrapperRef.value.parentElement?.querySelector('.filters') as HTMLElement
    const filtersHeight = filtersEl ? filtersEl.offsetHeight : 60
    
    const wrapper = gridWrapperRef.value.parentElement as HTMLElement
    const wrapperHeight = wrapper ? wrapper.offsetHeight : window.innerHeight
    const height = wrapperHeight - filtersHeight
    
    if (height > 0) {
      // Use setTimeout to ensure Tabulator is fully rendered before setting height
      setTimeout(() => {
        if (tabulatorInstance) {
          tabulatorInstance.setHeight(height)
        }
      }, 0)
    }
  } catch (error) {
    // Silently handle errors if Tabulator isn't ready yet
    if (import.meta.env.DEV) {
      console.warn('Could not set grid height:', error)
    }
  }
}

// Check if result cell is marked as final (uses rowMap and cellMap for O(1) lookups)
function isCellFinal(rowIndex: number, columnIndex: number): boolean {
  if (!store.data) return false
  
  const row = store.rowMap.get(rowIndex)
  if (!row) return false
  const rowCellMap = store.cellMap.get(rowIndex)
  const cell = rowCellMap?.get(columnIndex)
  return cell?.isFinal === true
}

// Check if a row has any final result cells (used to filter out "final" sample rows)
function hasAnyFinalResult(rowIndex: number): boolean {
  if (!store.data) return false
  
  const row = store.rowMap.get(rowIndex)
  if (!row) return false
  
  // Check all result columns for this row
  return store.filteredColumns
    .filter(col => col.columnType === 'result')
    .some(col => {
      const cell = store.cellMap.get(rowIndex)?.get(col.columnIndex)
      return cell?.isFinal === true
    })
}

// Extract selected result rows from multi-cell selection (filters out rows with final result cells)
function extractSelectedResultRows(selectedRanges: any[], clickedColumn: ColumnDefinition): Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}> {
  // Use validation helper
  if (!validateTabulatorOperation(tabulatorInstance, store.data)) {
    return []
  }
  
  // Use cell extraction utility with row-only extraction (pass tabulatorData for fallback method)
  const extractedCells = extractCellsFromRanges(
    tabulatorInstance,
    selectedRanges,
    {
      columnFilter: (colDef) => colDef?.columnType === 'result',
      extractRowsOnly: true,
      tabulatorData: tabulatorData.value,
      columnMap: store.columnMap
    }
  )
  
  if (import.meta.env.DEV) {
    console.log('extractSelectedResultRows: Extracted cells:', extractedCells.length, extractedCells)
  }
  
  // Extract unique row indices
  const rowIndices = new Set<number>()
  extractedCells.forEach(cell => {
    if (cell.rowIndex >= 0) {
      rowIndices.add(cell.rowIndex)
    }
  })
  
  if (import.meta.env.DEV) {
    console.log('extractSelectedResultRows: Found row indices:', Array.from(rowIndices))
  }
  
  // Filter out rows with any final result cells and build result array
  const resultRows: Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}> = []
  rowIndices.forEach(rowIndex => {
    // Skip rows that have any final result cells
    if (hasAnyFinalResult(rowIndex)) {
      if (import.meta.env.DEV) {
        console.log(`extractSelectedResultRows: Skipping row ${rowIndex} (has final result)`)
      }
      return
    }
    
    const row = store.rowMap.get(rowIndex)
    if (!row) {
      if (import.meta.env.DEV) {
        console.warn(`extractSelectedResultRows: Row ${rowIndex} not found in rowMap`)
      }
      return
    }
    
    // Use the clicked column's serviceItemIndex
    const serviceItemIndex = clickedColumn.serviceItemIndex
    
    // Only add if not already in result (avoid duplicates)
    if (!resultRows.find(r => r.rowIndex === rowIndex)) {
      resultRows.push({ rowIndex, rowData: row, serviceItemIndex })
    }
  })
  
  if (import.meta.env.DEV) {
    console.log('extractSelectedResultRows: Returning', resultRows.length, 'rows')
  }
  
  return resultRows
}

// Action handlers provided by useGridActions composable

// Open request modal for repeat or overlimit requests
function openRequestModal(
  requestType: 'repeat' | 'overlimit',
  selectedRows: Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}>,
  clickedColumn: ColumnDefinition
) {
  if (selectedRows.length === 0) {
    showToast('warning', 'No valid samples selected for request')
    return
  }
  
  requestModalType.value = requestType
  requestModalRows.value = selectedRows
  requestModalServiceItemIndex.value = clickedColumn.serviceItemIndex
  showRequestModal.value = true
}

// Close request modal
function closeRequestModal() {
  showRequestModal.value = false
  requestModalType.value = null
  requestModalRows.value = []
  requestModalServiceItemIndex.value = -1
}


// Manual Correction functions moved to composable

// Watch filter change counter to clear cache BEFORE filteredColumns recalculates (counter increments synchronously)
// This ensures cache is cleared before tabulatorColumns computed accesses it
watch(() => store.filterChangeCounter, () => {
  // Filter state changed - clear caches BEFORE filteredColumns recalculates
  cachedFilteredColumns = []
  cachedColumnIndicesString = ''
  cachedTabulatorColumns = []
  cachedTabulatorColumnIndices = ''
  lastFilteredColumns.value = [] // Signal that columns changed
  rowCache.clear() // Also clear row cache when filters change
  previousTabulatorData = [] // Clear previous tabulator data
  
  if (import.meta.env.DEV) {
    console.log('[Performance] Filter change detected - caches cleared', {
      serviceItemIndex: store.selectedServiceItemIndex,
      showReportableOnly: store.showReportableOnly,
      viewMode: store.viewMode,
      counter: store.filterChangeCounter,
      timestamp: new Date().toISOString()
    })
  }
}, { flush: 'sync' })

// Watch selectedServiceItemIndex to clear row cache when filter changes
watch(() => store.selectedServiceItemIndex, () => {
  // Row filter changed - clear row cache
  rowCache.clear()
  previousTabulatorData = []
  
  if (import.meta.env.DEV) {
    console.log('[Performance] Service item filter changed - row cache cleared', {
      serviceItemIndex: store.selectedServiceItemIndex,
      timestamp: new Date().toISOString()
    })
  }
}, { flush: 'sync' }) // Run synchronously

onMounted(() => {
  // Always initialize immediately - ajaxRequestFunc will handle data loading
  // REASONING: We always use ajaxRequestFunc now, which works with or without pre-loaded data
  nextTick(() => {
    initializeTabulator()
    setGridHeight()
  })
  
  // Handle window resize
  window.addEventListener('resize', setGridHeight)
})

onUnmounted(() => {
  if (tabulatorInstance) {
    tabulatorInstance.destroy()
    tabulatorInstance = null
  }
  window.removeEventListener('resize', setGridHeight)
})
</script>

<style scoped>
/* Tabulator :deep() styles remain as CSS - target third-party library DOM structure */
:deep(.tabulator) {
  background: #ffffff;
  border: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;
  font-size: 13px;
}

:deep(.tabulator .tabulator-header) {
  background: linear-gradient(to bottom, #f8f9fa, #ffffff);
  border-bottom: 2px solid rgba(0, 158, 247, 0.15);
  color: rgb(33, 37, 41);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:deep(.tabulator .tabulator-header .tabulator-col) {
  background: transparent;
  border-right: 1px solid rgba(0, 158, 247, 0.08);
  padding: 0;
  box-sizing: border-box;
}

/* Ensure all header rows have consistent height (all th elements must have identical padding, font-size, line-height, box-sizing) */
:deep(.tabulator-header table thead tr) {
  height: auto;
}

/* Row 1: All cells must have identical styling and height */
:deep(.tabulator-header table thead tr:nth-child(1) th) {
  padding: 0 !important;
  box-sizing: border-box !important;
  vertical-align: middle !important;
}

:deep(.tabulator-header table thead tr:nth-child(1) th .tabulator-col-content) {
  padding: 12px 8px !important;
  box-sizing: border-box !important;
}

:deep(.tabulator-header table thead tr:nth-child(1) th .tabulator-col-title) {
  font-size: 12px !important;
  line-height: 1.4 !important;
  font-weight: 600 !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Row 2: All cells must have identical styling and height */
:deep(.tabulator-header table thead tr:nth-child(2) th) {
  padding: 0 !important;
  box-sizing: border-box !important;
  vertical-align: middle !important;
}

:deep(.tabulator-header table thead tr:nth-child(2) th .tabulator-col-content) {
  padding: 12px 8px !important;
  box-sizing: border-box !important;
}

:deep(.tabulator-header table thead tr:nth-child(2) th .tabulator-col-title) {
  font-size: 12px !important;
  line-height: 1.4 !important;
  font-weight: 600 !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Analyte header with properties - compact two-line format */
:deep(.analyte-header) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  line-height: 1.2;
}

:deep(.analyte-code) {
  font-weight: 600;
  font-size: 12px;
  color: rgb(33, 37, 41);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:deep(.analyte-props) {
  font-weight: 500;
  font-size: 11px;
  color: rgb(60, 64, 80);
  text-transform: none;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* Row 3: All cells must have identical styling and height */
:deep(.tabulator-header table thead tr:nth-child(3) th) {
  padding: 0 !important;
  box-sizing: border-box !important;
  vertical-align: middle !important;
}

:deep(.tabulator-header table thead tr:nth-child(3) th .tabulator-col-content) {
  padding: 12px 8px !important;
  box-sizing: border-box !important;
}

:deep(.tabulator-header table thead tr:nth-child(3) th .tabulator-col-title) {
  font-size: 12px !important;
  line-height: 1.4 !important;
  font-weight: 600 !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Column header hover state - base style */
:deep(.tabulator .tabulator-header .tabulator-col:hover) {
  background: rgba(0, 158, 247, 0.05);
}

/* Column selection states - applies to both fixed and dynamic columns */
/* Override static-column background when selected for proper contrast */
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-range-selected),
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-frozen.tabulator-range-selected),
:deep(.tabulator .tabulator-header .tabulator-col:not(.tabulator-frozen).tabulator-range-selected),
:deep(.static-column.tabulator-range-selected) {
  background: rgb(0, 158, 247) !important;
  color: white !important;
}

/* Ensure selected column text content is white for readability */
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-range-selected .tabulator-col-content),
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-frozen.tabulator-range-selected .tabulator-col-content),
:deep(.tabulator .tabulator-header .tabulator-col:not(.tabulator-frozen).tabulator-range-selected .tabulator-col-content) {
  color: white !important;
}

/* Override hover state when column is selected - maintain dark bg and light text for all columns */
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-range-selected:hover),
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-frozen.tabulator-range-selected:hover),
:deep(.tabulator .tabulator-header .tabulator-col:not(.tabulator-frozen).tabulator-range-selected:hover) {
  background: rgb(0, 140, 220) !important;
  color: white !important;
}

:deep(.tabulator .tabulator-header .tabulator-col.tabulator-range-selected:hover .tabulator-col-content),
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-frozen.tabulator-range-selected:hover .tabulator-col-content),
:deep(.tabulator .tabulator-header .tabulator-col:not(.tabulator-frozen).tabulator-range-selected:hover .tabulator-col-content) {
  color: white !important;
}

:deep(.tabulator .tabulator-header .tabulator-col-content) {
  padding: 12px 8px;
  box-sizing: border-box;
}

/* Remove padding from dynamic columns (non-frozen) for alignment */
:deep(.tabulator .tabulator-header .tabulator-col:not(.tabulator-frozen)) {
  padding: 0;
  border-right: 1px solid rgba(0, 158, 247, 0.08);
}

/* Ensure dynamic column content has proper spacing */
:deep(.tabulator .tabulator-header .tabulator-col:not(.tabulator-frozen) .tabulator-col-content) {
  padding: 12px 8px;
}

:deep(.tabulator .tabulator-cell:not(.tabulator-frozen) .tabulator-cell-content) {
  padding: 12px 8px;
}

/* Ensure frozen column content has proper spacing and 40px height in rows 1 and 2 */
:deep(.tabulator .tabulator-header .tabulator-col.tabulator-frozen .tabulator-col-content) {
  padding: 12px 8px;
  box-sizing: border-box;
}


/* Ensure grouped headers align properly */
:deep(.tabulator .tabulator-header .tabulator-col-group) {
  box-sizing: border-box;
}

:deep(.tabulator .tabulator-header .tabulator-col-group .tabulator-col-group-cols) {
  box-sizing: border-box;
}

:deep(.tabulator .tabulator-tableHolder) {
  background: #ffffff;
}

:deep(.tabulator .tabulator-table) {
  background: #ffffff;
}

:deep(.tabulator .tabulator-row) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  min-height: 40px;
  transition: background-color 0.15s ease;
}

:deep(.tabulator .tabulator-row:hover) {
  background-color: rgba(0, 158, 247, 0.03) !important;
}

:deep(.tabulator .tabulator-row.tabulator-row-even) {
  background-color: #fafbfc;
}

:deep(.tabulator .tabulator-row.tabulator-selected) {
  background-color: rgba(0, 158, 247, 0.1) !important;
}

:deep(.tabulator .tabulator-cell) {
  padding: 12px 8px;
  border-right: 1px solid rgba(0, 0, 0, 0.04);
  color: rgb(33, 37, 41);
  font-size: 13px;
  vertical-align: middle;
  box-sizing: border-box;
}

:deep(.tabulator .tabulator-cell:focus) {
  outline: 2px solid rgba(0, 158, 247, 0.3);
  outline-offset: -2px;
}

/* Static column header styling - keep minimal gradient for header only */
:deep(.static-column.tabulator-col) {
  background: linear-gradient(to bottom, rgb(235, 238, 245), rgb(247, 250, 252)) !important;
  font-weight: 600;
  color: rgb(33, 37, 41);
}

/* Disable text-transform for static column headers (Row 3) */
:deep(.static-column .tabulator-col-title) {
  text-transform: none !important;
}

/* Disable cell and column selection for static columns */
:deep(.static-column .tabulator-cell) {
  user-select: none !important;
  cursor: default !important;
}

:deep(.static-column.tabulator-range-selected),
:deep(.static-column .tabulator-cell.tabulator-range-selected) {
  background: linear-gradient(to bottom, rgb(235, 238, 245), rgb(247, 250, 252)) !important;
  color: rgb(33, 37, 41) !important;
}

:deep(.static-column.tabulator-range-selected .tabulator-col-content),
:deep(.static-column .tabulator-cell.tabulator-range-selected .tabulator-cell-content) {
  color: rgb(33, 37, 41) !important;
}

/* Override static column styling when selected for proper contrast */
:deep(.static-column.tabulator-range-selected) {
  background: rgb(0, 158, 247) !important;
  color: white !important;
}

:deep(.static-column.tabulator-range-selected .tabulator-col-content) {
  color: white !important;
}

:deep(.static-column.tabulator-range-selected:hover) {
  background: rgb(0, 140, 220) !important;
  color: white !important;
}

/* Static column cells - match dynamic column styling exactly */
:deep(.static-column .tabulator-cell) {
  
  padding: 0 !important;
  border-right: 1px solid rgba(0, 0, 0, 0.04) !important;
  color: rgb(33, 37, 41) !important;
  font-size: 13px !important;
  font-weight: normal !important;
  vertical-align: middle !important;
  box-sizing: border-box !important;
}

:deep(.static-column .tabulator-cell .tabulator-cell-content) {
  padding: 12px 8px !important;
}

/* Frozen columns styling - ensure alignment */
:deep(.tabulator .tabulator-col.tabulator-frozen) {
  background: #fafbfc; /* Light solid color matching row backgrounds */
  border-right: 2px solid rgba(0, 158, 247, 0.2);
  box-sizing: border-box;
  z-index: 10; /* Ensure frozen columns appear above scrolling columns */
  position: relative; /* Required for z-index to work */
}

:deep(.tabulator .tabulator-row .tabulator-cell.tabulator-frozen) {
  background: #fafbfc; /* Light solid color matching row backgrounds */
  border-right: 2px solid rgba(0, 158, 247, 0.2);
  padding: 12px 8px;
  box-sizing: border-box;
  z-index: 10; /* Ensure frozen cells appear above scrolling cells */
  position: relative; /* Required for z-index to work */
}

/* Override frozen cell styling for static columns to match dynamic columns */
:deep(.static-column .tabulator-cell.tabulator-frozen) {
  
  border-right: 1px solid rgba(0, 0, 0, 0.04) !important;
}

/* Ensure frozen column border doesn't cause misalignment */
:deep(.tabulator .tabulator-col.tabulator-frozen:last-of-type) {
  border-right-width: 2px;
}

:deep(.tabulator .tabulator-row .tabulator-cell.tabulator-frozen:last-of-type) {
  border-right-width: 2px;
}

/* Menu styling */
:deep(.tabulator .tabulator-menu),
:deep(.tabulator-menu) {
  background: white !important;
  border: 1px solid rgba(0, 158, 247, 0.1) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 4px;
  min-width: 200px;
  overflow: hidden !important;
}

:deep(.tabulator-menu-item) {
  padding: 10px 14px;
  color: rgb(33, 37, 41);
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  transition: all 0.15s ease;
  cursor: pointer;
  margin: 2px 0;
}

:deep(.tabulator-menu-item:hover) {
  background: rgba(0, 158, 247, 0.08);
  color: rgb(0, 158, 247);
}

:deep(.tabulator-menu-item.tabulator-menu-item-active) {
  background: rgb(0, 158, 247);
  color: white;
}

/* Scrollbar styling */
:deep(.tabulator .tabulator-tableHolder::-webkit-scrollbar) {
  width: 12px;
  height: 12px;
}

:deep(.tabulator .tabulator-tableHolder::-webkit-scrollbar-track) {
  background: #f1f1f1;
  border-radius: 6px;
}

:deep(.tabulator .tabulator-tableHolder::-webkit-scrollbar-thumb) {
  background: rgba(0, 158, 247, 0.3);
  border-radius: 6px;
  border: 2px solid #f1f1f1;
}

:deep(.tabulator .tabulator-tableHolder::-webkit-scrollbar-thumb:hover) {
  background: rgba(0, 158, 247, 0.5);
}


/* Selection styling */
:deep(.tabulator .tabulator-cell.tabulator-selectable) {
  cursor: cell;
}

:deep(.tabulator .tabulator-cell.tabulator-selected) {
  background-color: rgba(0, 158, 247, 0.15) !important;
  border: 1px solid rgba(0, 158, 247, 0.3);
}

/* Group header styling - ensure proper alignment */
:deep(.tabulator .tabulator-header .tabulator-col-group) {
  background: linear-gradient(to bottom, rgb(230, 237, 247), rgb(242, 247, 252));
  border-bottom: 2px solid rgba(0, 158, 247, 0.2);
  box-sizing: border-box;
}

:deep(.tabulator .tabulator-header .tabulator-col-group .tabulator-col-group-cols) {
  border-top: 1px solid rgba(0, 158, 247, 0.15);
  box-sizing: border-box;
}

/* Ensure all columns have consistent box-sizing for alignment */
:deep(.tabulator .tabulator-header .tabulator-col),
:deep(.tabulator .tabulator-header .tabulator-col-group),
:deep(.tabulator .tabulator-cell) {
  box-sizing: border-box;
}


/* Ensure consistent content styling across all rows */
:deep(.tabulator-header thead tr th .tabulator-col-content) {
  padding: 12px 8px;
  box-sizing: border-box;
}

:deep(.tabulator-header thead tr th .tabulator-col-title) {
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  margin: 0;
  padding: 0;
}

/* Column type styling */
:deep(.column-type-rawdata) {
  text-align: center;
}

:deep(.column-type-correction) {
  text-align: center;
}

:deep(.column-type-result) {
  text-align: center;
  font-weight: 500;
}

/* Result cell with final indicator (Excel-style note indicator) */
:deep(.result-cell-content) {
  position: relative;
  display: inline-block;
  width: 100%;
  padding-right: 8px; /* Space for triangle */
}

:deep(.result-cell-value) {
  display: inline-block;
}

:deep(.final-indicator) {
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-top: 6px solid var(--cell-indicator-final) !important; /* Modern green color for final cells */
  pointer-events: none;
  z-index: 1;
  filter: drop-shadow(0 1px 2px var(--cell-indicator-final-shadow));
}

:deep(.source-indicator) {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-bottom: 6px solid var(--cell-indicator-source) !important; /* Grey color for non-default source */
  pointer-events: none;
  z-index: 1;
  filter: drop-shadow(0 1px 2px var(--cell-indicator-source-shadow));
}

:deep(.source-indicator-blue) {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-bottom: 6px solid var(--cell-indicator-correction) !important; /* Blue color for manual corrections */
  pointer-events: none;
  z-index: 1;
  filter: drop-shadow(0 1px 2px var(--cell-indicator-correction-shadow));
}

/* Conditional formatting based on analyte limits */
:deep(.result-cell-content.cell-below-limit) {
  background-color: var(--cell-limit-out-of-range-bg) !important; /* Light red background - below lower limit */
  border-left: 3px solid var(--cell-limit-out-of-range) !important; /* Red border indicator */
}

:deep(.result-cell-content.cell-above-limit) {
  background-color: var(--cell-limit-out-of-range-bg) !important; /* Light red background - above upper limit */
  border-left: 3px solid var(--cell-limit-out-of-range) !important; /* Red border indicator */
}

:deep(.result-cell-content.cell-within-limit) {
  background-color: var(--cell-limit-within-range-bg) !important; /* Light green background - within range */
  border-left: 3px solid var(--cell-limit-within-range) !important; /* Green border indicator */
}

/* Ensure conditional formatting works with cell padding */
:deep(.tabulator-cell .result-cell-content.cell-below-limit),
:deep(.tabulator-cell .result-cell-content.cell-above-limit),
:deep(.tabulator-cell .result-cell-content.cell-within-limit) {
  padding-left: 4px; /* Adjust padding to account for border */
  margin-left: -4px; /* Offset to maintain alignment */
}

/* Variance Formatting - ORIGINAL/REJCTDUP/PULPDUP (Red) */
:deep(.result-cell-content.cell-variance-dup-high) {
  background-color: var(--cell-variance-dup-high-bg) !important; /* Dark red background - variance > threshold */
  border-left: 3px solid var(--cell-variance-dup-high) !important; /* Dark red border indicator */
}

:deep(.result-cell-content.cell-variance-dup-medium) {
  background-color: var(--cell-variance-dup-medium-bg) !important; /* Light red background - variance > medium threshold and ≤ high threshold */
  border-left: 3px solid var(--cell-variance-dup-medium) !important; /* Light red border indicator */
}

/* Variance Formatting - ORGPRD/PRD (Orange/Amber) */
:deep(.result-cell-content.cell-variance-prd-high) {
  background-color: var(--cell-variance-prd-high-bg) !important; /* Dark orange background - variance > threshold */
  border-left: 3px solid var(--cell-variance-prd-high) !important; /* Dark orange border indicator */
}

:deep(.result-cell-content.cell-variance-prd-medium) {
  background-color: var(--cell-variance-prd-medium-bg) !important; /* Light orange background - variance > medium threshold and ≤ high threshold */
  border-left: 3px solid var(--cell-variance-prd-medium) !important; /* Light orange border indicator */
}

/* Variance Formatting - ORGCRD/CRD (Blue/Indigo) */
:deep(.result-cell-content.cell-variance-crd-high) {
  background-color: var(--cell-variance-crd-high-bg) !important; /* Dark blue background - variance > threshold */
  border-left: 3px solid var(--cell-variance-crd-high) !important; /* Dark blue border indicator */
}

:deep(.result-cell-content.cell-variance-crd-medium) {
  background-color: var(--cell-variance-crd-medium-bg) !important; /* Light blue background - variance > medium threshold and ≤ high threshold */
  border-left: 3px solid var(--cell-variance-crd-medium) !important; /* Light blue border indicator */
}

/* Ensure variance formatting works with cell padding */
:deep(.tabulator-cell .result-cell-content.cell-variance-dup-high),
:deep(.tabulator-cell .result-cell-content.cell-variance-dup-medium),
:deep(.tabulator-cell .result-cell-content.cell-variance-prd-high),
:deep(.tabulator-cell .result-cell-content.cell-variance-prd-medium),
:deep(.tabulator-cell .result-cell-content.cell-variance-crd-high),
:deep(.tabulator-cell .result-cell-content.cell-variance-crd-medium) {
  padding-left: 4px; /* Adjust padding to account for border */
  margin-left: -4px; /* Offset to maintain alignment */
}

/* Sample Name cell with SampleCode tooltip and grey note indicator */
:deep(.sample-name-cell-content) {
  position: relative;
  display: inline-block;
  width: 100%;
  padding-right: 8px; /* Space for triangle */
}

:deep(.sample-name-value) {
  display: inline-block;
}

:deep(.sample-code-indicator) {
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-top: 6px solid var(--cell-indicator-sample-code) !important; /* Grey color for sample code indicator */
  pointer-events: none;
  z-index: 1;
  filter: drop-shadow(0 1px 2px var(--cell-indicator-sample-code-shadow));
}

/* Manual Correction Dialog Styles */
/* Dialog, form, and button styles moved to shared.css - only component-specific styles here */
</style>
