---
title: Composer attachments
description: Add file picker, direct input, dropzone, and controlled attachments to @anvia/react-ui composer surfaces.
section: react-ui
sidebar:
  group: Examples
  order: 2
  label: Composer attachments
---

`Composer.Root` keeps pending attachments by default. `Composer.Attachments` renders them before
the prompt is sent.

```tsx
import { Attachment, Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments className="attachment-list">
        {(attachment) => (
          <Attachment.Root className="attachment-row">
            <Attachment.Preview />
            <Attachment.Name />
            <Attachment.Remove>Remove</Attachment.Remove>
          </Attachment.Root>
        )}
      </Composer.Attachments>

      <Composer.AddAttachment accept="image/*,.pdf" multiple>
        Attach
      </Composer.AddAttachment>
      <Composer.Input placeholder="Send a file with your message..." />
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
```

## Dropzone composer

Wrap the composer controls in `Composer.AttachmentDropzone` when files should be accepted through
drag-and-drop.

```tsx
<Composer.Root className="composer">
  <Composer.AttachmentDropzone className="dropzone">
    <Composer.Attachments className="attachment-list" />
    <Composer.AddAttachment accept="image/*,.pdf" multiple>
      Attach
    </Composer.AddAttachment>
    <Composer.Input minRows={1} maxRows={6} />
    <Composer.Stop>Stop</Composer.Stop>
    <Composer.Submit>Send</Composer.Submit>
  </Composer.AttachmentDropzone>
</Composer.Root>
```

## Direct file input

Use `Composer.AttachmentInput` when your design system owns the visible trigger.

```tsx
<label className="file-trigger">
  Upload files
  <Composer.AttachmentInput className="sr-only" accept="image/*,.pdf" multiple />
</label>
```

## Controlled attachments

Use controlled composer state when attachments need to be mirrored outside the composer.

```tsx
import type { UIAttachment } from "@anvia/react";
import { useState } from "react";
import { Composer } from "@anvia/react-ui";

export function ControlledAttachmentComposer() {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<UIAttachment[]>([]);

  return (
    <Composer.Root
      input={draft}
      onInputChange={setDraft}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      className="composer"
    >
      <Composer.Attachments keepMounted className="attachment-list" />
      <Composer.AttachmentInput multiple />
      <Composer.Input />
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
```

```css
.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dropzone[data-dragging] {
  outline: 2px solid currentColor;
  outline-offset: 4px;
}
```
