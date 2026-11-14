/** 可选组件在界面上暴露的协议与字段；宿主只按字段表渲染，不认识具体组件。 */

export type ComponentFieldType = 'text' | 'select' | 'number' | 'boolean';

/** 宿主知道怎么取值的动态选项来源；组件只声明用哪个源。 */
export type ComponentOptionsSource = 'serial-devices';

export interface ComponentField {
  key: string;
  label: string;
  type?: ComponentFieldType;
  placeholder?: string;
  options?: string[];
  /** 选项来自宿主枚举（如串口设备），优先级高于静态 options。 */
  optionsSource?: ComponentOptionsSource;
  default?: string;
  required?: boolean;
}

export interface ComponentDescriptor {
  id: string;
  protocol: string;
  label: string;
  fields: ComponentField[];
}
