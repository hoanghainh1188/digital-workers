import type {
  FastifySchemaCompiler,
  FastifySerializerCompiler,
  FastifyTypeProvider,
} from 'fastify';
import type { z } from 'zod';

/** Types route handlers from Zod schemas (request: output type, reply: input type). */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}

export class RequestValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
  readonly issues: readonly { path: string; message: string }[];

  constructor(error: z.ZodError) {
    super('Invalid request');
    this.issues = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
  }
}

export const zodValidatorCompiler: FastifySchemaCompiler<z.ZodType> =
  ({ schema }) =>
  (data) => {
    const result = schema.safeParse(data);
    return result.success
      ? { value: result.data }
      : { error: new RequestValidationError(result.error) };
  };

export const zodSerializerCompiler: FastifySerializerCompiler<z.ZodType> =
  ({ schema }) =>
  (data) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new Error('Response does not match its schema');
    }
    return JSON.stringify(result.data);
  };
