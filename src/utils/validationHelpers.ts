import type { ColumnDefinition } from '@/types'
import type { OptimizedDataTablePayload } from '@/types'
import { STATIC_COLUMN_COUNT } from '@/types'

export function validateColumnOperation(
  column: ColumnDefinition | null | undefined,
  requiredType?: 'result' | 'rawdata' | 'correction'
): boolean {
  if (!column) {
    if (import.meta.env.DEV) {
      console.warn('validateColumnOperation: Column is null or undefined')
    }
    return false
  }

  if (column.columnIndex < STATIC_COLUMN_COUNT) {
    if (import.meta.env.DEV) {
      console.warn('validateColumnOperation: Operation not allowed on static columns')
    }
    return false
  }

  // Check column type
  if (requiredType && column.columnType !== requiredType) {
    if (import.meta.env.DEV) {
      console.warn(`validateColumnOperation: Operation requires column type '${requiredType}', got '${column.columnType}'`)
    }
    return false
  }

  return true
}

export function validateRowOperation(
  rowIndex: number | undefined | null,
  data?: OptimizedDataTablePayload | null,
  rowMap?: Map<number, any>
): boolean {
  if (rowIndex === undefined || rowIndex === null) {
    if (import.meta.env.DEV) {
      console.warn('validateRowOperation: Row index is undefined or null')
    }
    return false
  }

  if (data === null || data === undefined) {
    if (import.meta.env.DEV) {
      console.warn('validateRowOperation: Data is null or undefined')
    }
    return false
  }

  // If rowMap is provided, check row existence
  if (rowMap && !rowMap.has(rowIndex)) {
    if (import.meta.env.DEV) {
      console.warn(`validateRowOperation: Row ${rowIndex} not found in rowMap`)
    }
    return false
  }

  return true
}

export function validateTabulatorOperation(
  tabulatorInstance: any | null,
  data: OptimizedDataTablePayload | null
): boolean {
  if (!data) {
    if (import.meta.env.DEV) {
      console.warn('validateTabulatorOperation: No data available')
    }
    return false
  }

  if (!tabulatorInstance) {
    if (import.meta.env.DEV) {
      console.warn('validateTabulatorOperation: No Tabulator instance available')
    }
    return false
  }

  return true
}
