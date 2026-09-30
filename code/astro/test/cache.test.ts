import {expect,test} from 'bun:test';
import type {RouteCache} from '../src/index.ts';
import {astroDocumentCache} from '../src/index.ts';
test('custom collections tag and eagerly warm only their configured public routes',async()=>{
 const events:string[]=[];let currentTags:string[]=[];
 const pages=astroDocumentCache<{id:string;slug:string}>({collection:'recipes',origin:'https://example.test',indexPaths:['/recipes'],documentPath:d=>`/recipes/${d.slug}`,fetch:async input=>{const path=new URL(String(input)).pathname;events.push(path);return new Response('page',{status:path.endsWith('/deleted')?404:200});}});
 const cache:RouteCache={enabled:true,set(value){if(value)currentTags=value.tags ?? [];},async invalidate({tags}){events.push(tags!.join(','));}};
 pages.set(cache,'one');expect(currentTags).toContain('quiescent:recipes:one');
 await pages.afterPublication(cache,{id:'one',slug:'dinner'},false);
 expect(events).toEqual(['quiescent:recipes,quiescent:recipes:one','/recipes','/recipes/dinner','/recipes','/recipes/dinner']);
 events.length=0;await pages.afterPublication(cache,{id:'one',slug:'deleted'},true);
 expect(events).toContain('/recipes/deleted');
});
