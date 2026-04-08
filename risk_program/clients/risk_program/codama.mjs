// clients/risk_program/codama.mjs
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('./src/generated/risk_program.json', 'utf-8'));
const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.accept(renderVisitor('./src/generated'));