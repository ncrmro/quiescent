import {ConflictError,ForgeError} from "@quiescent/git";
import {DocumentError} from "./document-error.ts";
import {MediaError} from "./media.ts";
export class WritingConfigurationError extends Error {}
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function payload(request:Request):Promise<Record<string,unknown>> {
  if(!request.body)throw new DocumentError("Request body missing","invalid");
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;
    if(size>1024*1024){await reader.cancel();throw new DocumentError("This document is too large","invalid");}chunks.push(chunk.value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const result:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if(!result || typeof result!=="object" || Array.isArray(result))throw new DocumentError("Invalid request","invalid");
  return result as Record<string,unknown>;
}
export function documentErrorResponse(error:unknown):Response {
  if(error instanceof WritingConfigurationError)return json({error:error.message},503);
  if(error instanceof DocumentError)return json({error:error.message,...(error.fields?{fields:error.fields}:{})},error.code==="conflict"?409:error.code==="not_found"?404:400);
  if(error instanceof MediaError)return json({error:error.message},error.status);
  if(error instanceof ConflictError)return json({error:"This draft has newer changes. Your writing is still in this browser; reopen it before saving."},409);
  if(error instanceof ForgeError){
    const status=error.status;
    return json({error:status===409 || status===422?"This document could not be merged. Your draft is safe. Reopen it and try again.":status===401 || status===403?"GitHub access was denied. Check the server credential or try again after its rate limit resets.":"GitHub is unavailable. Your draft has not been discarded; please retry."},status===409 || status===422?409:502);
  }
  if(error instanceof SyntaxError)return json({error:"Invalid document"},400);
  return json({error:"The operation could not finish. Your writing has not been discarded."},500);
}
