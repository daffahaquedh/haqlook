export const DEFAULT_MODEL = 'gpt-6-luna'

// Prices are centralized here so model pricing and the IDR conversion can be
// changed in one server-side module or overridden by function configuration.
const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-6-luna': { input: 0.10, cachedInput: 0.01, output: 0.50 },
}

function configuredNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function modelPricing(model: string) {
  const base = MODEL_PRICING_USD_PER_MILLION[model] || MODEL_PRICING_USD_PER_MILLION[DEFAULT_MODEL]
  return {
    input: configuredNumber('OPENAI_INPUT_PRICE_USD_PER_1M', base.input),
    cachedInput: configuredNumber('OPENAI_CACHED_INPUT_PRICE_USD_PER_1M', base.cachedInput),
    output: configuredNumber('OPENAI_OUTPUT_PRICE_USD_PER_1M', base.output),
    idrPerUsd: configuredNumber('AI_IDR_PER_USD', 16000),
  }
}

export function estimateCostIdr(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
  const pricing = modelPricing(model)
  const input = Math.max(0, inputTokens)
  const cachedInput = Math.min(input, Math.max(0, cachedInputTokens))
  const uncachedInput = input - cachedInput
  const usd = (uncachedInput / 1_000_000) * pricing.input
    + (cachedInput / 1_000_000) * pricing.cachedInput
    + (Math.max(0, outputTokens) / 1_000_000) * pricing.output
  return Number((usd * pricing.idrPerUsd).toFixed(6))
}

export function reservationCostIdr(model: string) {
  const maxInputTokens = configuredNumber('AI_MAX_INPUT_TOKENS', 20000)
  const maxOutputTokens = configuredNumber('AI_MAX_OUTPUT_TOKENS', 1600)
  return estimateCostIdr(model, maxInputTokens, maxOutputTokens)
}

export function maxOutputTokens() {
  return Math.max(200, Math.floor(configuredNumber('AI_MAX_OUTPUT_TOKENS', 1600)))
}
