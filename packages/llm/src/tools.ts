import { jsonSchema, type ModelMessage, type ToolSet, tool } from 'ai';

/**
 * What the worker runtime needs to describe tools and turns without importing the AI SDK
 * itself (spec llm-gateway: only packages/llm uses it). Tools are declared without
 * `execute`: the gateway returns the calls, the runtime runs them in its own code.
 */
export type { ModelMessage, ToolSet };

/** JSON Schema of a tool's input (plain JSON Schema, no SDK types needed by the caller). */
export type ToolInputSchema = {
  readonly type: 'object';
  readonly properties: Readonly<
    Record<string, { readonly type: string; readonly description?: string }>
  >;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

export function declareTool(description: string, input: ToolInputSchema): ToolSet[string] {
  return tool({
    description,
    inputSchema: jsonSchema(input as Parameters<typeof jsonSchema>[0]),
  });
}
