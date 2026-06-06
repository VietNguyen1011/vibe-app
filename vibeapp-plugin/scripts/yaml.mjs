// scripts/yaml.mjs — minimal YAML subset for app.yaml (maps, lists, scalars).
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~' || v === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
function stripComment(line) {
  // drop trailing ' # ...' but not inside quotes
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i);
  }
  return line;
}
export function parseYaml(src) {
  const lines = src.split('\n')
    .map((l) => stripComment(l).replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && l.trim() !== '---');
  const root = {};
  // stack of { indent, container }
  const stack = [{ indent: -1, container: root }];
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    // A block sequence (`- item`) may sit at the SAME indent as its parent key in YAML,
    // so list lines must not pop the container the key just opened — use strict `<` for them.
    const isListItem = line.startsWith('- ');
    while (stack.length > 1 && (isListItem ? indent < stack[stack.length - 1].indent : indent <= stack[stack.length - 1].indent)) stack.pop();
    const parent = stack[stack.length - 1].container;
    if (isListItem) {
      const val = coerce(line.slice(2).trim());
      if (!Array.isArray(parent.__list)) throw new Error('list item without key');
      parent.__list.push(val);
      continue;
    }
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (rest === '') {
      // could be a map or a list; decide later via __list
      const obj = {};
      Object.defineProperty(obj, '__list', { value: [], enumerable: false, writable: true });
      parent[key] = obj;
      stack.push({ indent, container: obj });
    } else {
      parent[key] = coerce(rest);
    }
  }
  return finalize(root);
}
function finalize(node) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (Array.isArray(node.__list) && node.__list.length > 0) return node.__list;
    for (const k of Object.keys(node)) node[k] = finalize(node[k]);
  }
  return node;
}
