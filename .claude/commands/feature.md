Guide me through a new feature called "$ARGUMENTS" using this strict workflow. Do NOT skip steps.

## Step 1: Understand the Feature

Ask me:
1. What is the feature? (If I already described it, summarize your understanding and confirm)
2. Which area does it affect? (inventory, orders, harness, planning, design, admin, etc.)
3. Are there database schema changes needed?
4. Any edge cases or constraints I should know about?

Do not proceed until I confirm your understanding is correct.

## Step 2: Create the Feature Record (DB-backed)

Instead of writing a Markdown spec file, create a `DesignFeature` record in the database that becomes the canonical home for this feature's documentation, requirement links, and GitHub linkage.

1. Pick a slug from `$ARGUMENTS` (kebab-case).
2. Draft a markdown body covering:
   - **Context** — why the feature is needed, what problem it solves
   - **API Contracts** — endpoint definitions (method, path, request/response shapes)
   - **UI Design** — components, layout, states (loading, empty, error)
   - **Database Changes** — schema changes if applicable
   - **Test Scenarios** — key cases per layer
   - **Implementation Notes** — files to create/modify, existing patterns, edge cases
3. Create the record:
   ```
   node scripts/feature.js create '{
     "name": "<Display Name>",
     "slug": "<kebab-slug>",
     "description": "<one-line>",
     "markdownBody": "<full markdown body>",
     "projectID": <project>
   }'
   ```
4. Note the returned feature id — call it `$FEATURE_ID`. Use it in later steps.
5. Present the markdownBody back to me and **do not proceed until I approve it**.

## Step 3: Create Requirements

1. List existing categories: `node scripts/req.js categories`
2. For each requirement, draft `description` + `rationale` + `verification` + `validation` + `parentRequirementID` JSON
3. Present each to me for approval, then create with:
   ```
   node scripts/req.js create '<json>' --feature $FEATURE_ID
   ```
   The `--feature` flag auto-links the requirement to the DesignFeature record.
4. After create, run `node scripts/req.js submit <id>` to move from `draft` → `unapproved`
5. If anything is ambiguous, STOP and ask — do not guess
6. If `req.js` or `feature.js` fails, STOP and tell me

Do not proceed to tests until ALL requirements are created and linked.

## Step 4: Write Tests

1. Ask me before running any tests
2. Write failing tests for each requirement:
   - Backend (Jest): `backend/tests/__tests__/<module>/`
   - Frontend (Vitest spec): component `.spec.ts` files
   - E2E (Playwright): `frontend/e2e/` if user-facing
3. Tests should FAIL at this point (they validate unimplemented behavior)

## Step 5: Link Tests to Requirements

Update each requirement to add test file references to the `verification` field:
`node scripts/req.js update <id> '<json>'`

## Step 6: Implement

Write the code to make the tests pass. Follow existing patterns. Ask before running tests.

## Step 7: Add GitHub Linkage to the Feature Record

Once a branch and PR exist:
```
node scripts/feature.js update $FEATURE_ID '{
  "branchName": "<branch>",
  "prURL": "<pr URL>",
  "commitRefs": [{"sha": "<sha>", "url": "<url>", "subject": "<commit subject>"}, ...]
}'
```

## Step 8: Verify and Submit for Review

1. Run `node scripts/req.js list --project <id>` to confirm requirement coverage
2. Run `node scripts/feature.js submit $FEATURE_ID` to move feature from draft → in_review
3. Update CLAUDE.md with a session entry summarizing surprises or non-obvious decisions
