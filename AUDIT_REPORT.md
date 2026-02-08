# Codebase Audit Report
**Date:** 2024-12-28  
**Project:** arena-sim (Weapon Ball Simulation)

## Executive Summary

This audit identified **1 critical bug**, **5 security concerns**, **8 code quality issues**, and **3 performance concerns**. The codebase is functional but requires improvements in error handling, type safety, and resource management before production use.

---

## 🔴 Critical Issues

*No critical bugs found. The codebase is functionally sound.*
---

## 🟠 Security Issues

### 2. Unvalidated File System Access
**File:** `src/sim.ts:9-10`  
**Severity:** HIGH  
**Issue:** File path from command-line arguments is used without validation.

```typescript
const specPath = process.argv[2] ?? "matchSpec.json";
const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as MatchSpec;
```

**Risks:**
- Path traversal attacks (`../../../etc/passwd`)
- Reading arbitrary files
- No file existence checks

**Recommendation:**
- Validate path is within project directory
- Check file exists before reading
- Use `path.resolve()` and validate against allowed paths

### 3. Unsafe JSON Parsing
**File:** `src/sim.ts:10`  
**Severity:** MEDIUM  
**Issue:** JSON parsing without try-catch or validation.

**Risks:**
- Malformed JSON crashes the application
- No schema validation for MatchSpec structure

**Recommendation:**
- Wrap in try-catch
- Use JSON schema validation library (e.g., `zod`, `ajv`)

### 4. Vite Dev Server File System Access
**File:** `viewer/vite.config.ts:7`  
**Severity:** MEDIUM  
**Issue:** Allows Vite dev server to read files from parent directory.

```typescript
allow: [".."],
```

**Risks:**
- In development, could expose sensitive files
- Should be restricted to specific paths if needed

**Recommendation:**
- Restrict to specific directories if parent access is truly needed
- Document why parent access is required

### 5. No Input Validation for Match Spec
**File:** `src/simCore.ts:435`  
**Severity:** MEDIUM  
**Issue:** `createSim` accepts any object without validation.

**Risks:**
- Invalid data causes runtime errors
- No bounds checking on numeric values (could cause overflow/underflow)

**Recommendation:**
- Add runtime validation for MatchSpec
- Validate ranges for all numeric values
- Check required fields exist

### 6. Unsafe Type Assertions
**File:** `viewer/src/main.ts:101`  
**Severity:** LOW  
**Issue:** Using `as any` bypasses type checking.

```typescript
const sim = createSim(matchSpec as any);
```

**Recommendation:**
- Properly type `matchSpec` import
- Remove `as any` assertion

---

## 🟡 Code Quality Issues

### 7. Missing Error Handling
**Files:** Multiple  
**Severity:** MEDIUM  
**Issues:**
- No error handling for file I/O operations
- No error handling for DOM element access (using `!` assertions)
- No error handling for canvas context retrieval

**Examples:**
```typescript
const ctx = canvas.getContext("2d")!;  // Could be null
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));  // Could throw
```

**Recommendation:**
- Add proper null checks
- Wrap file operations in try-catch
- Provide user-friendly error messages

### 8. Unused Code
**File:** `viewer/src/counter.ts`  
**Severity:** LOW  
**Issue:** Counter component is defined but never used.

**Recommendation:** Remove unused code or document why it's kept.

### 9. Console.log in Production Code
**Files:** `src/sim.ts:19`, `viewer/src/main.ts:4`  
**Severity:** LOW  
**Issue:** Debug console.log statements left in code.

**Recommendation:**
- Remove or replace with proper logging library
- Use environment-based logging levels

### 10. Inconsistent Code Formatting
**File:** `src/simCore.ts:503-504`  
**Severity:** LOW  
**Issue:** Inconsistent indentation.

```typescript
  function pullToCenter(ball: BallState) {
    // ...
  }

pullToCenter(A);  // Missing indentation
pullToCenter(B);
```

**Recommendation:** Run formatter (Prettier) and enforce in CI.

### 11. Missing Type Safety
**File:** `viewer/src/main.ts`  
**Severity:** MEDIUM  
**Issue:** Multiple DOM element accesses use non-null assertions without validation.

```typescript
const canvas = document.getElementById("arena") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
```

**Recommendation:**
- Add null checks
- Provide fallback behavior or clear error messages

### 12. No Input Validation for Image Files
**File:** `viewer/src/main.ts:24-38`  
**Severity:** LOW  
**Issue:** Image loading doesn't validate file type or size.

**Risks:**
- Large files could cause memory issues
- Non-image files could be loaded

**Recommendation:**
- Validate file type
- Add file size limits
- Handle errors gracefully

### 13. Missing Documentation
**Severity:** LOW  
**Issue:** 
- No JSDoc comments for exported functions
- Complex physics calculations lack explanation
- Magic numbers not documented

**Recommendation:**
- Add JSDoc for public APIs
- Document physics constants
- Explain complex algorithms

### 14. Hard-coded Values
**Files:** Multiple  
**Severity:** LOW  
**Issue:** Magic numbers throughout codebase.

**Examples:**
- `TIP_BOUNCE_BOOST = 1.12`
- `BALL_COLLIDE_DAMP = 0.94`
- `0.0005` gravity constant

**Recommendation:**
- Extract to named constants
- Consider configuration file for tunable parameters

---

## 🟢 Performance Issues

### 15. Memory Leak: Unrevoked Object URLs
**File:** `viewer/src/main.ts:28`  
**Severity:** MEDIUM  
**Issue:** `URL.createObjectURL()` creates URLs that are never revoked.

```typescript
const url = URL.createObjectURL(file);
// URL never revoked - memory leak!
```

**Impact:** Memory leaks when users upload multiple images.

**Recommendation:**
- Revoke URLs when images are replaced or component unmounts
- Store URLs and clean them up

### 16. No Resource Cleanup
**File:** `viewer/src/main.ts`  
**Severity:** LOW  
**Issue:** Image elements and object URLs not cleaned up.

**Recommendation:**
- Implement cleanup on page unload
- Revoke object URLs when replacing images

### 17. Potential Infinite Loop Risk
**File:** `src/sim.ts:13`  
**Severity:** LOW  
**Issue:** While loop could theoretically run forever if `sim.done` never becomes true.

```typescript
while (!sim.done) stepSim(sim);
```

**Note:** This is mitigated by `maxTicks` check, but worth documenting.

**Recommendation:**
- Add safety counter as failsafe
- Log warning if approaching max iterations

---

## 📋 TypeScript Configuration Issues

### 18. Inconsistent TypeScript Configs
**Files:** `tsconfig.json`, `viewer/tsconfig.json`  
**Severity:** LOW  
**Issue:** Two different TypeScript configurations with different strictness levels.

**Recommendation:**
- Align configurations where possible
- Document why differences exist

### 19. Commented-Out Options
**File:** `tsconfig.json`  
**Severity:** LOW  
**Issue:** Many useful strict options are commented out.

**Recommendation:**
- Enable `noUnusedLocals` and `noUnusedParameters` (already enabled in viewer)
- Consider enabling `noImplicitReturns`

---

## 🧪 Testing & Quality Assurance

### 20. No Tests
**Severity:** HIGH  
**Issue:** No unit tests, integration tests, or test infrastructure.

**Impact:**
- No way to verify correctness
- Refactoring is risky
- No regression detection

**Recommendation:**
- Add test framework (Jest, Vitest)
- Test core simulation logic
- Test edge cases (collisions, boundaries, etc.)

### 21. No Linting Configuration
**Severity:** LOW  
**Issue:** No ESLint or similar linting configuration found.

**Recommendation:**
- Add ESLint configuration
- Enforce code style
- Add pre-commit hooks

---

## 📦 Dependencies

### 22. Dependency Audit Needed
**Severity:** MEDIUM  
**Issue:** No evidence of dependency vulnerability scanning.

**Recommendation:**
- Run `npm audit`
- Keep dependencies updated
- Consider using Dependabot or similar

---

## ✅ Positive Observations

1. **Good Type Safety:** TypeScript is used throughout with strict mode enabled
2. **Clear Structure:** Code is well-organized with separation of concerns
3. **Deterministic Simulation:** Good use of seeded RNG for reproducibility
4. **Modular Design:** Core simulation logic is separated from visualization

---

## 🎯 Priority Recommendations

### Immediate (Before Production)
1. ✅ Add input validation for file paths and JSON
2. ✅ Add error handling for all file I/O operations
3. ✅ Fix memory leaks (revoke object URLs)

### Short-term
5. Add comprehensive error handling
6. Remove `as any` type assertions
7. Add basic test suite
8. Add input validation for MatchSpec

### Long-term
9. Add comprehensive documentation
10. Extract magic numbers to configuration
11. Add logging framework
12. Set up CI/CD with tests and linting

---

## 📊 Summary Statistics

- **Total Issues:** 21
- **Critical:** 0
- **High:** 2
- **Medium:** 8
- **Low:** 11
- **Files Reviewed:** 10
- **Lines of Code:** ~1,200

---

## 🔍 Additional Notes

- The codebase appears to be in active development (see `ChangeLog.md`, `problemList.md`)
- Some known issues are documented in `problemList.md`
- The visualization has known bugs (mentioned in README)
- Consider adding a `.gitignore` if not present
- Consider adding a `LICENSE` file

---

**Audit completed by:** Auto (Cursor AI)  
**Next Review:** After implementing critical fixes

