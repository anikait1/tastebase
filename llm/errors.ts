export class LlmRejectedError extends Error {
  constructor(message = "LLM rejected the instructions as not a valid recipe.", options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmRejectedError";
  }
}

export class LlmParseError extends Error {
  constructor(message = "Failed to parse the LLM response into the expected shape.", options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmParseError";
  }
}

export class LlmInvocationError extends Error {
  constructor(message = "Unexpected error occurred while invoking the LLM.", options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmInvocationError";
  }
}

export class LlmEmbeddingError extends Error {
  constructor(message = "Failed to generate LLM embedding.", options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmEmbeddingError";
  }
}
