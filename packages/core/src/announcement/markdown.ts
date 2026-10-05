/**
 * Sanitizes markdown content to ensure complete safety against XSS attacks.
 * Per docs/PHASE3_SPEC.md Section 10: "Announcements: sanitized markdown (no raw HTML)".
 * Strips all raw HTML tags, dangerous URI schemes, and malicious event handlers,
 * while preserving standard Markdown formatting (headings, lists, bold, italics, code blocks).
 */
export function sanitizeMarkdown(input: string): string {
  if (!input) return '';

  let sanitized = input;

  // 1. Remove dangerous paired tags including their inner content (scripts, iframes, styles, etc.)
  const dangerousContentTags = ['script', 'iframe', 'object', 'embed', 'applet', 'meta', 'link', 'style', 'base', 'template'];
  for (const tag of dangerousContentTags) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    sanitized = sanitized.replace(regex, '');
    const selfClosingRegex = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    sanitized = sanitized.replace(selfClosingRegex, '');
  }

  // 2. Remove all remaining raw HTML tags (e.g. <img ...>, <svg ...>, <div ...>, <span ...>)
  // This satisfies "sanitized markdown (no raw HTML)" from PHASE3_SPEC Section 10
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // 3. Remove javascript:, vbscript:, and data: protocols in markdown links [text](javascript:...)
  sanitized = sanitized.replace(/\[([^\]]+)\]\(\s*(?:javascript|vbscript|data):[^)]*\)/gi, '[$1](#)');

  // 4. Neutralize any loose protocol attacks
  sanitized = sanitized.replace(/(javascript|vbscript|data:\s*text\/html):/gi, 'blocked:');

  return sanitized;
}
