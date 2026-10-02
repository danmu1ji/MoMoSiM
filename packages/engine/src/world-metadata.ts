import { load, CORE_SCHEMA } from 'js-yaml';
import { parse } from 'yaml';

// Retain the existing parser's alias expansion limits and tag semantics for advanced YAML.
// The conservative scan may also match quoted prose; falling back only affects speed.
const ADVANCED_YAML = /(?:^|[\s,[{])(?:[&*][^\s,\[\]{}]+|![^\s]+)/m;

/** Fast YAML 1.2 core data parsing for large, plain entity indexes. */
export function parseWorldMetadata(text: string): unknown {
  return ADVANCED_YAML.test(text) ? parse(text) : load(text, { schema: CORE_SCHEMA });
}
