export class DocumentError extends Error {
  constructor(message:string,public readonly code:'invalid'|'conflict'|'not_found',public readonly fields?:Record<string,string>) {
    super(message);this.name='DocumentError';
  }
}
