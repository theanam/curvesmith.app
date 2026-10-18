/* Tiny XML tree + serializer for the SVG writer. */

export type XNode = {
  tag: string;
  attrs: [string, string][];
  children: (XNode | string)[];
  inline?: boolean;
};

export const x = (
  tag: string,
  attrs: [string, string | number | undefined | null | false][] = [],
  children: (XNode | string)[] = [],
): XNode => ({
  tag,
  attrs: attrs
    .filter((a): a is [string, string | number] => a[1] !== undefined && a[1] !== null && a[1] !== false)
    .map(([k, v]) => [k, String(v)]),
  children,
});

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function serialize(n: XNode, pretty: boolean, depth = 0): string {
  const pad = pretty ? '  '.repeat(depth) : '';
  const attrs = n.attrs.map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  if (!n.children.length) return `${pad}<${n.tag}${attrs}/>`;
  const inline = n.inline || n.children.some((c) => typeof c === 'string');
  if (inline || !pretty) {
    const inner = n.children
      .map((c) => (typeof c === 'string' ? escapeXml(c) : serialize(c, false)))
      .join('');
    return `${pad}<${n.tag}${attrs}>${inner}</${n.tag}>`;
  }
  const inner = n.children.map((c) => serialize(c as XNode, pretty, depth + 1)).join('\n');
  return `${pad}<${n.tag}${attrs}>\n${inner}\n${pad}</${n.tag}>`;
}
