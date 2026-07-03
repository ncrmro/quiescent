export class ForgeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "ForgeError";
  }
}

export class ConflictError extends Error {
  constructor(
    public readonly branch: string,
    public readonly expectedSha: string,
    public readonly actualSha: string,
  ) {
    super(`branch ${branch} moved from ${expectedSha} to ${actualSha}`);
    this.name = "ConflictError";
  }
}
