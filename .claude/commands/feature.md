Guide me through a new feature called "$ARGUMENTS" using this strict workflow. Do NOT skip steps.

## Step 1: Understand the Feature

Ask me:
1. What is the feature? (If I already described it, summarize your understanding and confirm)
2. Which area does it affect? (inventory, orders, harness, planning, design, admin, etc.)
3. Are there database schema changes needed?
4. Any edge cases or constraints I should know about?

Do not proceed until I confirm your understanding is correct.

## Step 2: Write Feature Spec

Create a full specification document at `docs/features/$ARGUMENTS.md` containing:

- **Context**: Why this feature is needed, what problem it solves
- **Requirements**: Detailed requirement descriptions with rationale, verification criteria, and validation criteria
- **API Contracts**: Endpoint definitions (method, path, request/response shapes) for any new or modified APIs
- **UI Design**: Description of UI components, layout, user interactions, and states (loading, empty, error)
- **Database Changes**: Schema changes (new tables, columns, migrations) if applicable
- **Test Scenarios**: Key test cases for backend, frontend, and E2E
- **Implementation Notes**: Files to create/modify, existing patterns to follow, edge cases

Present the spec to me for review. Do not proceed until I approve it.

## Step 3: Create Requirements

1. List existing categories: `node scripts/req.js categories`
2. For each requirement from the spec, draft it with `description`, `rationale`, `verification`, and `validation` fields
3. Present each requirement to me for approval before creating it with `node scripts/req.js create '<json>'`
4. If anything is ambiguous, STOP and ask — do not guess
5. If `req.js` fails or the API is unreachable, STOP and tell me
6. Update the spec doc with the created requirement IDs

Do not proceed to tests until ALL requirements are approved and created.

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

Write the code to make the tests pass. Follow existing patterns in the codebase. Ask before running tests.

## Step 7: Verify

1. Run `node scripts/req.js list --project <id>` to review all requirements
2. Confirm every requirement is fully met
3. Flag any that are partially met or missed
4. Update CLAUDE.md with a session entry documenting the changes
