export class AuthOwlError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AuthOwlError';
  }
}

export class RateLimitedError extends AuthOwlError {
  constructor(public readonly retryAfterSeconds: number, cause?: unknown) {
    super(`Rate limited. Retry after ${retryAfterSeconds}s.`, cause);
    this.name = 'RateLimitedError';
  }
}

export class InvalidKeyError extends AuthOwlError {
  constructor(message = 'invalid publishable key', cause?: unknown) {
    super(message, cause);
    this.name = 'InvalidKeyError';
  }
}
