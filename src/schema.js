import { z } from 'zod';

// Define o schema uma vez e gera tanto o zod (MCP) quanto o JSON Schema (API do Claude).
// spec: { campo: { type: 'string'|'number'|'boolean'|'string[]', desc, required?, enum? } }
export function toZodShape(spec) {
  const shape = {};
  for (const [k, f] of Object.entries(spec)) {
    let t;
    if (f.type === 'string[]') t = z.array(z.string());
    else if (f.enum) t = z.enum(f.enum);
    else if (f.type === 'number') t = z.number();
    else if (f.type === 'boolean') t = z.boolean();
    else t = z.string();
    t = t.describe(f.desc || k);
    shape[k] = f.required ? t : t.optional();
  }
  return shape;
}

export function toJsonSchema(spec) {
  const properties = {};
  const required = [];
  for (const [k, f] of Object.entries(spec)) {
    const p = { description: f.desc || k };
    if (f.type === 'string[]') { p.type = 'array'; p.items = { type: 'string' }; }
    else { p.type = f.type; if (f.enum) p.enum = f.enum; }
    properties[k] = p;
    if (f.required) required.push(k);
  }
  return { type: 'object', properties, required };
}
