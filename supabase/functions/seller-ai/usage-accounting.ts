type AnyClient = { rpc: (...args: any[]) => Promise<any> }
type AccountingError = Error & { code: string; status: number }

export function accountingRequestKey(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : crypto.randomUUID()
}

function makeError(code: string, message: string, status: number): AccountingError {
  return Object.assign(new Error(message), { code, status })
}

export async function reserveAiUsage(
  client: AnyClient,
  userId: string,
  feature: string,
  model: string,
  reasoningEffort: string,
  estimatedCost: number,
  requestKey: string,
  details: Record<string, unknown> = {},
) {
  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw makeError('REQUEST_ID_REQUIRED', 'A valid request id is required.', 400)
  const { data, error } = await client.rpc('reserve_ai_usage_server', {
    p_user_id: userId,
    p_feature: feature,
    p_model: model,
    p_reasoning_effort: reasoningEffort,
    p_estimated_cost: estimatedCost,
    p_tool_cost: 0,
    p_search_calls: 0,
    p_details: details,
    p_request_key: requestKey,
  })
  if (error) {
    const budget = String(error.message || '').includes('AI_BUDGET_EXCEEDED')
    throw makeError(budget ? 'AI_MONTHLY_BUDGET_REACHED' : 'AI_USAGE_RESERVATION_FAILED', budget ? 'AI monthly budget reached' : 'AI usage could not be reserved.', budget ? 429 : 403)
  }
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (!result.usage_id) throw makeError('AI_USAGE_RESERVATION_FAILED', 'AI usage could not be reserved.', 403)
  if (result.created !== true) throw makeError('AI_DUPLICATE_REQUEST', 'This request was already received.', 409)
  return String(result.usage_id)
}

export async function finalizeAiUsage(
  client: AnyClient,
  userId: string,
  usageId: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCost: number,
  toolCost = 0,
  searchCalls = 0,
  details: Record<string, unknown> = {},
) {
  const { error } = await client.rpc('finalize_ai_usage_server', {
    p_user_id: userId,
    p_usage_id: usageId,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_estimated_cost: estimatedCost,
    p_tool_cost: toolCost,
    p_search_calls: searchCalls,
    p_details: details,
  })
  if (error) throw makeError('AI_USAGE_FINALIZE_FAILED', 'The AI response could not be recorded.', 500)
}

export async function releaseAiUsage(client: AnyClient, userId: string, usageId: string) {
  const { error } = await client.rpc('release_ai_usage_server', { p_user_id: userId, p_usage_id: usageId })
  if (error) throw makeError('AI_USAGE_RELEASE_FAILED', 'The AI reservation could not be released.', 500)
}
