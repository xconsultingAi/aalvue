// Cell Formatters Composable
// Extracts cell formatter logic from DataTableGrid.vue to improve maintainability

import type { ColumnDefinition } from '@/types'
import { useDataTableStore } from '@/stores/dataTableStore'

interface UseCellFormattersOptions {
  // No options needed - formatters use store directly
}

/**
 * Variance Threshold Configuration
 * Configurable thresholds for each variance type (can be adjusted independently)
 */
const VARIANCE_THRESHOLDS = {
  // ORIGINAL/REJCTDUP/PULPDUP variance thresholds
  DUP: {
    high: 20,    // Variance > 20% triggers high severity
    medium: 10   // Variance > 10% and ≤ 20% triggers medium severity
  },
  // ORGPRD/PRD variance thresholds
  PRD: {
    high: 20,    // Variance > 20% triggers high severity
    medium: 10   // Variance > 10% and ≤ 20% triggers medium severity
  },
  // ORGCRD/CRD variance thresholds
  CRD: {
    high: 20,    // Variance > 20% triggers high severity
    medium: 10   // Variance > 10% and ≤ 20% triggers medium severity
  }
} as const

export function useCellFormatters(options?: UseCellFormattersOptions) {
  const store = useDataTableStore()

  /**
   * Get Analyte properties (lowerLimit, upperLimit, unit) for a column
   */
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

  /**
   * Determine conditional formatting class for result cells based on multiple criteria:
   * - CRM rows: Analyte limits (lowerLimit, upperLimit)
   * - ORIGINAL/ORGCRD/ORGPRD rows: Variance between original and duplicate/control values
   */
  function getResultCellFormattingClass(column: ColumnDefinition, cellValue: any, rowIndex?: number): string {
    // Only apply to result columns
    if (column.columnType !== 'result') return ''
    
    // Early exit if no row data available
    if (rowIndex === undefined || !store.data) return ''
    
    const row = store.data.rows.find(r => r.rowIndex === rowIndex)
    if (!row) return ''
    
    const controlType = (row.controlType || '').toString().toUpperCase()
    //const columnIndex = column.columnIndex
    
    // Handle CRM rows (existing logic - analyte limits)
    if (controlType === 'CRM') {
      // Get analyte properties
      const analyteProps = getAnalyteProperties(column)
      if (!analyteProps) return ''
      
      // Check if value is valid
      if (cellValue === null || cellValue === '') return ''
      
      // Parse value to number
      const numValue = parseFloat(cellValue)
      if (isNaN(numValue)) return ''
      
      // Parse limits to numbers
      const lowerLimit = analyteProps.lowerLimit ? parseFloat(analyteProps.lowerLimit) : NaN
      const upperLimit = analyteProps.upperLimit ? parseFloat(analyteProps.upperLimit) : NaN
      
      // Apply conditional formatting only if outside limits (below or above)
      if (!isNaN(lowerLimit) && numValue < lowerLimit) {
        return 'cell-below-limit' // Red - below lower limit
      } else if (!isNaN(upperLimit) && numValue > upperLimit) {
        return 'cell-above-limit' // Red - above upper limit
      } else if (!isNaN(lowerLimit) && !isNaN(upperLimit) && 
                 numValue >= lowerLimit && numValue <= upperLimit) {
        return 'cell-within-limit' // Green - within range
      }
      
      return ''
    }
    
    // Handle ORIGINAL/ORGCRD/ORGPRD rows (new logic - variance checks)
    if (controlType === 'ORIGINAL' || controlType === 'ORGCRD' || controlType === 'ORGPRD') {
      // Use cellValue parameter directly (same as CRM logic)
      const numOriginalValue = parseFloat(cellValue)
      
      // Skip if original value is missing or invalid
      if (isNaN(numOriginalValue)) return ''


      // Find matching duplicate/control rows based on controlType
      let matchingRows: typeof store.data.rows = []
      
      if (controlType === 'ORIGINAL') {
        // Match ORIGINAL with REJECTDUP or PULPDUP
        const originalSampleName = row.sampleName || ''
        const originalTravelerNo = row.travelerNo || ''
        
        // First, find all REJECTDUP/PULPDUP rows with same travelerNo for debugging
        const allDupCandidates = store.data.rows.filter(r => {
          const dupControlType = (r.controlType || '').toString().toUpperCase()
          return (dupControlType === 'REJECTDUP' || dupControlType === 'PULPDUP') && 
                 r.travelerNo === originalTravelerNo
        })
        
        // Then filter by sampleName pattern
        // Match by sampleName pattern only (more reliable than controlType)

        matchingRows = allDupCandidates.filter(r => {
          const dupSampleName = r.sampleName || ''
          
        
          // Trust the sampleName pattern over controlType field
          if (dupSampleName === originalSampleName + '-R') return true  // REJECTDUP pattern
          if (dupSampleName === originalSampleName + '-X') return true  // PULPDUP pattern
          
          return false
        })
      } else if (controlType === 'ORGCRD') {
        // Match ORGCRD with CRD (same travelerNo, seqNo + 1)
        matchingRows = store.data.rows.filter(r => {
          const dupControlType = (r.controlType || '').toString().toUpperCase()
          if (dupControlType !== 'CRD') return false
          if (r.travelerNo !== row.travelerNo) return false
          if (r.seqNo !== row.seqNo + 1) return false
          return true
        })
      } else if (controlType === 'ORGPRD') {
        // Match ORGPRD with PRD (same travelerNo, seqNo + 1)
        matchingRows = store.data.rows.filter(r => {
          const dupControlType = (r.controlType || '').toString().toUpperCase()
          if (dupControlType !== 'PRD') return false
          if (r.travelerNo !== row.travelerNo) return false
          if (r.seqNo !== row.seqNo + 1) return false
          return true
        })
      }
      
      // Calculate variance for each matching duplicate and track highest variance
      let highestVariance = 0
      
      for (const matchingRow of matchingRows) {
        const duplicateCellValue = matchingRow.values.find(c => c.columnIndex === column.columnIndex)
        const duplicateValue = duplicateCellValue?.value
        
        // Check if value is valid (consistent with CRM logic)
        if (duplicateValue === null || duplicateValue === '' || duplicateValue === undefined) continue
        
        // Parse value to number
        const numDuplicateValue = parseFloat(String(duplicateValue))
        if (isNaN(numDuplicateValue)) continue
        
        // Calculate variance: |originalValue - duplicateValue| / originalValue * 100
        const variance = Math.abs(numOriginalValue - numDuplicateValue) / numOriginalValue * 100
        
        // Track highest variance (prioritize high > medium)
        if (variance > highestVariance) {
          highestVariance = variance
        }
      }
      
      // Return variance-based classes based on highest variance found and controlType
      // Priority: variance-high > variance-medium
      let resultClass = ''
      const thresholds = controlType === 'ORIGINAL' 
        ? VARIANCE_THRESHOLDS.DUP
        : controlType === 'ORGPRD'
          ? VARIANCE_THRESHOLDS.PRD
          : VARIANCE_THRESHOLDS.CRD
      
      const classPrefix = controlType === 'ORIGINAL'
        ? 'cell-variance-dup'
        : controlType === 'ORGPRD'
          ? 'cell-variance-prd'
          : 'cell-variance-crd'
      
      if (highestVariance > thresholds.high) {
        resultClass = `${classPrefix}-high` // High severity - variance > high threshold
      } else if (highestVariance > thresholds.medium) {
        resultClass = `${classPrefix}-medium` // Medium severity - variance > medium threshold and ≤ high threshold
      }
      
      return resultClass // No formatting if variance ≤ medium threshold or no match found
    }
    
    // Handle REJECTDUP/PULPDUP/CRD/PRD rows (reverse logic - find ORIGINAL/ORGCRD/ORGPRD)
    if (controlType === 'REJECTDUP' || controlType === 'PULPDUP' || controlType === 'CRD' || controlType === 'PRD') {
      // Use cellValue parameter directly (same as CRM logic)
      const numDuplicateValue = parseFloat(cellValue)
      
      // Skip if duplicate value is missing or invalid
      if (isNaN(numDuplicateValue)) return ''
      
      // Find matching original/control rows based on controlType
      let matchingRows: typeof store.data.rows = []
      
      if (controlType === 'REJECTDUP' || controlType === 'PULPDUP') {
        // Match REJECTDUP/PULPDUP with ORIGINAL
        const dupSampleName = row.sampleName || ''
        const dupTravelerNo = row.travelerNo || ''
        
        // Remove suffix to get original sampleName
        const originalSampleName = dupSampleName.endsWith('-R') 
          ? dupSampleName.slice(0, -2) 
          : dupSampleName.endsWith('-X') 
            ? dupSampleName.slice(0, -2) 
            : ''
        
        if (originalSampleName) {
          matchingRows = store.data.rows.filter(r => {
            const origControlType = (r.controlType || '').toString().toUpperCase()
            return origControlType === 'ORIGINAL' && 
                   r.travelerNo === dupTravelerNo &&
                   r.sampleName === originalSampleName
          })
        }
      } else if (controlType === 'CRD') {
        // Match CRD with ORGCRD (same travelerNo, seqNo - 1)
        matchingRows = store.data.rows.filter(r => {
          const origControlType = (r.controlType || '').toString().toUpperCase()
          if (origControlType !== 'ORGCRD') return false
          if (r.travelerNo !== row.travelerNo) return false
          if (r.seqNo !== row.seqNo - 1) return false
          return true
        })
      } else if (controlType === 'PRD') {
        // Match PRD with ORGPRD (same travelerNo, seqNo - 1)
        matchingRows = store.data.rows.filter(r => {
          const origControlType = (r.controlType || '').toString().toUpperCase()
          if (origControlType !== 'ORGPRD') return false
          if (r.travelerNo !== row.travelerNo) return false
          if (r.seqNo !== row.seqNo - 1) return false
          return true
        })
      }
      
      // Calculate variance for each matching original and track highest variance
      let highestVariance = 0
      
      for (const matchingRow of matchingRows) {
        const originalCellValue = matchingRow.values.find(c => c.columnIndex === column.columnIndex)
        const originalValue = originalCellValue?.value
        
        // Check if value is valid (consistent with CRM logic)
        if (originalValue === null || originalValue === '' || originalValue === undefined) continue
        
        // Parse value to number
        const numOriginalValue = parseFloat(String(originalValue))
        if (isNaN(numOriginalValue)) continue
        
        // Calculate variance: |duplicateValue - originalValue| / originalValue * 100
        const variance = Math.abs(numDuplicateValue - numOriginalValue) / numOriginalValue * 100
        
        // Track highest variance (prioritize dark red > light red)
        if (variance > highestVariance) {
          highestVariance = variance
        }
      }
      
      // Return variance-based classes based on highest variance found and controlType
      // Priority: variance-high > variance-medium
      let resultClass = ''
      const thresholds = controlType === 'REJECTDUP' || controlType === 'PULPDUP'
        ? VARIANCE_THRESHOLDS.DUP
        : controlType === 'PRD'
          ? VARIANCE_THRESHOLDS.PRD
          : VARIANCE_THRESHOLDS.CRD
      
      const classPrefix = controlType === 'REJECTDUP' || controlType === 'PULPDUP'
        ? 'cell-variance-dup'
        : controlType === 'PRD'
          ? 'cell-variance-prd'
          : 'cell-variance-crd'
      
      if (highestVariance > thresholds.high) {
        resultClass = `${classPrefix}-high` // High severity - variance > high threshold
      } else if (highestVariance > thresholds.medium) {
        resultClass = `${classPrefix}-medium` // Medium severity - variance > medium threshold and ≤ high threshold
      }
      
      return resultClass // No formatting if variance ≤ medium threshold or no match found
    }
    //console.log("Column: " + column.columnIndex +", Row: " + rowIndex +", Control Type: " + controlType +", Value: " + cellValue)
    return ''
  }

  /**
   * Formatter for SampleName column (columnIndex === 1)
   * Shows SampleCode tooltip and note icon if sampleCode exists
   */
  function formatSampleName(cell: any): string {
    const rowData = cell.getData()
    const rowIndex = rowData?.rowIndex
    const value = cell.getValue()
    
    // Get sampleCode from row data
    if (rowIndex !== undefined && store.data) {
      const row = store.data.rows.find(r => r.rowIndex === rowIndex)
      if (row && row.sampleCode) {
        // Return HTML with value, tooltip, and note icon
        return `<div class="sample-name-cell-content" title="Sample Code: ${row.sampleCode}">
          <span class="sample-name-value">${value !== null && value !== '' ? value : ''}</span>
          <span class="sample-code-indicator"></span>
        </div>`
      }
    }
    
    // Return normal value if no sampleCode
    return value !== null && value !== '' ? value : ''
  }

  /**
   * Formatter for Result columns
   * Shows final indicator, source indicator, and correction indicators
   */
  function formatResultCell(cell: any, column: ColumnDefinition): string {
    const rowData = cell.getData()
    const rowIndex = rowData?.rowIndex
    const columnIndex = column.columnIndex
    const value = cell.getValue()
    
    if (rowIndex !== undefined && store.data) {
      const row = store.data.rows.find(r => r.rowIndex === rowIndex)
      if (row) {
        const cellValue = row.values.find(c => c.columnIndex === columnIndex)
        const isFinal = cellValue?.isFinal === true
        const copiedFrom = cellValue?.copiedFrom
        const baselineCorrection = cellValue?.baselineCorrection
        const multiplier = cellValue?.multiplier
        
        // Show source indicator if copiedFrom exists (always show, regardless of default wavelength)
        const showSourceIndicator = !!copiedFrom
        // Show correction indicator if baseline or multiplier is applied
        const hasCorrection = baselineCorrection !== undefined || multiplier !== undefined
        
        // Build tooltip: "From: X" if copiedFrom exists, then "Baseline: Y" and/or "Multiplier: Z" if corrections exist
        const tooltipParts: string[] = []
        if (copiedFrom) {
          tooltipParts.push(`From: ${copiedFrom}`)
        }
        if (hasCorrection) {
          const correctionParts: string[] = []
          if (baselineCorrection !== undefined) {
            correctionParts.push(`Baseline: ${baselineCorrection}`)
          }
          if (multiplier !== undefined) {
            correctionParts.push(`Multiplier: ${multiplier}`)
          }
          tooltipParts.push(correctionParts.join(', '))
        }
        const tooltip = tooltipParts.length > 0 ? tooltipParts.join('\n') : ''
        
        // Use blue indicator if corrections applied, otherwise grey
        const indicatorClass = hasCorrection ? 'source-indicator-blue' : 'source-indicator'
        
        // Get conditional formatting class based on value vs analyte limits or variance
        const conditionalClass = getResultCellFormattingClass(column, value, rowIndex)
        
        // Build CSS classes for result cell content
        const cellContentClasses = ['result-cell-content']
        if (conditionalClass) {
          cellContentClasses.push(conditionalClass)
        }
        
        if (isFinal || showSourceIndicator || hasCorrection) {
          return `<div class="${cellContentClasses.join(' ')}" ${tooltip ? `title="${tooltip}"` : ''}>
            <span class="result-cell-value">${value !== null && value !== '' ? value : ''}</span>
            ${isFinal ? '<span class="final-indicator"></span>' : ''}
            ${(showSourceIndicator || hasCorrection) ? `<span class="${indicatorClass}"></span>` : ''}
          </div>`
        }
        
        // If no indicators but has conditional formatting, still wrap in div with class
        if (conditionalClass) {
          return `<div class="${cellContentClasses.join(' ')}">
            <span class="result-cell-value">${value !== null && value !== '' ? value : ''}</span>
          </div>`
        }
      }
    }
    
    // Return normal value if no indicators or conditional formatting needed
    return value !== null && value !== '' ? value : ''
  }

  return {
    formatSampleName,
    formatResultCell
  }
}
