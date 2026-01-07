import { ref, type Ref } from 'vue'
import type { Tabulator } from 'tabulator-tables'
import type { ColumnDefinition, RowData } from '@/types'
import { useDataTableStore } from '@/stores/dataTableStore'
import { STATIC_COLUMN_COUNT } from '@/types'
import { icons } from '@/utils/icons' 

interface UseContextMenuOptions {
  getTabulatorInstance: () => Tabulator | null
  isCopyingToResult: Ref<boolean>
  isCellFinal: (rowIndex: number, columnIndex: number) => boolean
  extractSelectedResultRows: (selectedRanges: any[], clickedColumn: ColumnDefinition) => Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}>
  hasAnyFinalResult: (rowIndex: number) => boolean
  openRequestModal: (type: 'repeat' | 'overlimit', rows: Array<{rowIndex: number, rowData: RowData, serviceItemIndex: number}>, column: ColumnDefinition) => void
  handleCopyToResultCell: (column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) => void
  handleUseWavelengthCell: (column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) => void
  handleManualCorrectionCell: (column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) => void
  handleMarkFinalCell: (column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) => void
  handleClearResultsCell: (column: ColumnDefinition, rowIndex: number, selectedRanges: any[]) => void
}

export function useContextMenu(options: UseContextMenuOptions) {
  const store = useDataTableStore()
  const {
    getTabulatorInstance,
    isCopyingToResult,
    isCellFinal,
    extractSelectedResultRows,
    hasAnyFinalResult,
    openRequestModal,
    handleCopyToResultCell,
    handleUseWavelengthCell,
    handleManualCorrectionCell,
    handleMarkFinalCell,
    handleClearResultsCell
  } = options

  // Get cell context menu items (supports multi-cell selection)
  function getCellContextMenu(e: MouseEvent, cell: any): any[] {
    // Extract columnIndex from field name
    const field = cell.getField()
    if (!field || !field.startsWith('col_')) return []
    
    const columnIndex = parseInt(field.replace('col_', ''), 10)
    if (columnIndex < STATIC_COLUMN_COUNT) return [] // Only for dynamic columns
    
    const columnDef = store.filteredColumns.find(col => col.columnIndex === columnIndex)
    if (!columnDef) return []
    
    // Get selected ranges for multi-cell operations
    const selectedRanges = getTabulatorInstance()?.getRanges() || []
    const hasSelection = selectedRanges.length > 0
    
    // Get row index from cell
    const rowData = cell.getData()
    const rowIndex = rowData?.rowIndex
    
    // Count selected cells across all ranges
    let selectedCellCount = 0
    if (hasSelection) {
      selectedRanges.forEach((range: any) => {
        const rangeCells = range.getCells() || []
        selectedCellCount += rangeCells.length
      })
    }
    
    if (import.meta.env.DEV) {
      console.log('Cell context menu:', {
        columnIndex,
        rowIndex,
        columnType: columnDef.columnType,
        hasSelection,
        selectedCellCount: selectedCellCount || 1
      })
    }
    
    const menuItems: any[] = []
    
    // Options for wavelengths, WC, MC columns
    if (columnDef.columnType === 'rawdata' || columnDef.columnType === 'correction') {
      menuItems.push({
        label: icons .copy +' Copy to Results ' + (hasSelection ? `(${selectedCellCount} cells)` : ''),
        action: () => handleCopyToResultCell(columnDef, rowIndex, selectedRanges)
      })
    }
    
    // Options for wavelength columns only
    if (columnDef.columnType === 'rawdata') {
      menuItems.push({
        label: icons .useData +' Use this data ' + (hasSelection ? `(${selectedCellCount} cells)` : ''),
        
        action: () => handleUseWavelengthCell(columnDef, rowIndex, selectedRanges)
      })
    }
    
    // Options for result columns only
    if (columnDef.columnType === 'result') {
      // Don't show Manual Correction if cell is final
      if (rowIndex !== undefined && !isCellFinal(rowIndex, columnDef.columnIndex)) {
        menuItems.push({
          label: icons .edit +' Manual Correction',
          action: () => handleManualCorrectionCell(columnDef, rowIndex, selectedRanges)
        })
      }
      menuItems.push({
        label: icons .check +' Mark Final ' + (hasSelection ? `(${selectedCellCount} cells)` : ''),
        action: () => handleMarkFinalCell(columnDef, rowIndex, selectedRanges)
      })
      menuItems.push({
        label: icons .trash +' Clear Results ' + (hasSelection ? `(${selectedCellCount} cells)` : ''),
        action: () => handleClearResultsCell(columnDef, rowIndex, selectedRanges)
      })
      
      // Check for valid selected result rows (excluding final rows), or use clicked cell
      let selectedResultRows = extractSelectedResultRows(selectedRanges, columnDef)
      
      // If no selection but we're on a result column, include the clicked row
      if (selectedResultRows.length === 0 && rowIndex !== undefined) {
        // Check if row has any final result cells
        if (!hasAnyFinalResult(rowIndex)) {
          const row = store.rowMap.get(rowIndex)
          if (row) {
            selectedResultRows = [{
              rowIndex,
              rowData: row,
              serviceItemIndex: columnDef.serviceItemIndex
            }]
          }
        }
      }
      
      if (selectedResultRows.length > 0) {
        // Add separator
        menuItems.push({ separator: true })
        
        // Request generation options
        menuItems.push({
          label: icons .repeat +' Generate Repeat Request ' + `(${selectedResultRows.length} sample${selectedResultRows.length > 1 ? 's' : ''})`,
          action: () => openRequestModal('repeat', selectedResultRows, columnDef)
        })
        menuItems.push({
          label: icons .alert +' Generate Overlimit Request ' + `(${selectedResultRows.length} sample${selectedResultRows.length > 1 ? 's' : ''})`,
          action: () => openRequestModal('overlimit', selectedResultRows, columnDef)
        })
      }
    }
    
    return menuItems
  }

  return {
    getCellContextMenu
  }
}
