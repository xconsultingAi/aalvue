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
import { createApiClient } from '@/utils/apiClient'
import { debounce } from '@/utils/debounce'

export type ViewMode = 'qc' | 'report' | 'customer'

export const useDataTableStore = defineStore('dataTable', () => {
  const data = shallowRef<OptimizedDataTablePayload | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const hasUnsavedChanges = ref(false)
  const initialData = ref<OptimizedDataTablePayload | null>(null)
  const apiEndpoint = ref<string | null>(null)
  const csrfToken = ref<string | null>(null)
  
  const changedRowIndices = ref<Set<number>>(new Set())
  let isBatching = false
  let batchChangedRows = new Set<number>()

  const rowMapCache = new Map<number, RowData>()
  const cellMapCache = new Map<number, Map<number, CellValue>>()
  const lastDataRefForMaps = ref<any>(null)

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

  const cellMap = computed<Map<number, Map<number, CellValue>>>(() => {
    if (!data.value) {
      cellMapCache.clear()
      return new Map()
    }
    
    if (data.value !== lastDataRefForMaps.value) {
      cellMapCache.clear()
    }
    
    const map = new Map<number, Map<number, CellValue>>()
    
    data.value.rows.forEach(row => {
      const rowIndex = row.rowIndex
      const needsRebuild = 
        changedRowIndices.value.has(rowIndex) || 
        !cellMapCache.has(rowIndex)
      
      if (needsRebuild) {
        const rowCellMap = new Map<number, CellValue>()
        row.values.forEach(cell => {
          rowCellMap.set(cell.columnIndex, cell)
        })
        cellMapCache.set(rowIndex, rowCellMap)
        map.set(rowIndex, rowCellMap)
      } else {
        const cachedRowCellMap = cellMapCache.get(rowIndex)
        if (cachedRowCellMap) {
          map.set(rowIndex, cachedRowCellMap)
        } else {
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

  const analyteCodeMap = computed<Map<number, string>>(() => {
    if (!data.value?.metadata?.schema?.analytes) return new Map()
    
    const map = new Map<number, string>()
    data.value.metadata.schema.analytes.forEach(a => {
      map.set(a.analyteIndex, a.code || '')
    })
    return map
  })

  const allColumns = computed<ColumnDefinition[]>(() => {
    if (!data.value) return []
    
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
    
    const rowCellMap = cellMap.value.get(row.rowIndex)
    const cell = rowCellMap?.get(columnIndex)
    return cell?.value ?? null
  }

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
    
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      changedRowIndices.value.add(rowIndex)
      triggerRef(data)
    }
    
    hasUnsavedChanges.value = true
  }

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

  const markResultCellFinal = (rowIndex: number, columnIndex: number): void => {
    if (!data.value) return
    
    let row = rowMapCache.get(rowIndex)
    if (!row) {
      row = data.value.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        rowMapCache.set(rowIndex, row)
      }
    }
    if (!row) return
    
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
      const cellValue = getCellValueByIndex(rowIndex, columnIndex)
      if (cellValue === null || cellValue === '') {
        if (import.meta.env.DEV) {
          console.warn(`markResultCellFinal: Cell at row ${rowIndex}, col ${columnIndex} has no value, skipping`)
        }
        return
      }
      if (import.meta.env.DEV) {
        console.log(`markResultCellFinal: Creating missing cell object for row ${rowIndex}, col ${columnIndex}`)
      }
      cell = { columnIndex, value: cellValue }
      row.values.push(cell)
      rowCellMap.set(columnIndex, cell)
    }
    
    cell.isFinal = true
    cell.markedFinalAt = new Date().toISOString()
    
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      changedRowIndices.value.add(rowIndex)
      triggerRef(data)
    }
    hasUnsavedChanges.value = true
  }

  const clearResultCell = (rowIndex: number, columnIndex: number): void => {
    if (!data.value) return
    
    let row = rowMapCache.get(rowIndex)
    if (!row) {
      row = data.value.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        rowMapCache.set(rowIndex, row)
      }
    }
    if (!row) return
    
    row.values = row.values.filter(cell => cell.columnIndex !== columnIndex)
    
    const rowCellMap = cellMapCache.get(rowIndex)
    if (rowCellMap) {
      rowCellMap.delete(columnIndex)
    }
    
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      changedRowIndices.value.add(rowIndex)
      triggerRef(data)
    }
    hasUnsavedChanges.value = true
  }

  const setManualCorrection = (rowIndex: number, columnIndex: number, baselineCorrection?: number, multiplier?: number): void => {
    if (!data.value) return
    
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
    
    if (isBatching) {
      batchChangedRows.add(rowIndex)
    } else {
      changedRowIndices.value.add(rowIndex)
      triggerRef(data)
    }
    hasUnsavedChanges.value = true
  }

  const startBatch = (): void => {
    isBatching = true
    batchChangedRows.clear()
  }
  
  const endBatch = (): void => {
    if (!isBatching) return
    
    isBatching = false
    
    batchChangedRows.forEach(rowIndex => {
      changedRowIndices.value.add(rowIndex)
    })
    batchChangedRows.clear()
    
    triggerRef(data)
  }

  // FILTER STATE
  
  const selectedServiceItemIndex = ref<number | null>(null)
  const showReportableOnly = ref<boolean>(true)
  const viewMode = ref<ViewMode>('qc')
  const filterChangeCounter = ref(0)
  const isFiltering = ref(false)
  
  let filteredColumnsCache: ColumnDefinition[] = []
  let filteredColumnsCacheKey: string = ''
  let lastDataRefForColumns: OptimizedDataTablePayload | null = null
  
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
    if (!data.value) {
      filteredColumnsCache = []
      filteredColumnsCacheKey = ''
      return []
    }
    
    if (data.value !== lastDataRefForColumns) {
      filteredColumnsCache = []
      filteredColumnsCacheKey = ''
      lastDataRefForColumns = data.value
    }
    
    const cacheKey = `${selectedServiceItemIndex.value ?? 'null'}-${showReportableOnly.value}-${viewMode.value}`
    
    if (filteredColumnsCacheKey === cacheKey && filteredColumnsCache.length > 0) {
      return filteredColumnsCache
    }
    
    let columns = [...allColumns.value]
    
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
    
    if (viewMode.value === 'report') {
      columns = columns.filter(col => {
        if (col.columnIndex < STATIC_COLUMN_COUNT) return true
        if (col.columnType === 'correction') return false
        if (col.columnType === 'rawdata' && col.isSelected === false) return false
        return true
      })
    }
    
    filteredColumnsCache = columns
    filteredColumnsCacheKey = cacheKey
    
    return columns
  })
  
  const filteredRows = computed<RowData[]>(() => {
    if (!data.value) return []
    
    let rows = [...data.value.rows]
    
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
  
  const debouncedSetServiceItem = debounce((siIndex: number | null) => {
    selectedServiceItemIndex.value = siIndex
    filterChangeCounter.value++
  }, 200)
  
  const debouncedSetReportableOnly = debounce((enabled: boolean) => {
    showReportableOnly.value = enabled
    filterChangeCounter.value++
  }, 200)
  
  const debouncedSetViewMode = debounce((mode: ViewMode) => {
    viewMode.value = mode
    filterChangeCounter.value++
  }, 200)
  
  function setServiceItemFilter(siIndex: number | null) {
    isFiltering.value = true
    debouncedSetServiceItem(siIndex)
  }
  
  function setReportableOnlyFilter(enabled: boolean) {
    isFiltering.value = true
    debouncedSetReportableOnly(enabled)
  }
  
  function setViewMode(mode: ViewMode) {
    isFiltering.value = true
    debouncedSetViewMode(mode)
  }
  
  function clearAllFilters() {
    isFiltering.value = true
    selectedServiceItemIndex.value = null
    showReportableOnly.value = true
    viewMode.value = 'qc'
    filterChangeCounter.value++
  }
  
  function clearServiceItemFilter() {
    isFiltering.value = true
    selectedServiceItemIndex.value = null
    filterChangeCounter.value++
  }
  
  function clearReportableOnlyFilter() {
    isFiltering.value = true
    showReportableOnly.value = true
    filterChangeCounter.value++
  }

  async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        // Only retry on network errors (TypeError from fetch), not HTTP errors
        // Network errors typically have names like 'TypeError' or 'NetworkError'
        const isNetworkError = lastError.name === 'TypeError' || 
                              lastError.name === 'NetworkError' ||
                              lastError.message.includes('Failed to fetch') ||
                              lastError.message.includes('NetworkError')
        
        // Don't retry on HTTP errors or other non-network errors
        if (!isNetworkError) {
          throw lastError
        }
        
        if (attempt < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, attempt)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    throw lastError || new Error('Retry failed')
  }

  async function loadData() {
    console.log('[loadData] Starting loadData', {
      hasApiEndpoint: !!apiEndpoint.value,
      apiEndpoint: apiEndpoint.value,
      hasCsrfToken: !!csrfToken.value,
      hasInitialData: !!initialData.value
    })
    
    loading.value = true
    error.value = null
    hasUnsavedChanges.value = false
    
    try {
      if (apiEndpoint.value) {
        console.log('[loadData] Fetching from API:', apiEndpoint.value)
        const apiClient = createApiClient({ csrfToken: csrfToken.value || undefined })
        
        // Use retry logic for network errors (not HTTP errors)
        console.log('[loadData] Making API request...')
        const response = await retryWithBackoff(
          () => apiClient.get(apiEndpoint.value!),
          3,
          1000
        )
        
        console.log('[loadData] API response received:', {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText
        })
        
        if (!response.ok) {
          let errorMessage = 'Failed to load data'
          
          switch (response.status) {
            case 401:
              errorMessage = 'Authentication required. Please log in and try again.'
              break
            case 403:
              errorMessage = 'Access denied. You do not have permission to view this data.'
              break
            case 404:
              errorMessage = 'Data not found for this job code. Please verify the job code.'
              break
            case 500:
              errorMessage = 'Server error. Please try again later or contact support.'
              break
            case 503:
              errorMessage = 'Service temporarily unavailable. Please try again in a few moments.'
              break
            default:
              errorMessage = `Failed to load data: ${response.status} ${response.statusText}`
          }
          
          try {
            const errorData = await response.json()
            if (errorData.error) {
              errorMessage = errorData.error
            }
          } catch {
          }
          
          throw new Error(errorMessage)
        }
        
        const payload = await response.json()
        if (import.meta.env.DEV) {
          console.log('[loadData] Payload received:', {
            hasPayload: !!payload,
            hasRows: !!payload?.rows,
            rowsCount: payload?.rows?.length,
            hasMetadata: !!payload?.metadata,
            firstRow: payload?.rows?.[0],
            firstRowValues: payload?.rows?.[0]?.values,
            firstRowValuesCount: payload?.rows?.[0]?.values?.length,
            sampleCellValue: payload?.rows?.[0]?.values?.[0],
            hasColumnDefinitions: !!payload?.metadata?.schema?.columnDefinitions,
            columnDefinitionsCount: payload?.metadata?.schema?.columnDefinitions?.length,
            sampleColumnDef: payload?.metadata?.schema?.columnDefinitions?.[0]
          })
        }
        
        data.value = payload as OptimizedDataTablePayload
      } else if (initialData.value) {
        data.value = initialData.value as OptimizedDataTablePayload
        
        if (import.meta.env.DEV) {
          console.log('Data loaded from initialData:', {
            hasData: !!data.value,
            rowsCount: data.value?.rows?.length
          })
        }
      } else {
        data.value = sampleData as OptimizedDataTablePayload
        
        if (import.meta.env.DEV) {
          console.warn('Using sample data - no API endpoint or initialData provided')
        }
      }
    } catch (err) {
      console.error('[loadData] Error caught:', err)
      if (err instanceof Error && err.message === 'Request timeout') {
        error.value = 'Request timed out. The server is taking too long to respond. Please try again.'
      } else {
        error.value = err instanceof Error ? err.message : 'Failed to load data'
      }
      console.error('[loadData] Error set in store:', error.value)
    } finally {
      loading.value = false
      console.log('[loadData] Finished, loading set to false')
    }
  }

  function setInitialData(payload: OptimizedDataTablePayload | null) {
    initialData.value = payload
  }

  /**
   * Set API endpoint for data loading
   */
  function setApiEndpoint(endpoint: string | null) {
    apiEndpoint.value = endpoint
  }

  function setCsrfToken(token: string | null) {
    csrfToken.value = token
  }

  /**
   * Set loading state explicitly (for immediate UI feedback)
   */
  function setLoading(value: boolean) {
    loading.value = value
  }

  async function saveData(): Promise<boolean> {
    loading.value = true
    error.value = null
    
    if (!data.value) {
      loading.value = false
      throw new Error('No data to save')
    }
    
    if (!apiEndpoint.value) {
      loading.value = false
      throw new Error('Cannot save: API endpoint not configured')
    }
    
    try {
      console.log('[saveData] Starting save', {
        apiEndpoint: apiEndpoint.value,
        hasCsrfToken: !!csrfToken.value,
        rowsCount: data.value.rows?.length
      })
      
      const apiClient = createApiClient({ csrfToken: csrfToken.value || undefined })
      
      console.log('[saveData] Making POST request...')
      const response = await apiClient.post(apiEndpoint.value, data.value)
      
      console.log('[saveData] API response received:', {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText
      })
      
      if (!response.ok) {
        let errorMessage = 'Failed to save data'
        
        switch (response.status) {
          case 401:
            errorMessage = 'Authentication required. Please log in and try again.'
            break
          case 403:
            errorMessage = 'Access denied. You do not have permission to save this data.'
            break
          case 400:
            errorMessage = 'Invalid data. Please check your changes and try again.'
            break
          case 404:
            errorMessage = 'Job not found. Please verify the job code.'
            break
          case 500:
            errorMessage = 'Server error. Please try again later or contact support.'
            break
          case 503:
            errorMessage = 'Service temporarily unavailable. Please try again in a few moments.'
            break
          default:
            errorMessage = `Failed to save data: ${response.status} ${response.statusText}`
        }
        
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
        }
        
        throw new Error(errorMessage)
      }
      
      const result = await response.json()
      
      if (import.meta.env.DEV) {
        console.log('[saveData] Save successful:', {
          success: result.success,
          message: result.message
        })
      }
      
      hasUnsavedChanges.value = false
      return true
    } catch (err) {
      console.error('[saveData] Error caught:', err)
      error.value = null
      throw err
    } finally {
      loading.value = false
      console.log('[saveData] Finished, loading set to false')
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
    data,
    loading,
    error,
    hasUnsavedChanges,
    columnMap,
    rowMap,
    cellMap,
    resultColumnMap,
    allColumns,
    getCellValue,
    getCellValueByIndex,
    setCellValue,
    findResultColumn,
    markResultCellFinal,
    clearResultCell,
    setManualCorrection,
    startBatch,
    endBatch,
    selectedServiceItemIndex,
    showReportableOnly,
    viewMode,
    filterChangeCounter,
    isFiltering,
    availableServiceItems,
    availableAnalytes,
    filteredColumns,
    filteredRows,
    hasActiveFilters,
    activeFilterCount,
    serviceItemCodeMap,
    analyteCodeMap,
    loadData,
    saveData,
    clearUnsavedChanges,
    setInitialData,
    setApiEndpoint,
    setCsrfToken,
    setLoading,
    setServiceItemFilter,
    setReportableOnlyFilter,
    setViewMode,
    clearAllFilters,
    clearServiceItemFilter,
    clearReportableOnlyFilter,
    changedRowIndices,
    clearChangedRows
  }
})
