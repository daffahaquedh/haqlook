export const ANALYSIS_REASONING_EFFORT = 'low'

export function createItemAnalysisRequest({ model, input, maxOutputTokens, schema }) {
  return {
    model,
    reasoning: { effort: ANALYSIS_REASONING_EFFORT },
    input,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: 'item_analysis', strict: true, schema } },
  }
}
