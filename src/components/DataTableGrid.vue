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

// Row cache for tabulatorData memoization (reduces computation from O(rows × columns) to O(changed_rows × columns))
const rowCache = new Map<number, any>()
const lastFilteredColumns = ref<ColumnDefinition[]>([])
const lastFilteredRowsCount = ref<number | null>(null)
const lastDataRef = ref<any>(null)
// Cache previous result array (non-reactive to avoid reactivity loops)
let previousTabulatorData: any[] = []

// Track if formatter refresh is needed (only for final indicator changes, not simple value updates)
const needsFormatterRefresh = ref(false)

// Cache filteredColumns to avoid computed recalculation in buildSingleRowData
let cachedFilteredColumns: ColumnDefinition[] = []
let cachedColumnIndicesString: string = ''

// Cache for tabulatorColumns memoization (rebuilding nested structure is expensive)
let cachedTabulatorColumns: any[] = []
let cachedTabulatorColumnIndices: string = ''

// Extract all field names from nested column structure for smart watch comparison
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

// Get Service Item Code for a column using cached map (O(1) lookup)
function getServiceItemCode(col: ColumnDefinition): string {
  if (col.serviceItemIndex < 0) return ''
  
  return store.serviceItemCodeMap.get(col.serviceItemIndex) || ''
}

// Get Analyte Code for a column using cached map (O(1) lookup)
function getAnalyteCode(col: ColumnDefinition): string {
  if (col.analyteIndex < 0) return ''
  
  return store.analyteCodeMap.get(col.analyteIndex) || ''
}

// Get Analyte properties (lowerLimit, upperLimit, unit) for a column
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

// Build row data map from tabulatorData for O(1) row lookups
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
  if (!store.data) return null
  
  // Use cache directly to avoid triggering computed property recalculation
  const row = store.data.rows.find(r => r.rowIndex === rowIndex)
  if (!row) return null
  
  // Build cell value map for O(1) lookup
  const cellValueMap = new Map<number, string | number>()
  row.values.forEach(cell => {
    cellValueMap.set(cell.columnIndex, cell.value)
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
  if (cachedFilteredColumns.length === 0) {
    // Cache empty - return row with only static columns
    if (import.meta.env.DEV) {
      console.warn('[Performance] cachedFilteredColumns is empty in buildSingleRowData - returning row with static columns only')
    }
    return rowObj // Return early with only static columns
  }
  cachedFilteredColumns.forEach((col: ColumnDefinition) => {
    if (col.columnIndex >= STATIC_COLUMN_COUNT) {
      rowObj[`col_${col.columnIndex}`] = cellValueMap.get(col.columnIndex) ?? null
    }
  })
  
  return rowObj
}

// Performance measurement helper (DEV mode only)
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

// Safe Tabulator update wrapper with error handling
function safeTabulatorUpdate(updateFn: () => void, fallbackFn?: () => void): void {
  try {
    updateFn()
  } catch (updateError) {
    console.error('Error updating Tabulator:', updateError)
    if (fallbackFn) {
      fallbackFn()
    }
  }
}

// Manual Correction dialog functions moved to composable

// Getter function for tabulator instance (used by composables)
function getTabulatorInstance(): Tabulator | null {
  return tabulatorInstance
}

// Context menu functions - will be initialized after tabulatorData is defined
let getCellContextMenu: ((e: MouseEvent, cell: any) => any[]) | null = null

// Convert column definitions to Tabulator format with grouped headers
// Rebuilds only when filters or schema change, not on cell value changes
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
  
  // Define minWidth for each static column
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
        frozen: true, // Tabulator uses 'frozen' instead of 'pinned'
        minWidth: staticColumnMinWidths[col.columnIndex] || 100, // Content-based minWidth
        widthShrink: 0, // Prevent shrinking below minWidth
        headerTooltip: col.label,
        cssClass: 'static-column',
        headerSort: false, // Disable sorting to avoid warning with selectableRangeColumns
        // Selection disabled via CSS
      }
      
      // Add formatter for SampleName to show SampleCode tooltip and note icon
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
    columns.push({
      title: `Job: ${job.code}, Due Date: ${formattedDate}`, // Row 1
      frozen: true,
      headerSort: false,
      cssClass: 'static-columns-group',
      columns: [{
        title: `Customer: ${job.customerName} (${job.customerCode})`, // Row 2
        frozen: true,
        headerSort: false,
        columns: staticColumns // Row 3: Individual columns
      }]
    })
  } else if (staticColumns.length > 0) {
    // Fallback: if no job info, just add columns directly
    columns.push(...staticColumns)
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
      // Format Analyte header with properties (lowerLimit, upperLimit, unit)
      const analyteHeader = formatAnalyteHeader(analyteCols[0])
      
      // Create columns for this Analyte
      const columnsForAnalyte = analyteCols.map(col => {
        const headerLabel = isSelectedWavelength(col) ? `${col.label} *` : col.label
        
        const columnDef: any = {
          title: headerLabel,
          field: `col_${col.columnIndex}`,
          width: 120,
          headerTooltip: col.label,
          cssClass: `column-type-${col.columnType}`,
          headerSort: false, // Disable sorting to avoid warning with selectableRangeColumns
          resizable: true, // Make dynamic columns resizable
          // Add context menu for right-click on cells
          contextMenu: getCellContextMenu || undefined // Right-click on cells
        }
        
        // Add formatter for result columns to show final indicator
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

// Convert row data to Tabulator format (memoized - only rebuilds changed rows)
const tabulatorData = computed(() => {
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
  if (!filteredColsChanged && store.changedRowIndices.size === 0 && previousTabulatorData.length === store.filteredRows.length) {
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

// Initialize grid actions composable (provides all action handlers)
// Must be initialized after tabulatorData is defined
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

// Initialize context menu composable (uses handlers from gridActions)
// Must be initialized after gridActions is defined
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
  if (!gridContainerRef.value || !store.data) return
  
  // Destroy existing instance if any
  if (tabulatorInstance) {
    tabulatorInstance.destroy()
    tabulatorInstance = null
  }
  
  // Create Tabulator instance
  tabulatorInstance = new Tabulator(gridContainerRef.value, {
    data: tabulatorData.value,
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
        console.log('Tabulator render complete:', {
          rows: tabulatorInstance?.getRowsCount(),
          columns: tabulatorInstance?.getColumns().length
        })
      }
      
      // Header structure is now built correctly from the start
      // No post-render DOM manipulation needed
    }
  })
  
  if (import.meta.env.DEV) {
    console.log('Tabulator initialized:', {
      rows: tabulatorData.value.length,
      columns: tabulatorColumns.value.length
    })
  }
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
      sampleRow: newData?.[0]
    })
  }
  
  // For single cell changes, update immediately (nextTick adds ~16ms delay)
  const changedRowCount = store.changedRowIndices.size
  const isSingleCellChange = changedRowCount === 1 && !columnsChanged && oldData && oldData.length > 0
  
  if (isSingleCellChange) {
    // Immediate update for single cell - no nextTick delay
    const buildStart = import.meta.env.DEV ? performance.now() : 0
    const changedRows = Array.from(store.changedRowIndices)
    const rowsToUpdate = changedRows
      .map(rowIndex => buildSingleRowData(rowIndex))
      .filter(row => row !== null)
    const buildEnd = import.meta.env.DEV ? performance.now() : 0
    
    if (rowsToUpdate.length > 0) {
      const immediateUpdateStart = import.meta.env.DEV ? performance.now() : 0
      safeTabulatorUpdate(
        () => {
          const updateDataStart = import.meta.env.DEV ? performance.now() : 0
          tabulatorInstance.updateData(rowsToUpdate)
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
        },
        () => {
          tabulatorInstance.setData(newData)
          if (import.meta.env.DEV) {
            const fallbackEnd = performance.now()
            const fallbackDuration = fallbackEnd - immediateUpdateStart
            const totalWatchDuration = fallbackEnd - watchStartTime
            console.log(`[Performance] Immediate update failed, used fallback (setData): ${fallbackDuration.toFixed(2)}ms (total watch: ${totalWatchDuration.toFixed(2)}ms)`)
          }
        }
      )
      
      // Move formatter refresh outside safeTabulatorUpdate and use nextTick (ensures computed has updated)
      if (needsFormatterRefresh.value) {
        nextTick(() => {
          const reformatStart = import.meta.env.DEV ? performance.now() : 0
          // Reformat ALL changed rows (not just first one)
          // For single row: reformat() is fast (<10ms)
          // For 2 rows: reformat() on both is still faster than redraw(true) for small changes
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
          // If any rows failed to reformat, use redraw(true) as fallback
          if (failedCount > 0) {
            if (import.meta.env.DEV) {
              console.warn(`[Formatter] ${failedCount} row(s) failed to reformat, using redraw(true) fallback`)
            }
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
      return // Skip nextTick path
    }
  }
  
  // For batch operations or column changes, use nextTick
  nextTick(() => {
    // Only update columns if they actually changed
    if (columnsChanged) {
      // Performance measurement for column updates
      const columnUpdateStart = import.meta.env.DEV ? performance.now() : 0
      lastColumnFields.value = currentFields
      
      // Measure individual operations to identify bottlenecks
      const setColumnsStart = import.meta.env.DEV ? performance.now() : 0
      tabulatorInstance.setColumns(newColumns)
      const setColumnsEnd = import.meta.env.DEV ? performance.now() : 0
      
      // Force header redraw to ensure all group headers are visible
      nextTick(() => {
        if (tabulatorInstance) {
          tabulatorInstance.redraw(true)
        }
      })
      
      // When columns change, must use setData (structure changed)
      const setDataStart = import.meta.env.DEV ? performance.now() : 0
      tabulatorInstance.setData(newData)
      const setDataEnd = import.meta.env.DEV ? performance.now() : 0
      
      store.clearChangedRows()
      
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
    } else {
      // Columns unchanged - use incremental update when possible
      // Explicitly handle first load
      if (!oldData || oldData.length === 0) {
        // First load - use full update
        const firstLoadStart = import.meta.env.DEV ? performance.now() : 0
        tabulatorInstance.setData(newData)
        store.clearChangedRows()
        if (import.meta.env.DEV) {
          const firstLoadEnd = performance.now()
          const firstLoadDuration = firstLoadEnd - firstLoadStart
          const totalWatchDuration = firstLoadEnd - watchStartTime
          console.log(`[Performance] First load (setData): ${firstLoadDuration.toFixed(2)}ms (total watch: ${totalWatchDuration.toFixed(2)}ms)`)
        }
      } else {
        // Existing data - use incremental update if applicable
        const changedRows = Array.from(store.changedRowIndices)
        
        // If no rows changed, skip update entirely (tabulatorData may recalculate even when nothing changed)
        if (changedRows.length === 0) {
          // No changes - skip update entirely
          if (import.meta.env.DEV) {
            console.log(`[Performance] Watch triggered but no changes - skipping update`)
          }
          return // Exit early - no update needed
        }
        
        if (changedRows.length > 0 && changedRows.length < newData.length * 0.5) {
          // Update only changed rows (if less than 50% of rows changed)
          const rowsToUpdate = changedRows
            .map(rowIndex => buildSingleRowData(rowIndex))
            .filter(row => row !== null)
          if (rowsToUpdate.length > 0) {
            // Performance measurement for incremental updates
            const incrementalUpdateStart = import.meta.env.DEV ? performance.now() : 0
            safeTabulatorUpdate(
              () => {
                tabulatorInstance.updateData(rowsToUpdate)
              },
              () => {
                tabulatorInstance.setData(newData) // Fallback to full update
              }
            )
            
            // Move formatter refresh outside safeTabulatorUpdate and use nextTick (ensures computed has updated)
            let reformatDuration = 0
            if (needsFormatterRefresh.value) {
              nextTick(() => {
                const reformatStart = import.meta.env.DEV ? performance.now() : 0
                // For incremental updates (3+ rows), use redraw(true) - faster than multiple reformat() calls
                tabulatorInstance.redraw(true)
                reformatDuration = import.meta.env.DEV ? performance.now() - reformatStart : 0
                if (import.meta.env.DEV) {
                  console.log(`[Formatter] Redraw (incremental update) in ${reformatDuration.toFixed(2)}ms`)
                }
                needsFormatterRefresh.value = false
              })
            }
            
            // Performance measurement
            if (import.meta.env.DEV) {
              const incrementalUpdateEnd = performance.now()
              const incrementalDuration = incrementalUpdateEnd - incrementalUpdateStart
              const totalWatchDuration = incrementalUpdateEnd - watchStartTime
              console.log(`[Performance] Incremental update (${rowsToUpdate.length} rows): ${incrementalDuration.toFixed(2)}ms (reformat: ${reformatDuration.toFixed(2)}ms, total watch: ${totalWatchDuration.toFixed(2)}ms)`)
            }
          }
          store.clearChangedRows()
        } else {
          // Too many rows changed - use full update
          // Performance measurement for full updates
          const fullUpdateStart = import.meta.env.DEV ? performance.now() : 0
          tabulatorInstance.setData(newData)
          
          // For full updates, always use redraw(true) (reformat() on many rows is slow)
          let reformatDuration = 0
          if (needsFormatterRefresh.value) {
            // Use nextTick to ensure computed properties have updated before formatter runs
            nextTick(() => {
              const reformatStart = import.meta.env.DEV ? performance.now() : 0
              // For full updates, always use redraw(true) - faster than calling reformat() on many rows
              tabulatorInstance.redraw(true)
              reformatDuration = import.meta.env.DEV ? performance.now() - reformatStart : 0
              if (import.meta.env.DEV) {
                console.log(`[Formatter] Redraw (full update) in ${reformatDuration.toFixed(2)}ms`)
              }
              needsFormatterRefresh.value = false
            })
          }
          
          store.clearChangedRows()
          if (import.meta.env.DEV) {
            const fullUpdateEnd = performance.now()
            const fullUpdateDuration = fullUpdateEnd - fullUpdateStart
            const totalWatchDuration = fullUpdateEnd - watchStartTime
            console.log(`[Performance] Full update (setData, ${changedRows.length} changed rows): ${fullUpdateDuration.toFixed(2)}ms (reformat: ${reformatDuration.toFixed(2)}ms, total watch: ${totalWatchDuration.toFixed(2)}ms)`)
          }
        }
      }
    }
  })
})

/**
 * Set grid height to fill container
 */
function setGridHeight() {
  if (!gridWrapperRef.value || !gridContainerRef.value || !tabulatorInstance) return
  
  // Check if Tabulator is fully initialized (has rendered)
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

// Check if a result cell is marked as final (uses rowMap and cellMap for O(1) lookups)
function isCellFinal(rowIndex: number, columnIndex: number): boolean {
  if (!store.data) return false
  
  // Use rowMap for O(1) row lookup
  const row = store.rowMap.get(rowIndex)
  if (!row) return false
  
  // Use cellMap for O(1) cell lookup
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

// Action handlers (both column-level and cell-level) are now provided by useGridActions composable (see initialization above)

/**
 * Open request modal for repeat or overlimit requests
 */
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
  // Use the service item index from the clicked column
  requestModalServiceItemIndex.value = clickedColumn.serviceItemIndex
  showRequestModal.value = true
}

/**
 * Close request modal
 */
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
}, { flush: 'sync' }) // Run synchronously, before any computed properties

// Watch selectedServiceItemIndex to clear row cache when row filter changes
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
  // Wait for data to load
  if (store.data) {
    nextTick(() => {
      initializeTabulator()
      setGridHeight()
    })
  } else {
    // Watch for data to load
    const unwatch = watch(() => store.data, (newData) => {
      if (newData) {
        nextTick(() => {
          initializeTabulator()
          setGridHeight()
          unwatch()
        })
      }
    })
  }
  
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
/* Wrapper styles migrated to Tailwind classes */
/* Tabulator :deep() styles remain as CSS - they target third-party library DOM structure */

/* Modern Tabulator Grid Styling */
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
