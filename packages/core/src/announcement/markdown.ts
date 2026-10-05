/**
 * Sanitizes markdown / HTML content to ensure safety against XSS attacks.
 * Strips dangerous tags, event handlers, and malicious URI schemes.
 */
export function sanitizeMarkdown(input: string): string {
  if (!input) return '';

  let sanitized = input;

  // 1. Remove dangerous HTML tags and their inner content
  const dangerousTags = ['script', 'iframe', 'object', 'embed', 'applet', 'meta', 'link', 'style', 'base'];
  for (const tag of dangerousTags) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    sanitized = sanitized.replace(regex, '');
    const selfClosingRegex = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    sanitized = sanitized.replace(selfClosingRegex, '');
  }

  // 2. Remove inline event handlers (e.g. onerror=, onclick=, onload=)
  sanitized = sanitized.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 3. Remove javascript: or vbscript: or data:text/html URIs in href and src
  sanitized = sanitized.replace(/(href|src)\s*=\s*["']?\s*(javascript|vbscript|data:\s*text\/html):[^"'\s>]+/gi, '$1="#"');

  // 4. Remove javascript: protocol in markdown links [text](javascript:alert(1))
  sanitized = sanitized.replace(/\[([^\]]+)\]\(\s*javascript:[^)]*\)/gi, '[$1](#)');

  return sanitized;
}
