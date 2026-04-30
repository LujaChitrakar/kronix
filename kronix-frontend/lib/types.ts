export type Side = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'strategy';

export interface SchemaField {
  key: string;
  label: string;
  type: 'decimal' | 'integer' | 'select' | 'symbol' | 'resolution' | 'decimal_array';
  required?: boolean;
  default?: any;
  min?: number;
  max?: number;
  options?: string[];
  description?: string;
}

export interface StrategySchema {
  kind: string;
  label: string;
  description: string;
  fields: SchemaField[];
}
