// Tabulator Helper Utilities
// Extracts common patterns for extracting cells/rows from Tabulator ranges

import type { Tabulator } from 'tabulator-tables'
import type { ColumnDefinition } from '@/types'
import { STATIC_COLUMN_COUNT } from '@/types'

export interface ExtractedCell {
  rowIndex: number
  columnIndex: number
}

export interface ExtractCellsOptions {
  // Filter function to determine which columns to include (default: all dynamic columns)
  columnFilter?: (colDef: ColumnDefinition | undefined) => boolean
  
  // If true, extract only row indices (for row-based operations); if false, extract cell pairs
  extractRowsOnly?: boolean
  
  // Fallback cell/row to use if no selection exists
  fallbackCell?: { rowIndex: number; columnIndex: number }
  
  // Tabulator data for fallback method matching
  tabulatorData?: any[]
  
  // Column map for filtering
  columnMap?: Map<number, ColumnDefinition>
}

/**
 * Extract cells or rows from Tabulator range selections
 * 
 * REASONING: Consolidates the repeated pattern found in:
 * - handleCopyToResultCell (lines 1561-1685)
 * - handleMarkFinalCell (lines 1853-1906)
 * - handleClearResultsCell (lines 1982-2035)
 * - extractSelectedResultRows (lines 1147-1210)
 * 
 * This eliminates ~200+ lines of duplicated code.
 */
export function extractCellsFromRanges(
  tabulatorInstance: Tabulator | null,
  selectedRanges: any[],
  options: ExtractCellsOptions = {}
): ExtractedCell[] {
  const {
    columnFilter,
    extractRowsOnly = false,
    fallbackCell,
    tabulatorData,
    columnMap
  } = options

  if (!tabulatorInstance) {
    return fallbackCell ? [fallbackCell] : []
  }

  // Re-fetch ranges from Tabulator instance to get current state (selectedRanges may be stale)
  const currentRanges = tabulatorInstance.getRanges() || []
  const rangesToUse = currentRanges.length > 0 ? currentRanges : selectedRanges

  if (import.meta.env.DEV) {
    console.log('extractCellsFromRanges: Ranges found', {
      currentRangesCount: currentRanges.length,
      selectedRangesCount: selectedRanges.length,
      rangesToUseCount: rangesToUse.length
    })
  }

  const cellsToProcess: ExtractedCell[] = []

  if (rangesToUse && rangesToUse.length > 0) {
    // Process each range (use for loop to allow continue statement - need to process ALL ranges)
    for (let rangeIndex = 0; rangeIndex < rangesToUse.length; rangeIndex++) {
      const range = rangesToUse[rangeIndex]
      try {
        // Method 1: Use getRows() and getColumns() (preferred method)
        const selectedRows = range.getRows ? range.getRows() : []
        const selectedColumns = range.getColumns ? range.getColumns() : []

        if (selectedRows.length > 0 && selectedColumns.length > 0) {
          // Extract row indices
          const rowIndices: number[] = []
          selectedRows.forEach((row: any) => {
            try {
              const rowData = row.getData ? row.getData() : null
              if (rowData && typeof rowData.rowIndex === 'number') {
                if (!rowIndices.includes(rowData.rowIndex)) {
                  rowIndices.push(rowData.rowIndex)
                }
              } else {
                // Fallback: try getIndex() method
                const rowIdx = row.getIndex ? row.getIndex() : null
                if (typeof rowIdx === 'number' && !rowIndices.includes(rowIdx)) {
                  rowIndices.push(rowIdx)
                }
              }
            } catch (rowError) {
              if (import.meta.env.DEV) {
                console.warn('Error extracting row data:', rowError)
              }
            }
          })

          // Extract column indices
          const columnIndices: number[] = []
          selectedColumns.forEach((col: any) => {
            try {
              const field = col.getField ? col.getField() : null
              if (field && field.startsWith('col_')) {
                const colIndex = parseInt(field.replace('col_', ''), 10)
                if (!isNaN(colIndex) && colIndex >= STATIC_COLUMN_COUNT) {
                  // Apply column filter if provided
                  if (columnFilter && columnMap) {
                    const colDef = columnMap.get(colIndex)
                    if (!columnFilter(colDef)) {
                      return // Skip this column
                    }
                  }

                  if (!columnIndices.includes(colIndex)) {
                    columnIndices.push(colIndex)
                  }
                }
              }
            } catch (colError) {
              if (import.meta.env.DEV) {
                console.warn('Error extracting column data:', colError)
              }
            }
          })

          if (rowIndices.length > 0 && columnIndices.length > 0) {
            if (extractRowsOnly) {
              // For row-only extraction, just collect unique row indices
              // (cells will be built later based on all matching columns)
              rowIndices.forEach(rowIdx => {
                if (!cellsToProcess.some(c => c.rowIndex === rowIdx)) {
                  // Use columnIndex: -1 as marker
                  cellsToProcess.push({ rowIndex: rowIdx, columnIndex: -1 })
                }
              })
            } else {
              // Build cell list - all combinations of selected rows × columns
              rowIndices.forEach(rowIdx => {
                columnIndices.forEach(colIdx => {
                  // Avoid duplicates
                  const exists = cellsToProcess.some(
                    cell => cell.rowIndex === rowIdx && cell.columnIndex === colIdx
                  )
                  if (!exists) {
                    cellsToProcess.push({ rowIndex: rowIdx, columnIndex: colIdx })
                  }
                })
              })
            }
            
            if (import.meta.env.DEV) {
              console.log(`extractCellsFromRanges: Range ${rangeIndex} - Added ${extractRowsOnly ? rowIndices.length : rowIndices.length * columnIndices.length} cells`)
            }
            
            // CRITICAL FIX: Continue to next range instead of returning
            // REASONING: We need to process ALL ranges, not just the first one
            // The early return was causing only the first range to be processed,
            // which is why multi-cell selections were only marking the first cell
            continue // Skip fallback method for this range, but continue processing other ranges
          }
        }

        // Method 2: Fallback - Use getRangesData() and match rows by data (only if Method 1 failed)
        if (tabulatorData && tabulatorInstance?.getRangesData) {
          const rangesData = tabulatorInstance.getRangesData()
          if (rangesData && rangesData[rangeIndex]) {
            const rangeData = rangesData[rangeIndex] // Array of row data objects

            rangeData.forEach((rowData: any) => {
              // Match this row data to actual row in tabulatorData by comparing static fields
              const matchedRow = tabulatorData.find((r: any) => {
                // Match by sampleName and seqNo (or other unique static fields)
                return r.col_1 === rowData.col_1 && r.col_0 === rowData.col_0
              })

              if (matchedRow && matchedRow.rowIndex !== undefined) {
                // Extract column indices from rowData keys (e.g., "col_247") - use Set for O(1) duplicate checking
                const cellKeySet = new Set<string>()
                Object.keys(rowData).forEach(key => {
                  if (key.startsWith('col_')) {
                    const colIdx = parseInt(key.replace('col_', ''), 10)
                    if (!isNaN(colIdx) && colIdx >= STATIC_COLUMN_COUNT) {
                      // Apply column filter if provided
                      if (columnFilter && columnMap) {
                        const colDef = columnMap.get(colIdx)
                        if (!columnFilter(colDef)) {
                          return // Skip this column
                        }
                      }

                      const cellKey = `${matchedRow.rowIndex}_${colIdx}`
                      if (!cellKeySet.has(cellKey)) {
                        cellKeySet.add(cellKey)
                        if (extractRowsOnly) {
                          // For row-only, add row once
                          if (!cellsToProcess.some(c => c.rowIndex === matchedRow.rowIndex)) {
                            cellsToProcess.push({ rowIndex: matchedRow.rowIndex, columnIndex: -1 })
                          }
                        } else {
                          cellsToProcess.push({ rowIndex: matchedRow.rowIndex, columnIndex: colIdx })
                        }
                      }
                    }
                  }
                })
              }
            })
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(`Error processing range ${rangeIndex}:`, error)
        }
      }
    }
  }

  // If no selection, use fallback cell if provided
  if (cellsToProcess.length === 0 && fallbackCell) {
    // Validate fallback cell
    if (fallbackCell.columnIndex >= STATIC_COLUMN_COUNT || extractRowsOnly) {
      // Apply column filter to fallback cell if provided
      if (columnFilter && columnMap && !extractRowsOnly) {
        const colDef = columnMap.get(fallbackCell.columnIndex)
        if (columnFilter(colDef)) {
          cellsToProcess.push(fallbackCell)
        }
      } else {
        cellsToProcess.push(fallbackCell)
      }
    }
  }

  if (import.meta.env.DEV) {
    console.log('extractCellsFromRanges: Final result', {
      totalCells: cellsToProcess.length,
      extractRowsOnly,
      hasFallback: !!fallbackCell
    })
  }

  return cellsToProcess
}

// Extract only row indices from ranges (simplified version for row-based operations)
export function extractRowIndicesFromRanges(
  tabulatorInstance: Tabulator | null,
  selectedRanges: any[],
  options: {
    columnFilter?: (colDef: ColumnDefinition | undefined) => boolean
    columnMap?: Map<number, ColumnDefinition>
  } = {}
): number[] {
  const cells = extractCellsFromRanges(tabulatorInstance, selectedRanges, {
    ...options,
    extractRowsOnly: true
  })

  // Extract unique row indices
  const rowIndices = new Set<number>()
  cells.forEach(cell => {
    if (cell.rowIndex >= 0) {
      rowIndices.add(cell.rowIndex)
    }
  })

  return Array.from(rowIndices)
}
