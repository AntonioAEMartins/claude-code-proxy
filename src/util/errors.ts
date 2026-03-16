export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toAnthropicError(): { type: 'error'; error: { type: string; message: string } } {
    return {
      type: 'error',
      error: {
        type: this.errorType,
        message: this.message,
      },
    };
  }

  toOpenAIError(): { error: { message: string; type: string; code: string | null } } {
    return {
      error: {
        message: this.message,
        type: this.errorType,
        code: this.statusCode.toString(),
      },
    };
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, 'invalid_request_error', message);
}

export function unauthorized(message: string = 'Invalid API key'): ApiError {
  return new ApiError(401, 'authentication_error', message);
}

export function notFound(message: string = 'Not found'): ApiError {
  return new ApiError(404, 'not_found_error', message);
}

export function rateLimited(message: string, retryAfterSeconds?: number): ApiError & { retryAfter?: number } {
  const err = new ApiError(429, 'rate_limit_error', message) as ApiError & { retryAfter?: number };
  err.retryAfter = retryAfterSeconds;
  return err;
}

export function serverError(message: string = 'Internal server error'): ApiError {
  return new ApiError(500, 'api_error', message);
}

export function serviceUnavailable(message: string = 'Service unavailable'): ApiError {
  return new ApiError(503, 'service_unavailable', message);
}

export function requestTimeout(message: string = 'Request timed out'): ApiError {
  return new ApiError(408, 'request_timeout', message);
}
