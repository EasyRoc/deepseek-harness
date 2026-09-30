/** Catalog and exact-model metadata for one OpenAI-compatible route. */
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { OpenAICompatCatalogModel, OpenAICompatConnectionOptions } from './types.ts'

/** Project one catalog entry onto the selector vocabulary.
 * @param provider - the owning route.
 * @param model - the catalog entry.
 * @returns selector metadata with the text-only modality declaration.
 */
export function catalogModelInfo(provider: string, model: OpenAICompatCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: ['text'],
  }
}

/** Resolve exact-model metadata: catalog facts when listed, connection defaults otherwise.
 * @param connection - validated connection snapshot.
 * @param provider - the owning route.
 * @param model - exact wire model id.
 * @returns provider/model identity plus context capacity.
 */
export function resolveModelInfo(
  connection: OpenAICompatConnectionOptions, provider: string, model: string,
): LlmResolvedModelInfo {
  const entry = connection.models.find(candidate => candidate.id === model)
  return {
    provider,
    id: model,
    name: entry?.name ?? model,
    ...entry?.description === undefined ? {} : { description: entry.description },
    context: { contextWindow: entry?.contextWindow ?? connection.defaultContextWindow },
  }
}
