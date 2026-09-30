import {env} from 'cloudflare:workers';
export {env};
export function hostedMedia(){return undefined;}
// Same-Worker public fetch bypasses the Worker. Its service binding includes Workers Cache.
export const warmFetch:typeof fetch=(input)=>env.WRITING_SELF.fetch(input instanceof Request ? input.url : String(input),{redirect:'manual'});
