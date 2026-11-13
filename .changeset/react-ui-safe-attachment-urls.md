---
"@anvia/react-ui": patch
---

Reject active URL schemes in attachment links and image sources. `AttachmentPrimitive.Preview` and `ImagePrimitive` now drop `javascript:` and other non-web schemes instead of rendering them as a link or image source, and inline `data:` sources are limited to image media types. Relative, `http`, `https`, `blob` and image `data:` URLs keep working.
