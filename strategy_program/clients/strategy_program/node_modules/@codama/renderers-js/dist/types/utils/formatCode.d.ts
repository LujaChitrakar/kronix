import { Path } from '@codama/renderers-core';
import { format } from 'prettier/standalone';
import { RenderOptions } from './options';
export type PrettierOptions = Parameters<typeof format>[1];
export type CodeFormatter = (code: string, path: Path) => Promise<string>;
export declare function getCodeFormatter(packageFolder: string, options: Pick<RenderOptions, 'formatCode' | 'prettierOptions'>): Promise<CodeFormatter>;
//# sourceMappingURL=formatCode.d.ts.map