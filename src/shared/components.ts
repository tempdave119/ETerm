/** 可选组件在界面上暴露的协议与字段；宿主只按字段表渲染，不认识具体组件。 */

export type ComponentFieldType = 'text' | 'select' | 'number';

export interface ComponentField {
  key: string;
  label: string;
  type?: ComponentFieldType;
  placeholder?: string;
  options?: string[];
  default?: string;
  required?: boolean;
}

export interface ComponentDescriptor {
  id: string;
  protocol: string;
  label: string;
  fields: ComponentField[];
}
