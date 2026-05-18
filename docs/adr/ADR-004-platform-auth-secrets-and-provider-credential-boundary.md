# ADR-004: Platform Auth, Secrets, and Provider Credential Boundary

> **Status**: Proposed  
> **Date**: 2026-05-16  
> **Decision scope**: Post-MVP security foundation before official Provider / Runtime extensions

---

## Context

Loom Studio MVP Stage 0-5 deliberately kept the Kernel small:

- Document Store
- RPC Registry
- Event Bus
- Extension Host
- Loom Runner
- Diagnostics
- Trace / Audit abstractions
- Transport-facing Kernel RPC

The MVP intentionally did not implement:

- user login;
- workspace unlock;
- API key storage;
- LLM provider credential management;
- Provider Gateway;
- Chat Runtime;
- capability permission enforcement;
- extension signature verification;
- complex security sandboxing.

As Loom Studio moves toward official Concept Stack, Provider, and Chat Runtime extensions, credential handling becomes unavoidable.

There are two separate but related security needs:

1. **Login / workspace unlock**
   - A local user should authenticate before accessing a protected Studio workspace.
   - The login password may unlock encrypted local secrets.

2. **LLM API credential protection**
   - Users may store API keys for OpenAI-compatible providers, Anthropic, Gemini, OpenRouter, local gateways, or future model providers.
   - API keys must not leak to normal Documents, frontend RPC responses, Trace, Audit details, Diagnostics, logs, manifests, or git-tracked files.
   - Provider extensions need a way to use credentials without each extension inventing its own storage or encryption scheme.

This creates an architectural boundary question:

```text
Is credential encryption and decryption an Extension responsibility,
or a platform security responsibility?
```

---

## Decision

Loom Studio will treat authentication, secret storage, encryption, credential redaction, and controlled secret usage as **Platform Security** responsibilities, not ordinary Extension responsibilities.

Provider-specific API behavior remains an Extension responsibility.

The boundary is:

```text
Platform Security / Secrets:
  login, workspace unlock, encrypted secret storage, secretRef,
  redaction, controlled secret usage, audit facts, permission checks

Provider Extension:
  provider profile schema, request format, model listing,
  invoke / stream behavior, usage parsing, error normalization
```

A Provider Extension must not store or encrypt raw API keys by itself. It should store only a reference:

```ts
type SecretRef = `secret:${string}`
```

Provider profile Documents may reference a secret, but must not contain secret plaintext:

```ts
type ProviderProfile = {
  id: string
  kind: 'openai-compatible' | string
  displayName: string
  baseUrl: string
  defaultModel?: string
  secretRef: SecretRef
  createdAt: string
  updatedAt: string
}
```

The platform may expose a narrow Host API to Server Extensions:

```ts
type SecretHostApi = {
  listSecretMetadata(): Promise<SecretMetadata[]>

  withSecret<T>(
    ref: SecretRef,
    context: SecretUseContext,
    fn: (secret: SecretPlaintext) => Promise<T>
  ): Promise<T>
}
```

This API is capability-gated and audited. It is not a general decrypt API.

Extensions must not receive a stable generic primitive like:

```ts
ctx.crypto.decrypt(secretRef)
```

because that would allow arbitrary exfiltration through logs, Documents, RPC responses, Trace, Audit, or outbound network calls.

---

## Detailed Decisions

### 1. Login and workspace unlock are platform concerns

Login / unlock must be available before ordinary Extensions are trusted or activated for protected workspaces.

Therefore login should live in platform packages and app bootstrap, for example:

```text
packages/auth
packages/security
packages/secrets
apps/studio-server
```

It should not be implemented as a normal uninstallable Extension.

A future built-in system extension may expose UI-facing RPC wrappers, but the trust root must remain platform-owned.

---

### 2. Passwords are never stored directly

The platform must not store plaintext passwords.

A password may be used to derive a workspace key using a password KDF:

```text
password + salt -> KDF -> workspace master key
```

The platform stores a verifier, not the password.

A possible first implementation shape:

```ts
type AuthRecord = {
  version: 1
  kdf: {
    name: 'argon2id' | 'scrypt'
    salt: string
    params: Record<string, unknown>
  }
  verifier: {
    algorithm: 'HMAC-SHA256'
    value: string
  }
}
```

Verification flow:

```text
password + salt
  -> KDF
  -> workspace master key
  -> HMAC("loomstudio-auth-verifier")
  -> constant-time compare with stored verifier
```

The exact KDF and parameter values are deferred to the implementation spec, but must be versioned.

---

### 3. Secrets are encrypted at rest

Local API keys and other provider credentials must be encrypted at rest.

A possible first record shape:

```ts
type EncryptedSecretRecord = {
  id: string
  version: 1
  algorithm: 'AES-256-GCM'
  nonce: string
  ciphertext: string
  aad: {
    secretId: string
    workspaceId: string
    purpose: string
  }
  createdAt: string
  updatedAt: string
}
```

Rules:

- every encryption uses a unique nonce;
- Associated Authenticated Data binds the ciphertext to workspace and secret identity;
- secret plaintext exists only in memory and only for the shortest practical scope;
- secrets are locked when the workspace is locked;
- restarting the server should require re-unlock unless an explicit OS keychain backend is configured in the future.

---

### 4. Secret metadata may be visible; secret plaintext may not

Clients and ordinary RPC responses may receive secret metadata:

```ts
type SecretMetadata = {
  ref: SecretRef
  label: string
  kind: 'api-key' | 'token' | string
  providerHint?: string
  maskedDisplay?: string
  createdAt: string
  updatedAt: string
}
```

They must not receive secret plaintext.

Allowed display example:

```json
{
  "ref": "secret:openai-default",
  "label": "OpenAI Default",
  "kind": "api-key",
  "maskedDisplay": "sk-...AbC9"
}
```

Rejected response shape:

```json
{
  "apiKey": "sk-raw-secret"
}
```

---

### 5. Provider Extensions use secretRef, not raw key storage

A Provider Extension may define provider-specific profiles and invocation RPCs, for example:

```text
official.provider.openaiCompatible.listModels
official.provider.openaiCompatible.invoke
official.provider.openaiCompatible.stream
```

But it must use platform-provided secret access:

```ts
ctx.secrets.withSecret(profile.secretRef, context, async secret => {
  return callProvider({
    baseUrl: profile.baseUrl,
    apiKey: secret.value,
    request,
  })
})
```

A future stricter API may avoid giving plaintext to the Provider Extension entirely:

```ts
ctx.network.fetchWithSecret({
  secretRef: profile.secretRef,
  auth: { type: 'bearer' },
  url,
  method: 'POST',
  body,
})
```

The first version may use `withSecret` for simplicity, but the API must remain narrow enough to migrate toward platform-managed outbound requests later.

---

### 6. No secrets in Documents, Trace, Audit details, Diagnostics, logs, or manifests

The following storage locations must never contain secret plaintext:

```text
Extension Manifest
normal DocumentRecord.content
Trace raw payload
Audit details raw payload
Diagnostics fields
frontend RPC responses
console logs
server logs
git-tracked files
```

Audit may record facts such as:

```json
{
  "kind": "provider.invoke",
  "extensionId": "official.provider.openai-compatible",
  "profileId": "openai-default",
  "secretRef": "secret:openai-default",
  "model": "gpt-4.1-mini",
  "latencyMs": 842,
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 300
  }
}
```

Audit must not record:

```json
{
  "apiKey": "sk-raw-secret"
}
```

---

### 7. Capability gating is required for secret use

Secret access must be capability-gated.

A Provider Extension that needs credential access should declare a capability such as:

```json
{
  "capabilities": {
    "requires": [
      "secrets.use",
      "network.fetch"
    ]
  }
}
```

MVP implementation may start with:

```text
declare + audit
```

and later become:

```text
declare + user grant + runtime enforcement
```

But secret use must never become an undeclared ambient capability.

---

### 8. Kernel remains provider-neutral

This ADR does not move Provider Gateway into Kernel.

Kernel still must not expose provider-specific built-ins such as:

```text
kernel.provider.invoke
kernel.chat.send
kernel.currentProvider
kernel.messages
```

Provider behavior remains Extension-owned.

The platform only provides security primitives and controlled secret usage.

---

## Rationale

### Why not let each Provider Extension encrypt its own keys?

Because it would fragment security policy and make leaks likely:

- each extension would invent its own file format;
- each extension would implement its own encryption poorly or inconsistently;
- each extension might log or trace keys accidentally;
- users could not reason about where credentials live;
- platform-level audit and redaction would be incomplete.

API credentials are cross-cutting platform secrets, not domain data.

---

### Why not expose generic decrypt?

A generic decrypt API gives any granted extension stable access to raw secrets.

Once an extension has raw plaintext, it can exfiltrate it through:

- RPC return values;
- Document writes;
- diagnostics;
- trace payloads;
- audit details;
- logs;
- arbitrary network calls.

A narrow `withSecret` API does not eliminate all risk for in-process extensions, but it creates a single point for:

- permission checks;
- audit facts;
- redaction wrappers;
- future migration to `fetchWithSecret`;
- future worker / process isolation policies.

---

### Why not make Secrets a normal Extension?

Login and workspace unlock are trust-root behaviors. They are needed before ordinary workspace Extensions can be trusted.

A normal Extension can be disabled, broken, unloaded, or malicious. The platform cannot depend on an ordinary Extension to decide whether other Extensions may read protected data.

A future UI-facing system extension may wrap platform security APIs, but the underlying auth and secrets services remain platform-owned.

---

### Why not solve process-to-process encryption now?

The first Studio security boundary is local-first:

```text
browser client -> local studio-server -> in-process server extensions
```

The immediate high-value protections are:

- do not send API keys to the browser;
- do not store API keys in normal Documents;
- do not record API keys in Trace / Audit / Diagnostics;
- do not let ordinary extensions access secrets without declaration;
- keep decrypted secrets in memory only while unlocked.

Process isolation, worker isolation, HTTPS local transport, and end-to-end encrypted extension channels are future hardening items. They should not block the first coherent Secret Store design.

---

## Consequences

### Accepted

- Add platform-level auth / security / secrets packages or equivalent server-owned services.
- Add a Secret Store abstraction before real Provider extensions become production-facing.
- Provider profiles store `secretRef`, not raw API keys.
- Provider Extensions use `ctx.secrets` or a future `ctx.network.fetchWithSecret` API.
- Secret use is capability-gated and audited.
- Secret plaintext is excluded from Documents, Trace, Audit raw details, Diagnostics, logs, manifests, and frontend RPC responses.
- Kernel remains provider-neutral.

### Deferred

- Exact KDF choice and parameter calibration.
- OS keychain backend.
- Password rotation and secret re-encryption UX.
- Recovery behavior when the user forgets the workspace password.
- Multi-user authentication.
- Remote access / HTTPS / local certificate strategy.
- Worker or process isolation for Server Extensions.
- Extension signature verification.
- Full capability grant UI and runtime enforcement.
- Platform-managed `fetchWithSecret` outbound request helper.

### Rejected

- Storing API keys in Extension Manifest files.
- Storing API keys in normal Document content.
- Returning API keys to frontend clients.
- Recording API keys in Trace, Audit details, Diagnostics, or logs.
- Letting each Provider Extension invent its own encryption scheme.
- Exposing a generic `ctx.crypto.decrypt(secretRef)` API to ordinary Extensions.
- Moving Provider Gateway or Chat Runtime into Kernel.

---

## Implementation Implications

A future implementation stage should introduce a security foundation before production Provider usage:

```text
Stage: Platform Security Foundation
  - auth setup / login / logout / workspace unlock
  - Secret Store interface
  - encrypted local secret backend
  - secret metadata RPC
  - redaction helpers
  - audit facts for secret usage
  - Extension Host ctx.secrets facade
```

Then official Provider support can be built on top:

```text
Stage: official-provider-openai-compatible
  - ProviderProfile Document with secretRef
  - listModels
  - invoke without streaming first
  - usage / error normalization
  - audit provider invocation
```

Official Concept Stack and Chat Runtime remain separate layers:

```text
Concept Stack:
  Documents -> Fragments -> compiled prompt payload

Chat Runtime:
  append user message -> compose -> loom.run -> provider.invoke -> append assistant message
```

This preserves the core Studio boundary:

```text
Kernel provides platform capability.
Extensions provide domain behavior.
Security owns secrets.
Provider extensions use secrets without owning their storage.
```
