export class GeneratorConflictError extends Error {
  constructor(
    message: string,
    readonly guidance: string[],
  ) {
    super(message);
    this.name = "GeneratorConflictError";
  }
}
