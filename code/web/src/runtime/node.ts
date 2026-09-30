import { fileMedia } from '@quiescent/server/file-media';
import type { Env } from '@quiescent/server';
import type { WritingEnv } from '../writing/app';
export const env={
  WRITING_TEST:'true',WRITING_REPO_OWNER:'ncrmro',WRITING_REPO_NAME:'quiescent-writing-demo',
  WRITING_AUTHOR_NAME:'Example writer',WRITING_AUTHOR_EMAIL:'writer@example.invalid',...process.env,
} as Env & WritingEnv;
export function hostedMedia(){return fileMedia(process.env.WRITING_MEDIA_DIRECTORY ?? './.writing-media');}

export const warmFetch:typeof fetch=(input,init)=>fetch(input,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),...(process.env.QUIESCENT_WARM_TOKEN ? {'X-Quiescent-Warm':process.env.QUIESCENT_WARM_TOKEN} : {})}});
