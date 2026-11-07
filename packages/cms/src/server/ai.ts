/**
 * The AI slot: one provider the application configures (Anthropic, Workers AI, or its own) that
 * the editor's assistant and plugins with the `ai` capability complete text through. The CMS
 * never calls a model on its own; every call is a person's or a plugin's. Prompts are capped so a
 * runaway loop cannot spend without limit.
 */

export interface AiRequest {
    /** Who the model is and how it answers; the CMS adds nothing. */
    readonly system?: string;
    readonly prompt: string;
    /** Longest answer wanted, in the provider's tokens; capped at `AI_LIMITS.maxTokens`. */
    readonly maxTokens?: number;
    readonly signal?: AbortSignal;
}

export interface AiProvider {
    /** Shown in Health and Tools, such as `anthropic` or `workers-ai`. */
    readonly name: string;
    /** The model's answer as text. Throws when the provider refuses or fails. */
    complete(request: AiRequest): Promise<string>;
}

export const AI_LIMITS = Object.freeze({ prompt: 60_000, system: 8_000, maxTokens: 4_000 });

/** A request within the limits, or an error naming what is wrong. */
export function checkAiRequest(request: AiRequest): AiRequest {
    if (typeof request?.prompt !== 'string' || !request.prompt.trim()) throw new Error('The prompt is empty.');
    if (request.prompt.length > AI_LIMITS.prompt) throw new Error(`The prompt is longer than ${AI_LIMITS.prompt} characters.`);
    if (request.system !== undefined && (typeof request.system !== 'string' || request.system.length > AI_LIMITS.system)) throw new Error(`The system text is longer than ${AI_LIMITS.system} characters.`);
    const maxTokens = request.maxTokens === undefined ? 1_000 : Math.min(Math.max(Math.trunc(request.maxTokens), 1), AI_LIMITS.maxTokens);
    return { ...request, maxTokens };
}
