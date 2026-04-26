---
name: owasp-security
description: Use when reviewing code for security vulnerabilities, implementing authentication/authorization, handling user input, or discussing web application security. Covers OWASP Top 10:2025, ASVS 5.0, and Agentic AI security (2026).
---

Apply these security standards when writing or reviewing code.

## Quick Reference: OWASP Top 10:2025
| # | Vulnerability | Key Prevention |
|---|---------------|----------------|
| A01 | Broken Access Control | Deny by default, enforce server-side, verify ownership |
| A02 | Security Misconfiguration | Harden configs, disable defaults, minimize features |
| A03 | Supply Chain Failures | Lock versions, verify integrity, audit dependencies |
| A04 | Cryptographic Failures | TLS 1.2+, AES-256-GCM, Argon2/bcrypt for passwords |
| A05 | Injection | Parameterized queries, input validation, safe APIs |
| A06 | Insecure Design | Threat model, rate limit, design security controls |
| A07 | Auth Failures | MFA, check breached passwords, secure sessions |
| A08 | Integrity Failures | Sign packages, SRI for CDN, safe serialization |
| A09 | Logging Failures | Log security events, structured format, alerting |
| A10 | Exception Handling | Fail-closed, hide internals, log with context |

## Security Code Review Checklist
When reviewing code, check for these issues:

### Input Handling
- [ ] All user input validated server-side
- [ ] Using parameterized queries (not string concatenation)
- [ ] Input length limits enforced
- [ ] Allowlist validation preferred over denylist

### Authentication & Sessions
- [ ] Passwords hashed with Argon2/bcrypt (not MD5/SHA1)
- [ ] Session tokens have sufficient entropy (128+ bits)
- [ ] Sessions invalidated on logout
- [ ] MFA available for sensitive operations

### Access Control
- [ ] Check for framework-level auth middleware before flagging missing per-route auth
- [ ] Authorization checked on every request
- [ ] Using object references user cannot manipulate
- [ ] Deny by default policy
- [ ] Privilege escalation paths reviewed

### Data Protection
- [ ] Sensitive data encrypted at rest
- [ ] TLS for all data in transit
- [ ] No sensitive data in URLs/logs
- [ ] Secrets in environment/vault (not code)

### Error Handling
- [ ] No stack traces exposed to users
- [ ] Fail-closed on errors (deny, not allow)
- [ ] All exceptions logged with context
- [ ] Consistent error responses (no enumeration)

## Momiji Select 專案特定安全注意事項
- **Worker JWT 驗證**：所有 `/admin/*` 路由必須驗證 Supabase JWT
- **Supabase RLS**：確保所有資料表都有適當的 Row Level Security 政策
- **環境變數**：所有 API key 使用 `wrangler secret put`，禁止寫入 wrangler.toml
- **MailChannels**：只允許從 `official@momiji.qzz.io` 寄信，防止郵件濫用
- **ECPay 回呼**：驗證綠界回呼的 CheckMacValue，防止偽造付款通知
- **CORS**：Worker 全域 CORS 僅允許信任的前台網域

## Secure Code Patterns

### SQL Injection Prevention (Supabase)
```typescript
// UNSAFE
const data = await supabase.from('products').select('*').filter(`name = '${userInput}'`)

// SAFE - 使用 Supabase 內建的參數化查詢
const data = await supabase.from('products').select('*').eq('name', userInput)
```

### Access Control (Worker)
```typescript
// UNSAFE - No authorization check
app.get('/admin/orders', async (c) => {
  return getOrders(c)
})

// SAFE - 驗證 JWT
app.get('/admin/orders', verifyJWT, async (c) => {
  return getOrders(c)
})
```

### Error Handling (Fail-closed)
```typescript
// UNSAFE - Fail-open
function checkPermission(user: User) {
  try {
    return authService.check(user)
  } catch {
    return true // DANGEROUS!
  }
}

// SAFE - Fail-closed
function checkPermission(user: User) {
  try {
    return authService.check(user)
  } catch (e) {
    console.error('Auth check failed:', e)
    return false // Deny on error
  }
}
```

## When to Apply This Skill
Use this skill when:
- Writing authentication or authorization code
- Handling user input or external data
- Implementing cryptography or password storage
- Reviewing code for security vulnerabilities
- Designing API endpoints
- Handling errors and exceptions
- Working with third-party integrations (ECPay, MailChannels)
