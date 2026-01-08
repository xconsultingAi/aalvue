<template>
  <Teleport to="body">
    <div
      v-if="isVisible"
      class="fixed inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm flex items-center justify-center z-[1000] p-12"
      @click.self="handleClose"
    >
      <div class="bg-white border-2 border-black/15 rounded-2xl shadow-xl min-w-[400px] max-w-[500px] relative max-h-[calc(100vh-6rem)] flex flex-col overflow-hidden outline-none">
        <!-- Header -->
        <div class="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h3 class="m-0 text-lg font-semibold">Manual Correction</h3>
          <button
            class="bg-transparent border-none text-2xl cursor-pointer text-gray-600 p-0 w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:bg-gray-100 hover:text-black"
            @click="handleClose"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        
        <!-- Body -->
        <div class="px-6 py-6 overflow-y-auto flex-1 min-h-0">
          <!-- Baseline Correction -->
          <div class="mb-6">
            <label class="block mb-2 text-sm font-medium text-text">Baseline Correction (4 decimals):</label>
            <input
              type="number"
              step="0.0001"
              v-model.number="baseline"
              placeholder="0.0000"
              class="w-full px-3 py-2 mb-2 border border-gray-300 rounded-sm text-sm bg-white text-text transition-all focus:outline-none focus:border-primary-alt focus:shadow-[0_0_0_2px_rgba(74,144,226,0.1)]"
            />
            <button
              class="bg-primary-alt text-white border-none px-4 py-2 rounded-sm cursor-pointer text-sm font-medium transition-all hover:bg-[rgb(53,122,189)] disabled:bg-gray-400 disabled:cursor-not-allowed"
              @click="handleApplyBaseline"
              :disabled="baseline === null || baseline === undefined"
            >
              Apply
            </button>
          </div>
          
          <!-- Multiplier -->
          <div class="mb-6">
            <label class="block mb-2 text-sm font-medium text-text">Multiplier (2 decimals):</label>
            <input
              type="number"
              step="0.01"
              v-model.number="multiplier"
              placeholder="1.00"
              class="w-full px-3 py-2 mb-2 border border-gray-300 rounded-sm text-sm bg-white text-text transition-all focus:outline-none focus:border-primary-alt focus:shadow-[0_0_0_2px_rgba(74,144,226,0.1)]"
            />
            <button
              class="bg-primary-alt text-white border-none px-4 py-2 rounded-sm cursor-pointer text-sm font-medium transition-all hover:bg-[rgb(53,122,189)] disabled:bg-gray-400 disabled:cursor-not-allowed"
              @click="handleApplyMultiplier"
              :disabled="multiplier === null || multiplier === undefined"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ColumnDefinition } from '@/types'

interface Props {
  isVisible: boolean
  column: ColumnDefinition | null
  rowIndex: number | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  'apply-baseline': [value: number]
  'apply-multiplier': [value: number]
}>()

const baseline = ref<number | null>(null)
const multiplier = ref<number | null>(null)

// Reset values on dialog open/close
watch(() => props.isVisible, (newValue) => {
  if (newValue) {
    baseline.value = null
    multiplier.value = null
  }
})

function handleClose() {
  baseline.value = null
  multiplier.value = null
  emit('close')
}

function handleApplyBaseline() {
  if (baseline.value !== null && baseline.value !== undefined) {
    emit('apply-baseline', baseline.value)
  }
}

function handleApplyMultiplier() {
  if (multiplier.value !== null && multiplier.value !== undefined) {
    emit('apply-multiplier', multiplier.value)
  }
}
</script>
