// Grid Actions Composable
// Extracts action handlers from DataTableGrid.vue to improve maintainability and testability

import { ref, computed, nextTick, type Ref, type ComputedRef } from 'vue'
import type { Tabulator } from 'tabulator-tables'
import type { ColumnDefinition } from '@/types'
import { useDataTableStore } from '@/stores/dataTableStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { showToast } from '@/stores/toastStore'
import { STATIC_COLUMN_COUNT } from '@/types'
import { extractCellsFromRanges } from '@/utils/tabulatorHelpers'
import { withLoadingOverlay } from '@/composables/useAsyncOperation'
import { processInChunks } from '@/utils/chunkedProcessor'
import { validateColumnOperation, validateTabulatorOperation } from '@/utils/validationHelpers'
import { showClearResultsSuccessToast, showMarkFinalSuccessToast, showCopySuccessToast, showWarningToast, showErrorToast, showManualCorrectionSuccessToast } from '@/utils/toastHelpers'

interface UseGridActionsOptions {
  getTabulatorInstance: () => Tabulator | null
  tabulatorData: ComputedRef<any[]>
  isCopyingToResult: Ref<boolean>
  needsFormatterRefresh: Ref<boolean>
  isCellFinal: (rowIndex: number, columnIndex: number) => boolean
}

export function useGridActions(options: UseGridActionsOptions) {
  const store = useDataTableStore()
  const loadingStore = useLoadingStore()
  
  const {
    getTabulatorInstance,
    tabulatorData,
    isCopyingToResult,
    needsFormatterRefresh,
    isCellFinal
  } = options

  // Manual Correction Dialog State
  const showManualCorrectionDialog = ref(false)
  const manualCorrectionColumn = ref<ColumnDefinition | null>(null)
  const manualCorrectionRowIndex = ref<number | null>(null)
  const manualCorrectionSelectedRanges = ref<any[]>([])


  /**
   * Cell-level: Copy values from selected cells to Result column
   */
  async function handleCopyToResultCell(column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) {
    const tabulatorInstance = getTabulatorInstance()
    
    // Use validation helper
    if (!validateTabulatorOperation(tabulatorInstance, store.data)) {
      return
    }
    
    // Set formatter refresh flag (source indicator needs formatter refresh)
    needsFormatterRefresh.value = true
    
    // Performance measurement
    const operationStart = import.meta.env.DEV ? performance.now() : 0
    
    // Use loading overlay composable
    await withLoadingOverlay('Copying to Result...', async () => {
      // Extract cells from ranges
      const cellsToProcess = extractCellsFromRanges(
        tabulatorInstance!,
        selectedRanges,
        {
          fallbackCell: { rowIndex, columnIndex: column.columnIndex },
          tabulatorData: tabulatorData.value,
          columnMap: store.columnMap
        }
      )
      
      // If no selection, use just the clicked cell
      if (cellsToProcess.length === 0) {
        if (column.columnIndex >= STATIC_COLUMN_COUNT) {
          cellsToProcess.push({ rowIndex, columnIndex: column.columnIndex })
        } else {
          return
        }
      }
      
      // Find the rightmost column in selection
      const uniqueColumnIndices = [...new Set(cellsToProcess.map(c => c.columnIndex))]
      const maxColumnIndex = Math.max(...uniqueColumnIndices)
      
      // Find corresponding Result column for the rightmost column
      const rightmostColumn = store.columnMap.get(maxColumnIndex)
      if (!rightmostColumn) {
        console.error(`Column ${maxColumnIndex} not found in columnMap`)
        return
      }
      
      if (rightmostColumn.columnType === 'result') {
        console.warn('Rightmost column is already a Result column, cannot copy to itself')
        return
      }
      
      const resultColumn = store.findResultColumn(rightmostColumn.serviceItemIndex, rightmostColumn.analyteIndex)
      if (!resultColumn) {
        console.error(`Result column not found for ServiceItem:${rightmostColumn.serviceItemIndex}, Analyte:${rightmostColumn.analyteIndex}`)
        return
      }
      
      // Filter cells to only rightmost column
      // Filter to only cells in rightmost column
      const rightmostCells = cellsToProcess.filter(cell => cell.columnIndex === maxColumnIndex)
      let copiedCount = 0
      
      // Capture column label for use in closure (TypeScript type narrowing)
      const sourceColumnLabel: string = rightmostColumn.label
      
      // Use batching for multi-cell operations (batch all changes and trigger once)
      const shouldBatch = rightmostCells.length > 1
      
      if (shouldBatch) {
        store.startBatch()
      }
      
      // Use chunked processing utility
      await processInChunks(
        rightmostCells,
        async (cell) => {
          // Skip if result cell is marked as final
          if (isCellFinal(cell.rowIndex, resultColumn.columnIndex)) {
            return
          }
          
          const sourceValue = store.getCellValueByIndex(cell.rowIndex, cell.columnIndex)
          if (sourceValue !== null && sourceValue !== '') {
            // Copy to Result column with column header code (e.g., "328.068" for wavelength, "WC" for correction)
            store.setCellValue(cell.rowIndex, resultColumn.columnIndex, sourceValue, sourceColumnLabel)
            copiedCount++
          }
        },
        {
          chunkSize: 100,
          onProgress: (current, total) => {
            if (total > 10 && (current % 5 === 0 || current === total)) {
              loadingStore.updateProgress(current, total)
            }
          },
          progressUpdateInterval: 5
        }
      )
      
      if (shouldBatch) {
        store.endBatch()
      }
      
      // Performance measurement
      if (import.meta.env.DEV && copiedCount > 0) {
        const operationEnd = performance.now()
        const operationDuration = operationEnd - operationStart
        console.log(`[Performance] Copy to Result (cell selection, ${copiedCount} cells): ${operationDuration.toFixed(2)}ms`)
      }
      
      // Use toast helpers
      if (copiedCount > 0) {
        showCopySuccessToast(copiedCount)
      } else {
        showWarningToast('values', 'copy')
      }
    }).catch((error: any) => {
      // Use toast helpers for error
      showErrorToast('copy', error)
    })
  }

  /**
   * Cell-level: Mark selected cells as final
   */
  async function handleMarkFinalCell(column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) {
    const tabulatorInstance = getTabulatorInstance()
    
    // Use validation helper
    if (!validateTabulatorOperation(tabulatorInstance, store.data) || !validateColumnOperation(column, 'result')) {
      return
    }
    
    // Set formatter refresh flag (final indicator needs formatter refresh)
    needsFormatterRefresh.value = true
    
    // Performance measurement
    const operationStart = import.meta.env.DEV ? performance.now() : 0
    
    // Use loading overlay composable
    await withLoadingOverlay('Marking as Final...', async () => {
      // Use cell extraction utility
      // Pass tabulatorData for fallback method to work correctly
      const cellsToProcess = extractCellsFromRanges(
        tabulatorInstance,
        selectedRanges,
        {
          columnFilter: (colDef) => colDef?.columnType === 'result',
          fallbackCell: { rowIndex, columnIndex: column.columnIndex },
          tabulatorData: tabulatorData.value,
          columnMap: store.columnMap
        }
      )
      
      if (import.meta.env.DEV) {
        console.log('handleMarkFinalCell: Extracted cells:', cellsToProcess.length, cellsToProcess)
      }
      
      if (cellsToProcess.length === 0) {
        return
      }
      
      // Mark cells as final
      // Optimized to process only selected cells, not all rows
      // Use batching for multi-cell operations (batch all changes and trigger once)
      let markedCount = 0
      const shouldBatch = cellsToProcess.length > 1
      
      if (shouldBatch) {
        store.startBatch()
      }
      
      // Use chunked processing utility
      await processInChunks(
        cellsToProcess,
        async (cell) => {
          const cellValue = store.getCellValueByIndex(cell.rowIndex, cell.columnIndex)
          if (cellValue !== null && cellValue !== '') {
            store.markResultCellFinal(cell.rowIndex, cell.columnIndex)
            markedCount++
          }
        },
        {
          chunkSize: 100,
          onProgress: (current, total) => {
            if (total > 10 && (current % 5 === 0 || current === total)) {
              loadingStore.updateProgress(current, total)
            }
          },
          progressUpdateInterval: 5
        }
      )
      
      if (shouldBatch) {
        store.endBatch()
      }
      
      // Performance measurement
      if (import.meta.env.DEV && markedCount > 0) {
        const operationEnd = performance.now()
        const operationDuration = operationEnd - operationStart
        console.log(`[Performance] Mark Final (cell selection, ${markedCount} cells): ${operationDuration.toFixed(2)}ms`)
      }
      
      // Use toast helpers
      if (markedCount > 0) {
        showMarkFinalSuccessToast(markedCount)
      } else {
        showWarningToast('cells', 'mark as final')
      }
    }).catch((error: any) => {
      // Use toast helpers for error
      showErrorToast('mark final', error)
    })
  }

  /**
   * Cell-level: Clear selected cells
   */
  async function handleClearResultsCell(column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) {
    const tabulatorInstance = getTabulatorInstance()
    
    // Use validation helper
    if (!validateTabulatorOperation(tabulatorInstance, store.data) || !validateColumnOperation(column, 'result')) {
      return
    }
    
    // Set formatter refresh flag (final indicator removal needs formatter refresh)
    needsFormatterRefresh.value = true
    
    // Performance measurement
    const operationStart = import.meta.env.DEV ? performance.now() : 0
    
    // Use loading overlay composable
    await withLoadingOverlay('Clearing Results...', async () => {
      // Use cell extraction utility
      // Pass tabulatorData for fallback method to work correctly
      const cellsToProcess = extractCellsFromRanges(
        tabulatorInstance,
        selectedRanges,
        {
          columnFilter: (colDef) => colDef?.columnType === 'result',
          fallbackCell: { rowIndex, columnIndex: column.columnIndex },
          tabulatorData: tabulatorData.value,
          columnMap: store.columnMap
        }
      )
      
      if (import.meta.env.DEV) {
        console.log('handleClearResultsCell: Extracted cells:', cellsToProcess.length, cellsToProcess)
      }
      
      if (cellsToProcess.length === 0) {
        return
      }
      
      // Clear cells
      // Use batching for multi-cell operations (batch all changes and trigger once)
      // Batch all changes and trigger once
      let clearedCount = 0
      const shouldBatch = cellsToProcess.length > 1
      
      if (shouldBatch) {
        store.startBatch()
      }
      
      // Use chunked processing utility
      await processInChunks(
        cellsToProcess,
        async (cell) => {
          const cellValue = store.getCellValueByIndex(cell.rowIndex, cell.columnIndex)
          if (cellValue !== null && cellValue !== '') {
            store.clearResultCell(cell.rowIndex, cell.columnIndex)
            clearedCount++
          }
        },
        {
          chunkSize: 100,
          onProgress: (current, total) => {
            if (total > 10 && (current % 5 === 0 || current === total)) {
              loadingStore.updateProgress(current, total)
            }
          },
          progressUpdateInterval: 5
        }
      )
      
      if (shouldBatch) {
        store.endBatch()
      }
    
      // Performance measurement
      if (import.meta.env.DEV && clearedCount > 0) {
        const operationEnd = performance.now()
        const operationDuration = operationEnd - operationStart
        console.log(`[Performance] Clear Results (cell selection, ${clearedCount} cells): ${operationDuration.toFixed(2)}ms`)
      }
      
      // Use toast helpers
      if (clearedCount > 0) {
        showClearResultsSuccessToast(clearedCount)
      } else {
        showWarningToast('results', 'clear')
      }
    }).catch((error: any) => {
      // Use toast helpers for error
      showErrorToast('clear results', error)
    })
  }

  /**
   * Open manual correction dialog
   */
  function openManualCorrectionDialog(column: ColumnDefinition, rowIndex: number | null, selectedRanges: any[]) {
    manualCorrectionColumn.value = column
    manualCorrectionRowIndex.value = rowIndex
    manualCorrectionSelectedRanges.value = selectedRanges || []
    showManualCorrectionDialog.value = true
  }

  /**
   * Close manual correction dialog
   */
  function closeManualCorrectionDialog() {
    showManualCorrectionDialog.value = false
    manualCorrectionColumn.value = null
    manualCorrectionRowIndex.value = null
    manualCorrectionSelectedRanges.value = []
  }

  /**
   * Apply baseline correction to selected cells
   */
  async function applyBaselineCorrection(baselineValue: number) {
    const tabulatorInstance = getTabulatorInstance()
    
    // Use validation helper
    if (!validateTabulatorOperation(tabulatorInstance, store.data) || !manualCorrectionColumn.value) {
      return
    }
    
    if (manualCorrectionColumn.value.columnType !== 'result') {
      return
    }
    
    const baseline = parseFloat(baselineValue.toFixed(4))
    
    // Set formatter refresh flag
    needsFormatterRefresh.value = true
    
    // Use loading overlay composable
    await withLoadingOverlay('Applying Baseline Correction...', async () => {
      // Extract cells from ranges with result column filter
      const cellsToProcess = extractCellsFromRanges(
        tabulatorInstance!,
        manualCorrectionSelectedRanges.value,
        {
          columnFilter: (colDef) => colDef?.columnType === 'result',
          fallbackCell: { 
            rowIndex: manualCorrectionRowIndex.value!, 
            columnIndex: manualCorrectionColumn.value!.columnIndex 
          },
          tabulatorData: tabulatorData.value,
          columnMap: store.columnMap
        }
      )
      
      if (cellsToProcess.length === 0) {
        return
      }
      
      // Use batching for multi-cell operations
      let appliedCount = 0
      const shouldBatch = cellsToProcess.length > 1
      
      if (shouldBatch) {
        store.startBatch()
      }
      
      // Use chunked processing utility
      await processInChunks(
        cellsToProcess,
        async (cell) => {
          const cellValue = store.getCellValueByIndex(cell.rowIndex, cell.columnIndex)
          // Skip final cells
          if (cellValue !== null && cellValue !== '' && !isCellFinal(cell.rowIndex, cell.columnIndex)) {
            store.setManualCorrection(cell.rowIndex, cell.columnIndex, baseline, undefined)
            appliedCount++
          }
        },
        {
          chunkSize: 100,
          onProgress: (current, total) => {
            if (total > 10 && (current % 5 === 0 || current === total)) {
              loadingStore.updateProgress(current, total)
            }
          },
          progressUpdateInterval: 5
        }
      )
      
      if (shouldBatch) {
        store.endBatch()
      }
      
      // Use toast helpers
      if (appliedCount > 0) {
        showManualCorrectionSuccessToast(appliedCount, 'baseline')
      } else {
        showWarningToast('cells', 'apply correction to')
      }
      
      // Close dialog
      closeManualCorrectionDialog()
    }).catch((error: any) => {
      // Use toast helpers for error
      showErrorToast('apply correction', error)
    })
  }

  /**
   * Apply multiplier to selected cells
   */
  async function applyMultiplier(multiplierValue: number) {
    const tabulatorInstance = getTabulatorInstance()
    
    // Use validation helper
    if (!validateTabulatorOperation(tabulatorInstance, store.data) || !manualCorrectionColumn.value) {
      return
    }
    
    if (manualCorrectionColumn.value.columnType !== 'result') {
      return
    }
    
    const multiplier = parseFloat(multiplierValue.toFixed(2))
    
    // Set formatter refresh flag
    needsFormatterRefresh.value = true
    
    // Use loading overlay composable
    await withLoadingOverlay('Applying Multiplier...', async () => {
      // Extract cells from ranges with result column filter
      const cellsToProcess = extractCellsFromRanges(
        tabulatorInstance!,
        manualCorrectionSelectedRanges.value,
        {
          columnFilter: (colDef) => colDef?.columnType === 'result',
          fallbackCell: { 
            rowIndex: manualCorrectionRowIndex.value!, 
            columnIndex: manualCorrectionColumn.value!.columnIndex 
          },
          tabulatorData: tabulatorData.value,
          columnMap: store.columnMap
        }
      )
      
      if (cellsToProcess.length === 0) {
        return
      }
      
      // Use batching for multi-cell operations
      let appliedCount = 0
      const shouldBatch = cellsToProcess.length > 1
      
      if (shouldBatch) {
        store.startBatch()
      }
      
      // Use chunked processing utility
      await processInChunks(
        cellsToProcess,
        async (cell) => {
          const cellValue = store.getCellValueByIndex(cell.rowIndex, cell.columnIndex)
          // Skip final cells
          if (cellValue !== null && cellValue !== '' && !isCellFinal(cell.rowIndex, cell.columnIndex)) {
            store.setManualCorrection(cell.rowIndex, cell.columnIndex, undefined, multiplier)
            appliedCount++
          }
        },
        {
          chunkSize: 100,
          onProgress: (current, total) => {
            if (total > 10 && (current % 5 === 0 || current === total)) {
              loadingStore.updateProgress(current, total)
            }
          },
          progressUpdateInterval: 5
        }
      )
      
      if (shouldBatch) {
        store.endBatch()
      }
      
      // Use toast helpers
      if (appliedCount > 0) {
        showManualCorrectionSuccessToast(appliedCount, 'multiplier')
      } else {
        showWarningToast('cells', 'apply multiplier to')
      }
      
      // Close dialog
      closeManualCorrectionDialog()
    }).catch((error: any) => {
      // Use toast helpers for error
      showErrorToast('apply multiplier', error)
    })
  }

  /**
   * Cell-level: Open manual correction dialog for specific cell
   */
  function handleManualCorrectionCell(column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) {
    if (!store.data || column.columnType !== 'result') {
      if (import.meta.env.DEV) {
        console.warn('Manual correction only available for result columns')
      }
      return
    }
    
    openManualCorrectionDialog(column, rowIndex, selectedRanges)
  }

  /**
   * Placeholder for Use Wavelength action (cell-level)
   */
  function handleUseWavelengthCell(column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) {
    if (import.meta.env.DEV) {
      console.log('Use this data (cell):', { column, rowIndex, selectedRanges })
    }
    // TODO: Implement - applies to selected cells or single cell
  }

  return {
    // Cell-level handlers
    handleCopyToResultCell,
    handleMarkFinalCell,
    handleClearResultsCell,
    handleManualCorrectionCell,
    handleUseWavelengthCell,
    // Manual Correction Dialog State
    showManualCorrectionDialog,
    manualCorrectionColumn,
    manualCorrectionRowIndex,
    // Manual Correction Dialog Functions
    openManualCorrectionDialog,
    closeManualCorrectionDialog,
    applyBaselineCorrection,
    applyMultiplier
  }
}
