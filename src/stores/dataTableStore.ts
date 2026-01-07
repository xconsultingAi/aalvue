import { defineStore } from 'pinia'
import { ref, computed, shallowRef, triggerRef } from 'vue'
import type {
  OptimizedDataTablePayload,
  ColumnDefinition,
  ColumnMap,
  RowData,
  CellValue
} from '@/types'
import { STATIC_COLUMN_COUNT } from '@/types'
import sampleData from '@/data/sample-data-table.json'

export type ViewMode = 'qc' | 'report' | 'customer'

// Pinia Store for Data Table (Tabulator version)
// Centralized state management with efficient Map-based lookups (O(1) access)
export const useDataTableStore = defineStore('dataTable', () => {
  // ==================== STATE ====================
  
  const data = shallowRef<OptimizedDataTablePayload | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const hasUnsavedChanges = ref(false)
  const initialData = ref<OptimizedDataTablePayload | null>(null)
  
  // Track changed row indices for incremental updates (must track BEFORE triggerRef)
  const changedRowIndices = ref<Set<number>>(new Set())

  // Batching mechanism to reduce reactivity triggers (O(N) to O(1) for bulk operations)
  let isBatching = false
  let batchChangedRows = new Set<number>()

  // Cache for rowMap and cellMap memoization (avoids recalculating all rows/cells on every triggerRef)
  const rowMapCache = new Map<number, RowData>()
  const cellMapCache = new Map<number, Map<number, CellValue>>()
  const lastDataRefForMaps = ref<any>(null)

  // ==================== COMPUTED PROPERTIES ====================

  // Column map for O(1) lookup by columnIndex
  const columnMap = computed<ColumnMap>(() => {
    if (!data.value) return new Map()
    
    const map = new Map<number, ColumnDefinition>()
    data.value.metadata.schema.columnDefinitions.forEach(col => {
      map.set(col.columnIndex, col)
    })
    return map
  })

  /**
   * Row map for O(1) lookup by rowIndex
   * Phase 9.1.1: Memoized implementation - only rebuilds changed rows
   * REASONING: Avoids recalculating ALL rows on every triggerRef(data) call
   */
  const rowMap = computed<Map<number, RowData>>(() => {
    if (!data.value) {
      rowMapCache.clear()
      cellMapCache.clear()
      lastDataRefForMaps.value = null
      return new Map()
    }
    
    // Check if data reference changed (new data loaded)
    if (data.value !== lastDataRefForMaps.value) {
      rowMapCache.clear()
      cellMapCache.clear()
      lastDataRefForMaps.value = data.value
    }
    
    // Only rebuild changed rows, reuse cached rows for unchanged ones
    const map = new Map<number, RowData>()
    
    data.value.rows.forEach(row => {
      const rowIndex = row.rowIndex
      
      // Check if this row needs to be rebuilt
      const needsRebuild = 
        changedRowIndices.value.has(rowIndex) || 
        !rowMapCache.has(rowIndex)
      
      if (needsRebuild) {
        // Rebuild this row
        rowMapCache.set(rowIndex, row)
        map.set(rowIndex, row)
      } else {
        // Reuse cached row
        const cachedRow = rowMapCache.get(rowIndex)
        if (cachedRow) {
          map.set(rowIndex, cachedRow)
        } else {
          // Cache miss - rebuild
          rowMapCache.set(rowIndex, row)
          map.set(rowIndex, row)
        }
      }
    })
    
    return map
  })

  /**
   * Cell map for O(1) lookup by rowIndex and columnIndex
   * Structure: Map<rowIndex, Map<columnIndex, CellValue>>
   * Phase 9.1.1: Memoized implementation - only rebuilds changed rows/cells
   * REASONING: This is the CRITICAL bottleneck - avoids 50,000+ operations (1000 rows × 50 cells) for a single cell change
   */
  const cellMap = computed<Map<number, Map<number, CellValue>>>(() => {
    if (!data.value) {
      cellMapCache.clear()
      return new Map()
    }
    
    // Check if data reference changed (handled in rowMap, but double-check)
    if (data.value !== lastDataRefForMaps.value) {
      cellMapCache.clear()
    }
    
    // Only rebuild changed rows, reuse cached rows for unchanged ones
    const map = new Map<number, Map<number, CellValue>>()
    
    data.value.rows.forEach(row => {
      const rowIndex = row.rowIndex
      
      // Check if this row needs to be rebuilt
      const needsRebuild = 
        changedRowIndices.value.has(rowIndex) || 
        !cellMapCache.has(rowIndex)
      
      if (needsRebuild) {
        // Rebuild cell map for row
        const rowCellMap = new Map<number, CellValue>()
        row.values.forEach(cell => {
          rowCellMap.set(cell.columnIndex, cell)
        })
        cellMapCache.set(rowIndex, rowCellMap)
        map.set(rowIndex, rowCellMap)
      } else {
        // Reuse cached cell map
        const cachedRowCellMap = cellMapCache.get(rowIndex)
        if (cachedRowCellMap) {
          map.set(rowIndex, cachedRowCellMap)
        } else {
          // Fallback: cache miss
          const rowCellMap = new Map<number, CellValue>()
          row.values.forEach(cell => {
            rowCellMap.set(cell.columnIndex, cell)
          })
          cellMapCache.set(rowIndex, rowCellMap)
          map.set(rowIndex, rowCellMap)
        }
      }
    })
    
    return map
  })

  // Service Item Code Map for O(1) lookup by serviceItemIndex
  const serviceItemCodeMap = computed<Map<number, string>>(() => {
    if (!data.value?.metadata?.schema?.serviceItems) return new Map()
    
    const map = new Map<number, string>()
    data.value.metadata.schema.serviceItems.forEach(si => {
      map.set(si.siIndex, si.code || '')
    })
    return map
  })

  // Analyte Code Map for O(1) lookup by analyteIndex
  const analyteCodeMap = computed<Map<number, string>>(() => {
    if (!data.value?.metadata?.schema?.analytes) return new Map()
    
    const map = new Map<number, string>()
    data.value.metadata.schema.analytes.forEach(a => {
      map.set(a.analyteIndex, a.code || '')
    })
    return map
  })

  /**
   * All columns (static + dynamic) for Tabulator
   */
  const allColumns = computed<ColumnDefinition[]>(() => {
    if (!data.value) return []
    
    // Static columns (indices 0-4)
    const staticColumns: ColumnDefinition[] = [
      {
        columnIndex: 0,
        columnKey: 'seqNo',
        serviceItemIndex: -1,
        analyteIndex: -1,
        columnType: 'static',
        label: 'Seq No'
      },
      {
        columnIndex: 1,
        columnKey: 'sampleName',
        serviceItemIndex: -1,
        analyteIndex: -1,
        columnType: 'static',
        label: 'Sample Name'
      },
      {
        columnIndex: 2,
        columnKey: 'travelerNo',
        serviceItemIndex: -1,
        analyteIndex: -1,
        columnType: 'static',
        label: 'Traveler No'
      },
      {
        columnIndex: 3,
        columnKey: 'materialType',
        serviceItemIndex: -1,
        analyteIndex: -1,
        columnType: 'static',
        label: 'Material Type'
      },
      {
        columnIndex: 4,
        columnKey: 'controlType',
        serviceItemIndex: -1,
        analyteIndex: -1,
        columnType: 'static',
        label: 'Control Type'
      }
    ]
    
    // Dynamic columns (from columnDefinitions)
    const dynamicCols = data.value.metadata.schema.columnDefinitions || []
    return [...staticColumns, ...dynamicCols]
  })

  // Get cell value for Tabulator row data (uses cellMap for O(1) lookup)
  const getCellValue = (row: RowData, columnIndex: number): string | number | null => {
    // Static columns
    if (columnIndex < STATIC_COLUMN_COUNT) {
      switch (columnIndex) {
        case 0: return row.seqNo
        case 1: return row.sampleName
        case 2: return row.travelerNo
        case 3: return row.materialType
        case 4: return row.controlType
        default: return null
      }
    }
    
    // Dynamic columns: use cellMap for O(1) lookup
    const rowCellMap = cellMap.value.get(row.rowIndex)
    const cell = rowCellMap?.get(columnIndex)
    return cell?.value ?? null
  }

  // Get cell value by rowIndex and columnIndex (uses rowMap for O(1) lookup)
  const getCellValueByIndex = (rowIndex: number, columnIndex: number): string | number | null => {
    if (!data.value) return null
    
    const row = rowMap.value.get(rowIndex)
    if (!row) return null
    
    return getCellValue(row, columnIndex)
  }

  /**
   * Set cell value for specific row and column
   * @param rowIndex - Row index
   * @param columnIndex - Column index
   * @param value - Value to set
   * @param sourceColumnCode - Optional source column header code for metadata tracking (e.g., "328.068" for wavelength, "WC" for correction)
   */
  const setCellValue = (rowIndex: number, columnIndex: number, value: string | number, sourceColumnCode?: string): void => {
    if (!data.value) return
    
    // Use cache directly to avoid triggering computed property recomputation
    let row = rowMapCache.get(rowIndex)
    if (!row) {
      // Not in cache - find in data (only happens on first access)
      row = data.value.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        rowMapCache.set(rowIndex, row)
      }
    }
    if (!row) return
    
    // Use cellMap cache directly
    let rowCellMap = cellMapCache.get(rowIndex)
    if (!rowCellMap) {
      // Not in cache - build it
      rowCellMap = new Map<number, CellValue>()
      row.values.forEach(cell => {
        rowCellMap!.set(cell.columnIndex, cell)
      })
      cellMapCache.set(rowIndex, rowCellMap)
    }
    const existingCell = rowCellMap.get(columnIndex)
    
    if (existingCell) {
      existingCell.value = value
      // Update metadata if source column code is provided
      if (sourceColumnCode !== undefined) {
        existingCell.copiedFrom = sourceColumnCode
      }
    } else {
      // Create new cell with proper typing
      const newCell: CellValue = { columnIndex, value }
      if (sourceColumnCode !== undefined) {
        newCell.copiedFrom = sourceColumnCode
      }
      row.values.push(newCell)
    }
    
    // Track changed row BEFORE triggering reactivity (triggerRef immediately triggers tabulatorData recomputation)
    changedRowIndices.value.add(rowIndex)
    
    // Batch support - defer triggerRef if batching is active
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      // CRITICAL: Trigger reactivity since data is a shallowRef
      // Modifying nested properties doesn't automatically trigger reactivity
      triggerRef(data)
    }
    
    // Mark as having unsaved changes
    hasUnsavedChanges.value = true
  }

  // Result column map for O(1) lookup by serviceItemIndex and analyteIndex
  // Key format: `${serviceItemIndex}_${analyteIndex}`
  const resultColumnMap = computed<Map<string, ColumnDefinition>>(() => {
    if (!data.value) return new Map()
    
    const map = new Map<string, ColumnDefinition>()
    allColumns.value.forEach(column => {
      if (column.columnType === 'result' && column.serviceItemIndex >= 0 && column.analyteIndex >= 0) {
        const key = `${column.serviceItemIndex}_${column.analyteIndex}`
        map.set(key, column)
      }
    })
    return map
  })

  /**
   * Find the Result column for a given Service Item and Analyte
   * REASONING: Uses resultColumnMap for O(1) lookup instead of O(n) linear search
   */
  const findResultColumn = (serviceItemIndex: number, analyteIndex: number): ColumnDefinition | null => {
    if (!data.value) return null
    
    const key = `${serviceItemIndex}_${analyteIndex}`
    return resultColumnMap.value.get(key) || null
  }

  // Mark result cell as final (uses rowMap and cellMap for O(1) lookups)
  const markResultCellFinal = (rowIndex: number, columnIndex: number): void => {
    if (!data.value) return
    
    // Phase 9.1.1: Use cache directly instead of accessing computed properties
    let row = rowMapCache.get(rowIndex)
    if (!row) {
      row = data.value.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        rowMapCache.set(rowIndex, row)
      }
    }
    if (!row) return
    
    // Use cellMap cache directly instead of accessing computed
    let rowCellMap = cellMapCache.get(rowIndex)
    if (!rowCellMap) {
      rowCellMap = new Map<number, CellValue>()
      row.values.forEach(cell => {
        rowCellMap!.set(cell.columnIndex, cell)
      })
      cellMapCache.set(rowIndex, rowCellMap)
    }
    let cell = rowCellMap.get(columnIndex)
    
    // Create cell if it doesn't exist but has a value (getCellValueByIndex might return value without cell object)
    if (!cell) {
      // Check if cell actually has a value before creating
      const cellValue = getCellValueByIndex(rowIndex, columnIndex)
      if (cellValue === null || cellValue === '') {
        // No value - skip
        if (import.meta.env.DEV) {
          console.warn(`markResultCellFinal: Cell at row ${rowIndex}, col ${columnIndex} has no value, skipping`)
        }
        return
      }
      // Create new cell object
      if (import.meta.env.DEV) {
        console.log(`markResultCellFinal: Creating missing cell object for row ${rowIndex}, col ${columnIndex}`)
      }
      cell = { columnIndex, value: cellValue }
      row.values.push(cell)
      rowCellMap.set(columnIndex, cell) // Update cache
    }
    
    cell.isFinal = true
    cell.markedFinalAt = new Date().toISOString()
    
    // Phase 6.2: Track changed row BEFORE triggering reactivity
    changedRowIndices.value.add(rowIndex)
    
    // Phase 10: Batch support - defer triggerRef if batching is active
    // REASONING: For multi-cell operations, batch all changes and trigger once instead of N times
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      triggerRef(data)
    }
    hasUnsavedChanges.value = true
  }

  // Clear result cell (remove value and metadata) - uses rowMap for O(1) lookup
  const clearResultCell = (rowIndex: number, columnIndex: number): void => {
    if (!data.value) return
    
    // Phase 9.1.1: Use cache directly instead of accessing computed properties
    let row = rowMapCache.get(rowIndex)
    if (!row) {
      row = data.value.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        rowMapCache.set(rowIndex, row)
      }
    }
    if (!row) return
    
    // Filter out the cell from values array
    // Note: We use filter here to maintain the array structure
    row.values = row.values.filter(cell => cell.columnIndex !== columnIndex)
    
    // Update cellMapCache - remove cell from cache
    const rowCellMap = cellMapCache.get(rowIndex)
    if (rowCellMap) {
      rowCellMap.delete(columnIndex)
    }
    
    // Phase 6.2: Track changed row BEFORE triggering reactivity
    changedRowIndices.value.add(rowIndex)
    
    // Phase 10: Batch support - defer triggerRef if batching is active
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      triggerRef(data)
    }
    hasUnsavedChanges.value = true
  }

  // Set manual correction for result cell (uses rowMap and cellMap for O(1) lookups)
  // baselineCorrection: Baseline correction value (4 decimals)
  // multiplier: Multiplier value (2 decimals)
  const setManualCorrection = (rowIndex: number, columnIndex: number, baselineCorrection?: number, multiplier?: number): void => {
    if (!data.value) return
    
    // Phase 9.1.1: Use cache directly instead of accessing computed properties
    let row = rowMapCache.get(rowIndex)
    if (!row) {
      row = data.value.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        rowMapCache.set(rowIndex, row)
      }
    }
    if (!row) return
    
    // Use cellMap cache directly instead of accessing computed
    let rowCellMap = cellMapCache.get(rowIndex)
    if (!rowCellMap) {
      rowCellMap = new Map<number, CellValue>()
      row.values.forEach(cell => {
        rowCellMap!.set(cell.columnIndex, cell)
      })
      cellMapCache.set(rowIndex, rowCellMap)
    }
    let cell = rowCellMap.get(columnIndex)
    if (!cell) {
      // Create new cell if it doesn't exist
      cell = { columnIndex, value: null }
      row.values.push(cell)
      rowCellMap.set(columnIndex, cell) // Update cache
    }
    
    // Store corrections in metadata
    if (baselineCorrection !== undefined) {
      cell.baselineCorrection = baselineCorrection
    }
    if (multiplier !== undefined) {
      cell.multiplier = multiplier
    }
    
    // Get original value (before any corrections)
    const originalValue = cell.originalValue ?? cell.value
    
    // Recalculate value if corrections applied
    if (baselineCorrection !== undefined || multiplier !== undefined) {
      if (originalValue !== null && originalValue !== '') {
        let correctedValue: number = typeof originalValue === 'number' ? originalValue : parseFloat(String(originalValue))
        if (!isNaN(correctedValue)) {
          // Store original value if not already stored
          if (cell.originalValue === undefined) {
            cell.originalValue = correctedValue
          }
          
          // Apply corrections
          if (baselineCorrection !== undefined) {
            correctedValue += baselineCorrection
          }
          if (multiplier !== undefined) {
            correctedValue *= multiplier
          }
          
          cell.value = correctedValue
        }
      }
    }
    
    // Phase 6.2: Track changed row BEFORE triggering reactivity
    changedRowIndices.value.add(rowIndex)
    
    // Phase 10: Batch support - defer triggerRef if batching is active
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      triggerRef(data)
    }
    hasUnsavedChanges.value = true
  }

  // ==================== BATCHING METHODS ====================
  
  /**
   * Start a batch operation - defer all triggerRef calls until endBatch()
   * REASONING: For multi-cell operations, batch all changes and trigger once
   * This reduces recomputation from O(N) to O(1) for bulk operations
   */
  const startBatch = (): void => {
    isBatching = true
    batchChangedRows.clear()
  }
  
  // End a batch operation - trigger reactivity once for all batched changes
  const endBatch = (): void => {
    if (!isBatching) return
    
    isBatching = false
    
    // Add all batched rows to changedRowIndices
    batchChangedRows.forEach(rowIndex => {
      changedRowIndices.value.add(rowIndex)
    })
    batchChangedRows.clear()
    
    // Single triggerRef for all batched changes
    triggerRef(data)
  }

  // FILTER STATE
  
  const selectedServiceItemIndex = ref<number | null>(null)
  const showReportableOnly = ref<boolean>(true)
  const viewMode = ref<ViewMode>('qc')
  
  // Phase 11: Filter change counter to signal component to clear cache
  // REASONING: Increments synchronously when filters change, allowing component to clear cache before computed runs
  const filterChangeCounter = ref(0)
  
  // ==================== FILTER COMPUTED ====================
  
  const availableServiceItems = computed(() => {
    if (!data.value?.metadata?.schema?.serviceItems) return []
    return data.value.metadata.schema.serviceItems
      .map(si => ({
        siIndex: si.siIndex,
        code: si.code || '',
        name: si.name || si.code || ''
      }))
      .sort((a, b) => (a.name || a.code || '').toLowerCase().localeCompare((b.name || b.code || '').toLowerCase()))
  })
  
  const availableAnalytes = computed(() => {
    if (!data.value?.metadata?.schema?.analytes) return []
    return data.value.metadata.schema.analytes
      .map(a => ({
        analyteIndex: a.analyteIndex,
        code: a.code || '',
        name: a.name || a.code || '',
        serviceItemIndex: a.serviceItemIndex
      }))
      .sort((a, b) => (a.code || a.name || '').toLowerCase().localeCompare((b.code || b.name || '').toLowerCase()))
  })
  
  const filteredColumns = computed<ColumnDefinition[]>(() => {
    if (!data.value) return []
    
    let columns = [...allColumns.value]
    
    // Filter 1: Service Item
    if (selectedServiceItemIndex.value !== null) {
      columns = columns.filter(
        col => col.serviceItemIndex === selectedServiceItemIndex.value || col.columnIndex < STATIC_COLUMN_COUNT
      )
    }
    
    // Filter 2: Reportable Analytes Only
    if (showReportableOnly.value) {
      const reportableAnalyteIndices = new Set<number>()
      if (data.value?.metadata?.schema?.analytes) {
        data.value.metadata.schema.analytes.forEach(analyte => {
          if (analyte.reportable === true) {
            reportableAnalyteIndices.add(analyte.analyteIndex)
          }
        })
      }
      
      columns = columns.filter(
        col => col.columnIndex < STATIC_COLUMN_COUNT || reportableAnalyteIndices.has(col.analyteIndex)
      )
    }
    
    // Filter 3: View Mode
    if (viewMode.value === 'report') {
      columns = columns.filter(col => {
        if (col.columnIndex < STATIC_COLUMN_COUNT) return true
        if (col.columnType === 'correction') return false
        if (col.columnType === 'rawdata' && col.isSelected === false) return false
        return true
      })
    }
    
    return columns
  })
  
  const filteredRows = computed<RowData[]>(() => {
    if (!data.value) return []
    
    let rows = [...data.value.rows]
    
    // Filter by Service Item traveler numbers
    if (selectedServiceItemIndex.value !== null) {
      const serviceItem = data.value.metadata?.schema?.serviceItems
        ?.find(si => si.siIndex === selectedServiceItemIndex.value)
      
      if (serviceItem?.travelerNo && serviceItem.travelerNo.length > 0) {
        // Create Set for O(1) lookup
        const allowedTravelers = new Set(serviceItem.travelerNo)
        rows = rows.filter(row => allowedTravelers.has(row.travelerNo))
      } else {
        // Option A: Empty travelerNo[] array means show no rows
        rows = []
      }
    }
    
    return rows
  })
  
  const hasActiveFilters = computed(() => {
    return selectedServiceItemIndex.value !== null || viewMode.value !== 'qc'
  })
  
  const activeFilterCount = computed(() => {
    let count = 0
    if (selectedServiceItemIndex.value !== null) count++
    if (viewMode.value !== 'qc') count++
    return count
  })
  
  // FILTER ACTIONS
  
  function setServiceItemFilter(siIndex: number | null) {
    selectedServiceItemIndex.value = siIndex
  }
  
  function setReportableOnlyFilter(enabled: boolean) {
    showReportableOnly.value = enabled
  }
  
  function setViewMode(mode: ViewMode) {
    viewMode.value = mode
  }
  
  function clearAllFilters() {
    selectedServiceItemIndex.value = null
    showReportableOnly.value = true
    viewMode.value = 'qc'
  }
  
  function clearServiceItemFilter() {
    selectedServiceItemIndex.value = null
  }
  
  function clearReportableOnlyFilter() {
    showReportableOnly.value = true
  }

  // ==================== ACTIONS ====================

  // Load data from JSON file or API
  async function loadData() {
    loading.value = true
    error.value = null
    hasUnsavedChanges.value = false
    
    try {
      // Use initialData if provided, otherwise use sampleData
      const dataToLoad = initialData.value || sampleData
      data.value = dataToLoad as OptimizedDataTablePayload
      
      if (import.meta.env.DEV) {
        console.log('Data loaded:', {
          hasData: !!data.value,
          rowsCount: data.value?.rows?.length,
          columnsCount: allColumns.value.length,
          filteredColumnsCount: filteredColumns.value.length
        })
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load data'
      console.error('Error loading data:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Set initial data from external source
   */
  function setInitialData(payload: OptimizedDataTablePayload | null) {
    initialData.value = payload
  }

  // Save data (mocked for now)
  async function saveData(): Promise<boolean> {
    if (!data.value) return false
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500))
      hasUnsavedChanges.value = false
      return true
    } catch (err) {
      console.error('Error saving data:', err)
      return false
    }
  }

  function clearUnsavedChanges() {
    hasUnsavedChanges.value = false
  }

  /**
   * Clear changed row indices
   * REASONING: Phase 6.2 - Called after incremental updates are applied
   */
  function clearChangedRows() {
    changedRowIndices.value.clear()
  }

  return {
    // State
    data,
    loading,
    error,
    hasUnsavedChanges,
    // Computed
    columnMap,
    rowMap,
    cellMap,
    resultColumnMap,
    allColumns,
    getCellValue,
    // Data Operations
    getCellValueByIndex,
    setCellValue,
    findResultColumn,
    markResultCellFinal,
    clearResultCell,
    setManualCorrection,
    // Batching
    startBatch,
    endBatch,
    // Filter State
    selectedServiceItemIndex,
    showReportableOnly,
    viewMode,
    filterChangeCounter,
    // Filter Computed
    availableServiceItems,
    availableAnalytes,
    filteredColumns,
    filteredRows,
    hasActiveFilters,
    activeFilterCount,
    // Cached code maps for O(1) lookups
    serviceItemCodeMap,
    analyteCodeMap,
    // Actions
    loadData,
    saveData,
    clearUnsavedChanges,
    setInitialData,
    // Filter Actions
    setServiceItemFilter,
    setReportableOnlyFilter,
    setViewMode,
    clearAllFilters,
    clearServiceItemFilter,
    clearReportableOnlyFilter,
    // Changed row tracking for incremental updates
    changedRowIndices,
    clearChangedRows
  }
})
