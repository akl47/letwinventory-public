# Version Control for 3D Parts (Accessible Overview)

This document explains how the CAD system tracks the complete history of every part design, manages parallel lines of work, and guarantees that the version a manufacturer builds is exactly, provably, the version that was approved. The approach borrows the same core idea that software engineers use to track changes in source code — but applies it to 3D geometry — because the underlying problem turns out to be identical: structured data that changes over time, where history must be reliable and tamper-proof.

## The Problem with Revision Letters Alone

Engineering drawings have carried revision letters in the title block for over a century. "Rev B" is a familiar label. The problem is that a label is a promise with nothing behind it.

In a conventional shop, "Rev B" means someone decided the design was different enough from Rev A to deserve a new letter, and typed it in. But the letter does not *contain* the design. It points at a file on a network drive. That file can be opened, edited, saved over, or copied with a slightly different filename and emailed around. The label says "B" while the actual bytes underneath drift apart from whatever "B" was supposed to mean.

The challenge of engineering document control is largely the work of keeping that promise intact: ensuring that when anyone in the company refers to "Rev B," they are all looking at the same data. Version control eliminates that problem structurally. In this system, the version *is* the contents. The two cannot come apart, because of how the storage physically works.

## Content Addressing: How a Fingerprint Names a Thing

The foundation of the system is content-addressed storage. The term sounds technical, but the principle is simple: instead of a human choosing where to file a snapshot, the *contents of the snapshot* decide their own address.

Every snapshot of a part design passes through a mathematical function that reads all the data and produces a fixed-length string — a fingerprint. That fingerprint becomes the snapshot's permanent name and address. To retrieve the snapshot later, the system asks its store for "the thing whose fingerprint is this," and gets it back.

Three properties fall directly out of this one design decision.

**The name verifies the contents.** If you are handed a snapshot and told its fingerprint, you can re-run the same math on the data you received and check whether you get the same fingerprint. If even one dimension in that design changed by a thousandth of a millimeter, the fingerprint comes out completely different — not slightly different, but unrecognizably different. This is a deliberate property of these mathematical functions called the avalanche effect: one bit changes at the input, and on average half the output bits flip. The result is that identical fingerprints guarantee identical contents, always. A fingerprint is a perfect tamper seal: you cannot change the contents and keep the name. The two are welded together by math.

**Identical content is stored exactly once.** When a snapshot is saved, the system computes its fingerprint and checks whether the store already contains something under that address. If it does, nothing is written — the store simply notes another reference to what is already there. You never accumulate duplicate copies of the same snapshot, and you never have to think about deduplication, because the content decides its own address and there is only one address per content. This extends all the way down to individual features within a part: if a branch only changes one feature, only that feature gets a new fingerprint and a new store entry; the rest point at the exact same objects already on disk.

**History is append-only.** Because a snapshot's name is its fingerprint, and that fingerprint is determined by the contents, an old snapshot is frozen the instant it is created. There is no mechanism for editing a snapshot. Changing any part of a design produces a *new* fingerprint and a *new* snapshot, sitting alongside the old one. The old one is untouched and untouchable. For a manufacturing shop that needs to answer auditors' questions about which design was shipped and whether it has been altered since approval, "it is structurally impossible to alter a saved snapshot" is a far stronger guarantee than "we have a policy against it."

A useful analogy: imagine a library where you do not get to name your books. You hand the librarian a manuscript, and a machine reads every word and assigns a call number derived entirely from the words inside. Identical manuscripts get the identical call number, so the library never shelves two copies of the same book. Change a single comma and the machine produces a completely different call number, making it a different book on a different shelf — the original is exactly where it was. And you cannot sneak in and edit a shelved book, because then its words would no longer match its call number, and any integrity check would catch it immediately. That library is the content-addressed store.

This technology is not novel. The fingerprint function used here is from the same well-proven family that secures web traffic and that the git version control system uses internally. The design decision was not inventing a new mechanism — it was recognizing that a part design, once it is data, has exactly the same shape of problem as source code, so the same proven machinery applies directly.

## Everyday Workflow: Check In, Branch, Compare

The content-addressed store is the plumbing. Engineers never see it. What engineers see are three verbs: check in, branch, and compare.

### Check In

Checking in saves a permanent snapshot with an attached note. An engineer finishes a meaningful unit of work — added a mounting boss, adjusted a fillet — types a short description of what changed and why, and hits check in. The system fingerprints the current state of the design, files it in the store, and records: here is this snapshot, here is its message, here is who made it and when, and here is the snapshot it came from.

That last piece — "the snapshot it came from" — builds the history chain. Each snapshot remembers its parent. The result is not a pile of saves but a *lineage*: snapshot 5 came from 4 came from 3, tracing all the way back to the empty beginning. Because every link in that chain is frozen and append-only, the history is a permanent, honest record. Nobody went back and tidied it.

Checking in is fundamentally different from the familiar "save" button. Saving a file overwrites it; the previous state is gone unless you made a copy. Checking in never overwrites anything. Every check-in is a new permanent point on a chain that still holds every earlier point, fully intact. The current version is simply the most recent point on a chain that still holds all prior points. Any of those points can be restored into the editor on demand — not from a backup on a tape somewhere, but directly from the version history.

### Branch

A branch is a parallel line of work. The scenario it solves is common: a design is mostly done, and someone wants to try an alternative — a lighter version, a different connector layout — without losing the original. The old approach is creating a second file, and now there are two files drifting apart, with no clean way to compare or reconcile them.

A branch costs nothing to create. Under the hood, a branch is a movable pointer — a label that says "this line of work currently sits at this snapshot." Creating one takes an instant because no content is duplicated: both the original line and the new branch point at the same fingerprinted objects in the store for everything they agree on. A branch that changes only one feature out of fifty has its own copy of only that one feature, and shares the other forty-nine with the original line via structural sharing.

If the experimental branch yields something useful, there are tools to bring its changes back. If it turns out to be a dead end, the branch is simply archived and the main line never knew it happened.

### Compare

Compare answers "what exactly changed between these two versions?" — whether comparing last week to today, or one branch against another.

Because everything in the store is fingerprinted in pieces down to the individual feature, the comparison is fast and precise. The system lines up the two snapshots' lists of feature fingerprints: same fingerprint means provably identical content, so it skips those instantly and moves on. Only the features with differing fingerprints require real examination. On a part with a hundred features where three were changed, the system does three real comparisons and waves past the other ninety-seven. The cost of comparison is proportional to the number of differences, not the overall size of the part.

What the engineer actually sees is two things together: a structural list in plain language ("you modified the mounting boss, you added a chamfer, you removed the old slot"), and a visual 3D comparison with the changed faces highlighted in color so you can literally see the difference on the model. Compare is not a wall of numbers. It is "here is what is different — look."

## Protected Main and Draft Branches

The official line of a part's history — called `main` — is protected. It cannot be edited directly. Checking out main for editing, checking in changes to main, and updating main are all blocked. Main advances only through a controlled release, which has its own defined ceremony described below.

This protection enforces a concept called trunk-based development: the main line stays clean and releasable at all times, while all in-progress work happens on branches that fold back in carefully. For a regulated manufacturing shop where "the official version" is a thing auditors examine, protecting main is not just tidy — it gives a clean, auditable spine by construction.

In practice, engineers never have to think about this rule, because the system makes it automatic. The moment a part gets a CAD model, the system initializes main with an empty starting snapshot and immediately creates a draft branch — `draft/01` — and places the engineer on it. From the first click, the engineer is working on a safe, editable draft. Accidentally starting on the official line is not possible, because you were never placed there.

Multiple engineers can each hold their own draft branch of the same part, working completely independently. Neither can see or stomp on the other's work, because they are on separate parallel lines. When they go to release, the releases serialize cleanly onto main: whoever finishes first lands on main, then the second lands after. The official line moves only through that one controlled doorway, so it can only advance one careful step at a time.

### The "Behind Main" Situation

When engineer A releases first, engineer B's branch becomes "behind main" — it is based on an older version of the official line, and new official content now exists that the branch has never seen. The system catches this and blocks engineer B from releasing until the branch is brought up to date.

The reconciliation tool is a feature-level merge, not a crude last-writer-wins overwrite. Engineer B starts from main's current state and then selects, feature by feature, which of their own branch's changes to splice on top. "Keep main's new mounting hole, and also keep my cutout — those do not conflict." The engineer stays in control of what the reconciled result looks like.

The friction here is the system working correctly. Every time the "you are behind, catch up" prompt appears, it is preventing the exact scenario that silently overwrites a colleague's work in the old files-on-a-drive world — work nobody notices is lost until a bad part shows up on the manufacturing floor.

## Release: Freeze, Stamp, Lock

Release is the controlled ceremony by which a draft becomes official. It does three concrete, physical things.

### Freeze: Capturing the Exact Geometry

A part design is stored as a *recipe* — a feature tree that says "start with this sketch, extrude it this far, add a hole here, round this edge." To produce the actual 3D solid, the geometry engine runs that recipe. That computation can, in principle, produce slightly different results over time: a kernel upgrade, a rounding difference in a later version of the software, anything in the pipeline shifting.

For most software that would be an acceptable margin. For a part going to manufacture, it is not acceptable at all.

Freezing closes this gap. At the moment of release, the system runs the recipe one final time and captures the actual computed result — the real 3D geometry — and stores it, fingerprinted, attached to this snapshot. From that point forward, anyone who opens this released revision receives the frozen geometric result directly, with no trip to the geometry engine and no recomputation. The thing that was approved is byte-for-byte the thing anyone ever gets back, even years later on a totally different version of the software. The frozen geometry is itself content-addressed and stored in the same library as everything else, so it carries all the same tamper-proof guarantees.

### Stamp: One Official Revision Number

When a release happens, the system mints the next official revision number — a numeric designator like `01`, `02`, `03` — and permanently attaches it to this exact snapshot via a write-once tag. Write-once means what it says: once revision `01` points at a snapshot, that link is permanent. The tag cannot be re-pointed at different geometry later. The connection between "the official revision 01 of this part" and "this exact frozen geometry" is unbreakable.

There is no separate CAD revision number that someone has to keep synchronized with the manufacturing revision number. The part has one revision identity, shared by engineering, manufacturing, and purchasing. Keeping two separate revision schemes in sync is precisely where shops get burned; the system eliminates the problem by having only one.

### Lock: Read-Only After Release

Once a revision is released, its design is locked read-only. This is the natural consequence of everything above. If revision `01` is permanently welded to specific frozen geometry, editing "revision `01`" further would mean it was no longer that geometry — a contradiction. So the released design is sealed.

Continuing work on a part means starting a new revision. The system makes this automatic and smooth: if an engineer goes to edit a locked released design, the system understands the intent — they want to make changes — and quietly creates the next revision as a fresh editable draft, carrying all the prior work forward. The engineer wanted to edit; editing a released thing means making a new revision; so the new revision is made. Revision `01` stays sealed. The engineer is on revision `02` draft with the work of `01` as the starting point.

### The Two-Tier Release: Numbers and Letters

There are two kinds of release, distinguished by authority level.

The **numeric release** (`01`, `02`, …) is self-service. An engineer with write permission decides their draft is at a good checkpoint, releases it, and it becomes the next numeric revision. No sign-off is required. This is meant to be frequent and low-ceremony — an engineering checkpoint, not a regulatory event.

The **production letter release** (`A`, `B`, `C`, …) is formal and approval-gated. A separate permission level is required, and the design must first have been approved through the review workflow described in the next section before the letter release can be initiated. This is the "we are committing to manufacture and ship this" gate.

Critically, a production letter release does not regenerate or re-freeze anything. It takes a numeric release that is already frozen and locked, and stamps the letter revision onto the exact same frozen geometry. The development revision `02` and the production revision `A` promoted from it point at identical bytes — identical by construction, not by carefulness, because no one recomputed anything. The letter is simply a second write-once label placed on the same already-frozen snapshot.

One additional prerequisite applies to both tiers: before releasing, all work must be checked in as a proper snapshot. A release is a permanent, fingerprinted, frozen artifact. It must be built on a real committed snapshot, not on unsaved edits floating in the editor.

## The Review Workflow: Draft, In Review, Approved

Separate from the revision and release machinery, each branch carries a three-state review status: **Draft**, **In Review**, and **Approved**.

This is the project-management layer, not the data layer. It tracks where a design stands in the human review process, independently of the geometry and revision stamps. Draft means work is in progress. In Review means the engineer has submitted it and it is waiting for a reviewer. Approved means a reviewer with appropriate authority has signed off.

Transitions between states are explicit and deliberate. Submitting a draft moves it to In Review. A reviewer approving it moves it to Approved. This is a one-way ratchet — you advance through the states, you do not cycle backwards except by explicit reset.

The review workflow and the release machinery are wired together at exactly one point: a production letter release is only available when the branch's status is Approved. The status board is the gate. Without approval, the production release option does not exist. The human review is not a suggestion that can be skipped under deadline pressure; it is a hard prerequisite enforced by the system.

### Per-Branch Status

The workflow status is tracked per branch, not per part. This matters once multiple engineers have concurrent draft branches of the same part. If the status lived on the part, one engineer's branch going into review would flip the status for everyone's unrelated draft. Instead, each branch carries its own independent status tracker. Engineer A's branch can be in review while engineer B's branch is still in draft and the official main line has its own production-approval cycle running — all three independent, none interfering.

The workflow engine itself is generic and declarative: the CAD system hands it a description of the allowed states and transitions, and the engine enforces them. The same engine serves the assembly system. Both parts and assemblies go through identically-behaving review processes because they share one definition of what that process is. A fix to the engine benefits both; a change to the rules applies consistently to both.

## Three Locks, Three Jobs

The system has three distinct kinds of lock, and they are easily confused because they often activate together at release time. Each one answers a different question.

The **checkout lock** is transient and about the live editing moment. When an engineer checks out a branch to work on it, the lock signals "I am actively editing this — wait your turn." It releases when the engineer checks work back in or hands off. It has nothing to do with whether the part is final; it is purely about preventing two people from clobbering each other's live edits on the same branch right now.

The **release lock** is permanent for the released revision and about the design being sealed. When a revision is released, the design goes read-only — the release lock is why. It means "this version has been released and the design is now frozen." It is not about someone editing right now; it is about a version being finished and permanently sealed.

The **manufacturing lock** lives on the part record in the broader inventory and manufacturing system, not on the CAD model specifically. It signals that the manufacturing side of the house considers this revision immutable because purchasing orders, bills of materials, and work orders all depend on it. It exists because the manufacturing system predated the CAD module and has its own rules about part-record immutability. The CAD release triggers the manufacturing lock — they fire together — but they are conceptually owned by different parts of the system, live in different database tables, and answer to different logic.

When a release happens, all three often activate in a single motion: the checkout lock clears (the working copy is no longer live), the release lock sets on the design, and the manufacturing lock snaps onto the part. Seeing everything lock at once is what leads people to treat them as one thing. They are three things that happen to fire together, each earning its keep by enforcing a different constraint.

Collapsing them into one lock would be wrong. The checkout lock is transient and per-session; it cannot be merged with the permanent locks. The release lock and manufacturing lock feel more similar, but they are owned by different systems with different rules. Forcing them together would couple two systems that are better kept loosely joined.

## Why a Regulated Shop Needs All of This

The core payoff is traceability — but not the vague, aspirational kind. Structural traceability, where the answer to a critical question is not a best guess based on reconstructed email threads, but a single click with a guaranteed-correct result.

Consider the scenario where a part shipped eight months ago turns out to have a problem in the field. The first and only question that matters is: which exact version of this design did we actually build? The answer determines which units are affected, whether it is a one-off or a whole batch, and whether the design was wrong or the shop deviated from it.

In a files-on-a-network-drive shop, answering that question requires forensics: digging through email threads, finding three copies of a file with different modification dates, trying to reconstruct from memory which one went to the floor. The result is a best guess, not evidence. When a customer or auditor asks "prove it," there is a story but not a demonstration.

In this system, the question has an exact, instant answer. The part was built as revision B. Revision B is a write-once stamp welded to a specific frozen snapshot. Click it and you are looking at the exact geometry that shipped — not a regenerated approximation, the frozen thing itself — plus who approved it, when, and the complete chain of edits leading up to it, every one append-only and tamper-proof.

The prevention side — "build the right version" — is equally important and arguably the bigger win, because it stops problems before they ship. Wrong parts get built in the old world because someone pulls an old revision from a folder full of ambiguously named files. The protected main line, the clear separation between released revisions and in-progress draft branches, and the freeze-stamp-lock ceremony make it structurally difficult to do this by accident. When manufacturing pulls up "the released revision," there is exactly one thing that means, it is the right thing, and it is frozen, stamped, and locked. The structure of the system steers everyone toward the correct version by default.

For a regulated manufacturer, the distinction between structural guarantees and policy-based ones is significant. "We have a policy against editing approved files" is a statement about intentions that can erode under deadline pressure. "It is not possible to alter a saved snapshot — here is the math" is a statement about physical properties of storage. When demonstrating design control to an auditor, structural impossibility is a considerably stronger position than a well-intentioned procedure.

---

## Key Points

- Every snapshot of a part design is named by a fingerprint of its own contents. This simultaneously verifies integrity (a tamper seal), eliminates duplicate storage (same content always gets the same address), and makes history append-only (changing anything produces a new snapshot, never overwrites an old one).
- Parts are stored as trees of individually fingerprinted pieces (features, sketches, geometry objects). Branching and comparison are cheap because unchanged features share the exact same stored objects across any number of branches.
- Engineers interact with three verbs — check in, branch, compare — and never see the content-addressing machinery underneath.
- The official line (`main`) is protected and cannot be edited directly. All work happens on draft branches, and the system automatically places engineers on a draft branch from the first click.
- When main advances past a branch's base, the branch is blocked from releasing until it reconciles via a feature-level merge tool.
- Release does three physical things: freezes the computed geometry as a permanent snapshot so it can never drift with software changes; stamps the part's official revision number via a write-once tag; and locks the design read-only.
- There are two release tiers: numeric releases (`01`, `02`) are self-service engineering checkpoints; letter releases (`A`, `B`) are approval-gated production releases that reuse the exact same frozen geometry from a numeric release — identical by construction.
- The three-state review workflow (draft → in review → approved) is tracked independently per branch. Approved status is a hard prerequisite for a letter release.
- Three distinct locks — checkout (transient, live-editing), release (design sealed after release), manufacturing (supply-chain immutability) — often activate together at release time but each answer a different question and are owned by different parts of the system.
- Structural traceability means "which version did we build?" is a single click with a guaranteed-correct answer, and "build the right version" is the default rather than a hope — because the system's storage properties make the wrong behaviors physically impossible, not merely against policy.
