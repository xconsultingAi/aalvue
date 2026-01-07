// TypeScript type definitions for data table structure
// Fixed Columns (0-4): seqNo, sampleName, travelerNo, materialType, controlType
// Dynamic Columns (5+): Generated from ServiceItem x Analyte combinations
// Row Values: Sparse array referencing columnIndex (only non-empty values stored)

// METADATA TYPES

export interface JobDetails {
  code: string
  name: string
  customerCode: string
  customerName: string
  dueDate: string
}

export interface WavelengthSchema {
  wavelength: string
  isSelected: boolean
}

export interface CorrectionSchema {
  type: 'wc' | 'mc' | 'final'
  code: string
}

export interface AnalyteSchema {
  analyteIndex: number
  code: string
  name: string
  serviceItemIndex: number  // Links to ServiceItem
  lowerLimit: string
  upperLimit: string
  unit: string
  reportable: boolean
  wavelengths: WavelengthSchema[]
  corrections: CorrectionSchema[]
}

export interface ServiceItemSchema {
  siIndex: number
  code: string
  name: string
  analyteIndices: number[]  // Array of Analyte indices belonging to this ServiceItem
}

/**
 * Column Types:
 * - 'static': Fixed columns (0-4): seqNo, sampleName, travelerNo, materialType, controlType
 * - 'rawdata': Raw data from instrument (selected wavelength or other wavelengths)
 * - 'correction': Correction columns (wc = water correction, mc = multiplier correction)
 * - 'result': Final calculated result (previously 'correction' with 'final' type)
 */
export type ColumnType = 'static' | 'rawdata' | 'correction' | 'result'

export interface ColumnDefinition {
  columnIndex: number  // Unique index (0-4 = static, 5+ = dynamic)
  columnKey: string     // Unique identifier: e.g., "Wt0.000WEIGH"
  serviceItemIndex: number  // Which ServiceItem this column belongs to
  analyteIndex: number     // Which Analyte this column belongs to
  columnType: ColumnType
  label: string         // Display label: e.g., "Wt (g)"
  wavelength?: string   // If columnType is 'rawdata' (indicates which wavelength)
  isSelected?: boolean  // If columnType is 'rawdata' (indicates if this wavelength is selected by user)
  correctionType?: 'wc' | 'mc'  // If columnType is 'correction' (wc or mc only, no 'final')
  // Note: 'result' columns don't have correctionType (implied by columnType)
}

export interface Schema {
  serviceItems: ServiceItemSchema[]
  analytes: AnalyteSchema[]
  columnDefinitions: ColumnDefinition[]
}

export interface Metadata {
  job: JobDetails
  schema: Schema
}

// ==================== ROW DATA TYPES ====================

export interface CellValue {
  columnIndex: number  // References ColumnDefinition.columnIndex
  value: string | number
  // Rawdata cells: per-cell selection state
  isSelected?: boolean  // If true, this wavelength cell is selected for this specific row
  // Result cell metadata (only for result columns)
  isFinal?: boolean  // If true, cell is marked as final and cannot be overwritten
  copiedFrom?: string  // Source column header code (e.g., "328.068" for wavelength, "WC" for correction)
  markedFinalAt?: string  // ISO timestamp when cell was marked as final
  manualCorrection?: string | number  // Manual correction value if applied
  // Manual correction calculation properties
  baselineCorrection?: number  // Baseline correction value (4 decimals)
  multiplier?: number  // Multiplier value (2 decimals)
  originalValue?: number  // Original value before corrections (for recalculation)
}

export interface RowData {
  rowIndex: number
  // Fixed columns (always present, indices 0-4)
  seqNo: number
  sampleName: string
  sampleCode: number  // Sample Code (job_sample.code) for matching with MongoDB LIMS ID
  travelerNo: string
  materialType: string
  controlType: string
  // Dynamic values (sparse array, only non-empty values)
  values: CellValue[]
}

// ==================== COMPLETE PAYLOAD ====================

export interface OptimizedDataTablePayload {
  metadata: Metadata
  rows: RowData[]
}

// COMPUTED/HELPER TYPES

// Helper type for column lookup (maps columnIndex to ColumnDefinition for O(1) lookup)
export type ColumnMap = Map<number, ColumnDefinition>

/**
 * Helper type for row value lookup
 * Maps rowIndex -> columnIndex -> value for efficient cell access
 */
export type RowValueMap = Map<number, Map<number, string | number>>

// Static column indices (fixed columns)
export const STATIC_COLUMN_INDICES = {
  SEQ_NO: 0,
  SAMPLE_NAME: 1,
  TRAVELER_NO: 2,
  MATERIAL_TYPE: 3,
  CONTROL_TYPE: 4
} as const

export const STATIC_COLUMN_COUNT = 5
