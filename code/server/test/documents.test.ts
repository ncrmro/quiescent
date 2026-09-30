import {expect,test} from 'bun:test';
import {createDocumentStore,DocumentError,type JSONSchema} from '../src/document-store.ts';
import {documentCodec} from '../src/document-codec.ts';
import {fixture} from './forge-fixture.ts';
const author={name:'Writer',email:'writer@example.test'};
const schema={type:'object',additionalProperties:false,required:['servings','ingredients'],properties:{servings:{type:'integer',minimum:1},ingredients:{type:'array',items:{type:'string'},minItems:1}}} satisfies JSONSchema;
const initial={frontmatter:{servings:2,ingredients:['tomatoes','salt']},body:'# Lunch\n\nMix gently.\n'};
const selection=(draft:any)=>({id:draft.document.id,branch:draft.branch!,expectedHeadSha:draft.headSha});
function setup(){const f=fixture();return {...f,store:createDocumentStore({forge:f.forge,author,collection:'recipes',schema})};}

test('arbitrary schemas save front matter and Markdown in one commit and publish only from main',async()=>{
 const {store,forge,commits,branches}=setup();
 const draft=await store.createDocument(initial);
 expect(await store.listPublished()).toEqual([]);
 const before=commits.size;
 const input={frontmatter:{servings:4,ingredients:['peaches','cream']},body:'## Dessert\n\nServe **cold**.\n'};
 const saved=await store.saveDraft({...selection(draft),document:input});
 expect(commits.size-before).toBe(1);
 const source=commits.get(saved.headSha)!.files[`recipes/${saved.document.id}/index.md`]!;
 expect(source).toContain('servings: 4');expect(source).toContain('- peaches');
 expect(documentCodec(schema).parse(source)).toEqual(input);
 const published=await store.publish(selection(saved));
 expect((await store.getPublished(saved.document.id))?.document).toEqual(published.document);
 const edit=await store.getDraft(saved.document.id);
 await store.saveDraft({...selection(edit),document:{...input,body:'Private revision'}});
 expect((await store.listPublished())[0]?.document.body).toBe(input.body);
 const other=createDocumentStore({forge,author,collection:'other',schema});
 expect(await other.listDocuments()).toEqual([]);
 expect(branches.get('main')).toBe(published.publishedSha);
});

test('invalid metadata never creates or partially saves a document',async()=>{
 const {store,commits,branches}=setup();
 await expect(store.createDocument({...initial,frontmatter:{...initial.frontmatter,servings:0}})).rejects.toBeInstanceOf(DocumentError);
 expect(branches.size).toBe(1);expect(commits.size).toBe(1);
 const draft=await store.createDocument(initial);const count=commits.size;
 await expect(store.saveDraft({...selection(draft),document:{frontmatter:{servings:0,ingredients:[]},body:'Would lose original'}})).rejects.toBeInstanceOf(DocumentError);
 expect(commits.size).toBe(count);expect(branches.get(draft.branch!)).toBe(draft.headSha);
 expect((await store.getDraft(draft.document.id,draft.branch!)).document.body).toBe(initial.body);
 commits.get(draft.headSha)!.files[`recipes/${draft.document.id}/index.md`]='---\nservings: nope\ningredients: []\n---\nChanged outside Quiescent';
 const bad=draft;
 await expect(store.publish(selection(bad))).rejects.toBeInstanceOf(DocumentError);
 expect(branches.get('main')).toBe('root');

});

test('Markdown codec keeps body verbatim and rejects malformed YAML and incompatible metadata',()=>{
 const codec=documentCodec(schema);
 const document={...initial,body:'\n<script>literal source</script>\n\n---\n\nTrailing spaces  \n'};
 expect(codec.parse(codec.stringify(document))).toEqual(document);
 for(const source of ['Missing front matter','---\nservings: 2\nservings: 3\ningredients: [salt]\n---\nbody','---\n- not an object\n---\nbody'])expect(()=>codec.parse(source)).toThrow(DocumentError);
 expect(()=>codec.stringify({...initial,frontmatter:{servings:NaN,ingredients:['salt']}})).toThrow(DocumentError);
});

test('existing JSON posts migrate only on mutation with metadata and body in the same commit',async()=>{
 const {forge,commits,service}=fixture();const id='11111111-1111-4111-8111-111111111111';
 const legacy={id,title:'Sunday lunch',description:'A quiet afternoon',slug:'sunday-lunch',body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Old body'}]}]},publishedAt:'2026-09-01T00:00:00Z',publicationSource:'legacy'};
 const oldPath=`posts/${id}/post.json`;
 await forge.commitFiles({branch:'main',expectedHeadSha:'root',message:'Legacy post',files:[{path:oldPath,content:JSON.stringify(legacy)}]});
 const posts=service();expect((await posts.getPublished(id))?.post.title).toBe(legacy.title);
 const draft=await posts.getDraft(id);const count=commits.size;
 const saved=await posts.saveDraft({id,branch:draft.branch!,expectedHeadSha:draft.headSha,post:{...draft.post,title:'A new lunch',slug:'new-lunch',tags:['food','weekends'],headerImage:`/media/${id}/header`,body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'New body'}]}]}}});
 expect(commits.size-count).toBe(1);
 expect(commits.get(saved.headSha)!.files[oldPath]).toBeUndefined();
 const md=commits.get(saved.headSha)!.files[`posts/${id}/index.md`]!;
 expect(md).toContain('title: A new lunch');expect(md).toContain('slug: new-lunch');expect(md).toContain('- weekends');expect(md).toContain(`headerImage: /media/${id}/header`);expect(md).toContain('New body');
 expect((await posts.getPublished(id))?.post.title).toBe('Sunday lunch');
 await posts.publish({id,branch:saved.branch!,expectedHeadSha:saved.headSha});
 expect(await forge.getFile(oldPath,'main')).toBeNull();
 expect((await posts.getPublished(id))?.post).toMatchObject({title:'A new lunch',slug:'new-lunch',tags:['food','weekends'],headerImage:`/media/${id}/header`});
});

test('generic HTTP saves one document and returns validation fields without mutating Git',async()=>{
 const {createDocumentHandler}=await import('../src/document-http.ts');
 const {store,branches}=setup();const api=createDocumentHandler({store,authorize:r=>r.headers.get('Authorization')==='test'});
 const request=(path:string,method='GET',data?:unknown,origin='https://example.test')=>new Request('https://example.test/api/documents'+path,{method,headers:{Authorization:'test',Origin:origin},...(data?{body:JSON.stringify(data)}:{})});
 const response=await api(request('','POST',initial));expect(response.status).toBe(201);
 const draft=await response.json();
 const failed=await api(request('/'+draft.document.id,'PUT',{...selection(draft),document:{...initial,frontmatter:{...initial.frontmatter,servings:0}}}));
 expect(failed.status).toBe(400);expect(await failed.json()).toMatchObject({fields:{servings:expect.any(String)}});
 expect(branches.get(draft.branch)).toBe(draft.headSha);
 expect((await api(request('/'+draft.document.id,'PUT',{...selection(draft)}))).status).toBe(400);
 expect((await api(request('','POST',initial,'https://other.test'))).status).toBe(403);
 expect((await api(new Request('https://example.test/api/documents'))).status).toBe(403);
 const saved=await (await api(request('/'+draft.document.id,'PUT',{...selection(draft),document:{...initial,body:'New instructions'}}))).json();
 expect((await api(request('/'+draft.document.id+'/publish','POST',selection(saved)))).status).toBe(200);
 expect((await store.getPublished(draft.document.id))?.document.body).toBe('New instructions');
});
