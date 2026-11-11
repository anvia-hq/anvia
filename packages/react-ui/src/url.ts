const linkProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);
const imageProtocols = new Set(["http:", "https:", "blob:"]);

/**
 * Reads the URL scheme the browser would use. ASCII whitespace and control
 * characters are legal inside a scheme, so `java\nscript:` still resolves to
 * `javascript:`. Strip them before matching so a smuggled scheme is caught.
 */
function schemeOf(value: string): string | undefined {
  let normalized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) normalized += character;
  }
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  return match === null ? undefined : `${match[1]!.toLowerCase()}:`;
}

/**
 * Returns the value when it is safe to use as a link target, or `undefined`
 * when it uses an active scheme such as `javascript:`. Relative URLs are kept
 * because they resolve against the host application's own origin.
 */
export function safeLinkHref(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const scheme = schemeOf(value);
  if (scheme === undefined) {
    return value;
  }
  return linkProtocols.has(scheme) ? value : undefined;
}

/**
 * Returns the value when it is safe to use as an image source. Inline `data:`
 * URLs are allowed only for image media types, and `blob:` stays valid because
 * it references bytes the application already holds.
 */
export function safeImageSrc(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const scheme = schemeOf(value);
  if (scheme === undefined) {
    return value;
  }
  if (scheme === "data:") {
    return /^data:image\//i.test(value) ? value : undefined;
  }
  return imageProtocols.has(scheme) ? value : undefined;
}
