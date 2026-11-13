---
"@anvia/core": patch
---

Redact PEM private key blocks and context-labelled AWS secret access keys in the default redactor. `pemPrivateKey`, `pemPrivateKeyTruncated` and `awsSecretAccessKey` join the credential patterns, so `createRedactor()` scrubs private keys that previously passed through untouched. A bare 40-character base64 run is still kept, because the AWS pattern requires the setting name in front of the value.
