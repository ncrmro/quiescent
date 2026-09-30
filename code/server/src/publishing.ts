import type {CommitSignature,PublishingForge} from '@quiescent/git';
import {validateDocument,imageReferences,type WritingDocument} from '@quiescent/editor/document';
import {fromMarkdown,toMarkdown} from '@quiescent/editor/markdown';
import {createDocumentStore,type DocumentRecord,type DocumentDraft,type DocumentSelection,type JSONSchema} from './document-store.ts';
import {DocumentError} from './document-error.ts';
export {DocumentError as PublishingError} from './document-error.ts';
export type PostBody=WritingDocument;
export interface PostDocument {
  id:string;title:string;description:string;slug:string|null;
  tags?:string[];headerImage?:string|null;body:PostBody;publishedAt?:string;
}
export interface PostDraft {post:PostDocument;branch:string|null;headSha:string;state:'draft'|'published'|'unpublished-changes'}
export type DraftSelection=DocumentSelection;
type PostMetadata={title:string;description:string;slug:string|null;tags:string[];headerImage:string|null};
export const postSchema:JSONSchema={
  type:'object',additionalProperties:false,required:['title','description','slug','tags','headerImage'],
  properties:{
    title:{type:'string',title:'Title',maxLength:300},
    description:{type:'string',title:'Description',maxLength:2000},
    slug:{type:['string','null'],title:'Slug',description:'Use lowercase words separated by hyphens.',maxLength:160,pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$'},
    tags:{type:'array',title:'Tags',maxItems:30,uniqueItems:true,items:{type:'string',minLength:1,maxLength:80}},
    headerImage:{type:['string','null'],title:'Header image',pattern:'^/media/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+$'},
  },
};
export interface PublishingOptions {
  forge:PublishingForge;author:CommitSignature;defaultBranch?:string;
  validateDocument?:(body:PostBody)=>void|Promise<void>;
  verifyMedia?:(post:PostDocument)=>void|Promise<void>;
}
const toPost=(document:DocumentRecord<PostMetadata>):PostDocument=>({id:document.id,...document.frontmatter,body:fromMarkdown(document.body),...(document.publishedAt?{publishedAt:document.publishedAt}:{})});
const toDraft=(draft:DocumentDraft<PostMetadata>):PostDraft=>({post:toPost(draft.document),branch:draft.branch,headSha:draft.headSha,state:draft.state});
function metadata(post:PostDocument):PostMetadata {
  return {title:post.title,description:post.description,slug:post.slug,tags:post.tags ?? [],headerImage:post.headerImage ?? null};
}
const generatedSlug=(title:string,id:string)=>`${title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'post'}-${id.slice(0,8)}`;
/** Posts are one schema and a rich-text adapter over the general Markdown document store. */
export function createPublishingService(options:PublishingOptions) {
  const store=createDocumentStore<PostMetadata>({
    ...options,collection:'posts',schema:postSchema,
    legacy:{filename:'post.json',decode(source,id){
      const post=JSON.parse(source) as PostDocument & {publicationSource?:string;deletedAt?:string};
      if(post.id!==id)throw new DocumentError('Document identifier mismatch','invalid');
      return {id,frontmatter:{...metadata(post),slug:post.slug ?? (post.title.trim()?generatedSlug(post.title,id):null)},body:toMarkdown(post.body),...(post.publishedAt?{publishedAt:post.publishedAt}:{}),...(post.publicationSource?{publicationSource:post.publicationSource}:{}),...(post.deletedAt?{deletedAt:post.deletedAt}:{})};
    }},
    async beforePublish(document){
      const post=toPost(document);
      if(!post.title.trim())throw new DocumentError('Add a title before publishing.','invalid',{title:'Add a title before publishing.'});
      if(!post.slug)throw new DocumentError('Add a slug before publishing.','invalid',{slug:'Add a slug before publishing.'});
      if((await store.listPublished()).some(other=>other.document.id!==document.id && other.document.frontmatter.slug===post.slug))
        throw new DocumentError('This slug is already published. Choose another.','conflict',{slug:'This slug is already published.'});
      await options.validateDocument?.(post.body);await options.verifyMedia?.(post);
    },
  });
  return {
    schema:postSchema,documents:store,
    async createPost(){return toDraft(await store.createDocument({frontmatter:{title:'',description:'',slug:null,tags:[],headerImage:null},body:''}));},
    async getDraft(id:string,branch?:string){return toDraft(await store.getDraft(id,branch));},
    async saveDraft(input:DraftSelection & {post:PostDocument}){
      if(input.id!==input.post.id)throw new DocumentError('Document identifier mismatch','invalid');
      await options.validateDocument?.(input.post.body);
      const fields=metadata(input.post);
      if(fields.slug===null && fields.title.trim())fields.slug=generatedSlug(fields.title,input.id);
      return toDraft(await store.saveDraft({...input,document:{frontmatter:fields,body:toMarkdown(validateDocument(input.post.body))}}));
    },
    async publish(input:DraftSelection){const {document,...result}=await store.publish(input);return {...result,post:toPost(document)};},
    async deletePost(input:{id:string;branch?:string|null;expectedHeadSha:string}){const {document,...result}=await store.deleteDocument(input);return {...result,post:toPost(document)};},
    async getPublished(id:string){const value=await store.getPublished(id);return value?toDraft(value):null;},
    async listPublished(){return (await store.listPublished()).map(toDraft);},
    async listPosts(){return (await store.listDocuments()).map(toDraft);},
    async findPostForEditing(slug:string):Promise<PostDraft|null>{
      if(/^[0-9a-f-]{36}$/.test(slug)) {try{return toDraft(await store.getDraft(slug));}catch(error){if(error instanceof DocumentError && error.code==='not_found')return null;throw error;}}
      const published=(await store.listPublished()).find(p=>p.document.frontmatter.slug===slug);
      if(published)return toDraft(published);
      return (await store.listDocuments()).map(toDraft).find(p=>p.post.slug===slug) ?? null;
    },
  };
}

export function postImageReferences(post:PostDocument) {
  const references=imageReferences(post.body);
  if(post.headerImage) {
    const match=/^\/media\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/.exec(post.headerImage);
    if(!match)throw new DocumentError('Invalid header image','invalid',{headerImage:'Choose a valid image.'});
    references.push({postId:match[1]!,assetId:match[2]!});
  }
  return references;
}
