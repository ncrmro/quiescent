export interface MetadataSchema {
  properties?:Record<string,{title?:string;description?:string;type?:string|string[];enum?:unknown[];maxLength?:number;minimum?:number;maximum?:number;items?:{type?:string}}>;
  required?:string[];
}
/** Small schema-driven metadata form. The server validates the complete schema on each save. */
export function createMetadataForm(parent:HTMLElement,schema:MetadataSchema,onChange:()=>void,imageFields:string[]=[]) {
  const fields=new Map<string,{input:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;error:HTMLElement;type:string;nullable:boolean}>();
  for(const [name,property] of Object.entries(schema.properties ?? {})) {
    const types=Array.isArray(property.type)?property.type:[property.type ?? 'string'];
    const type=types.find(t=>t!=='null') ?? 'string';
    const label=document.createElement('label');label.textContent=property.title ?? name;
    const input=property.enum?document.createElement('select'):type==='object'?document.createElement('textarea'):document.createElement('input');
    input.name=name;input.dataset.field=name;
    if(input instanceof HTMLSelectElement)for(const value of property.enum!){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);input.append(option);}
    if(input instanceof HTMLInputElement){
      input.type=type==='boolean'?'checkbox':['number','integer'].includes(type)?'number':'text';
      if(type==='number')input.step='any';
      if(property.minimum!==undefined)input.min=String(property.minimum);
      if(property.maximum!==undefined)input.max=String(property.maximum);
      if(property.maxLength!==undefined)input.maxLength=property.maxLength;
      if(type==='array')input.placeholder='Separate values with commas';
      if(imageFields.includes(name))input.type='hidden';
    }
    if(name==='title')input.setAttribute('data-title','');
    if(name==='description')input.setAttribute('data-description','');
    const error=document.createElement('small');error.id=`metadata-${name}-error`;error.setAttribute('role','alert');error.hidden=true;
    input.setAttribute('aria-describedby',error.id);
    input.addEventListener('input',()=>{error.hidden=true;input.removeAttribute('aria-invalid');onChange();});
    label.append(input);parent.append(label);
    if(property.description){const help=document.createElement('small');help.textContent=property.description;help.id=`metadata-${name}-help`;parent.append(help);input.setAttribute('aria-describedby',`${help.id} ${error.id}`);}
    parent.append(error);fields.set(name,{input,error,type,nullable:types.includes('null')});
  }
  return {
    read():Record<string,unknown> {return Object.fromEntries([...fields].map(([name,{input,type,nullable}])=>{
      const value=input.value;
      return [name,type==='boolean'?(input as HTMLInputElement).checked:type==='array'?value.split(',').map(v=>v.trim()).filter(Boolean):nullable && value===''?null:['number','integer'].includes(type)?(value===''?null:Number(value)):type==='object'?JSON.parse(value):value];
    }));},
    load(value:Record<string,unknown>){for(const [name,{input,type}] of fields){const v=value[name];if(type==='boolean')(input as HTMLInputElement).checked=Boolean(v);else input.value=type==='array'?(Array.isArray(v)?v.join(', '):''):type==='object'?JSON.stringify(v ?? {},null,2):String(v ?? '');}},
    disable(disabled:boolean){for(const {input} of fields.values())input.disabled=disabled;},
    errors(errors:Record<string,string>={}){for(const [name,{input,error}] of fields){const message=errors[name] ?? Object.entries(errors).find(([key])=>key.startsWith(name+'/'))?.[1];error.textContent=message ?? '';error.hidden=!message;if(message)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');}},
    field(name:string){return fields.get(name)?.input;},
  };
}
