export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends ApiError {
  constructor(message = "unauthorized") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export class QuotaError extends ApiError {
  constructor(message = "daily budget exceeded") {
    super(message, 429);
    this.name = "QuotaError";
  }
}
