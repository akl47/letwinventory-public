# The CAD / Assembly / VCS Podcast — Full Scripts

A twelve-part audio deep-dive into the browser-based parametric CAD + assembly system, its Rust/OCCT geometry kernel, and its content-addressed version-control layer. The scripts are written for a **two-host conversational format**:

- **MAYA** — the host. A sharp generalist who asks the questions a smart listener would, pushes for plain English, and reaches for analogies.
- **THEO** — the engineer who designed and built the system. Explains with intuition and analogy, and is candid about tradeoffs, approximations, and footguns.

Each episode is written to run roughly **one hour** (~8,500–11,000 spoken words). The series is structured in two arcs:

- **Season 1 — Broad (Episodes 1–4):** an accessible primer. Concepts, intuition, and *why* the system is built this way.
- **Season 2 — Deep (Episodes 5–12):** the technical deep dive. Real mechanics, algorithms, data shapes, file/function names, edge cases, and footguns.

All technical content is grounded in the system documentation under [`docs/cad-system/`](./README.md). Total: 12 episodes, ~120k words.

---

## Contents

**Season 1 — Broad**

1. [Episode 1 — The Big Picture: A CAD System Inside Your Inventory App](#episode-1--the-big-picture-a-cad-system-inside-your-inventory-app)
2. [Episode 2 — The Engine Room: The Geometry Kernel](#episode-2--the-engine-room-the-geometry-kernel)
3. [Episode 3 — Git for 3D Parts: Version Control](#episode-3--git-for-3d-parts-version-control)
4. [Episode 4 — Putting It Together: Assemblies and the Big Idea](#episode-4--putting-it-together-assemblies-and-the-big-idea)

**Season 2 — Deep**

5. [Episode 5 — First Principles: Why Browser CAD, and How It All Fits](#episode-5--first-principles-why-browser-cad-and-how-it-all-fits)
6. [Episode 6 — Sketching and the Constraint Solver](#episode-6--sketching-and-the-constraint-solver)
7. [Episode 7 — Features: From 2D to Solid](#episode-7--features-from-2d-to-solid)
8. [Episode 8 — Inside the Kernel](#episode-8--inside-the-kernel)
9. [Episode 9 — Content-Addressed Version Control](#episode-9--content-addressed-version-control)
10. [Episode 10 — Freeze and Release](#episode-10--freeze-and-release)
11. [Episode 11 — Assemblies and the Mate Solver](#episode-11--assemblies-and-the-mate-solver)
12. [Episode 12 — Written Once: The Architecture](#episode-12--written-once-the-architecture)

---

# Episode 1 — The Big Picture: A CAD System Inside Your Inventory App

## Cold open

**MAYA:**
Okay, so before we even start, I want to do a thing. Theo, you sent me a link this morning to a part in your system. A bracket, I think? I opened it in my browser, and there it is, this little 3D shape, I can spin it around, it's got holes in it, the whole deal. And I have one question.

**THEO:**
Go.

**MAYA:**
Where's the file?

**THEO:**
[laughs] What do you mean, where's the file?

**MAYA:**
I mean, when I make a 3D model in, you know, the normal world, I get a file. A `.stl`, a `.step`, a `.sldprt`, something with a little icon. It lives in a folder. I can email it to somebody. So I went looking for *the bracket*, the actual saved shape, and I cannot find it. So where is it?

**THEO:**
It's not there.

**MAYA:**
What do you mean it's not there. I'm *looking at it*.

**THEO:**
You're looking at the *output*. The shape you're spinning around in your browser — that doesn't exist anywhere as a saved object. Nobody stored those holes. Nobody stored those surfaces. What we stored is a recipe. A list of instructions. And every single time you open that part, the system *re-bakes the cake from the recipe* and hands you a fresh one.

**MAYA:**
[pause] That can't be right.

**THEO:**
It's completely right. And once you understand *why* we did it that way — why the shape is a thing we re-derive instead of a thing we save — the entire rest of this system makes sense. That one decision is the keystone.

**MAYA:**
Okay. I have so many follow-up questions, and the first one is "isn't that insane," but let's do an intro first.

## Intro

**MAYA:**
Welcome to the show. I'm Maya, I'm your host, and the deal here is pretty simple: Theo built a thing, a genuinely large and weird and interesting piece of software, and across this season he's going to explain it to me, a reasonably smart person who is *not* a CAD expert, not a graphics expert, and who is going to keep asking "but why" until it makes sense. Theo, introduce yourself.

**THEO:**
I'm Theo. I designed and built the system we're talking about. Day job, mechanical-adjacent software. And I want to say up front — I'm not here to sell you on it. There are parts of this that are genuinely clever and there are parts that are honestly held together with tape and a prayer, and I'll tell you which is which. That's more fun anyway.

**MAYA:**
That's the deal we made. No hype. So let me frame the season. This is season one, and it's the broad strokes — the "what is this and why does it exist" tour. Four episodes. We're going to come out the other side actually understanding the shape of the thing. Then in season two we roll up our sleeves and go into the engine room with the real mechanics. Today is episode one, the big picture. And the big picture, apparently, is that there are no files, which still makes me want to lie down.

**THEO:**
[laughs]

**MAYA:**
So here's the map for today. I want to understand: what is this thing, top to bottom. Why does it exist when SolidWorks already exists. What are its major pieces. And this idea that geometry is a recipe and not a file, because that's clearly the load-bearing weird idea, and I want to actually get it in my bones, not just nod along. And then by the end I want to understand the big claim you keep teasing, which is that parts and assemblies are somehow the *same app*. We'll get there. Let's start with the obvious heretical question.

## Segment 1 — Why build CAD inside an inventory app at all

**MAYA:**
SolidWorks exists. Fusion exists. Onshape exists. These are mature, billion-dollar tools built by enormous teams over decades. You — one person, mostly — sat down and built a CAD program. In a *browser*. Bolted onto an *inventory app*. Walk me through how that's not completely deranged.

**THEO:**
[laughs] It's a fair opening. So let me set the scene. The system this lives inside is a manufacturing and inventory web app. It tracks parts, stock levels, barcodes, where things are in the warehouse, orders, work instructions for the people building things on the floor — the whole operational backbone of a small manufacturing shop. And the central object in that whole world is the *Part*. A part has a name, a revision, a part number, a category, suppliers, a bill of materials, all of that.

**MAYA:**
Right, a part is the noun the whole app is about.

**THEO:**
The part is the noun. And here's the problem we had. Every part also has a *shape*. It's a physical object — a bracket, a housing, a spacer, a machined block. And the shape of that part lived... nowhere. Or rather, it lived in a SolidWorks file, on somebody's laptop, or on a network share, in a folder, with a name like `bracket_v3_FINAL_actually_final.sldprt`.

**MAYA:**
Oh no. I know that file.

**THEO:**
Everybody knows that file. And the inventory system has this beautiful, rigorous, revision-controlled record of the part — revision A, revision B, this is locked for manufacturing, here's the history of every change. And then completely disconnected from that, off in file-share land, is the actual geometry, with no enforced connection between "revision B of the part in the database" and "which `.sldprt` file is actually revision B." They drift. Constantly.

**MAYA:**
So the database knows the part is on revision B, but the *shape* of revision B is just... vibes and a filename.

**THEO:**
Vibes and a filename. And when manufacturing pulls up a part to build it, they're trusting that the file someone handed them matches the revision the system says they should be building. That gap — between the official part record and the geometry — is where real, expensive mistakes happen. You machine fifty of the wrong revision because the file on the share was stale.

**MAYA:**
Okay, so I'm starting to feel the itch you were scratching. But the obvious fix is "make the file-naming discipline better," or "buy a PDM system that manages the SolidWorks files." Why build a whole CAD program?

**THEO:**
Two reasons. First, the discipline fix never actually works, because it relies on humans being perfect about filenames forever, and I have met humans. But the deeper reason: I wanted the geometry to be a *first-class citizen of the same database*, riding the *same* revision workflow as everything else. Not a file that points at a record, or a record that points at a file — the geometry literally *is* part of the record. Same database. Same revision A, B, C. Same "this is released and locked for manufacturing" workflow that the wire harnesses and the work instructions already use.

**MAYA:**
So when the part record says revision B is released and locked —

**THEO:**
— the exact geometry of revision B is frozen, in the database, tied to that revision, and physically impossible to drift. Manufacturing pulls up revision B and they get *the* revision B shape. There is no other file. There is no share. There's nothing to be stale.

**MAYA:**
Huh. Okay. So the pitch isn't "we built a better CAD than SolidWorks." Nobody's claiming that.

**THEO:**
God, no. SolidWorks will run circles around this thing on raw modeling horsepower. The pitch is: design intent, revision history, and manufacturing data all in *one* system, with *one* source of truth, that you open in a browser with nothing to install. A machinist on the floor opens a part on a tablet and sees the released geometry — no CAD license, no install, no "which file." That's the value. It's not the modeling. It's the *unification*.

**MAYA:**
The unification. Okay, hold that phrase, because I have a feeling it's going to come back about nine times today.

**THEO:**
[laughs] You have no idea.

**MAYA:**
And — devil's advocate one more time — the browser thing. People hear "CAD in a browser" and they think toy. They think laggy, low-poly, can't-do-real-work toy.

**THEO:**
Right, and that reputation was earned, ten years ago. But two things changed. Browsers got genuinely fast — we've got real 3D graphics through the GPU, we've got ways to run compiled code at near-native speed right there in the page. And Onshape proved you can ship serious, professional CAD entirely in a browser. So the technology bet isn't crazy anymore. It was crazy in 2014. It's just... a choice now. A reasonable one. The browser means zero install, which on a manufacturing floor full of locked-down tablets and shared machines is worth an enormous amount.

**MAYA:**
Okay. I'm convinced it's not deranged. Downgraded to "ambitious." Let's talk about what's actually in the box.

## Segment 2 — The workbench with four tools

**THEO:**
So the cleanest way to hold the whole system in your head — and this is the metaphor I keep coming back to — is: imagine a workbench. One bench. And on that bench there are four tools. They share the bench, they share the lighting, they hand work back and forth, but each one does a distinct job. Four tools, one bench.

**MAYA:**
I love a physical metaphor. Give me the four.

**THEO:**
Tool one is **the modeler**. That's where you draw. That's the part you, Maya, would actually touch with your hands. You sketch a 2D outline on a flat surface — and I really do mean it's like taping a piece of graph paper to a face and drawing on it — and then you give that outline depth. "Take this circle and push it ten millimeters into the screen." Now it's a cylinder. You stack up steps like that, and that stack of steps *is* the recipe we keep talking about. The modeler is the kitchen where you write the recipe.

**MAYA:**
Kitchen, recipe. Got it. Tool two.

**THEO:**
Tool two is **the kernel**. This is the engine room. It's a completely separate program — different language, even — and it does the heavy geometric math. When you say "push this circle ten millimeters," somebody has to actually compute the cylinder. The exact surfaces, the exact edges, where they meet, which faces are flat and which are round. That math is genuinely hard — like, decades-of-PhD-research hard — and the kernel is the muscle that does it. The modeler hands the kernel instructions, the kernel hands back a finished 3D shape.

**MAYA:**
So the modeler is the chef who writes "sauté the onions," and the kernel is the actual hot pan and the chemistry of the onions cooking.

**THEO:**
That's genuinely a good way to put it. The chef doesn't re-derive the Maillard reaction from physics every time. The chef says "sauté," and the pan handles the chemistry. The modeler says "extrude," and the kernel handles the topology.

**MAYA:**
The pan does not care about your feelings or your recipe. The pan does chemistry. Okay. Tool three.

**THEO:**
Tool three is **version control**. This is the time machine and the filing cabinet, fused into one. Every time you save your work — we call it "checking in" — it becomes a permanent, immutable snapshot. You can go back to it, you can compare against it, you can branch off it to try something risky without touching the main version. If you've ever heard a software engineer talk about "git" — committing code, branches, merging — it's *that*, but for 3D parts instead of text. And when a part is finished, you "release" it, which freezes the exact geometry and ties it to that official part revision number. Which is the whole reason we built this thing, from segment one.

**MAYA:**
Right — that's where the "no stale files" promise actually gets enforced. The freeze.

**THEO:**
The freeze is where the promise becomes physics instead of a hope. We'll spend a whole episode on it later, it's my favorite part. Branches, merges, comparing two revisions face-by-face, the works.

**MAYA:**
And tool four.

**THEO:**
Tool four is **assemblies**. Tools one through three are about making *one* part. Assemblies are where finished parts come together into a machine. You drop several parts into one scene and you tell the system how they relate. "This bolt's shaft goes inside that hole." "These two faces touch." And then a thing called a *mate solver* figures out exactly where everything physically has to sit so all those relationships are satisfied at once — the same way SolidWorks or NX positions parts in an assembly. And out of an assembly you get a bill of materials, you get exploded diagrams, you get a check for whether two parts are illegally overlapping in space.

**MAYA:**
Okay so let me play those back. Modeler: the kitchen where you write the recipe. Kernel: the hot pan that does the actual cooking. Version control: the time machine slash filing cabinet. Assemblies: the scene where finished parts snap together. Four tools, one bench.

**THEO:**
That's the whole system at altitude. Everything else we ever talk about is a detail hanging off one of those four.

**MAYA:**
And here's what I want to flag for the audience, because you buried it. You said "the same bench." Not four benches. One bench, shared.

**THEO:**
[laughs] You caught it faster than I wanted you to.

**MAYA:**
I'm onto you. But let's not spring the trap yet. I want to go back to tool one and tool two, because the relationship between the kitchen and the pan is where this "no files" thing lives, and I'm not going to let it go. Why is the kernel a *separate program*? Why not just... do the math in the same place as everything else?

**THEO:**
Genuinely good instinct to poke there. Two reasons. First, the kernel is built on a piece of software called OCCT — Open CASCADE Technology — which is this venerable, gnarly, industrial-strength geometry library that's been around for thirty years. It is not a thing you casually port into a web browser. It's written in C++, it's enormous, it wants to run as a real native program on a real server. So practically, it has to be its own process.

**MAYA:**
So it's a separate program partly because the good geometry math only comes in this one big heavy crate that won't fit in the browser.

**THEO:**
Right. And second — and this is the design reason, not just the practical one — keeping it separate means the kernel is a *replaceable engine*. The modeler doesn't know or care how the cylinder gets computed. It just sends a request — "extrude this profile this far" — and gets back a shape. The boundary between them is a clean little messaging protocol. That separation means if a better geometry engine comes along, in principle you swap the pan without rewriting the kitchen.

**MAYA:**
And I should say for the audience — Theo told me before we started rolling that the kernel is written in a totally different language than the rest, something called Rust, and that's its own whole episode in season two, so we're going to wave at it and keep moving.

**THEO:**
We're going to wave at it. The one-sentence version: Rust because the geometry work is heavy and you want it fast and you really, *really* don't want it to crash, and Rust is good at exactly those two things. That's the episode-five teaser, and I'm going to stop, because I will keep talking about Rust for forty-five minutes if you let me.

**MAYA:**
I will not let you. Back to the recipe. This is the thing I need to actually understand.

## Segment 3 — The recipe, not the file

**MAYA:**
So at the very top, you said the bracket isn't stored. It's re-baked from a recipe every time I open it. I nodded, because I'm a professional, but internally I screamed. Take me through it slowly. What is *actually* saved in the database when I save that bracket?

**THEO:**
Okay. Let's build the bracket together, in words, and you'll see exactly what gets written down.

**MAYA:**
Let's do it.

**THEO:**
Step one. We start with the origin — that's just the standard set of reference planes and axes, like the X, Y, Z you remember from school. Every new part starts with those and nothing else. Empty. So step one in the recipe is literally just "here are the reference planes." Free.

**MAYA:**
Okay, blank graph paper, three planes. No shape yet.

**THEO:**
No shape. Step two: I make a sketch on one of those planes. I draw a rectangle — let's say a hundred millimeters by sixty. And here's the first important thing. What gets *saved* for that sketch is not a picture of a rectangle. It's a tiny structured note that says, roughly: "there's a sketch, on this plane, and it contains four lines connecting these four corner points, and there are some rules — these two sides are parallel, this corner is a right angle, the bottom edge is a hundred millimeters long, the left edge is sixty."

**MAYA:**
So you're not saving the rectangle. You're saving the *description* of the rectangle. The instructions to draw one.

**THEO:**
The description and the *rules*. That second part matters and we'll come back to it. Step three: I select that rectangle and I extrude it — I push it twenty millimeters straight up off its plane. What gets saved is a note that says: "Feature number two: extrude. Use the sketch from before. Distance: twenty millimeters. Direction: up." That's it. Four numbers and a reference.

**MAYA:**
Still no actual block of material anywhere in the database.

**THEO:**
Still nothing. There is no box stored. Step four: I sketch a circle on the top face and cut a hole through it — extrude, but subtract. Saved: "Feature three: cut-extrude. This sketch. Through everything." Step five: I round over the four vertical edges with a fillet. Saved: "Feature four: fillet. These four edges. Radius three millimeters."

**MAYA:**
And let me guess. The fillet doesn't store the rounded surfaces either.

**THEO:**
The fillet stores "fillet, these edges, radius three." Four little instructions. So now look at what's actually in the database for this part. It is a *list*. Origin. Sketch-and-extrude a box. Cut a hole. Round four edges. Five lines. That ordered list — we call it the *feature tree* — is the entire saved representation of your part. It is the recipe. There is no cake. There is only the recipe for the cake.

**MAYA:**
So when I open the part this morning and I'm spinning a 3D bracket around with holes and rounded edges —

**THEO:**
— the system read that five-line recipe, and *executed it*, top to bottom, live, right then. It told the kernel "make a box this size," got back a box. "Cut this hole," got back a box with a hole. "Round these edges," got back the final shape. And *that* — the thing that came out the bottom of replaying the recipe — is what got drawn on your screen. You closed the tab, it evaporated. You'll open it again tomorrow, it'll get re-baked again.

**MAYA:**
Okay. I get the mechanics now. But I'm back to my scream. *Why?* That sounds like so much extra work. You're recomputing the entire shape every single time instead of just... saving the shape once and loading it. Saving a file is fast. Why would you choose to re-bake?

**THEO:**
This is the exact right question, and the answer is the entire reason parametric CAD exists. Watch what happens when I want to *change* something. Say the customer comes back and says, "actually the bracket needs to be a hundred and twenty millimeters long, not a hundred."

**MAYA:**
In file-world, I'd... reopen the model, and somehow stretch it, and hope the hole and the fillets come along for the ride.

**THEO:**
In file-world, if all you saved was the final shape — the cake — you're stuck. The cake doesn't know it was supposed to be a hundred. The cake is just frozen geometry. To make it a hundred and twenty you'd have to surgically push faces around and pray nothing breaks. But in recipe-world? I go back to step two. I change one number. A hundred becomes a hundred and twenty. And then I hit go, and the *entire recipe re-runs from that point down*. The box rebuilds itself at the new length. The hole — which the recipe placed relative to the geometry — moves to stay put. The fillets re-round the new edges. The whole part reflows, automatically, coherently, because every step downstream just re-executes against the new upstream result.

**MAYA:**
Oh. *Oh.* Because the hole and the fillets were never positions in space, they were *instructions* — "cut a hole here," "round these edges" — and instructions still make sense even after the box underneath them got bigger.

**THEO:**
That's it. That's the whole magic trick. That's why it's worth re-baking. The recipe isn't dead geometry, it's *living design intent*. It captures not just what the shape is, but *why* it is — "this hole is centered," "these edges are rounded," "this wall is two millimeters thick." And because the intent is captured as instructions, you can change an early decision and everything that depended on it updates. Change step two, everything rebuilds. That's the sentence I'd tattoo on this whole system. Change step two, everything rebuilds.

**MAYA:**
That's genuinely beautiful and I'm a little mad at how clean it is. Let me make sure I've got the distinction crisp, because I think this is the thing a listener has to walk away with. A file — a dumb geometry file — is a *photograph* of the part. It captures exactly what it looked like at one instant, and it knows nothing about how it got that way or what was supposed to stay related to what.

**THEO:**
Perfect.

**MAYA:**
And the recipe — the feature tree — is more like the *blueprint plus the reasoning*. It's "a box, with a centered hole, with rounded corners," where "centered" and "this size" are living relationships, not frozen coordinates. So if I change the box, "centered" still means centered, and the hole follows.

**THEO:**
You just described parametric modeling better than most textbooks. The word "parametric" literally means "driven by parameters" — by the numbers in the recipe. Twist a parameter, the model reflows. And the reason we eat the cost of re-baking every time you open the part is that re-baking is the *only* thing that makes that reflow possible. The instant you bake the cake and throw away the recipe, you've thrown away the ability to change your mind cheaply. We never throw away the recipe.

**MAYA:**
Now — honesty clause. You promised me honesty. Re-baking the whole thing every single time sounds like it could get slow. If my part is five steps, fine. If my part is five hundred steps with a bunch of those gnarly geometry operations, am I sitting there watching a spinner every time I open it?

**THEO:**
That's exactly the right worry, and yeah, naively it would be brutal. So there are two saving graces. The first is a *cache*. The system is clever about noticing when a step's inputs haven't changed. If step seventeen and everything above it is identical to last time, it doesn't bother re-asking the kernel — it reuses the answer it already computed. So in practice, when you open a part, most of the recipe gets served instantly from cache, and only the genuinely new or changed parts get re-cooked.

**MAYA:**
So it only re-bakes the parts of the cake you actually changed.

**THEO:**
Right. And the second grace is the freeze, from version control. When you *release* a part — lock it for manufacturing — the system bakes the cake one final time and stores the finished geometry permanently, attached to that release. So the machinist on the floor opening a released part does *not* re-run the recipe at all. They get the frozen cake, instantly, with zero geometry computation.

**MAYA:**
Wait, hang on. So you *do* save the shape sometimes.

**THEO:**
At release. And only at release. While you're actively *designing* — while the thing is still changing — it's pure recipe, because you need the flexibility. The moment you commit to a revision and freeze it, *then* we also stash the baked cake, because a released revision will never change again, so there's no downside to caching it forever, and a huge upside: speed and a permanent, guaranteed-faithful snapshot.

**MAYA:**
That's a really satisfying resolution actually. Recipe while it's alive and changing, photograph once it's frozen and dead. You get the flexibility while you need it and the speed once you don't.

**THEO:**
Best of both. And the photograph is taken *from* the recipe, at a known revision, so it can't drift from it. The two are bound. That binding is, again, the whole point of the project.

## Segment 4 — The regeneration heartbeat

**MAYA:**
You used a word a minute ago I want to pull on. You said the recipe gets "regenerated." There's a name for this re-baking, right? Regeneration.

**THEO:**
Regeneration. And it's such a central idea that I think of it as the *heartbeat* of the whole system. Here's the mental model: literally everything you ever see on screen — in the part editor, in an assembly, anywhere — is the *output of regeneration*. It is always, without exception, the result of taking a stored recipe and replaying it into displayable geometry. Nothing you look at is "just stored and loaded." It's all freshly derived. Thump. Thump. Every change, a new beat.

**MAYA:**
So regeneration is the verb for "replay the recipe and produce the shape."

**THEO:**
That's the verb. And let me walk you through one heartbeat, because the steps are intuitive once you see them. You change something — say you edit that length parameter. The system goes:

One. *Resolve the equations.* Remember I said the recipe can contain rules? Some parts have actual equations in them — like "the length is always twice the width." So before anything else, it works out all those relationships and figures out the real final numbers for every parameter. If you changed the width, the length recomputes first.

**MAYA:**
So before it builds anything, it settles all the "this depends on that" math.

**THEO:**
Settles the arithmetic first. Two. *Walk the feature tree in order.* It goes down the recipe, step by step, top to bottom. Origin, then sketch, then extrude, then cut, then fillet. Each step takes the geometry the previous steps produced and adds its own contribution. The box gets passed to the hole-cutter, the result gets passed to the fillet, and so on. Each step builds on the running total.

**MAYA:**
Like an assembly line where each station adds one operation to the thing moving down the belt.

**THEO:**
Exactly an assembly line. Three. *For each step, check the cache, and if it's a miss, call the kernel.* This is where the kitchen talks to the hot pan. For a step the system hasn't seen before, it packages up the instruction — "extrude this exact outline, this far" — and sends it over to the kernel program. The kernel does the brutal geometry math and sends back a finished shape.

**MAYA:**
And the shape it sends back — what does that even look like, as data? Because a curved surface isn't a list of numbers in an obvious way.

**THEO:**
Great thing to ask, because the answer reveals something. The kernel sends back two layers. There's the *exact* mathematical shape — the precise definition of every surface and edge, perfect curves, the real thing. And then there's a *triangle mesh* version — the shape chopped up into thousands of little flat triangles, because that's what a graphics card actually knows how to draw. Your GPU can't draw a true mathematical sphere. It can draw a zillion tiny triangles arranged to *look* like a sphere.

**MAYA:**
So there's the real shape, which is exact, and the triangle version, which is the costume it wears so the graphics card can paint it.

**THEO:**
The costume. I love that. And along with the triangles, each surface comes back wearing a little name tag — "this face is face number two of body one" — and a classification — "this face is flat," "this face is cylindrical." The name tags matter enormously later, for version control comparing two revisions face by face, but that's a season-two rabbit hole.

**MAYA:**
Noted, name tags, season two. So: resolve the equations, walk the recipe top to bottom, ask the kernel for any step you haven't cached, get back exact shapes plus their triangle costumes. And then?

**THEO:**
And then the viewer draws the costumes, and you see your part. That's one heartbeat. And the thing I want to really land is the *uniformity* of it. There is no special path. There's no "load mode" versus "edit mode." Opening a part for the first time is a regeneration. Editing a parameter is a regeneration. Undoing is a regeneration. Switching to a different revision is a regeneration. It is *always the same loop*: stored recipe in, replay, displayable geometry out. Thump. Thump. Thump.

**MAYA:**
And I assume assemblies have their own heartbeat?

**THEO:**
Same heartbeat, one extra move. When you regenerate an assembly, instead of building one part's geometry, it goes and grabs the *already-built* geometry of each component part — and here's a nice efficiency, if a component is a released part, it pulls the *frozen* baked cake, zero kernel calls, because that part's already done and locked. Then it runs the mate solver to figure out where every part physically sits — "this bolt goes in this hole" resolves into actual positions in space. Then it moves each part's triangles into its computed spot, and composes one combined scene. Same fundamental beat: stored recipe in, replay, geometry out. The recipe just happens to be "these parts, related this way" instead of "these features, stacked this way."

**MAYA:**
So even the assembly is a recipe. "Take this bolt and this bracket, and the rule is the bolt goes in the hole." And regeneration replays *that* into "here is exactly where the bolt sits."

**THEO:**
You're getting dangerously close to the punchline of the whole episode.

**MAYA:**
I can feel it. Hold on, let me make the listener actually *design* something first, because we've been pretty abstract and I want to ground it in clicks and hands.

## Segment 5 — How you actually design a part

**MAYA:**
Pretend I'm sitting down to make a part for the first time. I open a part record, I hit "add CAD model," I'm staring at the editor. Describe what I see, and then walk me through making something simple. A real, accessible, click-by-click walkthrough.

**THEO:**
Okay. What you see will be deeply familiar if you've ever opened SolidWorks or Onshape, because we deliberately copied that layout — there's no points for being original with a CAD interface, you want people's muscle memory to just work. So: across the top, a *ribbon* — a tabbed toolbar. Tabs labeled File, Sketch, Features, Assembly. Click a tab, the buttons underneath change. Sketch tab gives you drawing tools. Features tab gives you extrude, revolve, fillet, all that.

**MAYA:**
Like the ribbon in Microsoft Word, where the tabs swap which buttons you see.

**THEO:**
Precisely that, and for the same reason — there are too many tools to show at once, so you group them. Down the left side, a panel: the *feature tree*. The recipe, shown as a list, live. As you add steps, they appear there. And the big middle of the screen is the 3D view — your part, on a sort of infinite graph-paper floor, that you can orbit around, zoom, pan.

**MAYA:**
Okay, I'm oriented. Now make me something. Walk me through a simple part.

**THEO:**
Let's make a little plate with a hole in it. Move one: you click "Sketch," and the system says, in effect, "okay, where? Pick a flat surface to draw on." Since it's a blank part, you pick one of the three origin planes — let's say the flat one, the floor. You click it.

**MAYA:**
And now I'm "in" a sketch. On that plane.

**THEO:**
You're in the sketch. The ribbon auto-flips to the Sketch tab — it knows that's what you want now. And here's a genuinely slick detail: you don't drop into some separate flat 2D drawing screen. You stay in the *3D view*, looking at your plane, and you draw right there on it, with the rest of your 3D world still visible around you. It's like the graph paper is taped onto the actual surface in 3D space, and you draw on it in place.

**MAYA:**
Why does that matter? Why not pop me into a clean 2D drawing mode?

**THEO:**
Because the *whole point* of sketching is usually to relate your new shape to geometry that's already there. You're sketching a hole on the top face of an existing boss, and you need to *see* that boss while you do it, to line things up. If sketching yanked you into an isolated 2D world, you'd lose all that context. So we keep you in 3D, always. There's a little bit of clever math under the hood that turns your mouse clicks on the screen into precise 2D positions on the tilted plane you're drawing on, but you never think about it. You just click and a line appears on the surface.

**MAYA:**
Okay so I'm on my plane, in 3D. I draw a rectangle.

**THEO:**
You pick the rectangle tool, click one corner, click the opposite corner, there's your rectangle. Four lines. But — and this is the part that separates real CAD from a drawing app — that rectangle is *floppy* right now. Nothing pins it down. You could grab a corner and drag it and it'd squish around. It's a suggestion, not a commitment.

**MAYA:**
Floppy. Okay. How do I de-floppify it?

**THEO:**
You *constrain* it. You apply rules. You click the bottom edge and say "horizontal." Now it can't tilt. You click the bottom edge again and type a dimension — "a hundred millimeters" — now its length is locked. You do the same for the height. You tell the system the bottom-left corner sits on the origin, so the whole thing can't float away. And with each rule you add, the rectangle gets stiffer, less floppy, until it can't move at all. At that point we call it *fully constrained* — fully defined. It has exactly one possible shape and position, and it's locked there.

**MAYA:**
And there's a piece of software whose entire job is to take all my rules and figure out the one shape that satisfies them.

**THEO:**
That's the *constraint solver*, and it is doing something genuinely hard, continuously, in real time. Every time you add a rule, it re-solves the whole little puzzle — "horizontal, AND a hundred long, AND this corner on the origin, AND a right angle here" — and snaps the geometry to the unique answer. It's solving a system of equations every time you blink. And if you give it *contradictory* rules — "this line is a hundred long" and also "this line is fifty long" — it'll refuse, and tell you the constraints conflict, instead of silently doing something insane.

**MAYA:**
That solver sounds like a whole episode by itself.

**THEO:**
It's a whole episode in season two, and I'll just plant one flag: we didn't write that solver from scratch. We adopted the same proven solver that FreeCAD — a serious open-source CAD program — uses. It's a known-good piece of mathematical machinery, and we *vendored* it, meaning we took a copy and brought it in-house so it can't disappear out from under us. The math of constraint solving is genuinely hard and you do not want to be the person who reinvents it badly. So we didn't.

**MAYA:**
Good instinct. Okay. My rectangle is constrained, stiff, a hundred by sixty, pinned to the origin. Now I want a plate, not a drawing. Depth.

**THEO:**
Now you leave the sketch and you go to the Features tab and you click *Extrude*. The system says "which sketch?" — you point at your rectangle — "how far?" — you type five millimeters. And as you're typing, you get a *translucent ghost*, a see-through preview of the block you're about to make, growing and shrinking as you change the number. So you can dial in the thickness and *see* it before you commit.

**MAYA:**
And that ghost — is that the kernel cooking in real time as I type?

**THEO:**
No, and this is a nice little design call. The ghost is a quick-and-cheap fake the front-end draws by itself, without bothering the kernel. It's not the precise real shape — it's a good-enough preview, computed instantly, so it can keep up with you mashing the up-arrow on the distance field. You'd never want a full kernel round-trip on every keystroke; it'd lag. So: cheap ghost while you're dialing it in, real kernel build the moment you hit OK. You commit, the ghost is replaced by the real, exact block, and a new line appears in your feature tree: "Extrude 1."

**MAYA:**
And now if I want my hole?

**THEO:**
Same dance, one layer up. You click "Sketch" again, but this time, instead of an origin plane, you click *the top face of your new plate* — because now there's real geometry to draw on. You draw a circle on it, constrain it — "ten millimeters across, centered" — leave the sketch, and this time you pick *Cut Extrude*. "Which sketch? The circle. How deep? All the way through." And the system shows you the cutting cylinder, often in red so you understand *this is the volume being removed*, and you commit. Now there's a hole. And your feature tree reads: Origin, Sketch, Extrude, Sketch, Cut-Extrude. Five lines.

**MAYA:**
The recipe, building itself in the side panel as I work.

**THEO:**
Building itself as you work. And every one of those lines, you can go back and double-click and edit. Change the plate to ten millimeters thick — the hole, which you said goes "all the way through," stays going all the way through, because that was the *instruction*, not a fixed depth. Move the hole's center — done. Right-click any line, you get a menu — rename it "Mounting Hole," hide it, delete it, edit its numbers. Delete the extrude and the part rebuilds without it.

**MAYA:**
And from there it just... keeps going? Like, the same pattern scales up to a real complicated part?

**THEO:**
It's the same pattern all the way up. A real part is just more lines in the recipe, and fancier features. Instead of just extrude and cut, you've got *revolve* — spin a profile around a line, like a lathe, for anything round, a bottle, a wheel. *Sweep* — drag a profile along a path, like pushing toothpaste along a curve, for pipes and handrails. *Fillet and chamfer* — round or bevel edges. *Shell* — hollow a solid out to a thin wall, like turning a block into a box. *Pattern* — stamp out a grid or a ring of copies, so you draw one bolt hole and say "give me eight of these in a circle." And a *Hole Wizard* that knows real-world standardized hole sizes, so you say "a hole for an M5 screw" and it knows the exact dimensions. But every single one of those is just another line in the recipe. Another step the heartbeat replays.

**MAYA:**
That's the thing that's clicking for me. It's not that there are a hundred different complicated systems. It's *one* system — the recipe and the heartbeat — and all these features are just different kinds of steps you can put in the recipe.

**THEO:**
That's the whole architecture in one sentence. One spine — the ordered feature tree — and a growing vocabulary of step types that hang off it. Add a new kind of feature, you've added a new word the recipe can use. The spine never changes.

**MAYA:**
Okay. I think I'm ready. I think you can spring the trap now. The thing you've been dancing around since segment two. The "same app" thing.

## Segment 6 — The big thesis: parts and assemblies are the same app

**THEO:**
[laughs] Alright. Here's the thesis. And it's the thing I'm proudest of in the whole design, more than any individual feature.

Parts and assemblies are not two programs. They are the *same* program, wearing two hats. The editor that makes a single part and the editor that arranges parts into a machine — same editor. Literally one piece of software with a mode switch. The 3D viewer, the measurement tools, the File menu, the save-and-version machinery — all shared. Written once, used by both.

**MAYA:**
Now, naively, I'd have built those as two separate things. A part editor and an assembly editor. They feel like different jobs. One's about making a shape, one's about arranging shapes. Why force them to be the same?

**THEO:**
Because they share *enormously* more than they differ, and every time you split something that's fundamentally one thing into two codebases, you sign up to maintain two of everything *forever*, and watch them drift apart. Think about what a part editor and an assembly editor have in common. Both show you 3D geometry you can orbit and zoom. Both let you click a face and measure a distance. Both need to be saved, versioned, branched, compared, released. Both have a File menu. Both regenerate from a stored recipe. The *only* real difference is: a part's recipe is "a stack of features that build one shape," and an assembly's recipe is "a set of component parts and the relationships between them."

**MAYA:**
So the shape of the *recipe* differs, but everything *around* the recipe is identical.

**THEO:**
Identical. So we built everything-around-the-recipe exactly once, and then we made two thin little adapters — one that knows how to read and replay a *part* recipe, and one that knows how to read and replay an *assembly* recipe. And we plug whichever adapter is appropriate into the *same* shared machine. The version control doesn't know or care whether it's storing a part or an assembly — it's storing a recipe, period. The measurement tool doesn't know if it's measuring a single part or measuring across two parts in an assembly — it's measuring 3D geometry, period.

**MAYA:**
There's a phrase you keep using and I finally want to underline it for the audience. "Written once."

**THEO:**
"Written once" is the soul of the thing. Take version control. It is genuinely complicated software — branches, snapshots, freezing geometry, comparing revisions, the whole git-for-shapes machine. Imagine writing all of that, all that subtle, careful, easy-to-get-wrong logic — and then having to write it *a second time*, slightly differently, for assemblies. And keep both copies perfectly in sync as you fix bugs and add features, forever. That's a nightmare. That's how systems rot.

**MAYA:**
You'd fix a bug in one and forget the other, and now releasing a part and releasing an assembly behave subtly differently for no reason anyone can remember.

**THEO:**
And six months later someone loses a day to it. So instead: the version control is built once, in a way that's *blind* to what kind of document it's holding. It deals in "recipes" abstractly. A part is a recipe, an assembly is a recipe, and the version control treats them the same. Same for measurement. Same for the 3D viewer. Same for the File menu. You learn it once as a *user*, too — the save button, the version history, the way you measure things — it's all the same whether you're in a single part or a giant assembly. Nothing to learn twice. Nothing to maintain twice.

**MAYA:**
And *that's* the callback. The four tools on one bench. You weren't being cute. They genuinely share the bench — the same surface, the same lighting, the same drawers — because the bench, the shared machinery, was built once and the four tools just reach into the same drawers.

**THEO:**
That's the whole reason I picked that metaphor in segment two and then refused to explain it. Four tools, one bench. The bench is the shared machinery — the viewer, the version control, the measurement, the regeneration heartbeat. The four tools are modeler, kernel, version control, assembly. And they share the bench so completely that an assembly is, almost, just "a part whose features happen to be other parts."

**MAYA:**
Okay, that last line is going to live in my head. "An assembly is a part whose features are other parts."

**THEO:**
It's a slight oversimplification — please, the assembly people, don't email me — but as a *mental model* for a newcomer, it's exactly right, and it's why the unification works. At the level of "a recipe that regenerates into geometry, that gets versioned, that gets measured, that gets released" — a part and an assembly are the same animal. So treat them as the same animal. One bench.

**MAYA:**
And honesty clause, because you promised — is there a cost to this unification? Forcing two things to be one is usually not free.

**THEO:**
There's always a cost, yeah. The cost is up-front design discipline. To make version control "blind" to whether it's holding a part or an assembly, you have to find exactly the right abstraction — the precise seam where "what's the same" cleanly separates from "what's different." Get that seam wrong and you end up with a tangle of special cases — "if it's an assembly, do this; if it's a part, do that" — smeared through code that was supposed to be shared, and now it's worse than just writing two. So the unification is only a win *if* you find a clean seam. We did, mostly. There are a couple of spots where an assembly needs the machine to do something a part never would, and those are handled by the thin adapter, which is exactly where that difference *should* live. But it took real care to get the boundary in the right place. It's not free. It's just worth it.

**MAYA:**
"A clean seam." That's the season-two episode on architecture, isn't it.

**THEO:**
That is precisely the architecture episode. Where the seam is, why it's there, what it cost to find it, and the two or three places where it's a little messier than I'd like. But that's the deep dive. For today, the headline is just: one bench, four tools, parts and assemblies are the same animal, and the shared machinery is *written once*.

**MAYA:**
I think that's the episode. Let me recap.

## Recap

**MAYA:**
Okay. Four things I want you, the listener, to walk away holding. If you forget everything else, keep these.

One. **Geometry is a recipe, not a file.** This is the keystone, and it's the thing that broke my brain at the top. When you save a part, you do not save the shape. You save an ordered list of instructions — sketch this, extrude that, cut a hole, round these edges — and the system rebuilds the actual shape, fresh, every time you open it. The recipe is called the *feature tree*, and the reason it's worth re-baking from scratch is that it captures *living design intent* — change an early step, and everything downstream reflows automatically. Change step two, everything rebuilds. The file is a photograph; the recipe is the blueprint plus the reasoning.

Two. **Regeneration is the heartbeat.** Everything you ever see on screen is the output of *replaying that recipe* into displayable geometry. Resolve the equations, walk the feature tree top to bottom, ask the kernel for any step you haven't cached, get back exact shapes plus their triangle costumes for the graphics card. Opening a part, editing a parameter, undoing, switching revisions — it's all the *same loop*, every time. Thump, thump, thump. And a cache keeps it fast by only re-cooking what actually changed.

Three. **It's a workbench with four tools.** The *modeler* is the kitchen where you write the recipe by sketching and stacking features. The *kernel* is the separate, heavy-duty engine — the hot pan — that does the brutal geometry math. *Version control* is the time machine and filing cabinet that snapshots, branches, and freezes your work, tying released geometry to an official part revision. And *assemblies* are where finished parts snap together with a mate solver figuring out exactly where everything sits.

Four. **And the punchline — parts and assemblies are the same app, written once.** Same editor, same viewer, same measurement, same version control. The only thing that differs is the shape of the recipe — features-stacked-into-one-shape versus parts-related-to-each-other — and a thin adapter handles that difference. Everything else, the whole expensive shared machine, is built exactly once. One bench, four tools, and an assembly is almost just a part whose features happen to be other parts.

**THEO:**
I would not change a word. And the through-line under all four: this whole thing exists so that a part's *shape* lives in the *same database*, on the *same revision workflow*, as everything else the manufacturing app already knows about that part. No stale files. No "which `.sldprt` is revision B." One source of truth.

**MAYA:**
Vibes and a filename, defeated.

**THEO:**
Vibes and a filename, defeated.

## Teaser

**MAYA:**
Next time, we go down into the engine room. The kernel. The hot pan. The separate program in the strange language that does the geometry math we've been hand-waving at all episode — actually computing the cylinder when you say "extrude," actually figuring out where two solids overlap when you cut a hole, actually rounding an edge into a true fillet.

**THEO:**
And I get to talk about why a sphere is genuinely hard, why "round this edge" is a request that can fail in ways that'll surprise you, and why we picked a thirty-year-old industrial geometry library and a brand-new systems language to do it. And, yes, I will finally be allowed to talk about Rust, and Maya will finally not be able to stop me.

**MAYA:**
I'm bringing a stopwatch. Episode two: the geometry kernel — the engine room. We'll see you there.

---

# Episode 2 — The Engine Room: The Geometry Kernel

## Cold open

**MAYA:**
Okay, I want to start with a confession. Last week I spent twenty minutes in a CAD program rounding the corner of a little plastic bracket. Just one edge. I clicked the edge, I typed in "two millimeters," and this beautiful smooth round corner appeared. And I sat there thinking — I have absolutely no idea what just happened. Like, what *is* that round corner, underneath? Is it a picture? Is it a number? Is it a tiny lie my computer is telling me to make me feel good?

**THEO:**
[laughs] It is sort of a tiny lie. But a very principled one.

**MAYA:**
See, that's the most ominous possible answer.

**THEO:**
Here's the thing. When you rounded that edge, your CAD program didn't do the rounding. It can't. It doesn't know how. It sent a little message off to a completely separate program — a different piece of software, running on its own, whose *entire job* is to do nothing but the heavy geometry math. And that program figured out the exact mathematical shape of your round corner, built it, and sent the finished thing back.

**MAYA:**
Wait. So the thing I'm looking at, the thing I'm clicking on — that's not even the thing doing the work?

**THEO:**
The thing you're clicking on is basically a very pretty waiter. It takes your order, walks it back to the kitchen, and the kitchen cooks. Today I want to take you into the kitchen.

**MAYA:**
The engine room.

**THEO:**
The engine room.

## Intro

**MAYA:**
Welcome back to the show. If you're just joining us — this is a series where we take apart one real piece of software, top to bottom. It's a browser-based CAD system. Computer-aided design. You draw parts, you model them in 3D, you snap them together into assemblies, and the whole thing is bolted onto a manufacturing inventory app that a real shop actually uses to build things.

Last episode — Episode 1 — we did the big picture. The thirty-thousand-foot view. We talked about what parametric CAD even means, how you sketch a shape and then turn it into a solid, and how the system is built out of these separable pieces that each do one job.

**THEO:**
Right, and one of those pieces — we kept gesturing at it and saying "we'll get to it." That was the geometry kernel. The part that actually does the solid-shape math.

**MAYA:**
And today we get to it. So my goal for this hour is: by the end, when I round an edge, I want to actually know what happened. Not the equations — I don't need the equations — but the *story*. Where does my click go, what does it become, who does the work, and what comes back.

**THEO:**
That's a good frame. And I'll warn you up front, there are a couple of places where the honest answer is "it's an approximation" or "this part's a little janky and we know it." I'm not going to hide those. The approximations are kind of the most interesting part.

**MAYA:**
Good. I like a system that admits its flaws. Let's go to the kitchen.

## Segment 1 — A shape is just math

**MAYA:**
Start me at the very bottom. Before any program, before any kitchen. What *is* a 3D shape, to a computer?

**THEO:**
Let me ask you a question back first. If I say "draw me a circle," and you've got a pencil, what do you do?

**MAYA:**
I... draw a circle. I move the pencil around in a loop.

**THEO:**
You move it around in a loop. So your circle is a path. It's a million little pencil positions. But that's not how a mathematician thinks about a circle, and it's not really how a CAD kernel thinks about one either. To a mathematician, a circle is just: a center point, and a radius. Two pieces of information. "Everything exactly five millimeters away from *this* point." That's the whole circle. You don't need to store a million pencil positions — you need to store a point and a number, and the *rule*.

**MAYA:**
Okay, so the circle isn't a drawing. It's a recipe for a drawing.

**THEO:**
It's a recipe. And that distinction is the entire ballgame, honestly. Because a recipe is exact. If I tell you the center and the radius, you can find any point on that circle, as precisely as you want, forever. There's no resolution limit. Whereas a drawing — a bunch of stored pencil positions — is only as good as how many positions you bothered to save.

**MAYA:**
So scale that up. A circle is a point and a radius. What's a 3D part? My little plastic bracket?

**THEO:**
Same idea, just layered up. A flat face on your bracket isn't a bunch of stored points — it's a plane, which is also a recipe: a point it passes through, and a direction it faces. A round hole isn't a fan of triangles — it's a cylinder, which is, what, a centerline and a radius. And then the shape as a whole is the collection of all those surfaces, plus information about how they're stitched together at the edges. Where face A meets face B, that shared boundary is an edge. Where three faces come together, that's a corner — a vertex.

**MAYA:**
So the part is like... a quilt? A bunch of mathematically-perfect patches, and you know which patch is sewn to which.

**THEO:**
That is a genuinely good description of what's called a *boundary representation*. Which is the formal term, and I promise I'll only make you learn a couple of those today. Boundary representation — people say "B-rep" — means you describe a solid object by describing its *boundary*. Its skin. The surfaces, the edges where surfaces meet, the corners where edges meet. You don't describe the inside. There's no "stuff" in the middle stored anywhere. The object is defined entirely by its outer shell, the same way a balloon is defined by its rubber, not by the air.

**MAYA:**
But it knows it's solid? Like, it knows there's a difference between a brick and a hollow box that looks like a brick from the outside?

**THEO:**
Yes, and that's an important distinction. The B-rep doesn't just store the surfaces, it stores which side is "inside the material" and which side is "outside." Every face has an outward direction — a normal, it's called, the direction pointing away from the material. So the kernel knows that for a solid brick, all the faces point outward and there's material behind every one of them. A hollow box would have inner faces too, pointing the other way. It's a fully closed, watertight skin with a clear inside and outside.

**MAYA:**
Watertight. Meaning no gaps.

**THEO:**
No gaps. If you imagine pouring water into it, it wouldn't leak. Every edge is shared by exactly the faces that should share it, everything closes up. That "watertight" property is huge, because the moment there's a tiny crack — two faces that almost meet but don't quite — a lot of the math downstream falls apart. The kernel works very hard to keep shapes watertight.

**MAYA:**
Okay. So in my head now: a shape is a quilt of perfect mathematical patches, watertight, with a clear inside and out, and each patch is a *recipe* — exact, no resolution limit. That's the thing living in the kitchen.

**THEO:**
That's the thing living in the kitchen. And now here's the punchline you're going to feel the rest of the episode: the beautiful exact recipe is *not* what you see on your screen.

**MAYA:**
Of course it isn't. Why would anything be simple.

**THEO:**
[laughs] We'll get there. Hold that thought — it's the tiny lie from the cold open.

## Segment 2 — Why a whole separate program

**MAYA:**
So let's talk about the kitchen being a separate building. Because this surprised me. I assumed the CAD program was just... one program. It's an app, it does CAD. Why is the geometry off in its own thing?

**THEO:**
A few reasons, and they stack up into a pretty strong case. The first one is just: this math is *heavy* and it's *specialized*. Computing the exact shape of a rounded edge — where two curved surfaces blend into each other with a rolling-ball fillet — that's genuinely hard mathematics. People have spent careers on it. You do not want to write that yourself.

**MAYA:**
So you didn't write it yourself.

**THEO:**
God, no. Almost nobody writes their own geometry kernel from scratch. It's one of those things, like writing your own database or your own encryption — technically possible, professionally insane. So the kernel here is built on top of an existing industrial geometry library called OpenCASCADE. People abbreviate it OCCT.

**MAYA:**
And this is — what, an off-the-shelf thing?

**THEO:**
It's a big, mature, open-source geometry library that's been around for decades. It came out of a commercial CAD system originally. And the reason that matters for our story is: it's the *same class of engine* that sits underneath professional CAD tools. When you hear about FreeCAD, the open-source CAD program — that's OpenCASCADE underneath. It is genuinely industrial-strength geometry. So this little browser CAD app is standing on the shoulders of a serious, battle-tested geometry library. It is not a toy that someone reimplemented over a weekend.

**MAYA:**
Okay, that reframes it for me. The "kitchen" is staffed by a chef who's been cooking for thirty years. You didn't hire a kid.

**THEO:**
Exactly that. And we wrapped that thirty-year-old chef in a thin layer of our own code so the rest of the system can talk to it cleanly. That wrapper is written in a language called Rust.

**MAYA:**
Why Rust specifically? I know it's trendy. Is that the reason?

**THEO:**
[laughs] No, although it is trendy. Two real reasons. One is speed. Rust is what's called a systems language — it compiles down to fast native code, no slow middle layer, which matters because geometry is computationally expensive and people are sitting there waiting for their shape to appear. You don't want a half-second of lag every time someone drags a dimension.

**MAYA:**
And the second reason?

**THEO:**
Safety. And this one's subtle but it's actually the more important one. Geometry code deals with enormous, intricate data structures — all those faces and edges and pointers between them — and in a lot of older languages, if you make one mistake managing all that memory, the whole program corrupts itself or crashes in a way that's almost impossible to debug. Rust has this property where the compiler refuses to let you make that whole category of mistake. It checks your work before the program ever runs. So the language itself is acting as a safety net under code that's juggling chainsaws.

**MAYA:**
Okay but here's my pushback. You've now given me reasons the kernel is written in Rust. You haven't actually told me why it has to be a *separate program*. You could write a fast, safe thing and still have it be part of the main app, right?

**THEO:**
Fair. That's the real question and the answer is one word: isolation.

**MAYA:**
Isolation.

**THEO:**
Geometry kernels crash. Not because they're bad — because the problem space is brutal. You ask it to round an edge with a radius that's physically too big to fit, and the underlying OpenCASCADE math can hit a state it genuinely cannot resolve, and in the worst case it doesn't politely return an error — it hard-crashes the process it's running in. Takes the whole thing down with it.

**MAYA:**
Ohh. So if it were part of the main app —

**THEO:**
— it takes the main app down with it. Your whole CAD session, gone, because you typed a slightly-too-big fillet radius. That's a catastrophic user experience. But if the kernel is a *separate* program, in its own little walled-off process, then when it falls over, it falls over *alone*. The main app notices the kitchen went dark, calmly relights it, and tells you "hey, that operation failed, try a smaller radius." You don't lose your work. You barely notice.

**MAYA:**
So the wall between the buildings isn't bureaucracy. The wall is a blast wall.

**THEO:**
The wall is a blast wall. That's exactly right. And there's actually a piece of the system whose whole job is to stand outside the kitchen and watch it. If it sees the kitchen catch fire and go dark, it relights it automatically. The kernel respawns. So even crashes are mostly invisible — the supervisor brings it right back up.

**MAYA:**
Okay, I'm sold on the separation. Blast wall, fast and safe Rust wrapper, thirty-year-old chef named OpenCASCADE inside. Now I want to know how the order actually gets from the dining room to the kitchen.

## Segment 3 — Ordering from the kitchen

**THEO:**
So this is where I want to lean all the way into the restaurant thing, because it really does map.

**MAYA:**
Lean in. I'm hungry now anyway.

**THEO:**
[laughs] When the main app needs some geometry, it does not walk into the kitchen and start cooking. It writes a little order ticket. A small, structured message that says exactly what it wants. Something like: "Operation: extrude. Profile: this outline. Distance: ten millimeters." That's the whole ticket. It's tiny. It's just the instruction and the numbers.

**MAYA:**
And it sends that ticket... how? Like, physically, what's the mechanism?

**THEO:**
There's a standard, boring, reliable way for two programs to pass structured messages back and forth, and it's called JSON-RPC. You don't need to remember that. JSON is just a tidy text format for writing down structured data — labels and values, "distance, ten." And RPC stands for "remote procedure call," which is a fancy way of saying "ask a different program to run a function for you and give you the answer back."

**MAYA:**
So it's like... the order ticket is written in a standard handwriting that both the dining room and the kitchen can read.

**THEO:**
Yes. And critically, it's a *little* ticket going in and a *finished dish* coming out. The order says "extrude this outline ten millimeters" — that's a few hundred characters of text. And what comes back is the entire finished 3D shape. The kitchen did all the work. The dining room never touched a knife.

**MAYA:**
Now I want to press on "the entire finished 3D shape," because back in segment one you told me the shape is this beautiful exact recipe — the quilt of perfect math patches. Is *that* what comes back? Does the dining room get the recipe?

**THEO:**
[pause] This is the moment. This is the tiny lie.

**MAYA:**
Oh, here we go.

**THEO:**
So, two things come back, and you need to hold both of them in your head, because they are different and the difference is the whole rest of CAD. The first thing that comes back is the exact recipe — the real B-rep, the perfect mathematical shape. That gets returned in a compact, serialized form. Think of it as the chef's actual written recipe card, sealed in an envelope. The app stores that. It's the source of truth.

**MAYA:**
Okay. And the second thing?

**THEO:**
The second thing is a version of the shape you can actually *draw on a screen*. And here's the problem: your screen, and the graphics hardware behind it, only really know how to draw one thing. Flat triangles. That's it. That's the entire vocabulary of 3D graphics. Every video game, every 3D movie, every CAD viewport — it's all triangles, all the way down. The hardware is a triangle-drawing machine.

**MAYA:**
But my round hole isn't made of triangles. It's a cylinder. It's a perfect recipe.

**THEO:**
Right! And the screen can't draw a perfect cylinder. So the kernel takes that perfect cylinder and *approximates* it — it covers it in a bunch of little flat triangles that, from a distance, look round. Like a geodesic dome looks round but is actually made of flat panels. That process is called tessellation. The kernel tessellates the perfect shape into a mesh of triangles, and *that* triangle mesh is what gets sent to your screen and what you're actually looking at.

**MAYA:**
So when I'm staring at my smooth rounded corner —

**THEO:**
You're staring at a bunch of tiny flat triangles arranged to *look* smooth. The actual smooth thing — the real fillet — lives back in the kitchen as a perfect recipe in a sealed envelope. The screen is showing you a faceted impostor. A very, very good impostor.

**MAYA:**
The tiny principled lie.

**THEO:**
The tiny principled lie. And here's why it's principled and not just a cop-out. The triangles are *only* for your eyes. They're for drawing. Every time the system needs to do something *real* — manufacture the part, export it to another CAD program, do precise math on it — it goes back to the exact recipe, not the triangles. The triangles are a display convenience. The recipe is the truth. The system never confuses the two.

**MAYA:**
So there's a "what you see" and a "what's true," and they're deliberately kept separate.

**THEO:**
Deliberately, surgically separate. The triangle mesh you see is called the boundary representation's *tessellation*. The boundary representation itself — the math — is the part that matters when it's time to actually build the thing. And the kernel maintains both and keeps them in sync.

**MAYA:**
How rough are the triangles? Like, is it noticeably faceted?

**THEO:**
There's a setting for that, and it's a genuine tradeoff, so let me actually do it justice. It's called the chord tolerance. The idea is: how far is the flat triangle allowed to stray from the true curved surface before you say "no, that's too rough, add more triangles"? In this system that tolerance is set very small — five hundredths of a millimeter. So the triangles hug the real curve to within a fraction of a hair. On screen it looks perfectly smooth.

**MAYA:**
And the tradeoff is?

**THEO:**
Tighter tolerance means more triangles, which means more data to push around and more for the graphics card to draw. Looser tolerance means fewer triangles, faster, but you start to see the facets — the circle looks like a stop sign. So you pick a number that's smooth enough for the eye but not so dense it bogs down. And there's a subtle bonus reason this particular number was chosen: it matches the tolerance the *sketch* side of the app uses when it draws your 2D outlines. So the flat sketch and the 3D solid agree about where a curve is, down to the same fraction of a millimeter. They speak the same dialect of "round."

**MAYA:**
That's a nice detail — the two halves of the app rounding curves the same way so they don't disagree at the boundary.

**THEO:**
It's the kind of thing nobody notices when it's right and everybody notices when it's wrong. If they used different tolerances, you'd get these tiny visual mismatches where the sketch and the solid don't quite line up, and it would look like a bug even though everything's "correct." Matching the numbers makes the seam invisible.

## Segment 4 — The vocabulary of verbs

**MAYA:**
Okay. I want the menu now. You keep saying "operations" — extrude, boolean, all that. Give me the menu. What can the kitchen actually cook?

**THEO:**
I love this part because it's genuinely small. The number of fundamental things the kernel knows how to do is, like, seven or eight. And almost every part you've ever seen — every phone case, every engine block, every Lego brick — is some combination of these seven or eight verbs. It's a tiny vocabulary that composes into infinite things. Like how a handful of Lego shapes makes anything.

**MAYA:**
Give me the verbs. And I want an analogy for each one, because that's how my brain keeps things.

**THEO:**
Deal. Verb one: extrude. This is the foundational one, the one you learn first. Extrude means: take a flat outline and push it straight out to give it thickness. You draw a circle, you push it out, you get a cylinder. You draw a star, you push it out, you get a star-shaped prism. It's a cookie cutter in reverse — instead of pressing a shape *down* into dough, you're pulling the outline *up* into a solid.

**MAYA:**
Toothpaste. You squeeze the outline of the tube opening and a solid string of toothpaste comes out in that shape.

**THEO:**
Toothpaste is perfect, actually — "extrude" literally comes from the same root as pushing material out through a shaped opening. That's exactly the mental model. And it's the most-used verb by far. A huge fraction of all parts start as "draw an outline, extrude it."

**MAYA:**
Okay, verb two.

**THEO:**
Revolve. Instead of pushing an outline in a straight line, you *spin* it around an axis. Imagine you draw the side profile of a wine glass — just the silhouette, the outline of one side — and then you spin that outline a full turn around a vertical center line. It sweeps out the whole glass. Anything round-and-symmetric — a bottle, a vase, a shaft, a wheel, a chess pawn — is a revolve.

**MAYA:**
A potter's wheel. You've got the profile, you spin it, the 3D shape appears as it goes around.

**THEO:**
A potter's wheel is exactly right, and it's even the right *physics* — the potter shapes the silhouette and rotation does the rest. There's a fun little gotcha in revolve, actually, that tells you something about how careful this stuff has to be.

**MAYA:**
Tell me the gotcha. I love a gotcha.

**THEO:**
So when you revolve a full turn — all the way around, three hundred sixty degrees — the start of the spin and the end of the spin land in exactly the same place. They meet back up. And there are two ways to ask the kernel to do that. You can say "revolve it three hundred and sixty degrees," or you can say "revolve it all the way, full closed loop." Those *sound* identical. They are not.

**MAYA:**
Why not? Three sixty is all the way around.

**THEO:**
Because if you say "three hundred sixty degrees" as a number, the kernel dutifully spins from zero to three sixty — and at the end it leaves behind a little seam. A faint visible line right where the start edge and the end edge meet, because mathematically it treated them as two separate edges that happen to overlap. But if you say "full closed revolve," the kernel knows to just... close the loop seamlessly. No seam. One smooth continuous surface.

**MAYA:**
So you have to tell it "no, really, all the way around" in the special way, or you get a scar on your wine glass.

**THEO:**
A scar on your wine glass. And the system specifically uses the seamless way for full revolves for exactly this reason. It's a one-line distinction that's the difference between a clean part and one with a phantom line down the side. That's the texture of kernel work — it's full of these "technically the same, visually completely different" forks.

**MAYA:**
Okay, that's a great gotcha. Verb three.

**THEO:**
Sweep. Sweep is the cousin of extrude. Extrude pushes an outline in a straight line. Sweep pushes an outline along *any path you draw*. A curvy path. So you draw a circle, and then you draw a wiggly path through space, and the circle follows the path, and you get a bent pipe. Or a garden hose. Or a wire snaking through a harness.

**MAYA:**
So extrude is "push straight," sweep is "push along this squiggle."

**THEO:**
Right. Toothpaste again, but now you're moving the tube around while you squeeze, so the toothpaste follows your hand. There's a nice engineering detail here too — sweeping around sharp corners is genuinely hard. The naive way of doing it chokes the moment the path has a hard ninety-degree bend in it. So this system specifically uses the more forgiving method that handles sharp corners gracefully, because real parts — wires, brackets, tubing — have sharp bends all the time.

**MAYA:**
Good. They picked the version that survives contact with reality. Verb four.

**THEO:**
Boolean. And this one — this is the one that makes people fall in love with CAD, honestly. Boolean operations combine two solids three different ways. You can *fuse* them — glue two shapes into one. You can *cut* — use one shape to carve a chunk out of another, like a cookie cutter pressing through dough and taking the dough shape with it. Or you can take the *intersection* — keep only the chunk where the two shapes overlap, and throw away everything else.

**MAYA:**
Okay walk me through "cut" with a real thing, because that's the one I use without realizing it.

**THEO:**
Every hole you've ever seen in a part is a cut. You make a cylinder — that's your drill bit — you position it through your block, and you tell the kernel "subtract the cylinder from the block." And the block now has a perfectly round hole through it, with new round inner faces the kernel created where the material got removed. You never drew the hole. You drew a cylinder and subtracted it.

**MAYA:**
That is genuinely how I think about drilling. You don't add a hole, you remove a cylinder of material.

**THEO:**
That's the deep thing booleans teach you — a hole isn't a thing, it's an *absence*, and you make absences by subtracting shapes. The system calls this feature "Combine," and it deliberately matches how the big professional tools do it, so people coming from SolidWorks feel at home. You point at a target body, point at one or more tool bodies, pick fuse, cut, or intersect, and the kernel does it. And there's a neat wrinkle: if a cut happens to slice a body clean into two separate pieces, the kernel notices and hands you back *two* bodies. It tracks the split.

**MAYA:**
Oh that's smart. Like if I cut a donut in half, I get two half-donuts, not one weird thing.

**THEO:**
Exactly. It re-counts the separate solid chunks after every boolean and gives you each one as its own trackable body. Verb five: pattern.

**MAYA:**
Pattern. As in repeating?

**THEO:**
Repeating, yeah. Pattern is the lazy-genius verb. Say you've got a plate and you need a hundred bolt holes around the rim, evenly spaced. You do not drill a hundred holes by hand. You make *one* hole, and then you tell the kernel: "pattern this — copy it a hundred times, evenly, around this circle." And it stamps out all hundred copies. There's a linear version — copies in a straight row, like a fence. A circular version — copies around a center, like the numbers on a clock face. And a mirror version — reflect a shape to the other side, like the left and right halves of a car.

**MAYA:**
A rubber stamp. You ink it once and stamp the pattern.

**THEO:**
A rubber stamp is great. And the parametric magic — which we talked about last episode — is that the pattern stays *live*. You can go back and change "a hundred copies" to "a hundred and twenty," or change the spacing, and every copy updates. You set up the rule once, and you can re-dial it forever.

**MAYA:**
The mirror one is interesting to me — that's not really "copies," that's a reflection.

**THEO:**
It's a reflection, right, and it's its own thing because so many real objects are symmetric. You model the left half of something, you mirror it, you get a guaranteed-perfect right half. Free symmetry. The kernel handles all three — translate, rotate, reflect — under the one "pattern" umbrella, takes your shape, makes the copies, and fuses them into the body. Verb six: shell.

**MAYA:**
Shell. Like hollowing out?

**THEO:**
Hollowing out. You've got a solid block, and you want to turn it into an open box — thin walls, hollow inside. Shell does that in one move. You tell the kernel "hollow this out to a wall thickness of two millimeters, and leave the top face open," and it scoops out the inside, leaving you a two-millimeter-walled box with an open top.

**MAYA:**
That's the chocolate bunny, right? Solid chocolate is expensive and heavy. The hollow bunny is the same shape outside, thin chocolate, empty inside.

**THEO:**
The chocolate bunny is *the* canonical shell example, I'm not even going to try to top it. Every plastic enclosure — your remote control, a phone case, a Tupperware — is a shell. You design the solid outer form, then you shell it to make it a thin-walled hollow part that's cheap to manufacture and light. And you choose which faces to remove — the open ones — so the bunny has a hole in the bottom and the Tupperware is open at the top.

**MAYA:**
There's gotta be a gotcha in shell. You hollow something with walls thicker than the thinnest part of the shape, and...

**THEO:**
You've got good instincts. Yeah — if you ask for walls thicker than the geometry can actually support, the math becomes impossible. There's nowhere to put the inner wall. And the honest answer is the kernel detects that, validates the result, and if it came back malformed it refuses it and gives you a real error instead of handing you a broken shape. That validation step matters — there are cases where the underlying library *thinks* it succeeded but actually produced garbage, and there's an explicit check that catches that and rejects it.

**MAYA:**
So it double-checks the chef's work before sending the plate out.

**THEO:**
It double-checks the plate. Sends it back to the kitchen if it's wrong. And the last verb — the one from your cold open. Fillet and chamfer. Edge treatments.

**MAYA:**
My rounded corner. Finally.

**THEO:**
Your rounded corner. So a fillet is a *round* — you pick a sharp edge and you replace it with a smooth rolling curve. The mental image they actually use internally is a rolling ball. Imagine a ball of a certain radius rolling along the inside of your sharp edge, hugging both faces. The surface that ball traces out — that's your fillet. Roll a two-millimeter ball along the edge, you get a two-millimeter round.

**MAYA:**
Oh, I love that. The ball *is* the radius. The corner is just wherever the ball can reach.

**THEO:**
The ball is the radius. It's a beautiful way to think about it because it instantly explains the gotcha: if your ball is bigger than the faces it's supposed to roll along, it doesn't fit, and the fillet fails. A too-big radius is literally a ball that can't fit in the corner. And a chamfer is the same idea but instead of a round, you get a flat angled cut — a bevel. Like the slightly angled edge on a tabletop, or the way a countertop edge is cut at forty-five degrees so it's not a sharp ninety.

**MAYA:**
And why do we even round edges? Is it just so they look nice?

**THEO:**
Looks are part of it, but mostly it's physical. Sharp edges are weak — they concentrate stress, they're where cracks start. Sharp edges are sharp — they cut people, which is bad for a handheld product. Sharp edges don't take paint or coating well. And in manufacturing, the tools that cut metal physically can't make a perfectly sharp inside corner anyway — there's always some radius. So fillets and chamfers are everywhere in real parts, and they're usually the *last* thing you add — you model the whole shape, then go around softening the edges.

**MAYA:**
There were three kinds of chamfer, I saw in your notes — I'm curious what the three are, briefly.

**THEO:**
Quick version. You can specify a chamfer three ways. One — equal: cut the same distance back on both faces, which gives you a clean forty-five degrees. Two — two distances: cut farther on one face than the other, for an asymmetric bevel. Three — distance and angle: cut this far on this face, at this specific angle. Same bevel, three different ways to pin down its exact shape, depending on what the designer cares about. It's just giving you different handles on the same idea.

**MAYA:**
Okay. So that's the menu. Extrude, revolve, sweep, boolean, pattern, shell, fillet, chamfer. Eight verbs.

**THEO:**
Eight verbs and you can build a shocking amount of the manufactured world. And every single one is one of those little order tickets — "fillet, these edges, two millimeters" — going to the kitchen, and a finished shape coming back. The app's whole job, in a sense, is just deciding *which* ticket to write and what numbers to put on it.

## Segment 5 — The two clever bits

**MAYA:**
So if the kernel were *just* those eight verbs, it'd be a very good calculator. But you teased at the top that there are two things that make it more than a calculator. I want those.

**THEO:**
These are the two that I think are genuinely the soul of the thing, yeah. And they're both about *memory* and *meaning*, not about geometry per se. The first one is persistent names.

**MAYA:**
Persistent names. Names of what?

**THEO:**
Names of faces. Of every surface on your part. So picture this scenario, because it's the whole reason this exists. You make a block. It's got six faces. You pick the top face and you put a fillet on its front edge. Great. Now you go back to an *earlier* step — say the block was twenty millimeters tall and you decide you want it thirty millimeters tall. You change that one number.

**MAYA:**
And the part rebuilds. Parametric, like last episode.

**THEO:**
The part rebuilds from scratch. The kernel re-runs all your operations from the beginning with the new number. Brand new block, brand new faces. And here's the problem — here's the thing that'll keep you up at night once you see it. The fillet you put on "the front edge of the top face" — how does it know where to go on the *new* block? The new block's faces are technically all-new geometry. The kernel made them fresh. If the system just numbered the faces "face one, face two, face three" in the order they happened to come out...

**MAYA:**
...the numbers might come out in a different order the second time, and your fillet lands on the wrong edge.

**THEO:**
Your fillet jumps to a random edge, or vanishes, or lands on the bottom. This is the single most notorious problem in all of parametric CAD. It has a name — people call it the "topological naming problem" — and it has ruined many an afternoon. You change something innocent upstream and suddenly features halfway down your part are flailing around because they lost track of which face they were attached to.

**MAYA:**
So how does this system not do that?

**THEO:**
It gives every face a *persistent name*. A durable identity that's tied to *which feature created it and what role it plays*, not to the random order it came out of the math. So a face isn't "face number four." A face is something more like "the side face produced by the third extrude feature." That's a description that survives a rebuild. When you make the block taller, the side faces are *still* "the side faces produced by that extrude," even though they're geometrically brand new. The name carries the meaning across.

**MAYA:**
So it's the difference between calling someone "the fourth person who walked into the room" versus "Maya." If everyone leaves and comes back in a different order, "the fourth person" points at a stranger. "Maya" still points at me.

**THEO:**
That is exactly it. That's a perfect framing. The persistent name is the proper name. It sticks to the thing across the chaos of a rebuild. And it's not just a convenience — it's load-bearing. Your fillet *remembers* the named edge it was placed on. The system's ability to color in what changed between two versions of a part *depends* on faces having stable names so it can tell "this is the same face, it just moved" from "this is a brand new face." Selections, feature targeting, the visual diff between versions — all of it rides on persistent naming.

**MAYA:**
When you said "what role it plays" — for an extrude, what are the roles?

**THEO:**
For an extrude specifically, the kernel looks at each face it made and asks: is this the bottom cap, the top cap, or a side? It figures that out by checking where the face's center sits along the push direction — bottom cap is at the start, top cap is at the far end, everything else is a side. So the names come out meaning "top cap of extrude three," "side of extrude three." Real, role-based names. Not positional accidents. And there's a version number baked into the naming scheme, so if the rules ever change, the system knows to recompute old names rather than trust stale ones.

**MAYA:**
Okay. So persistent names — the faces remember who they are across rebuilds. That's clever bit one. What's clever bit two?

**THEO:**
Surface classification. And this one's all about setting up the *next* episode and the assembly stuff, so let me build it carefully. Remember the tiny lie — the screen shows you triangles, but the real shape is a recipe?

**MAYA:**
The faceted impostor, yeah.

**THEO:**
So here's a problem that creates. Suppose I want to put a bolt through a hole. I want the bolt's shaft to sit *perfectly centered* in the hole — coaxial, sharing the same centerline. To do that, the system needs to know the hole's exact centerline and the shaft's exact centerline, and line them up. Now — can the triangle mesh tell you the hole's exact centerline?

**MAYA:**
No. The triangle mesh is just... a bunch of flat triangles arranged in a rough circle. There's no "centerline" stored anywhere. You'd have to guess it from the triangles.

**THEO:**
And guessing it from the triangles is garbage — it wobbles, it's approximate, it depends on how the triangles happened to land. You'd never get a clean coaxial fit. So the mesh, for this job, is *useless*. You need the real number. You need the actual cylinder's actual centerline and actual radius, from the exact recipe.

**MAYA:**
So surface classification is the kernel digging the real numbers out of the recipe and handing them over separately?

**THEO:**
That's exactly what it is. When the kernel finishes a shape, for every face, it asks OpenCASCADE one question: "what *kind* of surface is this, really?" And if the answer is "it's a flat plane," the kernel records where that plane sits and which way it faces — its origin and its outward direction. If the answer is "it's a cylinder," it records the centerline — where it is, which way it points — and the radius. And it attaches those exact analytic numbers to the face, riding alongside the triangles.

**MAYA:**
So every face carries two things now. The triangles, for your eyes. And, if it's flat or round, the exact numbers, for the math.

**THEO:**
For the math. For lining parts up. The triangles are for *looking*, the classification is for *fitting*. And the reason it only bothers with flat and cylindrical — planes and cylinders — is delightfully pragmatic. Those are exactly the two kinds of surface the assembly tool needs to snap parts together. Two flat faces sitting flush against each other — that's plane-to-plane. A shaft centered in a hole — that's cylinder-to-cylinder. The overwhelming majority of how mechanical parts mate is one of those two. So the kernel classifies those two and, for anything fancier — a cone, a sphere, a free-form swoopy surface — it just shrugs and skips it. Doesn't waste a byte.

**MAYA:**
That's a nice discipline, actually. Only emit the data something downstream actually consumes.

**THEO:**
It's the whole philosophy in miniature. Don't compute what nobody needs. The flat-and-round classification exists *because* the mate solver eats exactly that and nothing else. If somebody later builds a feature that needs cones, you widen it then. Not before.

**MAYA:**
And — connecting it back — because these numbers come from the exact recipe and not the triangles, they're *stable*. The centerline of my hole is the same precise line whether I'm zoomed way in or way out, and it stays the same line when I change unrelated stuff upstream.

**THEO:**
You just nailed the whole reason it matters. Stability. The triangles change when you zoom — more or fewer of them. The exact centerline does *not*. It's a mathematical fact about the cylinder, not an artifact of how finely you happened to chop it up. So the assembly solver can grab that centerline and *trust* it. Lean its whole weight on it. Even as the part rebuilds and the parameters shift around, "the axis of this hole" stays put as a reliable anchor. And that — that trustworthy anchor — is the bridge to assemblies, which is a whole future episode.

**MAYA:**
So the tease is: persistent names let a *part* remember itself across edits, and surface classification lets *different parts* find each other and snap together.

**THEO:**
That's the one-sentence version, and it's exactly right. Memory within a part, and meaning between parts. Those two clever bits are what turn a geometry calculator into a CAD *system*.

## Segment 6 — The honest notes

**MAYA:**
Okay. Before we wrap, you promised me the warts. The "this part's a little janky and we know it" parts. Because a system with no warts is a system someone's hiding things about.

**THEO:**
[laughs] I respect that deeply. Yeah, there are a few, and they're honest tradeoffs, not embarrassments. Let me give you three.

First one — the separate-program thing we celebrated earlier has a cost. The kernel runs as its own walled-off service, in its own container — think of a container as a little shipping crate that holds one program and all its stuff, kept apart from everything else. That isolation is exactly the blast wall we wanted. But it also means there's *operational overhead*. It's a separate thing that has to be running, has to be reachable, has to be watched. If the kernel isn't up, the CAD app can still let you poke around, but it can't actually build geometry. So there's a little health-check heartbeat that constantly asks "kitchen, you alive?" and the editor lights up or grays out accordingly.

**MAYA:**
So the cost of the blast wall is you now have two buildings to keep the lights on in.

**THEO:**
Two buildings to keep the lights on in. That's the deal. It's worth it — the crash isolation alone pays for it — but it's not free, and I won't pretend it is.

**MAYA:**
Second wart.

**THEO:**
Second one is more of an inside-baseball thing about how we *change* the kernel, but it's a real footgun and it bites. When we update the kernel's code and need to rebuild it — recompile it into a fresh program — that rebuild does *not* happen automatically the way the rest of the app does. The web app, when you change a file, it just hot-reloads, instantly, you see your change. The kernel does not. Somebody has to deliberately, manually rebuild it.

**MAYA:**
Why? Why is it special?

**THEO:**
Because it's this big native compiled program sitting on top of that thirty-year-old industrial library, and rebuilding all of that is slow and heavy — it's not a thing you want firing off every time someone twiddles a file. So it's manual on purpose. But the footgun is: there's a particular case where you change part of the kernel and the build system *doesn't notice* it needs to rebuild, because of how it decides what's stale. So you can think you've updated the kernel and actually be running the old one, and chase a ghost for an hour wondering why your change didn't take.

**MAYA:**
Oof. The worst kind of bug. The one where the thing you fixed isn't even running.

**THEO:**
The absolute worst kind. "Why isn't my fix working" — because your fix isn't *there*, you're running yesterday's kitchen. It's documented, the maintainer knows to watch for it, but it's a sharp edge. Pun fully intended.

**MAYA:**
[laughs] Fully intended. And the third?

**THEO:**
The third one we already met — it's the tessellation tolerance, and I want to come back to it because it's the most *philosophical* wart, in a way. The thing on your screen is always, by definition, an approximation. Those triangles are never the true curve. They're within five hundredths of a millimeter, which is way finer than your eye, way finer than most manufacturing even cares about — but it is *not zero*. The display is forever a hair off from the truth.

**MAYA:**
But you keep telling me the *real* shape, the recipe, is exact.

**THEO:**
The recipe is exact. And that's the resolution to the tension — and it's why I keep harping on "what you see versus what's true." You never manufacture from the triangles. You never measure from the triangles. The triangles are *only* ever for your eyeballs. The instant anything real happens — exporting the part to a standard CAD file to send to a machine shop, doing precise calculations, the actual manufacturing — the system reaches past the triangles and uses the exact recipe. So the approximation is real, but it's quarantined. It lives in the display layer and nowhere else.

**MAYA:**
So the honest statement is: "yes, what you're looking at is approximate, and we are completely fine with that, because we never let the approximation touch anything that matters."

**THEO:**
That's the honest statement, word for word. The approximation is a feature of the *window*, not of the *house*. And once you internalize that — what you see is a faithful-but-approximate rendering of an exact underlying truth — a *lot* of CAD stops being mysterious. The faceting you sometimes catch when you zoom way in isn't a bug, it's the window. The house is fine.

**MAYA:**
There's something almost reassuring about that. The screen is allowed to be a little wrong, because the screen was never the point.

**THEO:**
The screen was never the point. The recipe is the point. The screen is just the most convenient lie we tell your eyes so you can work with the recipe. And honestly? That tradeoff is everywhere in computer graphics, in all of it. We just don't usually get to see the seam as clearly as you do in CAD, where the exact version is sitting right there in the kitchen the whole time.

## Recap

**MAYA:**
Let me try to pull this together, because we covered a lot and I want to know if it actually landed. Stop me if I butcher it.

**THEO:**
Go. I'll heckle if needed.

**MAYA:**
One. A 3D shape, underneath, is not a drawing — it's a *recipe*. A watertight quilt of mathematically-perfect surfaces — flat planes, round cylinders, curves — stitched together at edges, with a clear inside and outside. That recipe is exact, with no resolution limit. That's the boundary representation, the B-rep, and it's the source of truth.

**THEO:**
Clean. Keep going.

**MAYA:**
Two. The heavy geometry math is done by a *separate program* — the kernel — kept in its own walled-off building. It's written in Rust for speed and safety, and it's built on top of OpenCASCADE, the same industrial geometry library that powers professional CAD tools. It's separate mainly for *isolation* — when geometry math crashes, and it does, the blast wall means it crashes alone and a supervisor relights it, instead of taking your whole session down.

**THEO:**
Yep. The wall is a blast wall, not bureaucracy.

**MAYA:**
Three. The app talks to the kernel by sending tiny *order tickets* — "extrude this outline ten millimeters" — and getting back a finished shape. And the finished shape comes back as *two* things: the exact recipe, sealed up for when something real needs to happen, and a *triangle mesh* — the tessellation — which is the faceted impostor your screen actually draws. What you see is approximate; what's true is exact; the system never confuses them.

**THEO:**
The tiny principled lie. You've got it.

**MAYA:**
Four. The kernel knows a small vocabulary of *verbs* — extrude, revolve, sweep, boolean, pattern, shell, fillet, chamfer — and almost every manufactured object is some combination of those eight. And it's smarter than a calculator because of two things: *persistent names*, where every face keeps a durable identity across rebuilds so your fillet doesn't wander off when you change something upstream — that's the "Maya, not the fourth person in the room" thing — and *surface classification*, where it digs the exact centerlines and normals out of the recipe and hands them over, which is what lets parts find each other and snap together later.

**THEO:**
I have nothing to add. That's the episode. Memory within a part, meaning between parts.

**MAYA:**
And the warts: it's a separate service you have to keep running, rebuilding it is manual and occasionally sneaks up on you, and the picture on your screen is forever a hair off from the truth — on purpose, because the truth lives safely in the kitchen.

**THEO:**
Honestly? Better recap than I would've given.

**MAYA:**
I had a good chef.

**THEO:**
[laughs]

## Teaser

**MAYA:**
So next time. We've now got this kernel that turns recipes into shapes, and we've got parts that remember themselves. But here's a thing I keep snagging on. Real design isn't "make the part once and you're done." You change it. You try something, you hate it, you go back. Three people touch the same part. You ship a version and then need to remember exactly what you shipped.

**THEO:**
Yeah. And the way most people handle "I might want to undo this" is, what — save a file called "bracket-final," then "bracket-final-v2," then "bracket-FINAL-actually," then "bracket-FINAL-actually-USE-THIS-ONE"...

**MAYA:**
[laughing] You've seen my desktop.

**THEO:**
Everyone's seen everyone's desktop. So next episode, we get into how this system says "absolutely not" to that whole nightmare. There's a real version-control system underneath these 3D parts — the same fundamental idea that software developers use to track every change to their code, the thing called *git* — except here it's tracking the history of a *shape*. Every version, who changed what, branching off to try an idea and merging it back, releasing a version and freezing it forever so you know precisely what you manufactured.

**MAYA:**
Git. For 3D parts.

**THEO:**
Git for 3D parts. And it turns out that idea — content-addressed history, the thing that makes git work — maps onto solid geometry in a way that is *so* much more satisfying than "bracket-FINAL-actually." That's next time.

**MAYA:**
Can't wait. Thanks for taking us into the kitchen, Theo.

**THEO:**
Anytime. Mind the sharp edges on the way out.

**MAYA:**
[laughs] We'll round those off next quarter. See you next episode.

---

# Episode 3 — Git for 3D Parts: Version Control

## Cold open

**MAYA:**
Okay. I have to start with the thing that broke my brain when you first described this to me, because I don't want to bury it.

**THEO:**
[laughs] Go for it.

**MAYA:**
You took git. The thing programmers use to track changes in code. The thing with the commits and the branches and the merge conflicts that ruin people's afternoons.

**THEO:**
That's the one.

**MAYA:**
And you used it... for *parts*. For physical, three-dimensional, machined-out-of-aluminum *parts*. That's like telling me you used a spreadsheet to run your kitchen sink. Like, why? What does a bracket need with commits?

**THEO:**
So here's the thing I'd push back on — it's not that I "used git." I didn't import git. I built a thing that works the way git works, on purpose, because the problem turned out to be the *same problem*. A part design changes over time. People want to try alternatives. Somebody needs to know, six months later, which exact version of the part actually got built and shipped. That is, beat for beat, the problem version control was invented to solve.

**MAYA:**
But a bracket isn't a thousand lines of text.

**THEO:**
No. But underneath, the design of that bracket *is* data. And the moment it's data, you can do the magic trick: every snapshot is a permanent, fingerprinted save that you can go back to, branch from, or compare against any other one. Forever. Nothing silently changes.

**MAYA:**
Fingerprinted save. Okay. That's the hook, isn't it.

**THEO:**
That's the whole episode.

## Intro

**MAYA:**
Welcome back. This is the show where we take one real, working software system apart on the table and figure out how it actually thinks. If you're just joining us — we're three episodes into a series about a browser-based CAD program. Computer-aided design. The thing engineers use to draw the 3D parts that eventually get manufactured.

In Episode 1 we walked through what the whole system even *is* — a parametric modeler bolted onto a manufacturing inventory app, with a serious geometry engine doing the heavy math in the background. Episode 2 we went down into that geometry engine, the kernel, the part that turns "I want a hole here" into actual solid 3D shape.

Today is a different flavor entirely. Today we're not talking about geometry at all, really. We're talking about *history*. About how the system remembers every version of every part, who changed what, and how it makes sure the version somebody manufactured in March is exactly, provably, the version that got approved.

And my co-host, as always, is Theo, who designed and built this thing and has to sit here while I poke at it.

**THEO:**
Happily. This is genuinely my favorite part of the system, so you're going to have to rein me in.

**MAYA:**
I always do. Let me start with the dumb-but-honest question, because I think a lot of people are thinking it. Parts already have version numbers. Rev A, Rev B, Rev 01. Engineers have been writing those in a little box in the corner of a drawing for a hundred years. Why isn't that enough? Why do you need a whole git for it?

**THEO:**
Because the version number in the box is a *label*, and a label is a promise with nothing behind it.

**MAYA:**
Oof. Okay.

**THEO:**
Think about what "Rev B" actually means in a normal shop. It means somebody, at some point, decided this drawing was different enough from Rev A to deserve a new letter, and they typed "B" in the box. But the letter doesn't *contain* the design. It points at a file sitting on a network drive somewhere. And that file can be opened. It can be edited. It can be saved over. It can get a slightly different copy emailed around. The label says "B" but there is nothing forcing the contents to stay put.

**MAYA:**
So the label and the actual thing can drift apart.

**THEO:**
Constantly. That's the whole nightmare of engineering document control. Half the job is making sure that when someone says "Rev B," everyone is looking at the same bytes. What I wanted — what version control gives you for free — is a world where the version *is* the contents. Where "this version" and "this exact geometry" are the same statement, and can't come apart, ever, because of how the storage physically works.

**MAYA:**
And that's the fingerprint thing.

**THEO:**
That's the fingerprint thing. Should we just go there?

**MAYA:**
Let's go there. That's segment one.

## Segment 1 — The fingerprint that names a thing

**MAYA:**
So. "Content-addressed." That's the phrase in your docs, and it sounds like something you'd hear in a server room. Translate it for me. What does it mean to address something by its content?

**THEO:**
Okay. Let me build it up. Normally, when you save something, *you* pick where it goes. You save a file called `bracket_v2_final_FINAL.cad` into a folder you chose. The name and the location are decisions a human made, and they have nothing to do with what's inside the file.

**MAYA:**
Right, the name is just... whatever I felt like typing.

**THEO:**
Exactly, and that's the problem. The name is a sticky note. Content-addressing flips it completely around. Instead of you naming the thing, the *contents* name the thing. You take everything inside that snapshot — all the data describing the part — and you run it through a math function that chews it up and spits out a fixed-length string of characters. A fingerprint.

**MAYA:**
And that fingerprint is the name.

**THEO:**
That fingerprint *is* the name. The address. If you want that snapshot back, you ask the store, "give me the thing whose fingerprint is this," and it hands it over.

**MAYA:**
Okay, but walk me through why that's better than a sticky note. Slowly. Because right now it just sounds like a weirder, uglier filename.

**THEO:**
[laughs] Fair. Three things fall out of it, and all three are kind of magical. Let me do them one at a time.

First: the name verifies the contents. If I hand you a snapshot and tell you its fingerprint, you can re-run the math yourself on the contents I gave you and check that you get the same fingerprint. If even one number in that design is different — a hole moved by a thousandth of a millimeter — the fingerprint comes out completely different. Not slightly different. Wildly different.

**MAYA:**
Wait, how does a one-thousandth change make a *wildly* different fingerprint? I'd expect a tiny change to make a tiny change.

**THEO:**
That's exactly the property you want, and it's the whole point of these fingerprint functions. They're designed so that the tiniest difference in the input scrambles the entire output. It's called the avalanche effect — one bit flips at the input, and on average half the output bits flip. So you can never have a situation where two almost-identical designs have almost-identical fingerprints and somebody mixes them up. Either the fingerprints are byte-for-byte the same, meaning the contents are identical, or they're nothing alike.

**MAYA:**
So the fingerprint is basically a tamper seal.

**THEO:**
It's a perfect tamper seal. You cannot change the contents and keep the name. The two are welded together by math. That's thing one — the name verifies the thing.

**MAYA:**
Give me thing two.

**THEO:**
Thing two: identical content is only ever stored once. This is the deduplication property and it's lovely. Say you check in your part. The system fingerprints it, files it under that fingerprint. Now suppose you make a change, then change your mind and undo it, and check in again — and the design is now byte-for-byte identical to a snapshot you already saved.

**MAYA:**
Then the fingerprint comes out the same.

**THEO:**
The fingerprint comes out the same, the system goes "oh, I already have a thing under that address," and it stores nothing new. It just points at what's already there. You never get two copies of the same thing eating up space, and you never have to think about it. The docs actually call this out as one of the test cases — re-checking-in an unchanged model creates zero new storage. That's the proof that it works.

**MAYA:**
That's kind of beautiful, actually. The system is constitutionally incapable of hoarding duplicates.

**THEO:**
It physically can't. There's no code path where the same content lands in two places, because the content decides its own address, and there's only one address per content. And that scales down to the *pieces*, too, which is the part that really makes it sing — but I'll come back to that, because if I go there now I'll lose you.

**MAYA:**
You will, and I'll let you. Thing three.

**THEO:**
Thing three: nothing can be silently altered. This is the one that matters most for a manufacturing shop, and it's really just thing one and thing two standing next to each other. Because the name is the fingerprint, and the fingerprint is welded to the contents, an old snapshot is frozen the instant it's created. There is no "edit this snapshot." You can't reach back into history and quietly nudge a dimension on a version somebody already approved. If you change anything, you get a *new* fingerprint — a new snapshot — sitting alongside the old one. The old one is untouched and untouchable.

**MAYA:**
So history is append-only. You can add to it, you can never rewrite it.

**THEO:**
You can never rewrite it. And that's the whole game. In a regulated shop, "prove this design hasn't been tampered with since it was signed off" is a question people get audited on. Here the answer is structural. It's not "we have a policy against editing approved files." It's "editing an approved snapshot is not a thing that can physically happen — here's the math."

**MAYA:**
I want an analogy I can hand to my mom.

**THEO:**
[laughs] Okay, here's the one I use. Imagine a library where you don't get to name the books. You hand the librarian a manuscript, and the librarian runs it through a machine that reads every single word and assigns the book a call number based on the exact words inside it. Identical manuscripts get the identical call number — so the library never shelves two copies of the same book; it just notes "another request for that one." And if you change a single comma, the machine spits out a totally different call number, so it's a *different book* on a *different shelf*. The original is right where it was, unchanged.

**MAYA:**
And you can't sneak into the stacks and edit a book, because then its words wouldn't match its call number anymore.

**THEO:**
Right — it'd be a book filed under the wrong number, and the system would catch it instantly, because checking is just "re-read the words, recompute the number, see if it matches." That library is the store. Every snapshot of every part lives in it, filed by its own contents.

**MAYA:**
Okay. I'm sold on the *what*. But I want to make sure I'm not missing something. Is this fingerprint thing something you invented?

**THEO:**
God, no. I want to be really clear about that. This is decades-old, extremely boring, extremely well-understood technology. The fingerprint function I use is a standard one that the whole internet runs on — it's the same family of math that secures web traffic and, yeah, that git uses under the hood. I didn't invent anything here. What I did was *recognize* that a CAD part, once it's data, has exactly the same shape of problem as source code, and so the same proven machinery just... works. The interesting design decision wasn't the fingerprint. It was deciding to treat parts this way at all.

**MAYA:**
Which is the thing that broke my brain in the cold open.

**THEO:**
Which is the thing that breaks everyone's brain. "You can do *git* on a *bracket*?" Yes. Because a bracket, to this system, is just a structured pile of data, and version control doesn't care whether the data describes a poem or a hole pattern.

## Segment 2 — A day in the life: check in, branch, compare

**MAYA:**
Let's get out of the abstract. I'm an engineer. I'm sitting at this thing. Walk me through a normal Tuesday. What do I actually *do*, and importantly — how much of this fingerprint machinery do I have to think about?

**THEO:**
Zero. That's the design goal, and I'll keep saying it. The docs put it in a line I really like: "you never see the plumbing." Everything we just spent fifteen minutes on — the fingerprints, the dedup, the tamper seals — the engineer never types a single command about any of it. They see three verbs. Check in. Branch. Compare.

**MAYA:**
Start with check in.

**THEO:**
Check in is "save a permanent snapshot, and give it a note." You've been modeling. You added a mounting boss, you tweaked a fillet, you're at a good stopping point. You hit check in, you type a little message — "added mounting boss for the new sensor" — and that's it. The system takes everything about your design right now, fingerprints it, files it in the library, and writes down: here's a snapshot, here's its note, here's who made it, here's when, and here's the snapshot it came *after*.

**MAYA:**
"The snapshot it came after." That's the history chain.

**THEO:**
That's the chain. Each snapshot remembers its parent — the one before it. So you don't just have a pile of saves, you have a *lineage*. Snapshot 5 came from 4 came from 3, all the way back to the empty beginning of the part. You can walk that chain backwards and watch the part get built up, edit by edit. And because every link is frozen — remember, append-only — that history is a permanent, honest record. Nobody went back and tidied it up.

**MAYA:**
How is this different from, like, hitting save in Word? Word saves my document.

**THEO:**
Word saves *over* your document. There's one file, and each save replaces the last. If you want the version from Tuesday you'd better have made a copy and named it carefully, and now you're back in `final_FINAL_v2` hell. Check in is the opposite — it never overwrites. Every check-in is a *new* permanent point you can always return to. The current version is just the most recent point on a chain that still holds every earlier point, fully intact.

**MAYA:**
And there's a real "go back" button. I can actually return to Tuesday.

**THEO:**
You can return to any snapshot in the history and pull it back into the editor. The docs phrase the requirement as "a user can view the complete commit history and restore any prior snapshot." It's not a backup you have to go beg IT to restore from a tape. It's right there in the version history, every checkpoint, click it, you're back.

**MAYA:**
Okay, verb two. Branch.

**THEO:**
Branch is the one that I think really sells why this is worth doing. A branch is a parallel line of work. Say you've got a bracket that's basically done, and your boss says "can you try a lighter version with cutouts, but don't lose the heavy one, we might need it." In the old world you'd save a *copy* — `bracket_lightweight.cad` — and now you've got two files drifting apart, and merging anything between them is a manual nightmare.

**MAYA:**
The dreaded second file.

**THEO:**
The dreaded second file. With a branch, you say "branch off here," give it a name, and now you have a second line of history that shares everything up to the split point and then diverges. You hack on the lightweight version freely. Your original line is *completely untouched* — you didn't copy anything, you didn't risk anything. And if the lightweight idea turns out great, there are tools to bring those changes back over. If it turns out terrible, you just... abandon the branch. The label goes away. Your main work never knew it happened.

**MAYA:**
And under the hood, branching is cheap, right? You're not duplicating the whole part.

**THEO:**
This is where that piece I parked earlier comes back. When you branch, you copy *nothing*. A branch is just a little pointer — a label — that says "this line of work currently sits at this snapshot." Creating one is instant and free, because all the actual content is already in the library, shared. Two branches that agree on most of the part are literally pointing at the same stored pieces for the parts they agree on, and only have their own copies of the bits they actually changed.

**MAYA:**
Wait, go back — "the bits they actually changed." So a snapshot isn't one big blob. It's made of pieces.

**THEO:**
It's made of pieces, and each piece is fingerprinted on its own. This is the thing I was scared to say too early. Your part is a collection of features — the base shape, that mounting boss, the fillet, each sketch. Every one of those is stored as its own little fingerprinted object. So a snapshot is really a *list* of fingerprints pointing at the individual pieces.

**MAYA:**
Oh. Oh, that's clever. So if I branch and only change the fillet —

**THEO:**
Then only the fillet gets a new fingerprint and gets newly stored. The mounting boss, the base shape, the sketches — all unchanged, all still pointing at the exact same stored objects the original line points at. Two branches, mostly-identical part, and the storage cost of the difference is just... the difference. The fillet. Nothing else.

**MAYA:**
That's the dedup thing again but zoomed in.

**THEO:**
It's the dedup thing all the way down. The library doesn't just avoid storing duplicate *parts*, it avoids storing duplicate *features*. Structural sharing, it's called. It's why having fifty snapshots and ten branches of a part doesn't cost fifty-times-ten of anything. You're paying for the unique stuff once, and pointing at it from everywhere it's used.

**MAYA:**
Okay, I genuinely didn't see that coming and I like it. Verb three. Compare.

**THEO:**
Compare answers "what changed between these two versions?" And because everything is fingerprinted in pieces, this is fast and exact. You pick two snapshots — Tuesday's and today's, or your branch versus main — and the system lines up their lists of feature-fingerprints and goes: this feature has the same fingerprint in both, skip it, untouched. This one's fingerprint differs, flag it as modified. This one exists in today's but not Tuesday's, flag it as added. This one's gone, flag it as removed.

**MAYA:**
So it doesn't have to deeply re-examine every feature. It just compares fingerprints, and same-fingerprint means "I already know these are identical, move on."

**THEO:**
That's the whole trick. Same fingerprint is a guarantee of identical content — we established that in segment one. So compare can skip every unchanged feature in a single glance and only actually dig into the handful that differ. On a part with a hundred features where you changed three, it does three real comparisons and waves past the other ninety-seven. The docs describe the cost as proportional to the number of *changes*, not the size of the part.

**MAYA:**
And what do I see, as the engineer? A list?

**THEO:**
You see two things. There's a structural list — "you modified the mounting boss, you added a chamfer, you removed the old slot." Plain English, feature by feature. And then there's a *visual* compare, where it shows you the two parts in 3D and highlights the faces that actually changed color-coded, so you can literally see the difference on the model. "Compare" isn't a wall of numbers, it's "here's what's different, here, look."

**MAYA:**
That's the thing a drawing-in-a-box-with-a-rev-letter could never give you. You'd be eyeballing two PDFs trying to spot the difference.

**THEO:**
Playing spot-the-difference with a bracket, yeah. And getting it wrong, which is how bad parts get built. Here the machine does it perfectly, every time, because it's not looking at pictures — it's comparing fingerprints of structured data.

## Segment 3 — Why you can't scribble on main

**MAYA:**
Alright. You keep using this word "main." The official line. Let's dig into that, because there's something in your docs I want you to defend. You made main *un-editable*. You literally cannot edit the official version of the part directly. That seems backwards. The official version is the one I most want to be able to fix.

**THEO:**
[laughs] It feels backwards for about a day, and then you never want it any other way. Let me make the case.

**MAYA:**
Please.

**THEO:**
"Main" is the released line of the part. It's the spine of the part's official history — the sequence of versions that actually got stamped, approved, manufactured. It is the thing the rest of the company trusts. When the purchasing system orders material for this part, when the shop floor pulls up the work order, when the bill of materials references it — they're all trusting that the official line is clean and stable and exactly what it says it is.

**MAYA:**
So it's the source of truth.

**THEO:**
It's the source of truth, and you protect a source of truth by not letting people poke at it directly. So in this system, main is protected. If you try to check out main to edit it, the system stops you. If you try to check in changes to main, it stops you. Updates to main, blocked. The only way main ever changes is through a controlled release — which is its own whole ceremony we'll get to.

**MAYA:**
So where do I actually *work*, then? If I can't touch main, and main is the part, what am I editing?

**THEO:**
A draft branch. And this is the bit I really like about how it's set up — you never have to think about it, because it's automatic. The moment a part gets a CAD model, the system seeds main with an initial snapshot and then *immediately* creates a draft branch for you, called `draft/01`, and drops you onto it. You open the editor and you are already standing on a safe, editable branch. You literally cannot accidentally start by editing main, because you were never on main to begin with.

**MAYA:**
So out of the box, day one, you're on a draft.

**THEO:**
Day one, first click, you're on `draft/01`. The official line is over there, pristine, and you're working on your own draft copy that branched off it. When your draft is good, you release it, and *that* is the controlled moment where main moves forward. The rest of the time, main just sits there being trustworthy.

**MAYA:**
This has a name, doesn't it? This pattern. I feel like programmers fight about it.

**THEO:**
[laughs] Oh, they fight about everything, but yes — it's called trunk-based development. The idea is you have one trunk, the main line, that stays clean and releasable, and all the messy in-progress work happens out on branches that get folded back in carefully. The opposite is everybody hacking directly on the shared line and stepping on each other constantly. For a regulated manufacturing shop, where "the official version" is a thing you can get *audited* on, trunk-based isn't just tidy, it's kind of mandatory. You need a clean, auditable spine. Protecting main gives you that by construction.

**MAYA:**
Let me push on the multi-person angle, because that's where this stuff usually falls apart. Two engineers. Same part. Both want to make changes. In the file-on-a-network-drive world this is a disaster — somebody saves over somebody.

**THEO:**
Right, the classic "I opened the file and it said someone else has it locked," or worse, no lock at all and your morning's work just vanishes when they save. Here, the two engineers each get their own draft branch off main. They work completely independently. Neither can see or stomp on the other's work, because they're on separate parallel lines. The docs literally use this as the validation case — two designers work concurrent drafts, and their releases serialize cleanly onto main, one after the other.

**MAYA:**
"Serialize cleanly." Meaning?

**THEO:**
Meaning when they go to release, the releases line up in order — whoever goes first lands on main, then the second one lands after. They don't collide and corrupt the official line, because nobody was editing the official line directly. They were both on drafts. Main only ever moves through that one controlled doorway, so it can only move one careful step at a time.

**MAYA:**
And here's where I remember a thing from your branches doc. The "behind" situation. When the first person releases, the second person's branch becomes "behind."

**THEO:**
Yeah, this is a real consequence and I think it's worth being honest about, because it's the one bit of friction in an otherwise smooth flow. Picture it: you and I both branch off main when the part is at revision, whatever, snapshot five. We both work. I release first. Now main has moved forward — there's new official content on it that your branch has never seen. Your branch is now "behind main." It's based on an older version of the official line.

**MAYA:**
And I get told that.

**THEO:**
You get told that, clearly, and — this is the important guardrail — you're *blocked from releasing* until you catch up. Because if the system just let you release, you'd be shoving your old-based work onto main and silently undoing whatever I just released. So it stops you and says, essentially, "main moved, you need to bring its latest changes into your branch before you can release on top of it."

**MAYA:**
How painful is catching up?

**THEO:**
There's a dedicated tool for it — a merge — and the design choice there is actually thoughtful. Rather than crudely mashing the two together and letting whoever-was-last win, it lets you bring in main's latest as the new base and then pick exactly which of *your* branch's feature changes to splice on top. Feature by feature. So you stay in control — "yes, take main's new mounting hole, and also keep my cutout, those don't conflict." We're going to dig into merge properly in a later episode, because it's a meaty topic on its own, but the headline for today is: behind-main is a real situation, the system catches it, and it won't let you accidentally clobber the official line.

**MAYA:**
It's funny — that friction is the system working, isn't it. The annoyance *is* the safety.

**THEO:**
The annoyance is the safety. Every time you feel that little speed bump of "oh, I'm behind, I have to catch up," that's the exact moment where, in the old world, somebody would have silently overwritten somebody else's work and nobody would have noticed until a bad part showed up on the floor. The speed bump is the system refusing to let that happen.

## Segment 4 — Release: the ceremony that means something

**MAYA:**
Okay. We keep dancing around this word "release." Time to actually open it up. I do my work on a draft, I'm happy, I hit release. What does release *do*? And I want the real list, because I get the sense it's not just "flip a flag to published."

**THEO:**
It is emphatically not just flipping a flag. Release does three concrete, physical things, and I love this part because each one closes a specific hole that lets bad parts happen in normal shops. Let me do all three.

**MAYA:**
Three things. Go.

**THEO:**
Thing one: it freezes the exact geometry so it can never drift. Thing two: it stamps the part with its official revision number. Thing three: it locks the design read-only. Freeze, stamp, lock. Let me take them one at a time because each one is doing real work.

**MAYA:**
Start with freeze. And remind me what "geometry" even means here, for anyone who skipped episode two.

**THEO:**
Sure. So your design isn't stored as a finished 3D shape. It's stored as a *recipe* — a list of features. "Start with this sketch, extrude it this far, put a hole here, round this edge." To actually get the solid 3D model, the geometry engine — the kernel — has to *run* that recipe. It's a computation. And here's the subtle, scary thing: that computation can, in principle, produce slightly different results over time. If the kernel gets upgraded, if some rounding behaves a hair differently, if anything in the pipeline shifts — re-running the recipe a year later could give you geometry that's a tiny bit different from what you saw the day you designed it.

**MAYA:**
Wait, that's terrifying. The recipe is the same but the cake comes out different?

**THEO:**
It can, at the margins, and for most software that's a shrug. For a part you're going to *manufacture*, it is absolutely not a shrug. So freezing is: at the moment of release, the system runs the recipe one final time, and then it *captures the actual baked result* — the real, computed 3D geometry — and stores that, fingerprinted, attached to this exact snapshot. It's not storing the recipe anymore. It's storing the cake.

**MAYA:**
So forever after, when someone opens this released version —

**THEO:**
They get the frozen cake. The system doesn't re-run the recipe — it just hands back the exact geometry that was captured at release. The docs make a point of this: opening a released revision reconstructs the geometry from the frozen snapshot with *zero* trips to the kernel. No recomputation, so no opportunity for drift. The thing you approved is byte-for-byte the thing anyone ever gets back, even years later on a totally different version of the software.

**MAYA:**
And that ties back to the fingerprint stuff — the frozen geometry is itself stored by its content, so it can't be tampered with either.

**THEO:**
Same library, same rules. The frozen geometry is just more content in the content-addressed store, welded to its fingerprint. Belt and suspenders. The recipe is frozen because the snapshot is frozen, and the *result* of the recipe is frozen separately on top of it. There is no wiggle room anywhere.

**MAYA:**
Okay. Thing two. The stamp. The revision number.

**THEO:**
Right. So when you release, the system mints the next official revision number and permanently attaches it to this exact snapshot. And here's a design decision I'm proud of: there is no separate "CAD revision." The part has *one* revision number, and it's the same number engineering and manufacturing and purchasing all use. The CAD model doesn't get its own private versioning scheme that someone has to keep in sync with the manufacturing one — that "keeping in sync" is exactly where shops get burned. One identity. The release stamps *that* identity onto this snapshot.

**MAYA:**
And mechanically, the stamp is one of those write-once labels you mentioned.

**THEO:**
It's a write-once tag. So branches — those movable labels we talked about — can slide forward as you work. A revision stamp cannot. Once revision 01 points at a snapshot, it points at that snapshot forever. You physically cannot re-point "revision 01" at different geometry later. The link between "the official revision 01 of this part" and "this exact frozen geometry" is permanent and unbreakable. The docs frame the payoff as: a person can find *exactly* which committed model was released as a given revision. No ambiguity. Ever.

**MAYA:**
That is the thing the rev-letter-in-a-box could never promise.

**THEO:**
Never. The box promised a letter. This promises a letter *welded to specific bytes*. Completely different kind of promise.

**MAYA:**
Thing three. Lock it read-only.

**THEO:**
Once you've released a revision, that design is done. You can't edit it anymore. It's locked. And this is the natural consequence of everything we've said — if revision 01 is permanently welded to specific frozen geometry, then obviously you can't keep editing "revision 01," because then it wouldn't be that geometry anymore. So the released design goes read-only.

**MAYA:**
But parts get revised all the time. I *need* to make changes. So how do I, if it's locked?

**THEO:**
You start a new revision, and the system makes that effortless. It copies your design forward into a fresh, editable working copy and mints it as the next revision. So revision 01 is frozen and locked forever, and you're now editing what will become revision 02, with all of 01's work as your starting point. The history stays continuous — 02 knows it came from 01 — but 01 itself is sealed.

**MAYA:**
Oh, and there's a nice touch in your docs — if I try to check out a locked, released version, it just does this for me automatically.

**THEO:**
Yeah. If you go to edit something that's released and locked, the system doesn't just error at you and stop. It understands what you actually want — you want to make changes — so it quietly spins up the next revision as a draft and puts you on it. You wanted to edit; editing a released thing means making a new revision; so it makes the new revision. The locked original stays locked, you get your editable copy, everybody's happy.

**MAYA:**
Okay so that's the everyday release. Freeze, stamp with a *number*, lock. But you've mentioned letters too. A, B. There's a second kind of release.

**THEO:**
There's a second tier, and the distinction is really about *who's allowed to bless it*. Let me draw the line clearly. The everyday release — the numeric one, 01, 02, 03 — is self-service. It's your engineering checkpoint. You don't need anyone's sign-off. You're an engineer, you have edit rights, you decide your draft is good, you release it, it becomes revision 02. That's it. It's meant to be frequent and low-ceremony. The docs literally call it "self-service" — no approval step.

**MAYA:**
And the lettered one is the opposite.

**THEO:**
The lettered one — A, B, C — is the *production* release, and it is formal. It requires a separate approval permission. Somebody with the authority to sign off has to actually approve it before it can happen. This is the "we are now committing to manufacture and ship this" gate. And here's the elegant bit: a production release doesn't re-freeze or recompute anything. It takes a development release you already made — already frozen, already locked — and stamps the letter revision onto *the exact same frozen geometry*.

**MAYA:**
So the shipped letter-revision is guaranteed to be geometrically identical to the numeric one it came from.

**THEO:**
Identical by construction. Not "identical because we were careful." Identical because it's pointing at the *same frozen bytes*. There's no opportunity for them to differ, because nobody regenerated anything — the letter is just a second write-once label slapped onto the very same snapshot the number is on. So when someone asks "is production revision A actually the same geometry as the development revision 02 it was promoted from?" the answer isn't a process or a checklist. It's: they are literally the same stored object. Same fingerprint. Done.

**MAYA:**
Let me make sure I've got the two tiers straight. Numbers — 01, 02 — are everyday engineering checkpoints, self-service, no sign-off. Letters — A, B — are the formal shippable revisions, require approval, and reuse the exact frozen geometry from a numbered release.

**THEO:**
Nailed it. Numbers are "I, the engineer, am saving an official checkpoint." Letters are "we, the organization, are blessing this to ship." Two different acts, two different authority levels, one shared frozen reality underneath.

**MAYA:**
And before *either* release, there's a rule, right? You said you can't release work in progress.

**THEO:**
Right, small but important. Before you can release anything, your work has to be checked in — saved as a proper snapshot. You cannot release un-saved, work-in-progress edits floating around in your editor. Which makes total sense: a release is a permanent, fingerprinted, frozen thing. It has to be built on a real snapshot, not on whatever half-finished state happens to be on your screen at the moment. So the system makes you check in first. Clean state, then release.

## Segment 5 — The status board: draft, in review, approved

**MAYA:**
You've now mentioned "approval" a few times — the production release needs a sign-off. I want to talk about the workflow around that, because in your docs there's this little three-state thing. Draft, in review, approved. What is that, and how is it different from the release stuff we just did?

**THEO:**
Good instinct to separate them, because they're easy to blur. The release stuff is about the *geometry and the revision identity* — freezing, stamping, locking. The workflow is about *where a design stands in the human review process*. It's a status tracker. A little state machine that answers the question "has this design been reviewed and blessed, or is it still cooking?"

**MAYA:**
So it's the project-management layer, not the data layer.

**THEO:**
Exactly. Three states. **Draft** — somebody's actively working on it, it's not ready for eyes yet. **In review** — they've submitted it, and now it's sitting in front of a reviewer who's supposed to look it over. **Approved** — the reviewer signed off; it's blessed and ready for that formal production release we just talked about. And you move between those states by explicit, deliberate transitions. You *submit* a draft to push it into review. A reviewer *approves* it to push it to approved. It's a one-way ratchet through those stages.

**MAYA:**
Why even have this? Couldn't the approval just *be* the production release? Why a separate status?

**THEO:**
Because the review and the release are genuinely different acts, often by different people, sometimes days apart. Submitting for review is "I think this is done, please look." The reviewer approving is "I looked, it's good." And the production release is "now let's actually mint the official letter revision and lock it in." You want the approval to be its own recorded fact — "this design was reviewed and approved, by this person, at this time" — separate from the mechanical act of cutting the revision. Especially in a regulated environment, "who approved this and when" is a question you need a clean answer to, independent of when the release button got clicked.

**MAYA:**
And the workflow *gates* the production release.

**THEO:**
It gates it. You cannot do a production letter release unless the workflow says "approved." The status board and the release machinery are wired together at exactly that one point — approved is the green light. Before that, the production release simply isn't available. So the human review isn't a suggestion you can skip; it's a hard prerequisite the system enforces.

**MAYA:**
There's a detail in your branches doc I want you to explain, because it surprised me. The workflow status is tracked *per branch*. Not per part.

**THEO:**
Yeah, and this is one of those things that sounds like a footnote but actually matters a lot once you have multiple people. Remember — multiple engineers can each have their own draft branch of the same part, all in flight at once. If the review status lived on the *part*, they'd all share one status, and it'd be chaos — my draft going into review would somehow flip the status on your unrelated draft. So instead, each branch carries its own workflow status, independently.

**MAYA:**
So my branch can be in review while yours is still a draft and the official main line has its own separate production-approval status.

**THEO:**
All at once, all independent. Your draft, my draft, and main's production cycle are three separate little status trackers that don't interfere. The docs flag the gotcha plainly — the status is keyed per branch, and anything that tried to read the status without specifying *which* branch would read the wrong thing. It's a real subtlety they had to get right, but the payoff is that concurrent reviews just work.

**MAYA:**
One more on this — you described the workflow engine in the docs as "generic" and "declarative," and the same engine runs for both CAD parts and assemblies. What does that buy you?

**THEO:**
It buys consistency and it buys not-writing-the-same-thing-twice. The workflow isn't hardcoded into the CAD-specific code. It's a generic little engine that's been handed a *description* of the states and the allowed transitions — draft goes to in-review goes to approved, here's who's allowed to make each move. And then both the CAD parts and the 3D assemblies — which we'll get into next episode — point at that same engine with the same description. So a part and an assembly go through identically-behaving review processes, and there's exactly one piece of code defining what that process *is*. Fix a bug in it, both get the fix. Change the rules, both change together. There's no risk of parts and assemblies slowly drifting into two subtly-different review processes, because there's only one.

**MAYA:**
That's a theme in this whole system, isn't it. Write the hard thing once, point everything at it.

**THEO:**
It's *the* theme. And it's the big payoff I keep promising for episode four, so I'm going to bite my tongue. But yeah — the version control we've talked about today, all of it, is written once and shared. Parts and assemblies don't each have their own version control. They share one.

## Segment 6 — Three locks walk into a bar

**MAYA:**
Okay, I promised the listeners an honest segment, because your docs have this great little warning box that basically says "hey, there are three different things all called 'lock' and people mix them up constantly." I want you to untangle them, because I tried to read that table and my eyes crossed.

**THEO:**
[laughs] Yeah, this is the genuinely confusing corner of the system, and I'd rather be straight about it than pretend it's clean. There are three distinct kinds of "locked" and they mean completely different things. Let me give them human names and go slowly.

**MAYA:**
Human names, please. Not the variable names.

**THEO:**
Human names. Call them the *checkout lock*, the *release lock*, and the *manufacturing lock*. Three different locks, three different jobs.

**MAYA:**
Start with checkout.

**THEO:**
The checkout lock is the most everyday one, and it's about *people not stepping on each other right now*. When you check out a part to edit it on a branch, you grab a lock that says "I'm working on this, hands off." It's temporary. It's the same idea as the old library checkout card, or "I have the talking stick." While you hold it, someone else can't also be actively editing that same branch and clobbering you. When you check your work back in, or hand it off, the lock releases. It's transient — it's about live editing sessions, nothing more.

**MAYA:**
So that's a "someone's currently working on this" lock.

**THEO:**
Right. "Busy, come back later." It has nothing to do with whether the part is final. It's purely about the live editing moment.

**MAYA:**
Lock two. Release lock.

**THEO:**
The release lock is "this design has been released, so the design itself is now read-only." This is the one we hit in segment four — when you release a revision, the design goes read-only so it can't drift away from the frozen geometry. That's the release lock doing its job. It's about the *design being final*. It's not about someone editing right now, it's about "this version is sealed because it's been released."

**MAYA:**
So checkout lock is "busy at the moment," release lock is "this version is finished and frozen."

**THEO:**
Exactly the right framing. Temporary-busy versus permanently-sealed. Totally different lifespans. The checkout lock comes and goes all day. The release lock, once it's on a released revision, stays on.

**MAYA:**
And the third one. Manufacturing lock.

**THEO:**
The manufacturing lock lives on the *part* in the broader inventory system, not on the CAD model specifically. It's the manufacturing side of the house saying "this revision of the part is immutable now — purchasing, bills of materials, work orders all depend on it, so it can't be messed with." It exists because the part is woven into a whole manufacturing system that predates the CAD module entirely. The CAD release *triggers* it — when you release, it also throws the manufacturing lock on the underlying part — but it's conceptually a separate lock owned by a separate part of the system.

**MAYA:**
So let me try to say it back. Checkout lock: "I'm editing this right this second, wait your turn." Release lock: "this design version has been released and is now read-only." Manufacturing lock: "the manufacturing system considers this part revision immutable because the whole supply chain leans on it."

**THEO:**
That's it. That's the three. And the reason they get confused is they often switch on *together* — when you do a release, boom, the design goes read-only with the release lock, *and* the manufacturing lock snaps onto the part, in the same motion. So people see "everything locked at once" and assume it's one thing. It's three things that happen to fire together at release time but answer three different questions.

**MAYA:**
And honestly — and you said this is the honest segment — is having three a design smell? Like, should it be one lock?

**THEO:**
It's a fair challenge, and I've thought about it. My honest answer is no, they genuinely *are* three different concepts and collapsing them would be wrong. The checkout lock has to be separate because it's transient and per-session — it's about a live editing moment and it comes off the instant you're done. The release lock and the manufacturing lock *feel* mergeable, but they're owned by different parts of the system with different rules — one is "the CAD design is read-only," the other is "the manufacturing record is immutable," and the manufacturing one existed before CAD was ever bolted on. They live in different tables, they answer to different code. Forcing them into one would couple two systems that are better kept loosely joined. So — three locks, and yeah, it's a little confusing, but each one is earning its keep. The right fix isn't fewer locks, it's clear documentation, which is exactly why the docs have that warning box.

**MAYA:**
I respect that you didn't try to sell me on it being elegant.

**THEO:**
It's not elegant! It's *correct*, which is more important. Elegant would be one lock that's subtly wrong in three different situations. I'll take three honest locks over one dishonest one.

## Segment 7 — Why a regulated shop actually needs all this

**MAYA:**
Let's zoom all the way out, because I want to land the *why*. We've been deep in the machinery. But for somebody running an actual manufacturing operation — somebody who has to pass audits, somebody who ships parts that go into things that matter — what does all of this buy them that they couldn't get from files-on-a-drive plus discipline?

**THEO:**
The honest one-word answer is *traceability*, but let me unpack what that really means on the floor, because it's not abstract. It's the difference between "we think so" and "here, look."

**MAYA:**
Give me the scenario.

**THEO:**
Okay. A part you shipped eight months ago turns out to have a problem in the field. Maybe a hole's in the wrong spot, maybe a wall's too thin. The first question — the *only* question that matters in that moment — is: which exact version of this design did we actually build? Because the answer tells you which units are affected, whether it's a one-off or a whole batch, and whether the design was wrong or the shop deviated from it.

**MAYA:**
And in the files-on-a-drive world?

**THEO:**
In the files-on-a-drive world you are now doing forensics. You're digging through email threads, asking "which file was current in March?", finding three copies of `bracket_revB` with different modified-dates, trying to reconstruct from memory which one went to the floor. And you will never be *certain*. You'll have a best guess. When an auditor or a customer asks "prove it," you've got a story, not evidence.

**MAYA:**
And here?

**THEO:**
Here, the question has a single, exact, instant answer. The part was built as revision B. Revision B is a write-once stamp welded to a specific frozen snapshot. You click it. You're looking at the *exact* geometry that shipped — not a regenerated approximation, the frozen thing itself. You can see who approved it, when, and the entire chain of edits that led up to it, every one append-only and tamper-proof. "Which version did we build" goes from a forensic investigation to a single click with a guaranteed-correct answer.

**MAYA:**
And "build the right version." That's the flip side, the prevention side.

**THEO:**
That's the prevention side, and it's honestly the bigger win because it stops the problem before it ships. Think about how a wrong part gets built normally — somebody pulls up the design to manufacture it, and they grab the wrong file. An old rev. A draft someone forgot to clean up. A copy from the wrong folder. It happens *constantly*, and it's expensive — you've cut metal on a design that was superseded three weeks ago.

**MAYA:**
And the protected-main, release-ceremony structure prevents that.

**THEO:**
It makes it really hard to do by accident. The official line is *the* official line — protected, clean, one spine. The released revisions on it are frozen and unambiguous. The drafts and experiments are clearly off on their own branches, plainly marked as not-released. There's no folder full of ambiguous files where the "real" one is whichever was modified most recently. When the shop pulls up "the released revision," there is exactly one thing that means, and it's the right thing, frozen, stamped, and locked. The structure of the system is steering everyone toward the correct version by default.

**MAYA:**
So the version control isn't a nice-to-have bolted on for the engineers' convenience. It's load-bearing for the whole quality story.

**THEO:**
It's completely load-bearing. And this is the bit I'd want a skeptical manufacturing person to really hear: the traceability here isn't a *policy*. It's not "we have a procedure and we promise to follow it." It's *structural*. The design literally cannot be edited after release. The revision stamp literally cannot be moved to different geometry. The history literally cannot be rewritten. These aren't rules people might break under deadline pressure — they're properties of how the storage physically works. When you go to prove your process to an auditor, "it's structurally impossible to do otherwise" is a much, much stronger statement than "we have a policy against it."

**MAYA:**
That's the thing that turns the fingerprint math from a clever trick into something a business actually cares about.

**THEO:**
That's the whole bridge. The fingerprints, the content-addressing, the protected main, the freeze on release — for a programmer that's just nice engineering. For a manufacturer it's the difference between *demonstrable* control of your designs and *hopeful* control. And in a regulated world, demonstrable is the only kind that counts.

## Recap

**MAYA:**
Alright, let me pull the threads together, because we covered a lot and I want the takeaways to be clean. Four things.

One. Content addressing. Every snapshot of a part is named by a *fingerprint of its own contents*. That one idea does three jobs at once — the fingerprint verifies the contents like a tamper seal, identical content is automatically stored only once, and nothing in history can ever be silently altered, because changing anything produces a brand-new snapshot and leaves the old one untouched. History is append-only. Did I get it?

**THEO:**
Word perfect. The name verifies the thing, dedup is free, and the past is immutable. Those three come as a package from that one decision.

**MAYA:**
Two. The everyday workflow, and you never see the plumbing. Check in saves a permanent, noted snapshot on a chain you can always walk back. Branch spins up a parallel line of work for free — copying nothing, because everything's shared down to the individual feature. Compare lines up two snapshots and tells you exactly what changed, fast, by comparing fingerprints and skipping everything that matches. Three verbs, zero math homework.

**THEO:**
And the "down to the individual feature" bit is what makes branching and comparing cheap. The part is a pile of fingerprinted pieces, so you only ever store and compare the pieces that actually differ.

**MAYA:**
Three. Protected main, and release as a real ceremony. You can't edit the official line directly — you work on a draft branch you're dropped onto automatically, and main only moves through a controlled release. And release does three concrete things: it *freezes* the exact computed geometry so it can never drift, it *stamps* the snapshot with the part's one official revision number via a permanent write-once label, and it *locks* the design read-only. Numbers for everyday self-service releases, letters for formal approval-gated production releases that reuse the exact same frozen geometry.

**THEO:**
Freeze, stamp, lock. And the letter release pointing at the identical frozen bytes as the number it was promoted from — identical by construction, not by carefulness.

**MAYA:**
Four. The supporting cast. A three-state review workflow — draft, in review, approved — that's a status board, tracked per branch so concurrent reviews don't collide, and it gates the formal production release. Three different locks that look like one because they often fire together — checkout lock for "I'm editing now," release lock for "this version is sealed," manufacturing lock for "the supply chain depends on this." And the whole point of all of it, for a real shop: structural traceability. "Which version did we build?" becomes one click with a guaranteed answer, and "build the right version" becomes the default instead of a hope.

**THEO:**
And structural is the key word in that last one. Not policy. Property. The system can't do the wrong thing, rather than promising not to.

**MAYA:**
That's the episode. Honestly, going in, "git for parts" sounded like a gimmick to me. Coming out, it sounds inevitable.

**THEO:**
[laughs] That's the reaction I was hoping for. Once you see that a part is just data, and that the problem is identical to the one version control already solved, *not* doing it this way starts to look like the strange choice.

## Teaser

**MAYA:**
Next time, we go up a level — literally. We've spent three episodes on a single part. But real products aren't single parts. They're *assemblies* — dozens, hundreds of parts fitted together, bolted, mated, constrained to move the right way and not pass through each other.

**THEO:**
And here's the thing I've been biting my tongue about all episode. Everything we talked about today — the content-addressed version control, the branches, the freeze-on-release, the review workflow, even those three locks — *none* of it had to be rebuilt for assemblies.

**MAYA:**
None of it?

**THEO:**
None of it. It was written once and shared. The assembly system is, in a real sense, the *same* version control we just spent an hour on, pointed at a different kind of document. That's the big architectural payoff, and it's the whole spine of next episode — how you build two genuinely different things, parts and assemblies, and get them to share all the hard machinery without copying a line of it.

**MAYA:**
Plus I want to know how you stop a hundred parts from clipping through each other.

**THEO:**
[laughs] Oh, we'll get into the mating. There's math. There's a solver. It's great.

**MAYA:**
Of course there's a solver. There's always a solver. That's next time, on the show. Thanks for listening.

**THEO:**
See you next episode.

---

# Episode 4 — Putting It Together: Assemblies and the Big Idea

## Cold open

**MAYA:**
Okay, I want to start with a thing that happened on my screen yesterday, because I genuinely said "wait, what" out loud. Theo had me sitting in front of the assembly editor, and there's a little plate with a hole in it, and there's a bolt floating off to the side like it's lost. And he goes, "click the side of the bolt, then click the inside of the hole." So I do. And the bolt — it just *jumps*. It rotates, it slides, and it drops itself straight down the hole like it was always supposed to be there. I didn't drag it. I didn't type a single number. It snapped.

**THEO:**
[laughs] Your face was great.

**MAYA:**
My face was, like, betrayed. Because here's the thing — I didn't *tell* it where the bolt goes. I never said "put it at coordinate seven, four, two." I just said these two things should be lined up. And then some... force... decided exactly where the bolt lands. So my actual question, the one I want this whole episode to answer, is: who decided that? Who did the deciding? Because it felt like there was a tiny engineer living in my computer who knew where bolts go.

**THEO:**
There kind of is. It's called a mate solver. And it is the exact same idea — the same *math*, honestly — that SolidWorks and NX and every serious CAD tool you've heard of use to make parts fit together. We built our own. And by the end of today, you're going to know who that tiny engineer is and how it thinks.

**MAYA:**
And then, apparently, you're going to tell me something about the *architecture* that you keep calling "the big idea," and you've been weirdly smug about it for three episodes.

**THEO:**
I've earned the smug. It's a good idea.

## Intro

**MAYA:**
Welcome back. This is the show where we take one real piece of software — a browser-based CAD and assembly system bolted onto a manufacturing inventory app — and we crack it open and look at how it actually works. I'm Maya, I'm the one asking the dumb questions, except Theo keeps insisting they're not dumb.

**THEO:**
They're not. And I'm Theo. I designed and built most of the system we're talking about.

**MAYA:**
So this is Episode 4, and it's the finale of Season 1. And Season 1 has been the friendly tour. Episode 1, we figured out what parametric CAD even *is* — that a model is a recipe, a list of steps, not a frozen lump of geometry. Episode 2, we went down into the geometry kernel, the Rust engine that does the actual hard 3D math. Episode 3, the time machine — the version control system, the git-for-CAD thing, that lets you branch and merge and release a part like it's source code.

**THEO:**
Right. And today is two halves that turn out to be one story. The first half: assemblies. We've spent three episodes on a *single part*. Now we put many parts together into a product and make them fit. That's mates, that's the solver, that's bills of materials, exploded views, all of it.

**MAYA:**
And the second half is this "big idea" you keep teasing.

**THEO:**
The second half is the payoff. It's why I'm able to say "all of that assembly stuff" and then immediately add "and it reused almost everything from the single-part side." There's an architectural decision underneath this whole system that means assemblies got version control, branching, releasing, comparing, the editor, the measuring tools — basically for free. And I want to explain *how that's even possible* without it being magic, because it's not magic, it's just a really disciplined choice made once.

**MAYA:**
Half the episode on the bolt that jumps, half on the smug architecture thing. Let's go. Start with the bolt.

## Segment 1 — What an assembly even is

**THEO:**
So let's set the table. For three episodes, "the model" has meant one part. A bracket, a plate, a single machined thing. You sketch a profile, you extrude it, you cut a hole, you've got a part.

**MAYA:**
The recipe. The feature tree.

**THEO:**
The recipe, exactly. An assembly is a totally different *kind* of thing. An assembly is not a recipe for one shape. An assembly is a *scene*. It's a collection of already-finished parts, arranged in space, in their proper relationship to each other. Think of it like — you've built a bunch of LEGO pieces, individually, and now the assembly is the instruction booklet that says how they snap together into the spaceship.

**MAYA:**
Okay, so the parts already exist. The bolt is already a finished bolt. The plate is already a finished plate. The assembly is just... the arrangement.

**THEO:**
The arrangement and the *relationships*. And there are two big concepts you need, and they're both delightfully simple. The first is **instances**.

**MAYA:**
Instances.

**THEO:**
Here's the thing about a real product. Take any machine near you. How many identical screws does it have?

**MAYA:**
A lot. Twenty? Forty?

**THEO:**
Right. And you did not design forty screws. You designed *one* screw, and then you used it forty times. So in the assembly, we don't make forty copies of the screw's geometry. We make forty **instances** — forty little entries that all say "I am a copy of part number 17, the screw, and here's where I sit and how I'm turned."

**MAYA:**
Oh, so an instance is like... a pointer? A reference? "Go look at the real screw over there, and stamp it down right here."

**THEO:**
That's the perfect way to say it. An instance is a reference plus a position. In the document it's almost boringly literal — each instance is a little record with the part ID it points at, and a placement, which is just a translation, where it sits, and a quaternion, which is the rotation, how it's turned. Plus a few flags: is it grounded, is it suppressed, is it visible.

**MAYA:**
Hold on, quaternion. You said that fast and slid right past it. That's the spooky four-number rotation thing from the kernel episode, right?

**THEO:**
[laughs] You caught me. Yeah. A quaternion is just four numbers that encode a 3D rotation without the gimbal-lock problems you get from the "spin around X, then Y, then Z" approach. For today, every time I say quaternion, you can just hear "the rotation." That's all it is — the way the part is twisted in space.

**MAYA:**
Good. So the assembly is a list. Each line is "one copy of this part, sitting here, turned this way." Twenty bolts is twenty lines pointing at one bolt.

**THEO:**
You just described the actual data structure. It's called the `assemblyDoc`, a single document stored as JSON, and it is the *one source of truth* for the whole assembly. Everything else — the 3D you see, the parts list, the exported file — is *derived* from this one list. Nothing geometric is stored; it's computed fresh from the recipe.

**MAYA:**
That's the same philosophy as the single part. The model is the recipe, the geometry is cooked from it on demand.

**THEO:**
Same philosophy, all the way up. Hold onto that — it matters a lot in the second half. Now, the second big concept, and this is the one that makes assemblies actually *smart* instead of just a pile of stuff. **Mates.**

## Segment 2 — Mates: relationships, not coordinates

**MAYA:**
Mates. As in, the bolt mates with the hole.

**THEO:**
As in the bolt mates with the hole. So here's the central, almost philosophical idea of assembly modeling, and it's the thing that makes it click once you get it. When you arrange parts in a real product, you almost never actually care about absolute coordinates. You don't think "the bolt head is at X equals forty-two point three millimeters." You think *relationships*. "This bolt goes down that hole." "This face sits flat against that face." "These two parts stay five millimeters apart."

**MAYA:**
Right, because that's how it works physically. The bolt doesn't care what the coordinates are. It cares that it's in the hole.

**THEO:**
And here's why that distinction is everything. Imagine you positioned everything by typing coordinates. You place the plate, you carefully position the bolt at the exact numbers so it sits in the hole. Beautiful. Now your boss says "move the plate two centimeters to the left."

**MAYA:**
And now the bolt is floating in space two centimeters away from its hole, because I hardcoded the bolt's position and it didn't move with the plate.

**THEO:**
You'd have to go re-type every coordinate of every part that touched the plate. In a real assembly with hundreds of parts, that's a nightmare. That's a whole afternoon, and you'll get one wrong. But if instead you said "the bolt is *concentric* with that hole" — a relationship, not a coordinate — then when the plate moves, the hole moves, and the relationship still has to hold, so...

**MAYA:**
...the bolt just follows. Because the *rule* is still true, the system re-figures-out where the bolt has to be. Okay, that's genuinely elegant. You're describing intent instead of position.

**THEO:**
Intent instead of position. That's the whole game. You give the system a bunch of rules — we call them mates — and you let it work out the positions. And in our system there are eight kinds of mate. Let me give you the everyday-language version of each, because they're all things you'd say out loud about real parts.

**MAYA:**
Hit me.

**THEO:**
**Coincident** — two flat faces sit flush against each other, like setting a book flat on a table. The faces touch and they're parallel.

**MAYA:**
Touching faces. Got it.

**THEO:**
**Concentric** — two round things share a center axis. The bolt shaft runs straight down the middle of the hole. That's the one that made your bolt jump.

**MAYA:**
The jump mate.

**THEO:**
[laughs] The jump mate. **Parallel** — two faces stay parallel but don't have to touch. **Perpendicular** — two faces meet at a right angle. **Distance** — keep two faces a specific gap apart. "Five millimeters between these." **Angle** — hold two faces at a specific angle, like a hinge propped open at thirty degrees. **Tangent** — a round face just kisses a flat face, touching at exactly one line, like a ball resting on a floor. And **lock** — just glue these two parts together, they move as one rigid blob from now on.

**MAYA:**
Okay, those all map to physical intuition really cleanly. Touching, lined-up, parallel, square, gapped, angled, kissing, glued.

**THEO:**
And every one of them is a rule about *two faces on two different parts*. You always pick a face on part A, a face on part B, and a relationship between them. That's the unit. That's a mate. And the way you create one in the editor is literally: click a face, click another face on a different part, and the system offers you the mate types that make sense for those two faces.

**MAYA:**
Wait, "the ones that make sense" — it filters?

**THEO:**
It filters. If you pick two flat faces, it offers coincident, parallel, perpendicular, distance, angle — the things you can do with two planes. If you pick two round cylindrical faces, it offers concentric, because that's the sensible thing for two cylinders. A flat face and a round face — it offers tangent. And lock is always on the menu because you can always just glue two things. There's a little function literally called `validMateTypes` that takes the two face kinds and returns the legal moves. So you can't ask for something geometrically nonsensical.

**MAYA:**
That's a nice guardrail. Okay. So I've clicked two faces, I've picked "concentric," and now there's this *rule* in the system. But a rule isn't a position. Somebody still has to turn "these should be concentric" into "the bolt is right *here*." And that's the tiny engineer.

**THEO:**
That's the tiny engineer. That's the mate solver. And it's the hardest, most beautiful piece of this whole subsystem, so let's give it a real segment.

## Segment 3 — The solver, in intuition

**MAYA:**
So set it up for me. I've got a few parts, I've got a handful of these rules, these mates. Some of them are about touching, some about lining up. What does the solver actually *do* with that?

**THEO:**
Intuition first, then we'll get real. Here's the picture I want in your head. Imagine all your parts floating in space, roughly where you dropped them, not quite right. And imagine every mate is a little spring, pulling toward "satisfied." The concentric mate is a spring stretched unhappy because the bolt isn't centered in the hole yet — it wants to pull the bolt onto the axis. The coincident mate is a spring unhappy because two faces that should be touching are floating apart. So you've got this whole web of unhappy springs, all pulling at once, in different directions.

**MAYA:**
And the solver is trying to make all the springs happy at the same time.

**THEO:**
It's trying to find the one arrangement where the total unhappiness is as close to zero as it can get. And the way it does it is honestly very human. It looks at the current arrangement, measures how unhappy each spring is — how badly each rule is being broken right now — and then it asks "which direction should I nudge the free parts to reduce the total unhappiness the fastest?" It nudges. It re-measures. It nudges again. Over and over, dozens of times, each nudge a little smaller than the last, until everything settles and the springs are as relaxed as they're going to get.

**MAYA:**
So it's iterative. It doesn't *solve* it in one shot like an equation — it kind of feels its way downhill.

**THEO:**
It feels its way downhill. That's exactly the metaphor people use — it's "gradient descent," rolling downhill toward the bottom of a valley where the valley floor is "all rules satisfied." The specific method has a great name, it's called Levenberg-Marquardt, and people sometimes shorten it to LM, and it's a classic least-squares algorithm. "Least squares" just means "make the total error as small as possible." It's the same family of math you'd use to fit a line through a cloud of data points. We're just fitting *positions of parts* through a cloud of *constraints*.

**MAYA:**
And it does this fast enough that to me it looked instant. The bolt just snapped.

**THEO:**
For our assembly sizes, yeah, a handful of milliseconds. It runs in your browser while you drag, so you get that live snapping feel. Now — one rule of the game I have to tell you, because it trips everyone up the first time. At least one part has to be nailed down. Grounded. Pinned to the table.

**MAYA:**
Why? Why can't they all just float and figure it out?

**THEO:**
Because relationships are *relative*. "The bolt is concentric with the hole," "this face touches that face" — every rule is about parts relative to *each other*. None of them say anything about where the whole cluster sits in absolute space. So if nothing's pinned, the solver could satisfy every rule perfectly... then slide the entire happy assembly three feet to the left and it'd be *just as satisfied*. Nothing pulls it back.

**MAYA:**
Oh. So the assembly would just drift. Like it's correct but homeless.

**THEO:**
[laughs] Correct but homeless. There'd be infinite right answers, which to a solver is the same as no answer. So we pin one part — that's "grounded" — and now everything else has a fixed thing to be positioned *relative to*. And here's a nice touch: if you forget to ground anything, the system doesn't yell at you. It just quietly grounds the first part you placed, so there's always an anchor. You don't have to think about it.

**MAYA:**
That's a kind move. Okay, so it nudges everything downhill until the springs are happy. But here's where I want to push. You said it tells you whether you've under-constrained, fully constrained, or contradicted yourself. That feels like a different, harder thing than just *finding* a position. How does it know the difference?

**THEO:**
This is my favorite part, honestly, so I'm glad you went straight at it.

## Segment 4 — Under, fully, over: the solver's three verdicts

**THEO:**
So after the solver finishes nudging, it gives you one of three verdicts, and they correspond to three situations every engineer runs into constantly. Let me do them in order of constrained-ness.

**MAYA:**
Okay.

**THEO:**
**Under-constrained.** This means: I found a valid position, but the part is still free to move in some directions and the rules wouldn't care. Picture a bolt that's concentric with a hole but you haven't told it how deep to go. It's correctly *on the axis*, but it can still slide up and down the hole, and it can still spin around. Those are free motions. The rules are all satisfied, but the part isn't fully pinned down.

**MAYA:**
So under-constrained means "I haven't told it enough yet. It still has wiggle room."

**THEO:**
Right. And the solver doesn't just say "under-constrained," it tells you *how much* wiggle room — it gives you a number, the remaining degrees of freedom. A free part in 3D starts with six degrees of freedom: it can move along three axes, and it can spin around three axes. Six total. Every mate you add eats into that. Drop a concentric mate on a totally free bolt and you've used up four of the six — it can still slide along the axis and spin around it, so two degrees of freedom remain. The solver will literally tell you "two."

**MAYA:**
Six to start, and each mate carves some away. So I can watch the number drop toward zero as I add rules.

**THEO:**
And zero is the next verdict. **Fully constrained.** Zero degrees of freedom remaining. The part can't move at all without breaking a rule. It is completely pinned down. This is usually what you *want* for a finished assembly — everything located exactly, nothing floppy.

**MAYA:**
So fully constrained is the goal state. Everything's locked.

**THEO:**
Usually, yeah. And then the third verdict, the spicy one. **Over-constrained.** This means your rules *contradict each other*. You've told the system two things that can't both be true.

**MAYA:**
Give me the dumbest possible example so I really feel it.

**THEO:**
The dumbest possible example is also a real one from our test suite. You take two faces and you add a distance mate: "keep these ten millimeters apart." Fine. Then you add *another* distance mate on the same two faces: "keep these twenty millimeters apart."

**MAYA:**
[laughs] They can't be ten apart and twenty apart at the same time.

**THEO:**
They cannot. There is no arrangement in the universe that satisfies both. And here's the thing — a naive solver might just kind of... split the difference. Settle at fifteen, where both springs are equally unhappy, and shrug. And that would be *terrible*, because you'd never know you'd made a mistake. The thing would just sit there subtly wrong.

**MAYA:**
So how does yours know it's a contradiction and not just a hard problem?

**THEO:**
Two signals. The first one is honest and simple: it tries its hardest to make the springs happy, and it *can't get the unhappiness to zero*. The total error never settles below the threshold no matter how long it nudges. That failure to converge — that's the tell. When the solver can't get the residual down where it should be, it raises its hand and says "over-constrained. These rules conflict. I'm showing you this rather than pretending I solved it."

**MAYA:**
And it shows you rather than hides it. That's the part the requirement actually calls out, right? "Surface the conflict instead of silently ignoring it."

**THEO:**
Verbatim the intent. The worst CAD experience in the world is a model that *looks* fine and is secretly broken. So we made "I can't satisfy these" a loud, visible state.

**MAYA:**
You said two signals. What's the second?

**THEO:**
The second is how it counts those degrees of freedom — the wiggle-room number — and it's genuinely clever, so let me try to make it intuitive without drowning you. When the solver is figuring out which way to nudge, it builds a kind of map of "how does each rule respond when I move each part a tiny bit." A sensitivity table. And there's a mathematical operation you can do on that table that essentially asks: "how many *independent* directions of control do these rules actually give me?"

**MAYA:**
Independent. Meaning — two rules that secretly say the same thing only count once?

**THEO:**
Exactly that. If you add a rule that's already implied by another rule, it doesn't actually constrain anything new — it's redundant — and the math sees through it. The technical word is the *rank* of that table. The rank tells you the number of genuinely independent constraints. And then the arithmetic is dead simple: degrees of freedom equals six-per-floating-part minus the rank. The leftover is the wiggle room.

**MAYA:**
So "fully constrained" is when the rank ate up all six. "Under" is when there's leftover. And "over" is when the springs literally can't relax to zero.

**THEO:**
You just gave the exact classification logic. If it didn't converge — if the springs won't relax — it's over-constrained. Otherwise, if there's leftover wiggle room, it's under-constrained. Otherwise, fully constrained. Three lines. The spec tests pin it down to specific numbers, too — one coincident mate on a free part leaves three degrees of freedom, "under." A concentric leaves two. Three coincident mates at right angles leave zero, "fully." Those two contradicting distance mates fail to converge, "over." It's all nailed down so it can't drift on us.

**MAYA:**
I want to sit on one thing, because I think it's the deepest point in this whole half. The solver isn't just a positioning tool. It's a *checking* tool. It's telling you something true about your *design* — whether you've described it completely, or under-described it, or asked for something impossible. That's more than "where does the bolt go."

**THEO:**
That's the whole reason it's worth building a real solver instead of having people drag parts around by hand. Dragging gives you a position. The solver gives you a position *and a verdict on your intent*. And it runs in two places — a copy in the browser so dragging feels live, and an authoritative copy on the server that runs whenever you save, so the stored positions are always the official, reproducible answer. Same math, both sides.

**MAYA:**
Two copies of the same brain. Browser for feel, server for truth.

**THEO:**
That's it exactly.

## Segment 5 — From mates to a whole product: the rest of the toolbox

**MAYA:**
Okay. So mates and the solver are the heart. But you teased a bunch of other stuff — patterns, mirrors, subassemblies, exploded views. That all sounds like the rest of what makes a CAD assembly tool feel like a real product. Walk me through the toolbox.

**THEO:**
Let's do it, and I'll group them, because they fall into nice buckets. First bucket: ways to make *more parts* without placing them one at a time. Three tools here.

**MAYA:**
Because nobody wants to place forty bolts by hand.

**THEO:**
Nobody. So, **patterns.** A pattern takes one part you've placed — we call it the seed — and stamps out copies in a regular arrangement. A *linear* pattern puts them in a straight row: "ten brackets, twenty-five millimeters apart." A *circular* pattern arranges them around a circle: "eight bolts evenly spaced around this hole circle." You place one, you say "linear, ten, twenty-five millimeters," and nine more appear.

**MAYA:**
And here's the question I always have with this kind of thing — are those real, separate copies that bloat the file? Or are they... cheaper than that somehow?

**THEO:**
Great instinct, and the answer is they're cheaper, and it matters. The pattern doesn't store ten brackets. It stores *one* bracket — the seed — plus the rule: "linear, ten, twenty-five apart." The nine copies are *derived* at draw time. When the system regenerates the assembly, it expands the rule on the fly: take the seed's already-computed shape, place a copy here, here, here. The document stays tiny. And there's a bonus — the copies reuse the seed's geometry, so we don't recompute the bolt shape ten times. We compute it once and stamp the mesh down in ten spots.

**MAYA:**
So it's the recipe philosophy again. Store the rule, cook the copies on demand.

**THEO:**
All the way down, like I promised. Second tool in this bucket: **mirror.** This is for left-and-right-hand pairs. Think of a car — the left door and the right door aren't the same part rotated, they're true mirror images of each other. A left bracket and a right bracket.

**MAYA:**
Like your left and right hands. You can't rotate one into the other. They're reflections.

**THEO:**
Perfect example, and that's exactly the subtlety. Mirror isn't "copy and move to the other side." It's a true geometric *reflection* across a plane. Every point flips to the mirror-image position. And there's a genuinely sneaky detail here that I love, because it's the kind of thing that's invisible until it bites you.

**MAYA:**
Tell me the sneaky thing.

**THEO:**
When you reflect a 3D shape, the surfaces turn inside out. Literally. The way 3D graphics works, every little triangle on a surface has a front and a back — there's an order to its corners that tells the renderer "this side faces out." When you mirror the whole thing, that order gets reversed, and suddenly all your surfaces are facing *inward*. The part would render like it's been turned inside out — lighting would be wrong, it'd look like a hole into nothing.

**MAYA:**
So mirroring naively gives you an inside-out ghost part.

**THEO:**
Right, so the mirror operation has to do a second step: flip every triangle's corner order back, so the surfaces face outward again. In the code, when mirror is on, there's a flag that says "reverse the winding," and it swaps the second and third corner of every triangle. Tiny operation. Completely essential. Get it wrong and your right-hand bracket is a visual disaster.

**MAYA:**
I love that. It's a "the obvious thing is subtly wrong, here's the fix" detail. And — you flagged earlier you wanted to be honest about some approximations. Is mirror one of them?

**THEO:**
Good memory, and yes — mirror is exactly where I want to be candid. The *picture* of the mirrored part is perfect. The mesh on screen is correctly reflected, surfaces facing the right way. But there's a second representation of a part — the precise mathematical solid, the "BRep" from the kernel episode, the exact one we use for *exporting* to a real CAD file.

**MAYA:**
The boundary representation. The exact-math version, versus the triangle-mesh version you look at.

**THEO:**
Right. And for mirrored copies, the *export* version is, at the moment, approximated. When you export the assembly to a STEP file to hand to a machine shop, the mirrored copy currently goes out using the *seed's* exact solid, not a truly reflected one. So the thing on your screen is correctly mirrored, but the precise exported solid for that one copy isn't reflected yet.

**MAYA:**
Wait, so the picture and the export disagree for mirrored parts?

**THEO:**
For mirrored parts specifically, yes, right now. And I want to be totally straight about this because it's the honest state of the thing — there's literally a comment in the code flagging it. The screen mesh is correct. The exported precise solid for a mirror copy isn't reflected yet. Linear and circular patterns export perfectly, by the way — those are just rotations and slides, and the kernel handles those exactly. It's only the *reflection* that's approximated on export. It's a known "good enough for now," with a note pointing at exactly where to fix it.

**MAYA:**
I genuinely appreciate that you led me into that instead of letting me find it. Most people demoing software would've just... not mentioned it.

**THEO:**
The doc itself flags it as a footgun. Hiding it would be the actual sin. It's a real limitation, it's scoped, it's written down, and anyone who hits it will find the comment. That's the honest way to ship something that isn't finished in every corner.

**MAYA:**
Okay. That's the "make more parts" bucket — patterns, mirror. You said there was a third.

**THEO:**
Third one's the big structural one: **subassemblies.** And this is conceptually lovely. A subassembly is when you take a whole assembly — say you've built a complete gearbox, dozens of parts, all mated up — and you drop that *entire gearbox* into a bigger assembly as if it were a single part.

**MAYA:**
Oh, so it's assemblies inside assemblies. Like folders inside folders.

**THEO:**
Exactly like folders inside folders. You build the gearbox once, in its own assembly. Then in the car assembly, you place the gearbox as one component. To the car, the gearbox is just "a part that happens to be made of forty other parts." And it nests as deep as you want — the gearbox could contain a sub-sub-assembly, which contains another one.

**MAYA:**
And when you draw the car, the system has to... unfold all of that? Recursively?

**THEO:**
It recurses. To draw the car, it regenerates the gearbox first — which itself regenerates *its* subassemblies — and then places the whole resolved gearbox as one rigid blob in the car. It's the same regenerate function calling itself, one level deeper, each time. There's exactly one thing it forbids.

**MAYA:**
Let me guess. You can't put the gearbox inside itself.

**THEO:**
You can't put an assembly inside itself, directly *or* through a chain. Gearbox contains widget contains gearbox — banned. Because the recursion would never stop. It'd unfold forever and the program would just spin. So there's a cycle check that walks the chain of references before it lets you make the connection, and if it spots a loop coming back to itself, it refuses with a clear error — "an assembly cannot contain itself." And it catches the dumb direct case without even hitting the database, just by comparing the part IDs, so the guard is fast and works everywhere.

**MAYA:**
That's the folders thing again — you can't put a folder inside itself. Same trap, same guard. Okay, that's the "more parts" bucket. What's the next bucket?

**THEO:**
Next bucket: ways to *look at* the assembly without changing what it is. Three of these, and they're all about communication and inspection. First, **exploded views.** You know those furniture-assembly diagrams where all the pieces are floating apart with little lines showing how they come together?

**MAYA:**
The IKEA diagram. The one where the screws are hovering near their holes.

**THEO:**
That's an exploded view. Our editor lets you pull all the parts apart along a slider — zero is fully assembled, one is fully blown apart — and it animates smoothly between. And there's an "auto explode" button that's a nice little trick: it finds the center of the whole assembly, and pushes every part *outward* from that center, so things naturally spread apart radially instead of all piling up. You get a usable explosion in one click, then fine-tune by dragging.

**MAYA:**
And — let me check my recipe instinct — is the exploded view changing the actual positions of the parts? Or is it just a viewing trick on top?

**THEO:**
Pure viewing trick. The real positions never change. The explosion is just an offset added to each part's display position, scaled by that zero-to-one slider, applied right at the last second before drawing. The underlying assembly is exactly as mated as ever. You're just visually pulling the picture apart. Slide it back to zero and it's reassembled, untouched.

**MAYA:**
So it's like spreading out a deck of cards on the table — you didn't change the deck, you just fanned it so you can see each one.

**THEO:**
That's a better metaphor than the one in my head. Yes. Second viewing tool: **display states.** These are saved show-and-hide configurations. Say you want to show the frame but hide all the fasteners so you can see the structure clearly. You hide the bolts, and then you save that as a named state — "frame only." Later, one click brings it back. You don't re-hide forty bolts by hand.

**MAYA:**
So it's like saved layer setups. A named snapshot of what's visible.

**THEO:**
Exactly. It just remembers the list of which parts are hidden, under a name. Show only the electronics. Show only the housing. Click to recall. Third viewing tool: **section view.** This one slices the assembly with a flat plane so you can see *inside* it.

**MAYA:**
Like cutting a cake in half to see the layers.

**THEO:**
Precisely like that. You define a cutting plane, and the renderer just doesn't draw anything on one side of it. So you get this clean cutaway and you can peer into the guts — check that the interior parts actually fit, that there's clearance, that the wiring has room. Toggle it off and the cake's whole again. And it's a single cutting plane, which covers the overwhelming majority of inspection needs. Here's the part I want to flag, though, because it's a preview of the big idea: section view isn't really an *assembly* feature.

**MAYA:**
What do you mean?

**THEO:**
The cutting-plane capability lives in the 3D *viewer* — the same viewer that shows you a single part. So section view works in the single-part CAD editor *and* the assembly editor, for free, because it's the same viewer underneath. We wrote the clipping plane once. Both sides got it. Hold that thought — it's the entire second half of this episode in miniature.

**MAYA:**
Noted and held. Okay, two buckets down — make-more-parts, and ways-to-look. Is there a third?

**THEO:**
Third bucket: ways to *interrogate* the assembly. Get answers out of it. Two big ones. **Interference detection** and **mass properties.**

## Segment 6 — Asking the assembly questions: interference and mass

**THEO:**
**Interference detection** answers a deceptively important question: do any two parts crash into each other? Do any of them try to occupy the same physical space?

**MAYA:**
Which would be a disaster, because you can't actually build two solid things that overlap. The bolt can't pass through the steel.

**THEO:**
Right, it's physically impossible, and catching it on the screen is *so* much cheaper than catching it on the shop floor after you've cut metal. The naive way to check is: take every pair of parts, and do an exact, precise geometric overlap test. Does part A's exact solid intersect part B's exact solid?

**MAYA:**
And let me guess — that's brutally slow if you've got hundreds of parts, because the number of pairs explodes.

**THEO:**
It explodes, and the exact test is the expensive one — it's a real geometric boolean operation in the kernel. So we do a classic two-phase trick, and it's a pattern you see all over graphics and physics. Phase one, the cheap rough pass: for every part, compute its *bounding box*. Just the smallest axis-aligned box that contains the whole part. A box is trivially cheap to test — do two boxes overlap? That's six number comparisons.

**MAYA:**
So you wrap every part in a cardboard box and ask "do any boxes overlap." Fast and rough.

**THEO:**
Fast and rough — we call it the broad phase. And most pairs of parts in a real assembly are nowhere near each other, so their boxes don't overlap, and you reject those pairs instantly. Then phase two, the narrow phase: *only* for the handful of pairs whose boxes actually do overlap, you run the expensive exact test. You compute the true geometric intersection of the two precise solids, and if there's any real overlap, that's a genuine interference.

**MAYA:**
So the boxes are a filter. They throw out the obvious non-collisions cheaply so you only pay for the precise math on the suspicious pairs.

**THEO:**
That's the entire idea, and it's a beautiful pattern because the cheap pass and the expensive pass have totally different costs. Boxes: pennies. Exact boolean: dollars. You spend pennies to avoid spending dollars. And there's a nice graceful degradation here, too — if the geometry kernel happens to be offline, you can still run the box pass. So the system says "these pairs are *candidates*, their boxes overlap, I can't confirm precisely right now but you should look." Rough answer's still better than no answer.

**MAYA:**
And there's a sensible rule I'd want — a part shouldn't interfere with *itself*, right? Two copies of the same bolt that happen to be near each other, fine, but the bolt's own faces against each other, that's not a collision.

**THEO:**
Exactly handled — it skips any pair of faces that belong to the same component. A component can't interfere with itself. Only different instances can collide. Okay, second interrogation tool: **mass properties.** This one answers "how big is it, and where's the balance point?"

**MAYA:**
Volume and center of mass.

**THEO:**
Volume and center of mass. Total volume is the easy one — you just add up the volume of every part. Each part already knows its own volume from when the kernel computed its shape. Sum them.

**MAYA:**
And center of mass? That's the balance point — where you could theoretically balance the whole thing on one finger.

**THEO:**
Right, and that's a *weighted* average. It's not just the average position of the parts — it's the average weighted by how much material each part has. A big heavy part pulls the balance point toward itself; a tiny screw barely budges it. So you take each part's own center, multiply by its volume, add all those up, and divide by the total volume. That gives you the volume-weighted center — the balance point of the whole assembly.

**MAYA:**
And — recipe instinct again — those part centers, are they in the assembled positions? Because a part's center is one place when it's sitting at the origin and a totally different place once it's bolted into the corner of the machine.

**THEO:**
You are *really* internalizing this. Yes. The centers used are the *placed* centers — after each part's been moved into its assembled position. The placement transform moves the center along with the geometry, so by the time mass properties sums them up, every center is already in world position, in the assembly. So the balance point you get is the real balance point of the actual product, not of a pile of parts at the origin.

**MAYA:**
Good. So that's three buckets — make more parts, look at it different ways, ask it questions. And there's one more thing on your list I haven't heard about, which is the parts list. The bill of materials.

**THEO:**
The BOM. And this is the bridge between the CAD world and the rest of the company, so it's worth its own beat.

## Segment 7 — The bill of materials: where CAD meets the business

**THEO:**
A bill of materials is just the parts list. Which parts, and how many of each. "Three of part A, one of part B, twelve of the screw." Every manufactured product has one — it's what purchasing orders from, what the kitting team pulls, what planning schedules around.

**MAYA:**
And in most worlds, somebody *types* that list by hand, right? Looks at the design and transcribes it into a spreadsheet.

**THEO:**
Which is exactly where errors come from. The design changes, the spreadsheet doesn't, and now you've ordered the wrong count of brackets. So here, the BOM is *derived* — automatically counted from the assembly. The system walks the instance list and counts: how many instances point at part A, how many at part B. Three instances of A, one of B — the list says "A times three, B times one." Nobody types it. It's always exactly what's in the assembly, because it *is* what's in the assembly, just counted.

**MAYA:**
The recipe philosophy strikes again. Don't store the count, derive it.

**THEO:**
[laughs] It's the running theme, isn't it. Store the truth once, derive everything from it. And there's a great detail — the BOM counts the *authored* instances, the ones in your document. Suppressed instances, the ones you've turned off, don't count. But here's the thing I want you to appreciate about this system specifically.

**MAYA:**
Go.

**THEO:**
The assembly part — remember, an assembly *is* a part, it's got its own part number in the inventory system — it sits inside a whole existing manufacturing app. There's already an inventory system, with a bill-of-materials table, that the ordering and kitting and planning tools all read from. They've existed for years. So there's a "sync" button.

**MAYA:**
And sync pushes the CAD-derived list into the existing inventory records.

**THEO:**
Exactly. You hit sync, and it takes the counted list — "A times three, B times one" — and writes it into the same bill-of-materials table that the rest of the company already uses. It clears out whatever was there before for this assembly and writes the fresh list. And the *moment* it does that, the ordering tool can order these parts. The kitting tool can pull them. The planning tool can schedule them. None of those tools know or care that the list came from a 3D CAD assembly. To them it's just a normal bill of materials, in the normal table.

**MAYA:**
So the CAD assembly isn't off in its own little island. It plugs straight into the business systems that were already there.

**THEO:**
That's the whole point of building CAD *inside* the manufacturing app instead of bolting on some separate CAD package. The design and the business are the same system. You design the assembly in 3D, you sync, and now it's a real thing the company can order and build. And because an assembly is itself a part, an assembly can be a *line item in a bigger assembly's* bill of materials. The gearbox shows up as one line in the car's parts list. The structure nests, the same way subassemblies nest. It's all consistent.

**MAYA:**
And the last thing — export. The hand-it-to-someone-else file.

**THEO:**
Quick one. You can export the whole assembly as a single 3D file — STEP for precise CAD interchange, or STL for meshes and 3D printing. And the crucial bit is every part comes out *where it sits in the assembly*. The file is the assembled product, not a pile of loose parts dumped at the origin. The system takes each part's exact shape, moves and rotates it into its assembled position, and writes them all out together as one model you can hand to a machine shop or an inspector.

**MAYA:**
And that's where the mirror-export caveat from earlier lives.

**THEO:**
That's exactly where it lives, yeah — in this export path. Patterns and ordinary placements export perfectly. The one approximation is that a mirrored copy's *precise exported solid* isn't reflected yet, even though it looks right on screen. Everything else in the file is exactly placed. And there's a bonus path for *released* assemblies — if the assembly's been frozen as an official revision, export reads the stored frozen shapes directly instead of recomputing, which guarantees the exported file is byte-for-byte what was approved. No drift, no surprises.

**MAYA:**
Frozen geometry, official revision — that's the version-control stuff from last episode bleeding in.

**THEO:**
And *that* is the perfect doorway into the second half. Because the question you should be asking right now is: hang on, how does an *assembly* have releases and frozen revisions and branches? We spent a whole episode on version control for a single *part*. When did assemblies get all of that?

**MAYA:**
...Yeah. When did assemblies get all of that? I was about to assume you built a second version control system for assemblies.

**THEO:**
And that assumption is the most natural thing in the world. And it's wrong. And *why* it's wrong is the big idea. Let's take a break from features and talk about the bones of the thing.

## Segment 8 — The big idea: parts and assemblies are the same app

**THEO:**
So here's the trap. The seductive, natural, everybody-falls-into-it trap. You've built one good thing — single-part CAD, with its editor and its version control and its measuring tools. Now you need a *second* good thing — assemblies. They're similar but not identical. What's the obvious move?

**MAYA:**
Copy the part code, paste it, change the bits that are different. Make an assembly editor that's like the part editor but for assemblies. Make assembly version control that's like part version control but for assemblies.

**THEO:**
And it feels *productive*. You ship fast. Day one, you've got assemblies, look at you. And then.

**MAYA:**
And then?

**THEO:**
And then six months later you fix a nasty bug in the version control — say, a race where two people releasing at the same time corrupt the history. You fix it on the part side. You ship.

**MAYA:**
Except there are now two version control systems, and you only fixed one of them.

**THEO:**
You only fixed one. The assembly side still has the bug — and you might not even *remember* there are two, because the copy-paste was six months ago. So the assembly side quietly stays broken, the two systems drift apart with every change, every new feature gets built twice, every bug fixed twice, and half the time you forget the second copy exists.

**MAYA:**
That's the classic thing where the codebase slowly rots because the same logic lives in two places and falls out of sync.

**THEO:**
It's maybe *the* classic failure mode of growing software. Two parallel systems that were "basically the same" at birth and slowly become subtly, dangerously different. So this system makes a hard, disciplined choice to *not do that*. The choice is: parts and assemblies are the *same application*. The version control is written *once*. The editor is written *once*. The measuring tools are written *once*. CAD and assembly don't each have their own copy — they *plug into* the shared one.

**MAYA:**
Okay, but — and here's where I push, because this always sounds great as a slogan — they're *not* the same. A part is a recipe of features, extrudes and cuts. An assembly is a list of components and mates. The version control has to save them, and they save *differently*. You can't just pretend they're identical.

**THEO:**
And that is the exactly right objection, and the answer to it is the actual clever bit. You don't pretend they're identical. You find the *small, specific* places where they genuinely differ, and you make *only those* swappable. Everything else stays shared. The trick is being surgical about where the difference lives.

**MAYA:**
So how do you do that without it turning into spaghetti?

**THEO:**
Let me give you the analogy that's actually in our documentation, because it's a good one. Think of a coffee machine that can make espresso or tea. The machine — the heating element, the pump, the buttons, the timer — that's one device. It doesn't change. To switch between espresso and tea, you swap in a little *pod*. The pod is tiny. It just says: "this much water, this temperature, this grind." The machine reads the pod and does its thing.

**MAYA:**
So the machine is the version control, and the pods are... the part-ness and the assembly-ness.

**THEO:**
Exactly. The machine is all the hard, shared logic — locking a document so two people don't edit it at once, saving a snapshot, making a branch, comparing two versions, freezing a finished design, running the review-and-approve process. That machine is written and tested *one time*. And then there are two little pods. We call them *bindings*. The CAD pod and the assembly pod.

**MAYA:**
And what's *on* the pod? What does the binding actually say?

**THEO:**
This is the beautiful part — the pod is genuinely small. It answers maybe a handful of document-specific questions, the questions the shared machine can't answer on its own. Things like: "How do I turn *my* document into something you can save?" "How do I read it back?" "How do I rebuild my 3D geometry from it?" That's basically it. The CAD pod says "my document is a feature tree plus sketches plus equations, and here's how I cook it into 3D." The assembly pod says "my document is a list of components and mates, and here's how I cook *it* into 3D."

**MAYA:**
And then everything else — the locking, the branching, the comparing, the freezing, the releasing, the review workflow — the machine handles all of that and never has to know which pod is in it?

**THEO:**
Never has to know. The machine works in terms of "a document" — generic, abstract. It says "give me your document," and the pod hands it over; "save this," and the pod knows how to write it. The machine does the locking and branching and the commit graph and the diff *the same way no matter which pod is plugged in*. The differences are sealed inside the pod. The machine is document-blind on purpose.

**MAYA:**
So when you said the assembly "got version control for free" — you mean someone wrote the assembly pod, which is small, and then the *entire* existing version-control machine just worked on assemblies.

**THEO:**
That is precisely what happened, and it's not a figure of speech. Branching worked. Locking so two people can't clobber each other worked. The visual history graph — the thing that draws the tree of commits and branches — worked, because it operates on the generic object store, not on anything part-specific. Comparing two versions worked. The review-and-approve workflow worked. The freeze-on-release that snapshots the exact geometry worked. None of that was rewritten for assemblies. The assembly pod is a few functions. Everything downstream was already there.

## Segment 9 — Why "written once" pays off forever

**MAYA:**
Let me make sure I've got *why* this matters, concretely, not just as a tidiness thing. Because "less code" sounds nice but a little abstract.

**THEO:**
It's not abstract at all — two very concrete payoffs. First: *correctness*. Roughly half as much code to keep correct. The version control logic — genuinely the trickiest, most bug-prone part of the whole system, all that concurrent-editing and history-graph stuff — exists in exactly one place. So that nasty release race I mentioned? We fixed it once, in the shared machine, and *both* parts and assemblies got the fix the same instant. No second copy to forget.

**MAYA:**
Right, the rot scenario can't happen, because there's nothing to drift *from*. There's one of it.

**THEO:**
There's one of it. The two-systems-drifting-apart failure is structurally impossible here, because there aren't two systems. Second payoff: *new features are automatic*. Say next month we add a cool new version-control feature — pick any two old versions and get a rich visual diff of what changed between them. We build that into the shared machine. The day it ships, it works for assemblies *too*, with zero extra work, because assemblies ride the same machine.

**MAYA:**
So every improvement to the core lands on both sides simultaneously, forever. You build it once, both products get it, in perpetuity.

**THEO:**
In perpetuity. And it compounds. Every single feature we ever add to that core — that's twice the value for the same effort, forever, because two document types benefit from one implementation. There's actually a concrete example baked right into how the version *comparison* works. When it diffs two versions and lists what changed, it mostly speaks in generic terms — "this thing changed, that thing was added." But it knows a *little* bit about labeling: it can say "Component such-and-such" for an assembly change and "this feature" for a part change. That tiny bit of document-specific labeling is the *only* assembly-awareness in the entire diff engine. The actual hard part — figuring out *what* changed between two versions, efficiently — is one hundred percent shared.

**MAYA:**
And it does that efficiently using the content-addressing thing from last episode, right? Where identical chunks have identical fingerprints?

**THEO:**
You remembered the magic. Yes. Because everything's content-addressed — same content, same fingerprint — comparing two versions is mostly just comparing fingerprints. If two chunks have the same fingerprint, they're identical, skip them instantly, don't even look inside. So the diff only does real work on the parts that *actually* changed. And that machinery doesn't care whether the chunks represent CAD features or assembly components. Fingerprints are fingerprints. It's all the same comparison.

**MAYA:**
Okay, what about the editor? You said earlier the assembly editor *is* the part editor. That can't be literally true — they show different things.

**THEO:**
More literally true than you'd think — same pattern playing out in the frontend. There is *one* editor component. One. When you open it, it checks a single flag — assembly mode or not? — and that flag comes straight from which web address you came in on. The part URL doesn't set it; the assembly URL does. In assembly mode, the editor swaps out a couple of panels — component-and-mate tools instead of sketch-and-extrude tools — and points its save and branch and release buttons at the assembly side. But the 3D viewer? Identical. The version-control panel — checkout, check-in, branches, compare, release? Identical, just aimed at a different document. The measuring tools? Identical.

**MAYA:**
So it's the same cockpit, and a switch changes which instruments light up.

**THEO:**
That's a great way to put it. Same cockpit, one switch. Nothing in the viewer is duplicated. Nothing in the version UI is duplicated. Nothing in the measurement tools is duplicated. That's why section view — remember, the cake-slicing cutaway — works in both editors for free. It lives in the shared viewer. We wrote the cutting plane *once*, on the one viewer both editors use, and both got it. Same story as everything else.

**MAYA:**
I want to name the discipline here, because I think it's the real lesson. The hard part wasn't writing clever code. The hard part was *resisting* the easy thing. Resisting copy-paste. Being willing to stop and find the small seam where parts and assemblies actually differ, and put a clean little pod there, instead of forking the whole system and shipping a day faster.

**THEO:**
That's the entire lesson, and you said it better than the documentation does. The seductive move is always to copy. It feels fast. And it is fast — for about a month. Then it's a tax you pay on every change for the rest of the project's life. The discipline is to find the *real* axis of difference — here it's literally just "how do I save myself, and how do I rebuild my geometry" — make *that* swappable, and share everything else ruthlessly. It's more thinking up front and *enormously* less pain forever after. Half the code, and the half you kept can't silently drift, because there's nothing to drift from.

**MAYA:**
And the payoff isn't even subtle once you see it. The proof is just sitting there: an assembly is a wildly different beast from a single part — components and mates and a constraint solver versus extrudes and sketches — and yet it inherited branching, locking, history, comparison, releasing, freezing, the whole editor, and the measuring tools, basically by writing one small pod.

**THEO:**
That's the big idea in one sentence. Two very different documents, one machine, written once. That's the bones of the whole system. Everything you've seen across all four episodes hangs on that skeleton.

## Recap

**MAYA:**
Okay. Season 1 finale recap. Let me pull out the things I want people to actually walk away with from today, and then I want to do the *whole-season* victory lap, because we've come a long way. Today first. Theo, keep me honest.

**THEO:**
I'm here for it.

**MAYA:**
Takeaway one. **An assembly is a scene of finished parts.** It's not a recipe for one shape — it's a list of *instances* (the same bolt placed twenty times, each one a reference plus a position) held together by *mates* — relationships, not coordinates. "This shaft is concentric with that hole." "These faces touch." You describe intent, and the positions get figured out for you, which means when the design changes, everything follows along instead of breaking.

**THEO:**
And that "relationships not coordinates" point is the one I'd tattoo on people. It's the entire reason assembly modeling exists.

**MAYA:**
Takeaway two. **The mate solver is the tiny engineer who decides where everything lands.** It treats every mate like a spring pulling toward "satisfied," and it nudges the free parts downhill until the total unhappiness bottoms out. One part has to be pinned, or the whole thing drifts. And crucially, it gives you a *verdict on your design*: under-constrained means there's still wiggle room — and it counts exactly how much; fully constrained means everything's locked; over-constrained means your rules contradict each other — and it shows you that loudly instead of quietly faking an answer. It's a positioning tool *and* a checking tool.

**THEO:**
The checking is the underrated half. A tool that tells you your intent doesn't make sense is worth more than one that just does what you said.

**MAYA:**
Takeaway three. **The rest of the toolbox makes it a real product, and we were honest about the rough edges.** Patterns stamp out rows and circles from one seed without bloating the file. Mirror makes true left-right-hand twins — and has to flip the surfaces back outward or they render inside out. Subassemblies nest assemblies inside assemblies like folders, with a guard against putting one inside itself. Exploded views, display states, and section cuts let you *look* at it; interference checks and mass properties let you *interrogate* it; the bill of materials counts your parts automatically and syncs straight into the company's existing ordering and kitting systems. And the one honest caveat — mirrored copies are correct on screen but their precise *exported* solid isn't reflected yet. Flagged, scoped, written down.

**THEO:**
The honest caveat is the one I'm proudest of mentioning, weirdly. Shipping software always has a "good enough for now" somewhere. Naming it is the difference between a tradeoff and a lie.

**MAYA:**
And takeaway four — the big one. **Parts and assemblies are the same app.** Version control, the editor, and the measuring tools are each written *once*. CAD and assembly are two tiny "pods" — bindings — that only answer "how do I save myself" and "how do I rebuild my geometry." Everything else is shared. The payoff: half the code to keep correct, no risk of two systems drifting apart, and every new core feature lands on both sides instantly and forever. The discipline was resisting copy-paste and finding the one small seam where they genuinely differ.

**THEO:**
Two documents, one machine. That's the whole architecture in four words.

## Teaser

**MAYA:**
So that's not just the end of the episode — that's the end of Season 1. And I want to take one breath and look at the arc, because I didn't fully feel it until just now. We started with "what is parametric CAD" — a model is a *recipe*, a list of steps, not a frozen lump. Then we went down into the *kernel*, the Rust engine doing the brutal 3D geometry math. Then the *time machine*, the git-for-CAD version control that lets a physical part branch and merge and release like source code. And today we stacked parts into *assemblies*, met the solver that makes them fit, and then pulled back to see the architectural bones — that the whole thing is *written once* and the pieces just plug in.

**THEO:**
Four episodes, and I genuinely think you could now walk into a room of CAD engineers and hold a real conversation. That was the whole goal of Season 1 — get oriented. Understand the *concepts*, and the *why*. Why it's built this way.

**MAYA:**
And Season 2?

**THEO:**
Season 2, we go *deep*. Season 1 was the friendly tour, the view from the helicopter. Season 2 is boots on the ground. Real mechanics. Actual data structures, actual algorithms, the file names, the function names, the edge cases, the footguns — the stuff I kept *almost* saying and then pulling back from because it was too much for a first pass.

**MAYA:**
The stuff where you'd start to geek out and I'd cut you off.

**THEO:**
[laughs] All the stuff you cut me off on. It's coming. And we don't start in the middle — Season 2, Episode 5, we go back to *first principles* and build the whole mental model up properly, rigorously, from the ground. If Season 1 told you *what* a parametric model is, Episode 5 starts showing you *exactly how* one is represented, step by step, bit by bit.

**MAYA:**
So if today's episode left you wanting the *actual gears* — the real machinery under everything we've waved our hands at — that's where we're going. Season 2, Episode 5. First principles, the deep version.

**THEO:**
Bring a notebook for that one. You'll want it.

**MAYA:**
That's a wrap on Season 1. Thank you for spending it with us — genuinely, it's been a blast watching a 3D modeling system stop being a black box. Theo, thank you.

**THEO:**
Always. See you in the deep end.

**MAYA:**
See you in Season 2.

---

# Episode 5 — First Principles: Why Browser CAD, and How It All Fits

## Cold open

**THEO:**
Okay. I want to start with something that sounds wrong, and then convince you it's right.

**MAYA:**
That's a confident way to open a season.

**THEO:**
A part's shape — the actual 3D geometry of a physical object — is not a file you save. It's a history you replay.

**MAYA:**
Nope. I have a folder full of files that are very much shapes. I can email you one right now. It'll have a little 3D icon.

**THEO:**
You can email me a *photograph* of the shape. That's what those files mostly are — a frozen snapshot of the surfaces. But the thing that actually defines the part — the thing a designer reasons about — is the recipe. "Draw this rectangle, push it 40 millimeters, drill these two holes, round these edges." Change the rectangle, and the holes and the rounds move with it. The file doesn't know how to do that. The recipe does.

**MAYA:**
So you're saying the file is the cake, and you want to ship the *recipe*.

**THEO:**
I want to ship the recipe, keep every version of the recipe, attach the recipe to the part number in our inventory system, and only bake the cake when somebody needs to look at it.

**MAYA:**
And bake it... in a browser tab.

**THEO:**
In a browser tab. With a geometry engine written in Rust sitting behind it doing the actual math.

**MAYA:**
Alright. You've got an hour. Convince me the cake is a lie.

## Intro

**MAYA:**
Welcome back. If you're new — first, hi, and second, you might want to go listen to Season 1, because we built up a lot of intuition there that we're about to lean on hard. Season 1 was the gentle tour: what is parametric CAD, why would you put it in a browser, what's a feature history, what's a mate. Big-picture, low on jargon.

**THEO:**
And this season we open the hood.

**MAYA:**
This is Season 2. The deep dive. Eight episodes where we actually crawl through the machinery — the data shapes, the algorithms, the file names, the places where Theo will, I am promised, be honest about what's held together with tape.

**THEO:**
There's tape. There's good tape and bad tape.

**MAYA:**
We'll grade the tape. So today is the season opener, and the job of a season opener is to lay the frame. By the end of this episode I want a listener to be able to hold the *whole system* in their head as one picture — four parts, how they fit, and the one big idea that ties them together. Then every later episode zooms into one corner of that picture.

**THEO:**
Exactly the plan. So I'll give you the map, and you keep me honest about when I'm hand-waving.

**MAYA:**
That is my entire job. Let's start with the thing that bugs me. Why does this exist at all? There are extremely good CAD programs in the world. SolidWorks. Fusion. Onshape. Why build another one, and why bolt it onto an *inventory app*, of all things?

**THEO:**
That's the right place to start, because the *why* explains every weird decision after it.

## Segment 1 — The real problem: CAD that forgot where it lived

**THEO:**
Here's the situation this whole thing was built to fix. You've got a manufacturing shop. They've got an inventory and manufacturing system — the database of record. Every physical thing has a Part row. The part number, the revision, the bill of materials, what's in stock, what work order it's on, what it costs. That database is the source of truth for the business.

**MAYA:**
The thing that, if it's wrong, you ship the wrong widget and lose money.

**THEO:**
Right. Now — where does the *geometry* of that part live? The actual shape?

**MAYA:**
In the CAD program. On somebody's machine. In a CAD file.

**THEO:**
In a CAD file, on a file server, with a name like `bracket_v3_FINAL_actually_final_rev2.sldprt`.

**MAYA:**
[laughs] I have seen that exact filename. I think I made that filename.

**THEO:**
And that's the whole problem in one filename. The geometry and the business record are divorced. They live in two different worlds that don't talk. The inventory system says this is Part 4051, revision B. The CAD file says... whatever the person who saved it last decided to call it. Nothing enforces that they match. Nothing guarantees the shape in that file is the shape manufacturing is actually building. The revision in the filename and the revision in the database drift apart, and one day somebody machines the wrong version of a bracket because the file said rev2 and the system said rev B and nobody could tell which was newer.

**MAYA:**
So the geometry has no anchor. It's floating next to the system instead of inside it.

**THEO:**
Floating. And the moment it's floating, you've got a whole second universe of governance to maintain — a PDM system, a vault, check-in rules, naming conventions — all just to keep the floating files lined up with the database that was supposed to be in charge in the first place.

**MAYA:**
Okay, so the pitch is: stop letting the geometry float. Nail it down.

**THEO:**
The single decision the whole system grows out of: **attach a parametric CAD model directly to each Part row.** Not a file reference. Not a link to a vault. The model — the recipe, the feature history — lives in the same database as the part, keyed to the same part identity, versioned by the same revision lineage.

**MAYA:**
Let me push on "parametric," because we did this in Season 1 but the new listeners deserve it again. Parametric means what, precisely?

**THEO:**
It means the model is defined by an ordered list of operations with editable parameters, not by a static mesh of triangles. So instead of storing "here are ten thousand triangles that happen to form a bracket," you store "rectangle, 40 by 20; extrude 5 millimeters; two holes of diameter 6 at these positions; fillet these four edges at radius 2." That list is the feature history. The parameters — the 40, the 20, the 6, the 2 — are editable. Change the 40 to a 60 and you re-run the list and you get a longer bracket with the holes and fillets still correctly placed.

**MAYA:**
Which is the "history you replay" thing from the cold open. The shape is the *output* of replaying the list.

**THEO:**
The shape is the output. The list is the truth. And that distinction is going to come back over and over this season, so let it sink in. When I say "the document," I mean the recipe. When I say "the geometry," I mean the baked result of running the recipe. They are not the same object, they don't live in the same place, and one is cheap to store and the other is expensive to compute.

**MAYA:**
And because the recipe is the truth and it's small — it's basically a structured list — it can sit right in the Part's database row.

**THEO:**
It sits in a JSON blob next to the part. Tiny. Kilobytes. The expensive ten-thousand-triangle cake gets baked on demand and mostly thrown away. We'll get deep into "mostly" later, because there's a cache, and there's a freeze, and those are two different kinds of "don't throw it away."

**MAYA:**
Now why the browser? Because that's the part that still makes me squint. Geometry is heavy. Why not a desktop app?

**THEO:**
Two reasons, one philosophical and one practical. Philosophical: the inventory system is already a web app. Everyone's already in a browser tab looking at part records, BOMs, work orders. If the CAD opens in the *same tab*, in the same app, with the same login and the same permissions, there's no context switch. You click a part, you click "CAD," you're modeling. No install, no license server, no "which machine has the file."

**MAYA:**
The geometry shows up where the part already lives.

**THEO:**
Right where the part already lives. And practical reason: the heavy math doesn't actually have to happen in the browser. That's the trick. The browser is the *interface* — drawing, clicking, orbiting the camera, picking faces. The actual solid-geometry computation happens on a server, in a separate program built for exactly that, and the answer comes back as something the browser can cheaply draw.

**MAYA:**
So the browser is the cockpit and the engine is somewhere else.

**THEO:**
The browser is the cockpit. And that split — cockpit here, engine there — is the first big architectural seam, and it's a good doorway into the four-subsystem map. Because once you accept "interface in the browser, geometry math on a server, truth in a database, history in version control," you've basically named all four pieces.

**MAYA:**
Then let's name them properly. Give me the four.

## Segment 2 — The four subsystems, and the borders between them

**THEO:**
Four cooperating subsystems. I'll give you each one's name, what it owns, and — this is the part people skip — where it physically lives in the codebase. Because the borders between them are the whole story. A good architecture is mostly about where you draw the lines so that the pieces don't bleed into each other.

**MAYA:**
Borders first. I like it. Go.

**THEO:**
Number one: the **CAD modeler.** This is the part the user actually touches. Sketching a 2D outline, stacking features into a history, walking that history to rebuild the shape, and the 3D viewer where you orbit and click on faces. It straddles the browser and the backend. On the frontend it lives in two main folders — `frontend/src/app/cad/lib/`, which is the pure modeling library: the sketch solver, the profile extractor, the tessellator, the feature tree code. And `frontend/src/app/components/cad/`, which is the actual UI components — the editor host, the sketch tools, the viewer. On the backend, the modeler owns the *regeneration* orchestration, which is mostly one service called `cadRegenService.js`.

**MAYA:**
Hold on — "the modeler" spans the browser *and* the server? That feels like it violates your clean-borders speech.

**THEO:**
Good catch, and it's a fair tension. The way to think about it: the modeler is a *responsibility*, not a location. The responsibility is "turn a feature history into displayable geometry." Part of that job is interactive and lives in the browser — drawing, picking. Part of it is orchestration and lives on the server — walking the tree, deciding what needs rebuilding, calling the engine. But notice what the modeler does *not* do: it never does the actual solid-geometry math itself. It's the conductor, not the orchestra.

**MAYA:**
So the modeler is the conductor. Who's the orchestra?

**THEO:**
Subsystem two: the **geometry kernel.** This is the engine room. It's a completely separate program, written in Rust, wrapped around an industrial-grade geometry library called OCCT — OpenCASCADE Technology, which is the open-source bones underneath a lot of serious CAD.

**MAYA:**
Rust and a C++ geometry library. That's a different world from Angular and Node.

**THEO:**
Totally different world, and that's deliberate. It lives in its own folder, `cad-kernel/src/`, in its own language, behind a network boundary. The kernel owns all the hard geometry: taking a 2D profile and a distance and producing a real boundary-representation solid — a "B-rep," meaning the object is defined by its exact surfaces and edges, not triangles. It does the boolean operations — fusing two solids, cutting one out of another. Revolves, sweeps, patterns, shelling a solid hollow, rounding edges — fillets. And then two more subtle jobs: tessellation, which is turning that exact mathematical surface into the triangles the browser can draw, and per-face classification and *naming*, which we'll come back to because it's secretly one of the most important things in the system.

**MAYA:**
Why is the kernel a separate program at all? Why not just a library you call?

**THEO:**
Because the math is heavy, it's written in another language, and it can occasionally fail in spectacular ways — OCCT can throw exceptions, even crash, on geometry it doesn't like. You do *not* want a bad fillet taking down your web server. So the kernel runs as its own process, the backend talks to it over a network connection — JSON-RPC over TCP, which just means "structured requests and responses over a socket" — and if the kernel falls over on one weird operation, the web app catches the error and stays up.

**MAYA:**
So the border there is a literal network boundary. A wall.

**THEO:**
A literal wall, on purpose. The backend hands the kernel a clean, simple instruction — "extrude this profile this far" — and gets back triangles plus metadata. Neither side knows the other's internals. The backend doesn't know OCCT exists; it knows there's a thing on a socket that answers geometry questions. The kernel doesn't know Sequelize or Postgres exist; it knows it gets profiles and returns meshes.

**MAYA:**
Okay, that's two. Conductor, orchestra. Three?

**THEO:**
Three: the **version-control system.** This is the time machine and the filing cabinet. It's a git-like, content-addressed store. Every check-in is a permanent, immutable snapshot. You can branch, compare two versions, merge, and — the big one — *release*, which freezes the exact geometry and ties it to an official part revision. It lives in `backend/services/vcs/`, with its database models in `backend/models/vcs/`.

**MAYA:**
"Git-like" is going to mean something to some listeners and nothing to others. One sentence.

**THEO:**
Git is the version-control tool software engineers use to track every change to their code — every version saved forever, branchable, comparable. This is that idea, applied to 3D parts instead of source code. Same shape of solution: snapshots, branches, history, release.

**MAYA:**
And "content-addressed"?

**THEO:**
That one's beautiful and we'll spend a whole episode on it later, but the one-liner: instead of naming a saved chunk of data by *where* it is or *when* you saved it, you name it by a fingerprint of *what's in it*. Same content, same fingerprint, stored exactly once. Two parts that share an identical sketch literally share the same stored object. We'll unpack why that's magic in the VCS episodes.

**MAYA:**
Filing cabinet, noted. And four?

**THEO:**
Four: **assemblies.** This is where finished parts come together into a bigger thing. You drop several released parts into one scene and tell the system how they relate — "this bolt goes in that hole," "these two faces touch." Then a *mate solver* figures out exactly where everything sits. From an assembly you get a bill of materials, exploded views, interference checks — does anything overlap that shouldn't — and a combined export. It lives across a few places: `backend/services/assembly*` for the server logic, including the regen service and the mate solver — well, the *backend* mate analysis. The frontend has an assembly editor, and there's a `mateSolver.ts` in the modeling library on the frontend too.

**MAYA:**
Wait, there are two mate solvers? Front and back?

**THEO:**
There's mate-solving logic that the system uses to position instances, and there's analysis like interference and mass properties on the backend. The thing to hold onto today is just: assemblies are the fourth subsystem, they place multiple parts and solve their relative positions, and — here's the punchline that makes the whole architecture sing — **an assembly is itself a Part.**

**MAYA:**
Say more, because that sounds like a riddle.

**THEO:**
An assembly nests. It shows up in bills of materials. It's a thing you can put inside another assembly. So in the data model, it's a Part, just like a single component is a Part. Which means it gets to ride the *exact same* version-control machinery, the same editor, the same measurement tools. An assembly is just a different kind of document that the same system already knows how to store, version, and release.

**MAYA:**
And that's the "written once" thing you keep hinting at.

**THEO:**
That's the thread we'll pull all season. Hold that thought — I want to earn it, not just assert it.

**MAYA:**
Let me play it back so I'm sure I've got the four. Modeler — the conductor, draws and orchestrates, browser plus a regen service on the backend. Kernel — the orchestra, Rust and OCCT, behind a network wall, does the real geometry. Version control — the time machine, content-addressed, git-for-parts. Assemblies — parts of parts, with a mate solver, and secretly themselves just Parts.

**THEO:**
That's the map. Frame it on your wall. Everything else this season is a zoom into one of those four.

**MAYA:**
And the borders are: network wall between modeler and kernel; the database between everything and its persistence; and... what separates version control from the modeler?

**THEO:**
The notion of "working copy" versus "history," which is so central I want to give it its own segment. But before that — you asked how the conductor actually conducts. Let's actually watch a regeneration happen, start to finish, because that's the heartbeat of the whole thing and once you've seen it once, half the system makes sense.

## Segment 3 — The regeneration cycle: watching the cake get baked

**MAYA:**
The heartbeat. Okay. Walk me through it slowly. Somebody opens a part. What happens?

**THEO:**
Let's set the scene. There's a stored document — the recipe — sitting in the database. It's got a `featureTree`, which is the ordered list of features. It's got a `sketchDoc`, which holds the 2D sketches the features reference. And it's got `equations`, which are named parameters and formulas — like "length = 40" and "width = length divided by 2."

**MAYA:**
So the equations are the dials, and the feature tree is the recipe that reads the dials.

**THEO:**
Perfect framing. Step zero of regeneration: **resolve the equations.** Before you can build anything, you compute the actual numbers. The equations might say width equals length over two, and length is 40, so width resolves to 20. The system walks the equation graph and produces concrete values, then stamps them into the model so every feature downstream sees real numbers, not formulas. There's a `cadEquations` module that does exactly this — `resolveEquations` and `applyEquationsToModel`.

**MAYA:**
Why first? Why not resolve as you go?

**THEO:**
Because a feature halfway down the tree might depend on an equation that's defined globally. You want all the dials read and settled before you start building, so nothing reads a stale value. Resolve once, up front, then build.

**MAYA:**
Okay, dials are set. Now?

**THEO:**
Step one: **walk the feature tree, in order.** This is the regen service — `cadRegenService.regenerate`. It goes feature by feature, top to bottom, because order matters enormously. Feature five might cut a hole into the solid that features one through four built up. You can't cut a hole into a solid that doesn't exist yet. The history is ordered for a reason.

**MAYA:**
Recipe steps in sequence. You can't frost a cake you haven't baked.

**THEO:**
And you skip the steps that are turned off — features can be hidden or suppressed, and the walk just continues past them. For each *active* feature, step two: **extract the profile.** Most features start from a sketch — a 2D outline. The profile extractor — there's a `cadProfile` module, `extractRegions` — takes the raw sketch geometry and finds the closed loops. The outer boundary, and any inner loops that are holes.

**MAYA:**
Like the outline of a washer — the outer circle and the inner circle that's the hole.

**THEO:**
Exactly that. A region is "outer loop plus N inner holes." A washer is one region: big circle outside, small circle inside. And extracting that cleanly from a pile of sketch lines and arcs is non-trivial — which loops connect, which way they wind, what's a hole versus a separate shape. That's its own little algorithm, and it's the bridge between the messy 2D sketch and the clean instruction the kernel wants.

**MAYA:**
So now we've got a clean profile. Do we call the engine yet?

**THEO:**
Not yet — step three, and this is my favorite, the **cache check.** Before we pay the cost of calling the kernel, we ask: have we built *exactly this* before? We compute a cache key. For each feature it's a triple: the feature's identity, a hash of its parameters, and a hash of everything upstream of it.

**MAYA:**
Break that triple down. Why three parts?

**THEO:**
Because a feature's output depends on three things and only those three. *Which* feature it is. *Its own* parameters — if you changed the extrude distance, the parameter hash changes, the key changes, you rebuild. And *what came before it* — the upstream hash — because if feature three changed, then feature four, which cuts into feature three's solid, also needs to rebuild even if feature four's own parameters didn't change at all.

**MAYA:**
Oh. So the upstream hash is how a change *ripples down* the recipe.

**THEO:**
That's the whole point of it. Change something early, and everything downstream of it gets a new upstream hash and rebuilds. Change something late, and only it and what's below rebuild — everything above is untouched, cache hit, instant. There's a table, `DesignBRepCache`, content-keyed exactly this way. If the triple matches a stored row, we return the cached tessellated faces immediately. Zero kernel calls.

**MAYA:**
And that table is... safe to lose? You said earlier the recipe is truth and the geometry is derived.

**THEO:**
That's the discipline, and the regen service even says it in a comment: the `featureTree` stays authoritative, the cache is *derived*. You can drop the entire cache table and rebuild it from scratch by re-running every recipe. It's purely a speed optimization. Never a source of truth. That separation — truth versus derived-and-disposable — is a theme. The recipe is sacred; the cake is disposable; the cache is a tray of cakes you keep around in case someone orders the same one again.

**MAYA:**
And there's a versioning thing on the cache, right? I saw you wince when I asked if it was safe to lose.

**THEO:**
[laughs] There's a `namingVersion`. The cache rows are stamped with a version number, and any time the kernel's output changes shape — a new way of naming faces, a new way of handling arcs, a new pipeline — we bump that number, and every old cache row stops matching and rebuilds fresh. It's a blunt instrument, but it's a *safe* one. The comments in `cadRegenService` are honestly a little museum of the system's history — "version 2: arcs switched from chord approximation to true arc edges," "version 5: cumulative-body pipeline," "version 12: boolean ops decompose into independent solids." Each bump is a war story.

**MAYA:**
We should do a whole episode that's just you reading cache-invalidation comments like ghost stories.

**THEO:**
[laughs] "Version 13 invalidates version 12 cache rows written during the brief window when the backend was bumped but the storage code hadn't shipped yet, because the dev server reloaded mid-edit." That's a real one. That's a 2 a.m. one.

**MAYA:**
Okay — cache miss. We've genuinely never built this. *Now* we call the engine.

**THEO:**
Step four: **call the kernel.** The regen service hands the profile and the operation to `cadKernelClient`, which packages it as a JSON-RPC request and ships it over the socket to the Rust process. The kernel does the real work — builds the boundary-representation solid in OCCT — and ships back a tessellated result: arrays of positions, normals, and indices that describe triangles, plus, per face, two crucial bits of metadata.

**MAYA:**
The naming and the classification you teased.

**THEO:**
A stable `persistentName` per face, and an optional `surface` classification — is this face flat, cylindrical, spherical. Let me dwell on the name for a second because it's subtle and load-bearing. When you click on a face in the viewer and say "fillet this edge" or "put a hole on this face," the system has to *remember which face you meant* — even after you go back and change an earlier feature and the whole thing rebuilds and the triangles are completely different.

**MAYA:**
Right, because if I round "the top face" and then I make the part taller, "the top face" is now made of different triangles. How does it stay "the top face"?

**THEO:**
That's the persistent-naming problem, and it's genuinely one of the hardest problems in parametric CAD — the big commercial kernels have all bled over it. The kernel assigns each face a stable name that survives a rebuild, so a downstream feature that says "fillet the edge between face A and face B" can find A and B again even though they're freshly computed. It's not perfect — naming can break when topology changes drastically, and that's a known footgun across the whole industry — but the *attempt* to keep names stable across regeneration is what makes "edit an early feature and watch the later features stay attached" possible at all.

**MAYA:**
So the name is the thread that ties a downstream feature to the geometry it depends on, across rebuilds.

**THEO:**
It's the thread. And here's a wrinkle from the comments that I love because it's so concrete: face IDs get *scoped by body*. The kernel might return a face called "f2-f0." The regen service rewrites it to "f2#0-f0" — body-scoped — so that when you've got multiple bodies in one part, their face IDs can't collide. There was a real bug where unscoped IDs caused the viewer's edge map to leak stale line objects into the scene — you'd hide a body and ghost edges would stay. Scoping the IDs by body killed it.

**MAYA:**
Ghost edges. This system has a lot of hauntings.

**THEO:**
[laughs] It's a haunted house with very good documentation. Step five, last one: **cumulative bodies.** Each feature doesn't just produce its own little prism in isolation. It emits the *running, cumulative* shape — the new prism already fused into, or cut out of, the body that the previous features built up. So by the time you reach the bottom of the tree, you've got the final solid, and the frontend only has to render the latest cumulative result.

**MAYA:**
Why cumulative? Why not render all the pieces?

**THEO:**
Because the pieces aren't the truth — the *combined* solid is. If feature four cuts a slot into the block from features one through three, what you want to see is a block with a slot, not a block and a separate phantom slot floating in space. Each feature fuses or cuts into the running body, and the viewer renders only the final state. And it tracks an *array* of bodies, because a part can be multi-body — one extrude can be told to start a new body instead of merging into the last one. Each emitted result carries a `bodyId` so the system knows which body it belongs to.

**MAYA:**
So the output of the whole walk is: a set of bodies, each a bag of tessellated faces, each face with a stable name and a flat-or-round classification, ready for the browser to draw.

**THEO:**
That's the regeneration cycle. Resolve equations, walk the tree, extract profiles, check the cache, call the kernel on misses, accumulate bodies, hand back face meshes. That loop is the heartbeat. Every single thing you see in the 3D viewer is the output of that loop running.

**MAYA:**
Okay. Now do it for an assembly, because you said it's different, and I want to know how.

## Segment 4 — The other heartbeat: assembly regeneration

**THEO:**
So an assembly has its own regen service — `assemblyRegenService.regenerateAssembly` — and the fun part is contrasting it with the part regen, because they *rhyme* but they're solving a different problem. Part regen builds *one shape from a recipe of operations*. Assembly regen *arranges several already-built shapes in space.*

**MAYA:**
Composition instead of construction.

**THEO:**
That's exactly it. Let me walk it. Step one: an assembly document is a list of component *instances* and a list of *mates*. An instance is "a copy of Part 4051 sitting here." A mate is a relationship — "instance A's hole is concentric with instance B's shaft." So step one is **resolve each instance to its source geometry.** Go find the actual 3D shape for each child part.

**MAYA:**
And here's where it gets to be cheap, right? Because the children are finished parts.

**THEO:**
This is the beautiful part. If a child instance points at a *released* part — a part that's been frozen — then its geometry is already computed and stored. We don't re-run the part's recipe. We don't call the kernel at all. We just load the frozen mesh. So an assembly of fifty released bolts is fifty cheap mesh loads, zero geometry computation.

**MAYA:**
Because a released part's shape can never change. It's frozen. So the cake is already baked and in the freezer.

**THEO:**
Literally why it's called freezing. We'll do a whole episode on freeze and release later, but the payoff shows up right here: assemblies are fast because their ingredients are pre-baked.

**MAYA:**
Okay, we've got all the child meshes. Now we have to position them. The mate solver.

**THEO:**
Step two: **solve the mates.** Some instances are pinned — fixed in place, the ground. Others are floating, positioned only by their relationships to other parts. The mate solver's job is to take all those relationships — concentric, coincident, distance, angle — and compute an exact position and orientation for every floating instance that satisfies all of them at once.

**MAYA:**
That's the same flavor of problem as the 2D sketch solver from Season 1, isn't it? Constraints in, positions out.

**THEO:**
Same *flavor*, different dimension. The sketch solver works in 2D — it positions points and lines on a flat plane to satisfy constraints. The mate solver works in 3D — it positions whole rigid bodies, each with six degrees of freedom, three to move and three to rotate. It's a harder problem, and it's a different episode, but you've got the right instinct: both are constraint solvers. Relationships in, a consistent arrangement out.

**MAYA:**
And it can fail the same way? Over-constrained, under-constrained?

**THEO:**
Same failure modes. You can ask for something impossible — "this face touches that face AND is two centimeters away from it" — and the solver has to tell you it can't. Or you can leave things under-defined and a part is free to slide. That's all in the assembly episodes. Today, just: step two solves positions.

**MAYA:**
So now every instance has a position. Then?

**THEO:**
Step three: **transform the meshes.** Each instance now has a placement matrix — a little bundle of math that says "move this child here, rotate it like this." We take the child's already-tessellated mesh and push every vertex through that matrix. The bolt's triangles, which were defined in the bolt's own local space, get moved into the assembly's shared space, in the right spot, at the right angle.

**MAYA:**
We're not rebuilding the bolt. We're *moving* the bolt's existing triangles.

**THEO:**
Moving, not rebuilding. That's the whole efficiency story again. Part regen calls the kernel to *make* geometry. Assembly regen takes existing geometry and *relocates* it with matrix math, which is cheap and doesn't touch the kernel at all.

**MAYA:**
What about the face names? In the part regen those mattered a lot.

**THEO:**
Step four, and this is the assembly mirror of the body-scoping trick: **re-scope the face IDs.** In a single part, a face is "body 0, face 3." But in an assembly, you might have the same part dropped in five times — five instances of the same bolt. They all share the same internal face names. So if you clicked a face and the name was just "body 0, face 3," the system wouldn't know *which bolt* you meant.

**MAYA:**
So you stamp the instance onto the name.

**THEO:**
You prefix it. The assembly re-scopes every face ID to `instanceId::bodyId::faceId`. Now "instance 4, body 0, face 3" is globally unambiguous. You can click the third bolt from the left and the system knows exactly which face of which copy you touched — for measurement, for mates, for selection.

**MAYA:**
It's the same idea as the body-scoping in the part — add a layer of prefix so names can't collide. Just one level up.

**THEO:**
It's namespacing, the same instinct at every level. Body-scope within a part so multi-body parts don't collide. Instance-scope within an assembly so repeated parts don't collide. It's prefixes all the way up.

**MAYA:**
And the last step?

**THEO:**
Step five: **compose.** Bundle all those transformed, re-scoped child meshes into one assembly geometry, plus a roster — a per-instance list of what's in the scene, which part, where. That roster is what feeds the bill of materials, the instance tree in the sidebar, the interference checks. And that composed geometry is what the viewer draws.

**MAYA:**
So let me hold the two side by side. Part regen: resolve dials, walk the recipe in order, extract profiles, check the cache, call the Rust kernel on misses, accumulate into cumulative bodies. The expensive step is the kernel call. Assembly regen: resolve children to *already-built* geometry, solve the mates for positions, transform meshes by matrix, re-scope IDs, compose. The expensive step is the mate solve, and the kernel basically never gets called.

**THEO:**
You just nailed the contrast better than I would have. Part regen is *construction* — it makes new geometry, and its cost center is the kernel. Assembly regen is *arrangement* — it positions existing geometry, and its cost center is the solver. Same heartbeat shape — stored document in, displayable geometry out — but the organ doing the work is different.

**MAYA:**
And both of them end in "tessellated meshes with scoped names, handed to the viewer."

**THEO:**
Both converge on the same output format, which is exactly why the *same viewer* can draw a single part or a fifty-piece assembly without caring which it's looking at. The output contract is identical. That convergence is not an accident — it's the "written once" idea showing up in the geometry layer. But before we get to "written once," I owe you the segment that makes version control make sense, because I keep saying "working copy" and "frozen" and "released" and I haven't actually drawn that line.

## Segment 5 — Versioning is the spine: working copy versus history

**MAYA:**
Yeah, draw me that line. Working copy versus history. What's the distinction?

**THEO:**
Here's the cleanest way I can put it. There are two fundamentally different kinds of storage in this system, and confusing them is the source of basically every versioning bug.

**MAYA:**
Name them.

**THEO:**
The **working copy** is your live, editable, current draft. It's a database row — `DesignCADModel` for a part, `DesignAssembly` for an assembly. It's mutable. You're actively poking at it: adding features, dragging sketch points, changing dials. It's the document you have open right now.

**MAYA:**
The thing on my workbench.

**THEO:**
The thing on your workbench, covered in pencil marks. The **durable history** is the opposite: it's the content-addressed version-control store — the `VcsObject` and `VcsRef` tables. Every commit there is *immutable*. It is a permanent, frozen snapshot. You never edit history. You add to it.

**MAYA:**
So the workbench is messy and changeable, and the filing cabinet is permanent and append-only.

**THEO:**
And the flow between them is: you work on the workbench, and when you've got something worth keeping, you *check in* — you take a snapshot of the working copy and file it permanently in the cabinet as a new commit. The working copy keeps being editable; the commit is frozen forever.

**MAYA:**
That's exactly how code version control works. You edit files, then you commit, and the commit is a permanent point you can always come back to.

**THEO:**
Same mental model, and that's deliberate — engineers already know it, so reuse the intuition. The `DesignCADModel` row even carries the version-control bookkeeping right on it: which branch it's on, which commit it's based on, whether it's locked for editing, whether it's "dirty" — meaning changed since the last check-in.

**MAYA:**
Now here's where I need help, because you said something earlier that I parked and now I want it back. You said the history is keyed to the *part-revision lineage root.* What does that mean and why do I care?

**THEO:**
This is genuinely one of the cleverest decisions in the system, and it solves a problem that's easy to not even notice until it bites you. Here's the setup. In manufacturing, a part gets *revised*. Bracket revision A, then revision B, then revision C. In this system — and this is from the inventory side — each revision is actually a *new Part row* in the database, linked back to the previous one by a "previous revision" pointer. So revision B is a different row than revision A, with a link saying "I came from A."

**MAYA:**
Okay, so revisions are a chain of Part rows. A points to nothing, B points to A, C points to B.

**THEO:**
Right. Now naively, you'd think: each Part row has its own CAD model, its own history. But that's a disaster. Because then your *design* history — every save, every branch, every experiment — restarts from scratch every time manufacturing cuts a new revision. You'd lose the continuity. "When did we change this fillet?" — well, that was three revisions ago, in a different part row's separate history, good luck.

**MAYA:**
The history would be chopped up at every revision boundary.

**THEO:**
Chopped into disconnected pieces. So instead: the version-control repository is keyed not to the individual Part row, but to the *lineage root* — you walk the "previous revision" chain all the way back to the very first part row, and *that* id is the repository key. So revisions A, B, and C all share *one* continuous repository. One history. The design story flows unbroken across every manufacturing revision.

**MAYA:**
So the part number can get revised five times and there's still one single thread of "here's how this part's design evolved."

**THEO:**
One thread. The CAD binding has a function — `repoForModel` — that does literally this: walk `previousRevisionID` to the root, use the root id as the repo id. And there's a requirement for it, 688, that says exactly: one repository per part lineage, continuous across revisions. It's a load-bearing design choice with a requirement number on it.

**MAYA:**
And how does a release tie back to a revision? You keep using "release" and "freeze" as if they're related but different.

**THEO:**
They're a pair. Let me give you the shape of it without going deep — that's a whole later episode. When a design is ready, you *release* it. Release does three things at once. It **freezes** the geometry — bakes the cake and stores it permanently on that commit, so it never has to be recomputed and can never silently change. It **tags** that commit write-once with a revision — and write-once means once that tag exists, it's locked, you cannot overwrite it. And it **mints a part revision** on the manufacturing side.

**MAYA:**
So release is the moment the floating geometry stops floating and gets nailed to an official revision number.

**THEO:**
That's the whole reason the system exists, in one operation. Remember the cold open's real problem — geometry divorced from the business record? Release is the marriage. The exact shape, frozen, fingerprinted, permanently bound to a part revision that manufacturing reads. The bracket that the work order says to build is *byte-for-byte* the bracket the designer released. No drifting filenames. No "which version is this."

**MAYA:**
And `main` is special in there somehow — you said it's "protected."

**THEO:**
`main` is the released, protected line — the official spine. You don't edit `main` directly. You do your work on draft branches, you experiment, you check in, and when a branch is ready you release it *onto* main, which is what advances the official history and mints the revision. Branch protection, the review workflow, who's allowed to approve a release — all of that is the version-control episodes. Today, the spine: working copy is the editable now, history is the immutable forever, the repo is keyed to the lineage so history survives revisions, and release is the act that freezes geometry and binds it to an official revision.

**MAYA:**
I want to make sure I have the three meanings of "frozen" or "locked" straight, because I bet they're different and I bet you're about to tell me people confuse them.

**THEO:**
[laughs] You've been reading ahead. Yes. There are a few different locks and they are absolutely confused constantly. There's the *edit lock* — the checkout lock — which is the "I've got this checked out, you can't edit it right now" PDM-style exclusive lock, transient, like checking a book out of a library. There's the *release lock* — once a design is released, the working copy goes read-only because it's been frozen. And there's the manufacturing-side revision lock on the Part itself. Three different locks, three different meanings, and yes, conflating them causes bugs. We'll be very careful about them when we get to the VCS season-middle.

**MAYA:**
Noted for later. Okay. You've earned it. Tell me about "written once."

## Segment 6 — The season's spine: "written once"

**THEO:**
So. The single most important architectural idea in this whole system, the one I want you to carry through all eight episodes, is two words: **written once.**

**MAYA:**
Set it up. What's the temptation it's resisting?

**THEO:**
Picture where we are. We've got single-part CAD, and we've got multi-part assemblies. They're *different* — one builds a shape from operations, one arranges shapes in space. But they're also, structurally, ninety percent the same. They both need to be saved. Versioned. Branched. Compared. Released. Reviewed and approved. Opened in a 3D editor. Measured.

**MAYA:**
So the lazy move is: build the CAD version of all that, then build the assembly version of all that.

**THEO:**
Build it twice. And that is the trap, because the two copies *drift.* You fix a version-control bug in the CAD path and forget the assembly path. You add a "compare two versions" feature to assemblies and CAD doesn't get it. Six months later they're meaningfully different systems that happen to look similar, and every change is double the work and half of it is wrong.

**MAYA:**
I've lived in that codebase. The "we'll keep them in sync, it'll be fine" codebase.

**THEO:**
It is never fine. So this system makes the opposite bet. The version-control machinery, the editor, and the measurement tools are each written *exactly one time.* CAD and assembly don't get their own copies. They *plug into* the shared machinery by answering a small number of questions.

**MAYA:**
This is the coffee-machine thing from the docs, isn't it. The pods.

**THEO:**
That's the analogy and it's a good one. Imagine a coffee machine that can make espresso or tea. The machine — the heater, the pump, the buttons, the timer — is one device, built once. To switch drinks you drop in a little pod that says "this much water, this grind, this temperature." The machine never changes. Only the pod.

**MAYA:**
So version control is the machine, and CAD and assembly are pods.

**THEO:**
In the code they're called **bindings.** And the machine is a set of **factories** — functions that take a binding and hand back the operations for that document type. There are four of them, and I love that they have honest, boring names. `makeWorkingCopy`. `makeBranchOps`. `makeFreeze`. `makeRelease`.

**MAYA:**
"Make working copy." So that factory builds the checkout-checkin-undo-lock-history logic?

**THEO:**
All of it. The whole exclusive-lock protocol — "this is checked out by someone else, here's the 423 error." The check-in flow — snapshot the doc, chain the new commit onto the parent, advance the branch, mark it clean. The undo-checkout flow — roll back to the base commit, drop the lock. Every bit of that is in `makeWorkingCopy`, written one time, and it is *document-agnostic.* It does not know or care whether it's saving a CAD part or an assembly.

**MAYA:**
So what does the binding — the pod — actually have to provide? What are the questions?

**THEO:**
A handful. "What's my repo key?" — `repoFor`. "How do I extract the savable document from my row?" — `docOf`. "How do I write that document into the object store?" — `serialize`, and the reverse, `deserialize`. "How do I apply a loaded document back onto the working copy?" — `applyDoc`. And for freezing: "how do I regenerate my geometry?" and "how do I snapshot it" and "how do I reconstruct it from frozen objects?"

**MAYA:**
And that's *it?* Those few answers and you inherit all of version control?

**THEO:**
That's it. Watch the difference between the two pods. The CAD binding's `docOf` says "my document is a feature tree, a sketch document, and equations." The assembly binding's `docOf` says "my document is an assembly document — instances and mates." The CAD binding's regen points at `cadRegenService` — the part heartbeat we walked through. The assembly binding's regen points at `assemblyRegenService` — the arrangement heartbeat. They differ *exactly where they must* — how a document is shaped, how it's turned into geometry — and *nowhere else.*

**MAYA:**
And everything downstream — locking, branching, comparing, releasing, the approval workflow — that's all the shared machine, untouched.

**THEO:**
Untouched and unaware. Let me give you the three best examples of "unaware," because they're satisfying. The **workflow engine** — the thing that drives a design through draft, then in-review, then approved — is generic and declarative. There's a table that says "from draft you can submit to in-review; from in-review an approver can approve." That table is defined once. CAD uses it. Assembly adopts it by *literally pointing at the same table entry.* No new workflow code for assemblies. Zero.

**MAYA:**
The reviewer clicks "approve" and it works identically whether they're approving a bracket or a gearbox assembly.

**THEO:**
Identically, by construction. There's a requirement, 703, that says exactly this: a generic declarative workflow engine, reused across document types. Second example: the **version-history graph** — the thing that draws the branching diagram of your commits, with lanes and tags and author initials. It's repo-keyed. Hand it a CAD repo, it draws CAD's history. Hand it an assembly repo, it draws the assembly's history. Same code. Third: **structural diff** — comparing two versions to see what changed. It compares trees by fingerprint, so identical subtrees just match by hash and it only looks at what actually differs. And it knows how to label both worlds — a changed "feature" or "sketch" for CAD, a changed "instance" or "mate" for assembly. One diff engine, two vocabularies.

**MAYA:**
So the payoff is concrete. Add a feature to the machine — say, a better diff view — and both CAD and assembly get it for free, the same day.

**THEO:**
The same commit. And there's half as much code to keep correct, which means half as many places for bugs to hide. It even reaches up into the frontend: there is *one* editor component. One. It runs a CAD mode and an assembly mode, switched by a single route flag. The 3D viewer, the file menu with checkout and check-in and branches and release, the measurement tools — none of it is duplicated. The assembly mode swaps which geometry source it reads and which side panels it shows, and reuses absolutely everything else.

**MAYA:**
Now — you promised honesty about tape. Is "written once" all upside? Because abstractions that try to serve two masters sometimes serve neither.

**THEO:**
That's the right skepticism, and it's the tension we'll actually wrestle with this season. The honest answer: it's load-bearing and it's mostly a huge win, but it has costs. The factory pattern adds a layer of indirection — to understand check-in you have to read the generic factory *and* the binding, two files instead of one. And the abstraction holds only as long as CAD and assembly really do differ *only* in those binding questions. The places where they *don't* fit cleanly — like reconciliation, merging branches, where the right behavior genuinely differs between a feature tree and a list of mates — those deliberately stay *out* of the shared factory and live in the per-document service. Knowing *what to leave out* of the shared machine is as important as what to put in.

**MAYA:**
So the discipline isn't "share everything." It's "share the truly-common, and be honest about the genuinely-different."

**THEO:**
That's the mature version of the idea, and it's exactly the thread I want to pull all season. We'll watch "written once" pay off in the version-control episodes, and we'll watch it *strain* at the assembly episodes where the two document types pull apart. And then — this is the promise — we resolve it in Episode 12. The season finale is basically "did the written-once bet pay off, where did it bend, and what would we do differently." So every time you hear me say "the same machine handles this," file it away. We're keeping score, and we settle up at the end.

**MAYA:**
Episode 12, the reckoning. I'm marking my card.

**THEO:**
[laughs] Mark it.

## Segment 7 — The tech-stack map: what's made of what

**MAYA:**
Before we wrap, I want the concrete stack — because this season we're naming names, and a listener should know which technology is doing which job. Quick map. Frontend first.

**THEO:**
Frontend is **Angular 19**, using **signals**, and **Three.js** for the 3D.

**MAYA:**
One sentence each. Angular signals — what's that buying us?

**THEO:**
Signals are Angular's modern reactivity system. The mental model: you've got values that other things depend on, and when a value changes, everything downstream automatically recomputes and the screen updates. So when you change an equation — the dial — the signal carrying that value updates, and the things derived from it re-evaluate without you wiring up the plumbing by hand. For an interactive editor where one change ripples through a lot of derived state, that reactivity is exactly the right tool.

**MAYA:**
And it rhymes with the geometry idea, weirdly. Change one upstream thing, everything downstream recomputes.

**THEO:**
[laughs] It's the same shape at two levels. Signals do it for UI state, the upstream-hash does it for geometry. Reactivity all the way down.

**MAYA:**
Three.js?

**THEO:**
Three.js is the workhorse 3D library for the web. It wraps WebGL — the browser's low-level graphics capability — in something humans can actually program. It's what draws the meshes the kernel produces, runs the camera you orbit with, and handles picking — figuring out which face you clicked on by shooting a ray from your cursor into the scene. The viewer component, `cad-viewer`, is essentially "Three.js, pointed at our face meshes, with our picking rules on top."

**MAYA:**
Backend.

**THEO:**
Backend is **Node** with **Express** for the web server, **Sequelize** as the database layer, and **PostgreSQL** as the database. Express handles the HTTP requests — the API the frontend calls. Sequelize is the translator between JavaScript objects and database tables, so the code works with a `DesignCADModel` object and Sequelize turns that into the right SQL. Postgres is where everything durable lives — the part records, the working copies, and the whole content-addressed version store, the `VcsObject` and `VcsRef` tables.

**MAYA:**
So the version control isn't some separate special database. It's tables in the same Postgres as everything else.

**THEO:**
Same Postgres. The "git-like" store is just well-designed tables — objects keyed by content fingerprint, refs pointing at commits. No separate vault, no external system. Which is the whole "stop letting geometry float" thesis again — even the *history* lives inside the one database of record.

**MAYA:**
And the kernel, one more time, for the stack map.

**THEO:**
The kernel is **Rust**, wrapping **OCCT** — the C++ geometry library. Rust because the geometry math is performance-critical and we want the safety guarantees Rust gives you when you're bridging into a big C++ library that can misbehave. It runs as its own process and the Node backend talks to it over **JSON-RPC over TCP** — structured messages on a socket.

**MAYA:**
So the full picture, edge to edge: I click in an Angular app, Three.js handles the 3D, the frontend calls an Express API, Node runs the regen service, which checks a Postgres cache, and on a miss talks over a socket to a Rust program wrapped around a C++ geometry kernel, which sends back triangles, which Three.js draws.

**THEO:**
That is the entire data path, and you just recited it from memory. Five technologies, four subsystems, one click. And notice — every boundary in that path is a place we drew a clean line on purpose. Browser-to-backend is HTTP. Backend-to-kernel is a socket. Truth-to-derived is the recipe-versus-cache split. Working-copy-to-history is check-in. The whole architecture is really just a set of well-chosen borders.

**MAYA:**
Well-chosen borders. That might be the actual thesis of the season.

**THEO:**
Honestly? It might be. "Written once" is *why* the borders are where they are. The borders are *how* you get to write things once. Put the genuinely-shared thing on one side of a clean line, put the genuinely-different thing on the other, and now you can share the first without entangling the second.

## Recap

**MAYA:**
Let me pull out the takeaways, because we covered a lot of ground and I want a listener to walk away with the frame, not the trivia.

**THEO:**
Go.

**MAYA:**
One. **A part's shape is a history you replay, not a file you save.** The recipe — the feature tree of operations and editable parameters — is the truth, lives in kilobytes in the database next to the Part, and the heavy 3D geometry is *derived* output, baked on demand and mostly thrown away. Truth versus derived is the cleanest line in the system, and the whole reason CAD got attached to the inventory record instead of floating in a file somewhere.

**THEO:**
And the consequence of that line is everywhere downstream — the cache is disposable, the feature tree is sacred.

**MAYA:**
Two. **Four subsystems, clean borders.** The modeler conducts — draws and orchestrates, browser plus a regen service. The Rust-and-OCCT kernel does the real geometry behind a network wall. The content-addressed version control is the time machine, git-for-parts, keyed to the part-revision lineage so history survives every manufacturing revision. And assemblies arrange finished parts with a mate solver — and an assembly is itself a Part.

**THEO:**
The borders are the architecture. Network wall, database, recipe-versus-cache, working-copy-versus-history.

**MAYA:**
Three. **Two heartbeats, same output.** Part regen *constructs* — resolve equations, walk the tree, extract profiles, check the cache, call the kernel on misses, accumulate cumulative bodies — and its cost is the kernel. Assembly regen *arranges* — resolve children to already-frozen geometry, solve the mates, transform meshes by matrix, re-scope IDs, compose — and its cost is the solver, with the kernel barely touched. Different work, but they converge on the same face-mesh format, which is why one viewer draws both.

**THEO:**
And persistent face names are the quiet hero of both — the thread that survives a rebuild.

**MAYA:**
Four. **"Written once" is the spine.** Version control, the editor, the measurement tools — each built one time, as factories. CAD and assembly are thin bindings that answer a few questions — how do I save, how do I rebuild — and inherit everything else: locking, branching, diff, release, the approval workflow. The win is half the code and no drift. The honesty is that the abstraction strains where the two document types genuinely differ, and knowing what to *leave out* of the shared machine is as important as what to put in. We're keeping score on that bet all season.

**THEO:**
And we settle the score in Episode 12. That's the deal.

**MAYA:**
That's the deal.

## Teaser

**MAYA:**
Next time, we go all the way down into the first thing a designer actually does: draw. Sketching.

**THEO:**
Which sounds simple and is secretly a constraint-satisfaction problem in disguise. You draw a rough rectangle — wobbly lines, nothing's exactly right — and then you say "these two are parallel, this one's 40 long, this corner's a right angle," and something has to take all those demands and snap the wobbly sketch into the exact shape that satisfies every constraint at once.

**MAYA:**
That something being the constraint solver. Which can also tell you when you've asked for the impossible.

**THEO:**
Over-constrained, under-constrained, the math of degrees of freedom, and how it figures out — fast — where every point has to go. It's the foundation every feature stands on, because the profile we extract for the kernel starts as a sketch. Get the solver wrong and everything above it wobbles.

**MAYA:**
Episode 6 — sketching and the constraint solver. The part where the wobble becomes precise.

**THEO:**
Bring graph paper. Metaphorical graph paper.

**MAYA:**
[laughs] Metaphorical graph paper. See you next time.

---

# Episode 6 — Sketching and the Constraint Solver

## Cold open

**MAYA:**
Okay, before we even do the intro, I want you to do the thing you did at lunch. You had the sketch editor open, you had this rectangle on the screen, and you grabbed one corner with the mouse and started dragging it around. And the whole rest of the shape just... followed. Not like the corner moved and left a gap. The whole thing rearranged itself. Live. While you were dragging.

**THEO:**
Right, the rectangle had a few rules on it. "These two sides stay parallel." "This side is exactly forty millimeters." "This corner sits on the origin." And I grab a free corner and drag, and every frame — every single mouse-move — there's a little math engine going, "given where Maya just put that corner, where does everything else have to be so all the rules still hold?" And it solves that, completely, before the next frame draws.

**MAYA:**
And that felt instant. No lag, no "computing" spinner.

**THEO:**
There can't be. If it stuttered, the illusion breaks. The thing doing that is a constraint solver, running Newton-Raphson — the same root-finding method you'd see in a numerical methods class — except dozens of times a second, on a system of geometric equations, applying the answer back to the screen in real time.

**MAYA:**
So the shape that "follows my mouse" is actually being re-solved from scratch, over and over.

**THEO:**
From scratch, every frame. And here's the part that gets me — the solver we use is the *exact same solver* that ships inside FreeCAD, a real desktop CAD program. We didn't write the hard math ourselves. We borrowed the best one we could find and taught it to live in a web browser.

**MAYA:**
Okay. I have so many questions. Let's go.

## Intro

**MAYA:**
Welcome back. This is Season Two, where we stop being polite about the details and open the hood. If you joined us in Season One, you have the map: a browser-based CAD tool bolted onto a manufacturing inventory app, a Rust-and-OCCT geometry kernel doing the heavy 3D math, and a git-like version-control system underneath the whole thing. We gave you the tour.

**THEO:**
And now we go room by room.

**MAYA:**
This episode is the sketch — the 2D drawing you make before anything becomes a solid — and the brain behind it, the constraint solver from the cold open that makes geometry feel alive. By the end you'll understand: what a sketch actually *is* as data, how the solver turns your rules into one consistent shape, how the editor knows whether you're "done," and — my favorite bit — the weird three-way split where a circle is drawn one way, solved another, and clicked-on a third.

**THEO:**
And we extract the outline at the end. Turning a flat doodle into a clean closed loop the 3D engine can push into a solid. That's its own little graph-theory adventure.

**MAYA:**
Right. So, Theo. Let's start with the most basic thing. When I draw a line in this sketch editor, what gets stored?

## Segment 1 — What a sketch actually is

**THEO:**
So the thing you'd *expect* — and the thing the system used to do — is you'd store an array of points, an array of lines, an array of constraints. Three separate lists.

**MAYA:**
That sounds reasonable. What's wrong with it?

**THEO:**
Nothing, until you add a third kind of thing. And a fourth. And a tenth. Now you want circles, so you add a circles array. Arcs, arcs array. Ellipses, splines, text, imported pictures, equation curves. And every single piece of code that touches the sketch — renderer, picker, the saver, the profile extractor — every one of them now has to know about all ten arrays and loop over each separately.

**MAYA:**
So the complexity multiplies. Ten kinds of shape times every consumer.

**THEO:**
Exactly that. So we flipped it. Now there's *one* list. It's called the entities list. And every entity in it is what we call a tagged union — sometimes people say discriminated union. Each entity is a little record that has a `kind` field, and that field is a string: `"point"`, `"line"`, `"circle"`, `"arc"`, and so on. Thirteen kinds total right now.

**MAYA:**
Tagged union. Unpack that for me like I've never heard it.

**THEO:**
Think of a deck of cards where every card has a label in the corner telling you what type it is. A "point" card has an x and a y on it. A "line" card doesn't have coordinates — instead it has the IDs of two other cards, its start point and its end point. A "circle" card has the ID of its center point, plus a radius number. They're all in the same deck, same pile, but each one carries a tag that says "here's how to read me."

**MAYA:**
So a line doesn't store its own endpoints' coordinates. It stores *references* to point cards.

**THEO:**
And that's load-bearing. The whole trick. Because the line references its endpoints by ID, dragging a point that two lines share moves both lines. The corner of a rectangle is literally one point card two lines point at. Move the card, both follow — you never go hunting for "everything near this coordinate." The connection is structural.

**MAYA:**
Got it. So in `types.ts` — that's the file, right? —

**THEO:**
Yeah, `types.ts` is the dictionary for the whole CAD module. If you ever want to know "what fields does an arc have," that's the one file you open. There's a base that every entity shares — it's got an `id`, and an optional flag called `construction`, which, hold that thought, we'll come back to it because it has a great little story. And then thirteen variants. Point is x and y. Line is start-ID and end-ID. Circle is center-ID and radius. Arc is center, start, end, a radius, and a `ccw` boolean — counterclockwise, which way it sweeps.

**MAYA:**
And the weirder ones?

**THEO:**
Ellipse, which is a center, the end of its major axis, and a minor radius. A spline — that's the free-form swoopy curve — which is a list of control point IDs and a degree. A conic, which is a parabola or hyperbola defined by some points. Text, which is interesting because a text entity actually carries four corner points forming a box you can dimension, so you can constrain the size of a word on your sketch. A picture, an imported image you can trace over. And an equation curve, where you literally type x and y as functions of a parameter t and it draws the curve.

**MAYA:**
You can type a parametric equation into the sketch and it draws it?

**THEO:**
You can. There's a couple more exotic ones — an intersection curve and a spline-on-surface — that are more 3D-ish and we won't dwell on them. But the point is: thirteen kinds, one list, one tag each. And the payoff — REQ five-five-nine, if you're following the requirements — is that adding a fourteenth kind means *extending the union and adding cases*, not bolting a fourteenth array onto every consumer. The shape of the code stops fighting you.

**MAYA:**
Okay, you teased the construction flag. Cash it.

**THEO:**
So `construction` is a little optional boolean on every entity, and it started with a simple meaning: "this shape is a guide, not real geometry." A centerline, a layout point — something that helps you build the sketch but doesn't become material in 3D. You draw a dashed centerline to mirror across, but you don't want the centerline itself to be a wall of the solid.

**MAYA:**
So construction shapes get filtered out at the end.

**THEO:**
Filtered out of profile extraction — the thing that becomes the solid skips them. But — the bit I love — they still participate in solving. A construction centerline can be the axis your geometry is symmetric about. It shapes everything, it just doesn't show up as material. That's REQ five-six-zero.

**MAYA:**
You said its meaning "expanded." That implies it grew beyond that.

**THEO:**
It did, a little by accident — which is the most honest kind of design. In the store — `store.ts`, the file that does all the sketch edits — there's a function `setConstructionFlag`. When you toggle a *curve* to construction, it cascades down to the curve's support points and flags them too. So a construction circle's center point also goes dashed.

**MAYA:**
Why does that matter?

**THEO:**
Visual coherence first — you don't want a solid-looking center dot floating inside a ghostly dashed circle; that reads as a bug. But deeper: the flag started meaning "reference geometry," and over time it quietly also became "locked reference geometry," because a fully-pinned construction circle is a stable thing to reference. It went from "don't extrude this" to "this is a fixed scaffold." Nobody decreed that. The code grew into it.

**MAYA:**
I appreciate you admitting the design wasn't handed down from a mountain.

**THEO:**
Most good design isn't. Oh — one more store detail that'll matter later. Every sketch is born with a synthetic origin point. ID is literally the string `"origin"`. It's at zero-zero, it's marked construction, and you cannot move it or delete it.

**MAYA:**
Why force an origin into every sketch?

**THEO:**
So you have something to anchor to. If you want a corner pinned to the origin, the origin has to be a real referenceable thing in the data, not an implied concept. Empty sketches get it seeded in; old sketches from before this rule get it backfilled by a function called `ensureOriginPoint`. Which is a nice segue, because old sketches are a whole thing.

**MAYA:**
Loading old data. Go.

**THEO:**
Remember the old schema — points array, lines array, constraints array. We have real sketches saved in that format. And we're *not* going to run a database migration that rewrites every blob on disk; that's risky and it touches the version-control system in ways we don't want. Instead there's a file, `migration.ts`, and when a document loads, a function `isLegacySketchState` sniffs for the old shape — a `points` field, a `lines` field.

**MAYA:**
And if it's old?

**THEO:**
It upgrades *in memory*, on the spot. `migrateSketchState` turns the old points and lines into tagged-union entities, backfills the origin, and — subtle one — rewrites constraint types that don't exist anymore. The old schema had separate `point-on-line` and `point-on-curve` constraints; the new model folds both into a single `coincident`. It also finds the old `projectedFrom` field and synthesizes the modern `on-edge` constraint.

**MAYA:**
So a user opening a two-year-old part never knows any of this happened.

**THEO:**
Never. The document upgrades the instant it touches the screen and saves back in the new format on the next edit. No migration window, no downtime, no scary batch job. Lazy in the good sense — work happens only when needed.

## Segment 2 — The solver: borrowing FreeCAD's brain

**MAYA:**
Alright. The star of the episode. The constraint solver. In the cold open you said you didn't write the hard math. Start there — why not?

**THEO:**
Because the hard math is genuinely hard, and there's a version of it that's already battle-tested by thousands of engineers. Let me set up *why* it's hard first. Naively, you might think: I'll just nudge things toward satisfying the rules. A point's a little too far from where a distance constraint wants it? Move it closer. Loop until everything's happy. That's called iterative projection, and it's what this system used to do.

**MAYA:**
And it worked?

**THEO:**
It worked for easy sketches. Rectangles. Points with distances. The moment you mix constraint types — a tangency *and* a perpendicularity *and* an equal-radius *and* a dimension, all interacting — iterative projection has no guarantee it'll ever settle. It can oscillate. It can creep. It can find a solution that technically satisfies each rule a little but isn't actually the shape you meant. There's no theory underneath it promising convergence.

**MAYA:**
So you need something with actual math behind it.

**THEO:**
You need Newton-Raphson. The intuition: every constraint can be written as an equation that should equal zero. "This distance minus twenty equals zero." "This line's slope minus that line's slope equals zero" — that's parallel. Stack all of those up and you've got a system of equations; the unknowns are all the coordinates and radii in your sketch. Solving the sketch *is* solving "where do all these equations hit zero at once."

**MAYA:**
And Newton-Raphson finds where a function hits zero.

**THEO:**
That's its whole job. Start at a guess — here, "wherever the geometry currently sits" — look at the slope of the error, take a smart step downhill toward zero, repeat. Each step roughly doubles your correct digits when it's behaving. The "slope" in many dimensions is a matrix called the Jacobian — "how does every constraint's error change as I wiggle every coordinate." And the gold standard is to compute that Jacobian *analytically*, with exact derivatives, not by poking each variable and measuring.

**MAYA:**
Why does analytic matter so much?

**THEO:**
Speed and accuracy. Computing it by nudging costs an extra evaluation per variable and eats numerical noise from the nudge. Analytic derivatives are exact and cheap. That's a big reason the good solver is the good solver.

**MAYA:**
And the good solver is...

**THEO:**
PlaneGCS. It stands for, roughly, planar geometric constraint solver. It's the 2D sketch solver that ships inside FreeCAD, which is a serious open-source desktop CAD program. Newton-Raphson, analytical Jacobians, decades of edge cases beaten out of it. The requirement that pins this is five-five-eight — "use a Newton-Raphson 2D solver based on PlaneGCS."

**MAYA:**
So you took FreeCAD's solver and... put it in a web page. How? That's a desktop C++ thing.

**THEO:**
WebAssembly. PlaneGCS is C++; it got compiled to WASM, which is this portable binary format that runs in the browser at near-native speed. So the actual numeric solving runs in compiled code, in the browser, on Maya's laptop, no server round-trip.

**MAYA:**
Now here's where I push back. You're shipping someone else's library. Normally you'd just install it from a package manager and let it update. But you told me earlier it's "vendored." What's that mean and why?

**THEO:**
Vendored means we copied the artifact and its wrapper into our own repository. It lives at `frontend/src/app/cad/vendor/planegcs/`. It's not pulled fresh from npm every build; it's *ours* now, in our tree.

**MAYA:**
Which sounds like the thing every senior engineer tells you not to do. Don't fork your dependencies.

**THEO:**
Usually, yeah. But weigh it. This solver is the literal heart of the whole CAD tool. If it vanished — package unpublished, the one maintainer walks away, a version drifts and breaks us — the entire sketcher dies. Vendoring insulates us completely. The version we tested is the version that ships, forever, until we deliberately update it. There's a `PROVENANCE.md` right next to it documenting where it came from and how to update on purpose.

**MAYA:**
There's a licensing angle too.

**THEO:**
PlaneGCS is LGPL — roughly, you can use it in a bigger program, but users need to be able to swap in their own version of the LGPL'd part. We honor that because the WASM binary is a clean, replaceable file — drop in your own `planegcs.wasm` if you want. So vendoring isn't just convenient, it's structured to respect the license too.

**MAYA:**
Okay so I draw my rectangle, I add a constraint. Walk me through what physically happens, button-press to settled-shape.

**THEO:**
Let's do it. The entry point is a function called `solveSketch`. It takes your sketch state and some options. First thing — there's a function `buildPrimitives` that translates your sketch into PlaneGCS's vocabulary. PlaneGCS doesn't know what our entities are; it knows *its own* primitive types. So:

Every point entity becomes a PlaneGCS point. Every line becomes a PlaneGCS line that references those points by ID. Every circle becomes a PlaneGCS circle. So far it's a pretty direct mapping.

**MAYA:**
And the origin, the one that can't move?

**THEO:**
The origin and any point you've explicitly pinned with a "fixed" constraint get emitted as fixed-true. PlaneGCS will treat those as immovable anchors. They're the bedrock the solve builds on. Without at least one anchor, the whole sketch could float off — every relative constraint is satisfied but the shape is wandering in space.

**MAYA:**
Makes sense. Then the constraints.

**THEO:**
Then each of your constraints runs through a function called `translateConstraint`, and this is the most interesting part of the whole file, because it's not one-to-one. It returns an *array* of PlaneGCS primitives.

**MAYA:**
Wait. One of my constraints can turn into several of PlaneGCS's?

**THEO:**
That's the whole reason it's interesting. Three categories. First, the easy ones — direct, one-to-one. You say "horizontal," it emits PlaneGCS's `horizontal_l`. "Vertical" becomes `vertical_l`. "Distance" becomes `p2p_distance` — point-to-point distance. "Perpendicular" becomes `perpendicular_ll`. "Parallel" becomes `parallel`. Clean handoffs.

**MAYA:**
And the second category?

**THEO:**
Dispatch-by-kind. Same user constraint, but which PlaneGCS primitive you emit depends on what shapes you selected. Take "tangent." Tangent between a line and a circle is a different equation than between two circles, or a circle and an arc. A helper, `tangentPrimitive`, looks at the two entities' kinds and picks the right one out of six variants. "Equal" is the same idea — equal length of two lines is one primitive, equal radius of two circles another, two arcs another. Four variants there.

**MAYA:**
So "make these tangent" is one button to me, but six possible equations underneath.

**THEO:**
And you never see the seam. You just pick two things and hit tangent. Now the third category, the fun one — synthesized. One constraint that becomes *two* PlaneGCS primitives that together mean the thing you asked for, because PlaneGCS has no single primitive for it.

**MAYA:**
Example.

**THEO:**
Midpoint. You say "this point is the midpoint of this line." PlaneGCS has no midpoint primitive. So we synthesize it: the point must be on the line — one primitive — *and* on the line's perpendicular bisector, which forces it to the exact center rather than just somewhere along it. Two primitives, together: midpoint.

**MAYA:**
Huh. On the line *and* on the bisector. Both at once nails it to the middle.

**THEO:**
Symmetric is similar — "midpoint lands on the axis" plus "the connecting line is perpendicular to the axis." Concentric becomes a coincidence of two center points. Coradial — same center *and* radius — is concentric plus equal-radius. Collinear — two segments on the same infinite line — becomes parallel plus point-on-line.

**MAYA:**
Now I have a naming worry. If "midpoint" spawns two new internal primitives, those need IDs, right? What if a generated ID collides with one of my actual shapes' IDs?

**THEO:**
You caught the exact footgun. They handle it by suffixing. If your constraint's ID is, say, `c42`, the two synthesized pieces get IDs like `c42-onl` for the on-line piece and `c42-pb` for the perpendicular-bisector piece. Derived from the parent, suffixed so they can't collide with any entity in your sketch. It's a small thing but if you got it wrong you'd get these maddening, intermittent solve corruptions.

**MAYA:**
What about the dimensions? The actual numbers — "radius twenty-five."

**THEO:**
Those are driven dimensions, emitting their matching PlaneGCS dimensional primitive. Radius emits `circle_radius` or `arc_radius`. Diameter, the diameter variants. Angle is sneaky — it uses an angle-between-four-points primitive with a sign correction so the sketch rotates the *short* way to the target instead of spinning all the way around.

**MAYA:**
Oh, I'd never have thought of that. If I say "ten degrees" you don't want it rotating three hundred fifty.

**THEO:**
Right, and you'd be furious watching your geometry whip around backwards. So the sign's chosen from the current geometry for the minimal path. Horizontal- and vertical-distance use a "difference" primitive on just the x or just the y, sign again chosen from where the geometry sits.

**MAYA:**
There's a subtlety I want to make sure I have. You mentioned arcs need a special rule.

**THEO:**
Yes — and it bit hard enough to be worth a full minute. An arc, in our data, is a center, a start, an end, a radius, and a direction. That's redundant — radius and endpoints over-describe the arc. And PlaneGCS will happily let all of those drift independently during the solve. The center wanders, the radius shrinks, the endpoints float, and they no longer agree. You get a nonsense arc where the "start point" isn't actually on the circle of that radius.

**MAYA:**
So you have to tie them together.

**THEO:**
You emit a thing called `arc_rules` for every single arc, automatically — a constraint with an ID like `arcrules-` plus the arc's ID, enforcing that start and end are on the circle and the radius and angles agree. PlaneGCS does *not* add this for you. Forget it, and every arc quietly comes apart on the first solve. So `buildPrimitives` emits it for every arc, no exceptions.

**MAYA:**
That feels like exactly the kind of thing you only learn by getting burned once.

**THEO:**
Once. You only need to watch an arc explode once.

**MAYA:**
Okay, primitives are built, including the arc rules. Now what?

**THEO:**
Now we hand the whole pile to the WASM solver — a wrapper with methods like `push_primitives_and_params`, `solve`, `apply_solution`. We push the primitives in and call solve. The algorithm it runs is called DogLeg — a robust Newton-Raphson variant that blends the aggressive Newton step with a safer gradient step. We don't care much about the internals; that's the part we deliberately didn't write.

**MAYA:**
And the WASM init isn't free, right?

**THEO:**
Init's about fifty milliseconds. So we do it *once*, lazily, the first time anyone solves, and cache that wrapper for the lifetime of the page. After that each solve just calls `clear_data` and pushes the new problem in. Fifty milliseconds once; sub-millisecond per solve after. That caching is why dragging feels continuous.

**MAYA:**
Then solve returns... what?

**THEO:**
A status and a degree-of-freedom count — more on degrees of freedom next segment. If the status is Success or Converged, we call `apply_solution`, and `readBack` copies the answers home: new x and y onto every point, new radius onto every circle and arc. Lines don't get read back — a line has no coordinates of its own, it's fully described by its two endpoints. Move the points, the line follows free.

**MAYA:**
And that whole loop runs every frame while I drag.

**THEO:**
Build, push, solve, read back, render. Every frame. That's the cold open.

**MAYA:**
What happens when I ask for something impossible? The "make this line both ten and twenty millimeters" case.

**THEO:**
This is REQ five-two-six and it's a fail-safe-or-die situation. If you let a contradiction scramble the sketch, you've corrupted the user's work — unforgivable. So: when solve returns *anything* other than Success or Converged — meaning it couldn't find a consistent answer — the solver does not apply anything. It returns a result tagged `inconsistent`, and crucially it returns the *original, prior state* — the sketch exactly as it was before you added the bad constraint.

**MAYA:**
So the caller gets back "here's your old sketch, untouched, and by the way that didn't work."

**THEO:**
And the caller — the editor — throws the new constraint away and pops up a message. That's REQ five-three-two, the user-visible "I rejected that and here's why." Your geometry never even flinches. You try to over-define it, it just declines, politely, and your forty existing constraints sit there exactly as they were.

**MAYA:**
There was one more wrinkle in my notes — something about not making unrelated stuff jump.

**THEO:**
Yeah, a quality-of-life thing that matters more than you'd think. When you add a constraint, there are often *many* valid solutions, and a dumb solver might pick one that yanks geometry on the far side of your sketch — stuff unrelated to what you added. Jarring. So there's an option, `movablePoints` — the set of points *allowed* to move — and everything else gets temporarily pinned. A wrapper, `solveSketchAfterAdd`, does two passes: first with only the new constraint's own targets movable, biasing toward "disturb as little as possible"; if that's too restrictive and fails, it retries with the restriction lifted.

**MAYA:**
So it solves *locally* first, touching as little as it can, and only goes global if it has to.

**THEO:**
Least surprise first. You add a dimension to one corner and that corner adjusts; the opposite end doesn't go skating across the screen. There's a sibling option, `pinAllRadii`, that locks every radius during a drag so you don't accidentally resize a circle while just moving it. Both are about respecting what the user clearly didn't intend to change.

## Segment 3 — Determinacy: am I done yet?

**MAYA:**
So here's a question that's been nagging me. When am I *done*? How do I know my sketch is fully nailed down versus still floppy?

**THEO:**
And that question is the entire emotional core of parametric sketching. The whole feel of these tools is a loop: you look at your sketch, you go "what's still loose?", you add a constraint, you look again. So the editor has to *tell* you, at a glance, what's pinned and what's free. We color it. Fully-determined geometry is one color — blue — and stuff that can still wiggle is another — black. That's REQ five-three-three.

**MAYA:**
And blue means?

**THEO:**
Blue means: this entity has exactly one possible position now. It cannot move. You've fully constrained it. Black means it still has freedom — it could slide, rotate, grow. The mental model is degrees of freedom. A free point in 2D has two degrees of freedom — x and y, it can go anywhere on the plane. Pin its x with a vertical line constraint and it's down to one — it can only slide up and down. Pin a distance too and it's down to zero — locked. Zero degrees of freedom is "done."

**MAYA:**
Now wait — doesn't PlaneGCS already give you a degree-of-freedom number? You said solve returns a DOF count.

**THEO:**
It does, and that catches a great misconception. PlaneGCS gives you *one scalar* for the whole sketch. "This sketch has three degrees of freedom remaining." Total. It does *not* tell you *which* three. It won't say "this point is free and that line is pinned." It's a single number for the entire system.

**MAYA:**
But for coloring you need per-shape. You need to know "this specific circle — locked or loose."

**THEO:**
Exactly, and that's why there's a whole separate file, `determinacy.ts`, doing analysis PlaneGCS doesn't hand us. Its main function is `analyzeDeterminacy`, and what it returns is the *set of entity IDs that are fully determined*. Then the viewer just asks, for each shape, "are you in the determined set?" — blue if yes, black if no.

**MAYA:**
How does it figure that out?

**THEO:**
This is a genuinely pretty piece of linear algebra. Step one: list every free parameter. Each non-fixed point contributes two — x and y. Each circle and arc contributes its radius. So you get a big vector of all the numbers *allowed* to change. The origin, fixed points, and on-edge anchors are pre-removed — no column, they can't move by definition.

**MAYA:**
Okay, a list of every knob that can turn.

**THEO:**
Right. Step two: build the Jacobian — that same "how does every constraint's error respond to wiggling every parameter" matrix. Rows are constraints, columns are parameters. Here it's built by finite differences — nudge each parameter a tiny step, measure how each constraint's residual changes — with a careful step size scaled to each value's magnitude, around ten-to-the-minus-seven.

**MAYA:**
Hold on — earlier you bragged that PlaneGCS uses *analytic* Jacobians, not finite differences, and that the analytic one was better. Now determinacy uses finite differences. Why the downgrade?

**THEO:**
Sharp. Different job, different tradeoff. PlaneGCS is *solving* — it does that math hundreds of times a second under your mouse, so the speed and precision of analytic derivatives is worth the engineering. Determinacy runs *once* after a solve settles, just to decide what color to paint things. It doesn't need to be blazing or perfectly precise; it needs to be simple and robust and easy to get right for twenty-some constraint types. Finite differences are dead simple to write and correct. It's the right tool for a once-per-settle classification, even though it'd be the wrong tool inside the hot solve loop.

**MAYA:**
Fair. Okay, you've got the Jacobian. Then what?

**THEO:**
Step three is the clever bit. You take that matrix and you do Gauss-Jordan elimination — row-reduce it to what's called reduced row echelon form. And the question you're really answering is: which parameters are *pinned down* by the constraints, and which are still free to vary? In linear-algebra terms, you're finding the pivot columns. There's a function `determinedColumns` that does this.

**MAYA:**
And a pivot column means that parameter is determined?

**THEO:**
*Almost.* Here's the subtlety that makes it match real CAD. A parameter is only "uniquely determined" if its pivot row has zeros in every *free* column — meaning its value is fixed and doesn't depend on any still-free variable. If it's determined only *in terms of* something still free, it'll move when that free thing moves, so it's not actually nailed down.

**MAYA:**
Say it slower. The difference between "I have a value" and "I have a value that won't change."

**THEO:**
Two points connected only by "these two are five apart." Is point B determined? It's five from A — but A is still free to slide anywhere. So B is pinned *relative to a thing that's loose*, which means B is loose. Its pivot row has a nonzero entry in one of A's free columns, so the analysis correctly says: not determined. Black. And that matches SolidWorks precisely — a shape turns blue only when it genuinely cannot move, not when it's merely related to something.

**MAYA:**
That's a beautiful little distinction. Then you roll it up to shapes?

**THEO:**
Last step, `rollUpToEntities`. The analysis worked on raw parameters — individual x's and y's and radii. But the user sees shapes. So: a point is determined when both its x and its y are determined. A line is determined when both its endpoint points are. A circle is determined when its center *and* its radius are. An arc when center, start, end, and radius all are. Roll the parameter-level answer up to the entity level, hand back the set of determined IDs, viewer paints.

**MAYA:**
And arcs — you said earlier they're internally redundant. Does that trip up the analysis?

**THEO:**
Good memory. It handles it by adding the arc's internal invariants as *implicit rows* in the Jacobian — "the start point is exactly one radius from the center," "the end point is exactly one radius from the center." Those get folded in so the arc's endpoint parameters are tracked correctly, same spirit as the arc-rules thing from the solver. The redundancy is real, so it's accounted for in both places.

**MAYA:**
You mentioned a fallback. What happens if this fancy analysis blows up?

**THEO:**
There's a safety net, `analyzeHeuristic`. If the exact Jacobian analysis throws — malformed state, a numerical edge case, a degenerate sketch — instead of crashing the editor it falls back to a simpler constraint-propagation heuristic: track per-point degree-of-freedom counts — two for free, zero for fixed — and propagate reductions through the easy constraints. It's less accurate — it misses some implicitly-determined triangles the precise analysis would catch — but it never throws. Worst case: slightly-too-conservative coloring instead of a broken editor.

**MAYA:**
Graceful degradation. The fancy thing when it can, the dumb-but-safe thing when it must.

**THEO:**
And the user never sees a stack trace because their sketch happened to hit a numerical corner. The coloring just gets a touch more cautious for that one weird sketch.

## Segment 4 — The three-way split nobody expects

**MAYA:**
Okay. This is the one you told me would bend my brain. The three-way split. Lay it out.

**THEO:**
Take a single circle on a sketch. Just one circle. There are three completely different things the system does with it, and each represents it *differently*. Rendering it. Solving it. Clicking on it. Three separate representations of the same circle, on purpose.

**MAYA:**
Start with rendering. When I look at the circle on screen, what am I actually seeing?

**THEO:**
A *fan of tiny straight line segments*. The 3D overlay can't draw a true mathematical circle — it draws line segments, that's what the graphics layer speaks. So the circle gets *tessellated* — chopped into a chain of short chords that approximate the curve. There's a file, `tessellator.ts`, whose whole job is turning curves into these polylines.

**MAYA:**
So my smooth circle is a lie. It's a many-sided polygon.

**THEO:**
It's a many-sided polygon, but a carefully-many-sided one. The tessellator computes how many segments it needs from a tolerance — the "chord height," the maximum gap between the true curve and the straight chord cutting across it. Default's point-oh-five. The formula's elegant: the number of segments is the ceiling of pi over the arccosine of one minus tolerance-over-radius.

**MAYA:**
Walk me through what that *means*, not the symbols.

**THEO:**
Bigger circle, more segments. Smaller tolerance, more segments. A huge circle needs lots of chords to stay within that tiny gap; a tiny circle needs only a few. It adapts to scale — small features get enough facets to look smooth, giant circles don't waste thousands of vertices. There's a floor of three. And arcs scale the same way, proportional to how much of the full circle they sweep.

**MAYA:**
And this is what feeds the 3D engine too, right? The thing that actually makes the solid?

**THEO:**
Right, that's the second consumer of tessellation, and it's the whole *reason* tessellation exists — REQ five-six-two. The pure-JS extrude path operates on straight-edged polygons. So curves *must* become polylines before they can be pushed into a solid that way. Renderer and extruder both eat the tessellated form.

**MAYA:**
Now — the solver. You spent a whole segment on it. Does the solver see this fan of segments?

**THEO:**
No. And this is the key. The solver works on the *parametric* form — the circle as "a center and a radius." Two numbers. When PlaneGCS solves a tangency on that circle, it's reasoning about the true mathematical circle, the analytic definition, not a forty-sided polygon. If it solved against the tessellation, every constraint would be slightly wrong — tangent to a *facet* instead of tangent to the true curve — and worse, the answer would change every time the tessellation density changed. So the solver lives entirely in the clean parametric world. Center and radius. Never sees a chord.

**MAYA:**
So the same circle is a polygon to the renderer and two numbers to the solver. That's two. What's the third?

**THEO:**
Picking. Clicking. When you move your mouse over to click that circle's edge to select it, how does the system decide you hit it? You might assume it tests against the tessellation — "is the cursor near one of those little line segments?" That's the obvious implementation. And it's *wrong*, and we deliberately don't do it.

**MAYA:**
Why is it wrong?

**THEO:**
Because the tessellation has *gaps*. Between two chords, near the middle where the chord cuts across, the true curve bulges out past the straight segment by up to the chord tolerance. If you hit-test against the segments, there's a thin dead zone along the real curve where your click "falls through the crack" between facets and misses. And it gets worse for *coarse* tessellation — a big circle with relatively few segments, or if you cranked tolerance up, has bigger gaps. Your pick accuracy would degrade exactly as the curve gets chunkier.

**MAYA:**
So picking is the third representation.

**THEO:**
Picking goes back to the analytic definition. There's a file, `picking.ts`, and its core is a function `distanceToEntity` that hit-tests each shape against its *true math*. For a circle, the distance from your cursor to the circle is — beautiful and simple — the distance from the cursor to the center, minus the radius, absolute value. The ring distance. It doesn't care about facets at all. So you can click the visual edge of a tiny circle and never see a miss. That's REQ five-six-four, and the requirement spells it out: "independent of the tessellation used for rendering, so pick accuracy does not degrade with coarse tessellation."

**MAYA:**
So let me make sure I've got the trinity. Same circle. Rendered as a polygon of chords. Solved as a center plus a radius. Picked as a true ring you measure distance to. Three representations.

**THEO:**
Three representations, three files, zero coupling. And the magic is they *don't interfere*. Crank the render tessellation coarse to save memory and your picking stays pixel-perfect, because picking never looked at the tessellation. Each one has a different job: rendering wants "looks smooth and cheap to draw," solving wants "mathematically exact and stable," picking wants "accurate no matter how coarse the drawing is."

**MAYA:**
And picking handles every shape this way?

**THEO:**
Per-kind. A line is the perpendicular distance to the segment, clamped to its endpoints. A circle is the ring distance. An arc is the ring distance *if your cursor's angle falls within the sweep* — otherwise the distance to the nearer endpoint, because you shouldn't click the empty part of the circle where the arc isn't. A few gnarly ones — ellipse, spline — honestly *do* fall back to tessellation, because true closest-point on an ellipse needs iterative root-finding and it's not worth it for a click tolerance. Analytic purity for the common shapes; the polyline for the rare ones. But points, lines, circles, arcs — the bread and butter — are fully analytic.

**MAYA:**
There's a tie-breaking thing too, in my notes. PICK_RANK?

**THEO:**
Yeah, when several things are near your cursor, you need a priority. It's a two-pass deal. First pass: if any *point* is within a small point-tolerance, the point wins outright, no contest — because near a corner you almost always mean the vertex, not the lines meeting there. Grabbing the corner point is more useful than grabbing one of the two edges. Second pass, if no point grabbed it: there's a rank map — points rank zero, most curves rank one, text rank two, pictures rank three — lowest rank within tolerance wins, and distance breaks ties inside a rank. So a text box or a traced picture sitting on top of construction lines won't *absorb* a click that was meant for the lines underneath it. The cheap, precise, structural things get priority over the big area-filling things.

**MAYA:**
The picture doesn't get to hog clicks just because it's big.

**THEO:**
Exactly. Big and vague loses to small and precise.

## Segment 5 — From doodle to solid: profile extraction

**MAYA:**
Alright. I've drawn my shape, I've constrained it, it's all blue, I'm happy. Now I want it to become a 3D solid. There's a step in between, you said — the system has to find the actual outline.

**THEO:**
This is profile extraction, and it's a genuinely fun graph-theory problem hiding inside a CAD tool. Here's the thing: your sketch is just a *bag of entities*. Some lines, some arcs, maybe a circle, maybe some construction junk you don't want. The extruder needs a clean answer to: "what are the closed loops here, which ones are holes inside other ones, and which are separate islands?"

**MAYA:**
Give me the washer example, because that's the one that made it click for me earlier.

**THEO:**
Perfect example. You draw two circles, one inside the other, sharing a center. To you, obviously, that's a washer — a ring. But the raw data is just "two circle entities." The system has to figure out: the outer circle is a boundary, the inner circle is a *hole* punched in it, and the region between them is solid material. Extrude *that* and you get a ring. Extrude it wrong and you get a solid disc, or two overlapping discs, or an error.

**MAYA:**
So how does it find loops?

**THEO:**
The intuition is the maze-wall trick. You know how if you're lost in a maze, you put your right hand on the wall and just keep following it, and eventually you trace the whole boundary? Same idea. Start on an edge, always turn the same direction at every junction, and you trace out exactly one closed loop. Do it from every unused edge and you find every loop.

**MAYA:**
But our sketches have curves, and crossings, and that snapping you mentioned. It's not a clean maze.

**THEO:**
No, and there are three real complications, each with its own machinery. Let me take them in order. The first one is the sneakiest, and it lives in the backend — there's a function called `canonicalizePoints`, in `cadProfile.js`.

**MAYA:**
Wait, backend? I thought this was all in the browser.

**THEO:**
It runs in both — that's a whole parity story I'll get to. But `canonicalizePoints` first. Here's the problem it solves. When you draw a rectangle in the editor, you don't draw four lines sharing four corner points. You draw line one, which creates two fresh endpoint IDs. Then line two, which creates *two more* fresh IDs — and where line two's start "touches" line one's end, the editor doesn't reuse the ID. It creates a new point and links them with a coincident *constraint*.

**MAYA:**
So a rectangle that looks like four corners is actually... eight points?

**THEO:**
Eight points. Four coincident constraints holding them in pairs. And if you naively walk that as a graph by shared IDs, every "corner" looks like two separate degree-one dead-ends — an open chain. The walker throws up its hands and says "this isn't closed, I can't extrude it," even though it's visually a closed rectangle.

**MAYA:**
So canonicalize fixes that.

**THEO:**
It's a union-find — the classic structure for grouping things into equivalence classes. It merges point IDs that are *either* joined by a coincident constraint *or* sitting within a tiny spatial tolerance of each other. After it runs, those eight points collapse to four canonical corners and the walker is happy. Without it, basically no hand-drawn shape would extrude. Invisible plumbing that makes the whole thing not be broken.

**MAYA:**
Okay. Complication two?

**THEO:**
Curves that *cross* each other where the crossing isn't a point you drew. Picture a line slashing through a circle — that should make two half-disk regions. But there's no point in the data where the line meets the circle; they just geometrically overlap. So a phase called `splitAtIntersections`, in `arrangement.ts`, goes through every pair of non-construction curves, computes where they actually cross, and *inserts new points at the crossings*, chopping the curves into pieces there.

**MAYA:**
So the line through the circle becomes...

**THEO:**
The circle becomes two arcs, split at the two crossing points. The line becomes three sub-segments — outside, inside, outside. Now there *are* real shared vertices at the crossings, and the maze-walk can find the two half-disk regions even though you never clicked where the line meets the circle. It even dedups crossings that land basically on top of each other using a spatial bucket map, so you don't get duplicate near-identical points.

**MAYA:**
And complication three is the actual walk.

**THEO:**
The actual walk — done properly, with a real data structure called a DCEL, a doubly-connected edge list. Every edge becomes *two* directed half-edges, one each way, like a two-way street drawn as two one-way lanes. Each half-edge knows its start, its end, its twin — the lane going the other way — and critically its *exit angle*: the tangent direction it leaves its start vertex at. For a line that's just its slope; for an arc it's the arc's tangent there, which depends on which way it curves.

**MAYA:**
Why do you need the exit angles?

**THEO:**
That's how you do "always turn the same way" rigorously. At every vertex you sort the outgoing half-edges by angle. Then walking a face is mechanical: when you arrive along some edge, the next edge around the face is the one immediately clockwise from your twin in that sorted fan. Follow those next-pointers and they trace one face. Keep going from unused half-edges and you enumerate every face.

**MAYA:**
And you know which faces are real regions versus the outside-the-world infinite face how?

**THEO:**
Signed area — the shoelace formula. Walk a face, compute its signed area. Positive means a bounded interior region, the kind you can fill with material. Negative or zero is the unbounded outer face, the infinite "outside," which you discard. So out of the walk you get a clean list of bounded faces, each a real fillable region.

**MAYA:**
Then the washer logic — outer versus hole.

**THEO:**
That's `extractRegions`. You've got all your closed loops; now you sort out nesting. It tessellates each loop coarsely — just for containment testing — and builds a containment matrix: which loops fully contain which? Then each loop finds its *direct* parent — the deepest, tightest loop containing it — and becomes a hole in that parent. For the washer: the inner circle is contained by the outer, so it becomes a hole; you get an annulus region — outer boundary, inner hole — and separately the inner disk as its own region.

**MAYA:**
Wait, both? The ring *and* the inner disk?

**THEO:**
Both regions exist, and the user picks which to extrude. That's REQ six-two-one — and the validation is literally "user extrudes a washer and can pick the inner disk, the outer disk, *or* the annulus." A feature carries a `regionIndices` field saying which regions it consumes. Default, if you don't say, is region zero. So you extrude the ring, or you extrude the disc, or someone doing something clever extrudes both. The geometry's all there; selection is a separate choice.

**MAYA:**
You mentioned typed loops earlier — preserving the curve identity. Why does that matter if you're tessellating anyway?

**THEO:**
This is REQ six-one-seven and it's about the *quality* of the final solid. Each edge in a profile loop keeps its true type — line, arc, circle, Bézier — carrying its analytic definition, not a pre-chopped polyline. Hand the kernel a tessellated arc — forty little segments — and it builds forty little flat side faces. A faceted wall. Hand it a *typed arc edge* and it builds *one smooth curved face*. The validation line is literally "an extruded arc produces a single curved side face, not a fan of flat strips." Typed loops keep face count low, BReps clean, and face naming stable, which matters downstream.

**MAYA:**
And there's a shortcut for the simplest case?

**THEO:**
The single-circle shortcut, REQ six-one-two. If your sketch is exactly one non-construction circle and no lines or arcs, there's no maze to walk — it's just a circle. So `extractClosedLoop` special-cases it: one circle in, one self-closing circle edge out, done. No graph machinery for the most common simple case. You drew a circle, you want a cylinder, the system doesn't make a production of it.

**MAYA:**
You keep saying frontend *and* backend run this. Why twice?

**THEO:**
Two moments, same algorithm. The frontend version, `profile.ts`, runs in the browser to drive the live "can I extrude this yet?" affordance — graying out or lighting up the extrude button, showing previews. The backend version, `cadProfile.js`, runs on the saved sketch during server-side regeneration — when the part rebuilds for real, the server re-extracts the profile from the stored document.

**MAYA:**
And they have to agree.

**THEO:**
They have to agree *exactly*, or you get the worst kind of bug — looks fine in the editor, comes out wrong when the server rebuilds it. So they're kept in lockstep, and the test suite literally asserts the two produce matching output. One honest caveat the docs flag: the backend trusts the resolved coordinates the client already solved. It doesn't re-run PlaneGCS server-side — server-side re-solving is a separate, future work item. So today the server takes the client's solved positions as truth and just re-does the *extraction* on them.

**MAYA:**
That seems like a reasonable line to draw for now.

**THEO:**
It is, as long as you know where the line is. The geometry the server extracts is only as trustworthy as the solve the client already did — which is fine, because the client did a real solve with the real FreeCAD solver. But it's worth remembering if server-side re-solving ever becomes necessary.

## Segment 6 — The helpful stuff: inference and edit ops

**MAYA:**
Let's talk about the things that make it feel *nice* to use. Two areas in my notes. Inference — the snapping — and the edit operations, the trim and offset and mirror tools.

**THEO:**
Inference first — it's subtle and most people never notice it's happening, which is the goal. There's a file, `inference.ts`, whose whole job is: while you're dragging out a line, where should the endpoint *want* to go, and what constraint should I quietly offer?

**MAYA:**
The "it snaps to horizontal" thing.

**THEO:**
The headline one. You drag a line, get *close* to horizontal — within five degrees — and it snaps to exactly horizontal, a badge pops saying "horizontal," and when you click, it doesn't just place a roughly-flat line, it adds a real `horizontal` *constraint*. So the line is genuinely, permanently flat, not just flat-looking. The function's `inferLineEnd`, running every mouse-move while you draw.

**MAYA:**
So it's not just visual snapping. It's offering to add real constraints based on what you seem to be aiming at.

**THEO:**
That's the soul of it. It infers your *intent* and pre-loads the constraint. And there's a strict priority order, first match wins. Top priority is curve coincidence — if your cursor's near an existing circle or line, it snaps the endpoint right onto that curve and offers a coincident constraint, so your new line actually *attaches* to the circle. Then horizontal snap. Then vertical snap. Then polar tracking — snapping to nice angles, multiples of fifteen degrees, with a little "forty-five degrees" hint. Then alignment — lining up with other points in the sketch, vertically or horizontally.

**MAYA:**
And those all add constraints?

**THEO:**
Here's a clean distinction, and it's deliberate. Coincidence, horizontal, vertical — those add real constraints, because PlaneGCS has primitives for them. Polar tracking and alignment do *not* — they just snap the position and draw a dashed guide. So they help you *place* the point accurately, but they don't *pin* it. You get the convenience without a phantom constraint you didn't ask for.

**MAYA:**
That's a nice honesty — snap me, but don't secretly constrain me with something you can't really enforce.

**THEO:**
And critically, inference never touches the sketch itself. It's pure — cursor in, "here's the snapped position and here's the constraint I *would* add" out. The constraint only gets applied when you actually click. So hovering around never commits anything; it's all suggestion until you commit.

**MAYA:**
Now the edit ops. Trim, extend, offset, mirror. These are the after-the-fact tools.

**THEO:**
`sketchEditOps.ts`, and like the store, every one is a pure function — sketch in, new sketch out, never mutates. Trim's the most-used and the most fiddly. You've got a line crossing two other lines, and you want to scissors-out just the middle chunk between the two crossings. So `trimAt` finds all the points where other curves cross your line, finds the two crossings bracketing where you clicked, and replaces the original line with the sub-segments you *keep*.

**MAYA:**
And the constraints on the original?

**THEO:**
That's the genuinely careful part. When you cut a line in two, what happens to its constraints? Some should transfer, some absolutely shouldn't. Direction-type constraints — horizontal, vertical, parallel, perpendicular, collinear, on-edge — those *inherit* onto every surviving sub-segment, because a piece of a horizontal line is still horizontal. But *length* constraints, *equal* constraints — those deliberately don't transfer, because the sub-segment has a totally different length than the original. Inheriting "this is twenty millimeters" onto a piece that's now seven millimeters would be nonsense.

**MAYA:**
So it knows which constraints are about *shape* versus about *size*.

**THEO:**
Direction versus magnitude. Direction survives the cut, magnitude doesn't. And there's a little efficiency thing — before it makes a new endpoint at a cut, it looks for an existing point within a thousandth of a unit and reuses it. So at a T-junction where the cutter already ends right at the intersection, you don't spawn a redundant duplicate point. Reuse over proliferate.

**MAYA:**
Mirror's the one I think I'd use constantly. Symmetric parts.

**THEO:**
Mirror does the thing you'd hope. You select some entities and a centerline, and each one reflects across the line — `reflectAcrossLine` does the geometry. A line reflects both endpoints; a circle reflects its center and gets an equal-radius; an arc reflects center, start, end and flips direction. But here's the good part: after reflecting, it emits `symmetric` constraints linking each original point to its mirrored twin, and `equal` constraints linking each curve to its mirror.

**MAYA:**
So the mirror isn't a dumb copy. It stays *connected*.

**THEO:**
It stays live. Drag the original and the mirror moves symmetrically, automatically, because the symmetric constraints are real and the solver enforces them every frame. You designed half a symmetric part and the other half just *tracks* it forever. That's the difference between "copy-paste-flip" and a parametric mirror.

**MAYA:**
And offset — parallel copies.

**THEO:**
Offset makes a parallel curve at a distance — think the inner wall of a pipe parallel to the outer. For a line it's a perpendicular translation, the side chosen from a cross product against where you clicked. For a circle it grows or shrinks the radius depending on whether you clicked inside or out. The genuinely hard version is *chained* offset — offsetting a whole connected run of segments consistently, so the chain steps inward or outward together without one segment flipping to the wrong side.

**MAYA:**
Why is consistency hard there?

**THEO:**
Because "which side is inward" has to stay coherent as you go around corners. There's a flood-fill that finds all the connected segments — and it connects them by shared *coordinates*, not shared IDs, because of that same eight-points-for-a-rectangle thing. Then it works out the consistent direction: a closed loop uses a polygon-containment test — is each offset midpoint on the same side as your seed click — and an open chain propagates the seed's left-or-right handedness down through each segment. So one click establishes the side, and it carries all the way around, even through corners.

## Segment 7 — Honest notes: the unfinished and the duct tape

**MAYA:**
Okay. This is the segment where you tell me what's *not* done, or done with duct tape. Because the docs were refreshingly blunt about a few things and I want them on the record.

**THEO:**
I like this segment. So, first one — and it's a big one — the tool *menu* is way ahead of the tool *implementations*. If you open the sketch editor, there's this gorgeous toolbar. Point, line, centerline, midpoint-line. Circle, perimeter circle, center arc, three-point circle, three-point arc, tangent arc. Ellipse, partial ellipse, parabola, equation curve. Rectangle in four flavors, parallelogram, polygon, four kinds of slot, text, picture. Trim, extend, fillet, chamfer, split, jog.

**MAYA:**
That's a lot of tools.

**THEO:**
It's a *SolidWorks-looking* lot of tools. And a bunch of them are buttons that don't fully do the thing yet. The three-point circle, the tangent arc, the slots — some of those variants are spec'd, the requirements exist, the buttons render, but the actual entity-building behind them is partial or stubbed. The data model genuinely *supports* all thirteen entity kinds — the tagged union has them, the store can hold them, the type system knows them. But the interactive tool that lets you *draw* one with three clicks isn't always wired all the way through.

**MAYA:**
Why ship the buttons before the behavior?

**THEO:**
Honestly? The data model came first on purpose — get the union, the store, and the solver mappings solid. And the toolbar enumerates the *aspiration* — the full SolidWorks-equivalent set — so the UI's shape is locked in even as tools land one by one. But it means if you expect "tangent arc" to behave like SolidWorks's today, you might find it half-there. These "cover" the requirements in the sense that the plumbing is staged, not that every one is polished.

**MAYA:**
What's actually solid and shippable right now?

**THEO:**
Points, lines, circles by center-and-radius, arcs by center-and-endpoints, rectangles, polygons. The core of the core. Those go all the way through — draw, constrain, solve, extract, extrude. The exotic stuff — splines, conics, equation curves, text, pictures — exists in the model and tessellates and picks, but the authoring tools and some downstream handling are at varying stages.

**MAYA:**
Give me the most embarrassing piece of duct tape.

**THEO:**
[laughs] Okay. When you add a dimension — "make this twenty-five millimeters" — and the editor needs you to type the number, in at least one path it uses a plain browser `window.prompt`. The little gray "this page says..." box your browser throws up.

**MAYA:**
The thing from like 2004.

**THEO:**
The thing from 2004. It's quick, it's dirty, it works — type twenty-five, hit enter, the constraint gets the value, the solver runs, the geometry snaps. Escape or Cancel cleanly aborts, nothing gets corrupted. So functionally it's *fine*; aesthetically it's a browser prompt in the middle of an otherwise slick 3D CAD tool. The intended replacement is a proper Material dialog. It just wasn't blocking anyone, so it sat.

**MAYA:**
I actually respect that. It works, it's honest, it's flagged, it's on the list.

**THEO:**
That's the whole philosophy. Ship the thing that works, write down that it's duct tape, don't pretend. There's another one in that spirit — the determinacy coloring's heuristic fallback we talked about. It's "less accurate for implicitly-determined triangles." That's an admitted approximation. The exact analyzer's the real deal, but when it can't run, you get a slightly-too-cautious answer rather than a crash. Documented, on purpose, fine.

**MAYA:**
And server-side solving — you flagged that one earlier.

**THEO:**
Right, the backend trusts the client's solved coordinates instead of re-solving. That's a real seam. It's correct *today* because the client always solves before saving, but it's a documented limitation, not an oversight. The honest version of "how does this work" includes "and here's where it's currently taking a shortcut." All three of those — the prompt, the heuristic, the no-server-resolve — are flagged in the docs as known approximations. That's what makes them okay. The sin isn't the shortcut; it's the *undocumented* shortcut.

**MAYA:**
You sound like you've inherited an undocumented shortcut before.

**THEO:**
Everybody who's done this long enough has spent a weekend discovering one. Writing them down is penance.

## Recap

**MAYA:**
Okay, let me pull the threads. Four things I'm walking away with.

One: a sketch is a single list of tagged entities — points, lines, circles, arcs, up to text and equation curves — where shapes reference their support points by ID, so moving a shared corner moves everything attached. Plus a `construction` flag whose meaning quietly grew from "don't extrude this" to "locked reference scaffold," and a forced origin point in every sketch.

**THEO:**
And legacy sketches upgrade themselves in memory on load — no database migration, ever.

**MAYA:**
Two: the solver is the vendored PlaneGCS — FreeCAD's actual constraint solver, compiled to WebAssembly, copied into the repo on purpose so nothing upstream can ever break it. It runs Newton-Raphson with exact analytic derivatives every frame. Your constraints translate into its primitives, sometimes one-to-one, sometimes one-to-six by shape kind, sometimes one-of-yours-into-two-of-its like midpoint and symmetric. And every arc secretly carries an "arc rules" constraint or it falls apart. And if you ask for a contradiction, it hands your old sketch back untouched and refuses.

**THEO:**
Fail safe, always.

**MAYA:**
Three: "am I done" is its own analysis, in `determinacy.ts`, because PlaneGCS only gives you one number for the whole sketch, not per-shape. So there's a Jacobian-rank analysis — row-reduce, find which parameters are truly pinned versus merely related to something still loose — and that's what paints shapes blue when they're locked and black when they're free. With a dumb-but-unbreakable heuristic fallback if the fancy version chokes.

**THEO:**
And the distinction that makes it match real CAD: "determined" means "can't move," not "has a value."

**MAYA:**
Four — my favorite — the three-way split. One circle is three different things: a fan of straight chords to the renderer and the extruder, a clean center-and-radius to the solver, and a true ring you measure distance to for picking. Decoupled on purpose, so coarse drawing never hurts click accuracy and the solver never reasons about facets.

**THEO:**
And the bonus thread — turning that doodle into a solid is a real graph walk: merge the duplicate corners, split curves where they cross, build a half-edge structure, always turn left to enumerate the loops, then sort out which loops are holes inside others. The washer becomes a ring because the inner circle gets recognized as a hole, and you can pick the ring, the disc, or both.

**MAYA:**
And typed loops, so an extruded arc gets one smooth face instead of a fan of flat strips.

**THEO:**
That's the lot.

## Teaser

**MAYA:**
So next time — we've got a clean, solved, closed profile sitting on a plane. A perfect 2D outline. And we're about to give it *depth*.

**THEO:**
Episode seven. From 2D to solid. We take this profile and we extrude it, revolve it, sweep it — we hand it to the real geometry kernel, the Rust-and-OCCT one, and we get actual three-dimensional bodies with real faces and edges and topology. And we get into the feature tree — how an extrude knows it's sitting on top of a sketch, how cuts and revolves and fillets stack into a recipe that rebuilds your part from scratch every time you change one number near the top.

**MAYA:**
The thing where you edit step two and steps three through twelve all replay.

**THEO:**
Parametric rebuild, the whole point of the exercise. That's next time. Bring your right hand off the maze wall — we're going up into the third dimension.

**MAYA:**
See you there.

---

# Episode 7 — Features: From 2D to Solid

## Cold open

**MAYA:**
Okay, picture this. Maya — a different Maya, a mechanical engineer at some shop — has a bracket she designed three weeks ago. Forty features. Sketches, extrudes, a dozen holes, fillets, a shell, a pattern of cooling slots. And her boss walks over and says, "the mounting plate needs to be eight millimeters thicker."

**THEO:**
The dreaded late change.

**MAYA:**
So she finds the very first feature — the base plate extrude, the thing everything else is stacked on top of — and she changes one number. Ten to eighteen. And she hits enter, and the *entire part rebuilds*. The holes move up. The fillets reform on the new edges. The cooling slots re-pattern. The shell re-hollows. All of it, automatically, in the right order.

**THEO:**
And here's the part that should bother you a little: the system didn't redo most of that work. It only recomputed the steps that actually depended on the thing she changed.

**MAYA:**
Wait — it changed the thickness, which everything sits on. How does *anything* survive that?

**THEO:**
That's the whole episode. There's a recipe, there's a replay, and there's a very opinionated filing cabinet that decides what gets reused. Let's pull it apart.

## Intro

**MAYA:**
Welcome back. This is the deep-dive season — Season Two — of our series on this browser-based parametric CAD system bolted onto a manufacturing app. If you're just joining: in Season One we did the wide-angle tour, what parametric modeling even *is*, why you'd build a CAD tool in a web browser. And last episode we were down in the sketcher — points, lines, constraints, the solver that makes a rectangle stay a rectangle.

**THEO:**
The two-dimensional world.

**MAYA:**
Right. And today we climb out of it. Today is the bridge from 2D to 3D — features. How a flat sketch becomes a solid block, how those blocks stack and combine and get rounded and drilled and hollowed out, and the machinery underneath that replays the whole thing every time you touch a number. Theo built this. Theo, where do we start?

**THEO:**
We start with the recipe. Because everything today hangs off one idea, and it's almost aggressively simple: the part is not a shape. The part is a *list*.

## Segment 1 — The recipe, not the cake

**MAYA:**
Okay, "the part is a list." Sell me on that, because my intuition says a part is a chunk of metal. It's a shape.

**THEO:**
That's what it *looks like* at the end. But that's the cake. We don't store the cake. We store the recipe — the ordered steps that, when you follow them, produce the cake.

**MAYA:**
And the recipe lives where?

**THEO:**
In a structure we call the feature tree. In the code it's literally a file named `featureTree.ts`. And the data shape is almost insultingly humble. It's an object with a field called `features`, which is an array — an ordered list — and a little counter. That's basically it.

**MAYA:**
An ordered list of what, exactly?

**THEO:**
Features — and a feature is one step in the build. "Start with the origin." "Extrude this sketch ten millimeters." "Cut this hole." "Round these edges." Each is an object with a unique id, a type — `extrude`, `fillet`, `hole` — and a bag of parameters that make sense for that type.

**MAYA:**
So an extrude carries a distance, a hole carries which holes and what size —

**THEO:**
Exactly. The type tells you which parameters to expect. It's a tagged union — every feature has a `type` field, and that tag tells you which *kind* you're holding and which fields are valid. A whole roster of kinds — origin, extrude, cut-extrude, revolve, cut-revolve, sweep, cut-sweep, loft, fillet, chamfer, shell, the three datums, hole, combine, the patterns, mirror-body, move-copy-body. Twenty-odd.

**MAYA:**
That's a lot of verbs for "make a shape."

**THEO:**
We'll go through the important ones. But the point of the union is: the tree doesn't care what the features *do*. It just holds them in order. The list is dumb on purpose. All the smarts live elsewhere.

**MAYA:**
Okay, back up to the very first item. You said every part starts with "the origin." What is that?

**THEO:**
When you make a brand-new model — nothing drawn yet — the system doesn't hand you a blank void. A function, `emptyFeatureTree`, seeds the list with exactly one feature: the Origin. And it carries the standard scaffolding — three reference planes, three axes, a center point. The floor and two walls of a room. You can't draw a sketch in mid-air; you need a plane to draw *on*. So every model is born knowing where "front" and "top" and "right" are.

**MAYA:**
That's the "exactly one origin feature" rule.

**THEO:**
A formal requirement — a fresh model initializes with precisely one origin and nothing else. The origin is special: it's the only feature that makes no geometry of its own. Pure reference. We'll come back to it at datums.

**MAYA:**
You keep saying *ordered* like it matters a lot. It's a list, lists are ordered, who cares?

**THEO:**
Because each step builds on the result of the ones above it. The extrude only happens *after* the sketch it consumes. The fillet only rounds edges that *exist* — so it comes after the extrude that made them. The order isn't cosmetic, it's causal. Earlier features are the ground later ones stand on. People coming from a drawing program get tripped up here — it's not a layers panel where order is z-stacking. The order is *time*. It's history.

**MAYA:**
So the tree is a timeline.

**THEO:**
And that reframing buys everything. If the part is a timeline, editing it means editing a step *in the past* and replaying forward.

**MAYA:**
Which is the cold open. She changed the first extrude and everything downstream re-ran.

**THEO:**
That's the replay. We'll get to the engine. But first, how you *touch* the list, because there's a discipline that matters.

**THEO:**
Every operation on the tree is what we call immutable and pure. When you add a feature, you don't *mutate* the existing list — you don't poke a new item into the array in place. You get back a *new* tree with the feature appended. Same with removing, same with editing a parameter. New copy every time.

**MAYA:**
Why? That sounds like more work — copying the whole list to change one thing.

**THEO:**
It sounds wasteful and it's the opposite. The old version and the new version both exist side by side, and nothing got secretly changed under anyone's feet. That makes undo trivial — you keep the old reference. And it makes the UI's change-detection reliable, because Angular, the framework the front end's built in, decides whether to re-render by checking if an object *reference* changed. Mutate in place and the reference is the same, so the screen doesn't update even though the data did.

**MAYA:**
So immutability is partly a correctness thing for the framework.

**THEO:**
Correctness and sanity. So the core operations: `addFeature` takes the tree and a feature, gives it a globally-unique id, stamps a `createdAt` timestamp, and — nice touch — auto-names it.

**MAYA:**
Auto-names it how?

**THEO:**
SolidWorks-style. It counts how many of that kind already exist and names accordingly. First extrude "Extrude 1," next "Extrude 2," first cut "Cut-Extrude 1," first fillet "Fillet 1." A little map from feature-type to label — extrude to "Extrude," datum plane to "Plane." The origin deliberately gets no default name; it's just "Origin."

**MAYA:**
And can I rename them? "Mounting Boss" instead of "Extrude 7"?

**THEO:**
Every feature carries an optional `name`. Set, the row shows your name; not set, it falls back to the default. Designers rename constantly — "Lightening Pocket," "Mounting Boss." Default keeps the unnamed ones readable, your name takes over when you care.

**MAYA:**
The other operations — removing, editing?

**THEO:**
`removeFeature` filters out the matching id — a no-op if it isn't there, doesn't blow up. `updateFeatureParam` is the edit path: a tree, an id, a patch — "set distance to eighteen" — merged into that feature, type preserved. That's "edit this extrude's distance" from the context menu.

**MAYA:**
You mentioned a cascade — deleting something other things depend on.

**THEO:**
A sharp-edged one, `removeFeaturesReferencingSketch`. Delete a sketch that three extrudes were built *from*, and they now point at nothing. So this walks the tree and drops every feature whose sketch reference — `sketchId`, `profileSketchId` for sweeps, `pathSketchId` — matches. Delete the foundation, the things built on it go too. Or, a real UI choice, you break the references instead and leave the now-broken features for the user. But the *tree* operation is the cascade.

**MAYA:**
And there are these little type-guard helpers you mentioned — `isExtrudeFeature`, `isOriginFeature`.

**THEO:**
Yeah, because it's a tagged union, you constantly need to ask "is this thing an extrude?" before you reach for its distance. Those guards are little predicate functions that narrow the type safely. There's even an `isAnyExtrudeFeature` that catches both regular extrudes and cut extrudes, since they share most of their shape. Plumbing, but load-bearing plumbing.

**MAYA:**
One thing — you said `addFeature` gives a "globally-unique id." There was a note in there about ids colliding across branches. What's that?

**THEO:**
Ah, you read the fine print. The ids come from a helper in `ids.ts`. Honest history: they used to be sequential — f1, f2, f3 — and sequential ids collide the moment you have *branches* of a part's history, because two branches both mint "f4" independently and now two different features share an id. So they moved to random globally-unique ids. The tree still carries a legacy `nextFeatureSeq` counter, but the real generation is random now. Vestigial counter, live randomness.

## Segment 2 — The replay engine

**MAYA:**
Okay. We have the recipe. Now I want the replay. The cold-open magic. She changes one number, the whole part rebuilds correctly. What actually runs?

**THEO:**
The heart of the system, in one backend file: `cadRegenService.js`. "Regen" for regeneration. One orchestrating function — `regenerateModel` — called on basically every save or edit, and also by the exporters when you download a STEP or STL.

**MAYA:**
And its job is: take the recipe, produce the shape.

**THEO:**
Take the stored feature tree plus the sketch document, turn it into displayable 3D geometry. And it does that in a specific sequence — roughly six moves. Resolve equations. Walk the features in order. For each prism feature, extract a profile from its sketch. Check a cache. On a miss, call the kernel. Compose the result into the running bodies. Then scope the names so nothing collides.

**MAYA:**
One at a time. Equations first — what does "resolve equations" mean and why is it step zero?

**THEO:**
Whole segment on these later, but the one-line version: a designer can write formulas. "Length equals two times width." "This extrude distance equals the global `wall` divided by four." Before the engine touches a single feature, it resolves all those formulas to plain numbers and bakes them into the tree.

**MAYA:**
So the kernel never sees "two times width." It sees forty.

**THEO:**
Never sees the formula. By the time dispatch starts, every drivable number is concrete. That's deliberate — it happens at the canonical compute point, regen, so the geometry engine only ever deals in finished values.

**MAYA:**
Step two — walk the features in order.

**THEO:**
`regenerateModel` iterates the array front to back, and for each feature the first thing it does is decide whether to *skip* it. It skips the origin — no geometry. Skips anything `suppressed`. Skips anything with `visible` false. And skips anything at or past the rollback bar.

**MAYA:**
Three skip conditions. Suppressed versus hidden — aren't those the same?

**THEO:**
They *feel* the same and they're not. Hidden — `visible === false` — means "don't show it, don't build it." Suppressed gets skipped the same way at the regen layer; the distinction is intent — "temporarily off" versus "don't want to look at it." But the crucial mechanical detail is what skipping *does* downstream.

**MAYA:**
Which is?

**THEO:**
Downstream features compose against the body state *as it was before the skipped feature*. Suppress the extrude in the middle, and the fillet after it doesn't get the extrude's edges to round — it operates on whatever existed before. Skipping isn't "pretend the result is empty." It's "pretend this step never happened, and let everyone after build on the earlier state." Which is why suppressing can cascade into downstream errors — you yanked the ground out from under later steps.

**MAYA:**
And the rollback bar.

**THEO:**
A SolidWorks idea — a movable line in the tree. Everything at or below it is "in the future," temporarily not built. You drag it up to roll the model back to an earlier state, maybe to insert a feature mid-history, then drop it back and the rest replays on top. Same skip mechanism, different intent — time-traveling rather than "this is off."

**MAYA:**
So we're walking the surviving features. What happens to each one?

**THEO:**
It dispatches on type, into three families. First, the datums — plane, axis, point. Pure reference; folded into the datum list, *no kernel call*, no change to any body. Scaffolding, not metal — segment on them later. Second, the "modify a body in place" features — fillet, chamfer, shell, combine, hole, the patterns, mirror-body, move-copy-body. Those don't build fresh geometry from a sketch; they take an *existing* body and transform it. Each routes to its own dispatch helper.

**MAYA:**
And the third family?

**THEO:**
The prism builders — extrude, cut-extrude, revolve, cut-revolve, sweep, cut-sweep, loft. The 2D-to-3D ones: take a sketch, push it into a solid. They run a two-stage flow that's the cleverest part of the pipeline. Stage one: build the prism. Stage two: compose it into the bodies.

**MAYA:**
Why split it?

**THEO:**
Because building the prism — sketch into raw 3D shape — is the expensive part you want to cache. Composing it into the running model — fusing, cutting — is the cheap bookkeeping that depends on everything before it. Splitting lets you cache the expensive half independently. Hold that thought; the cache is the next big idea.

## Segment 3 — Profiles and the filing cabinet

**MAYA:**
Stage one of a prism feature. You said "extract a profile from the sketch." We did sketches last episode — what's a profile, specifically?

**THEO:**
The *closed outline* you're going to push into 3D. Extraction lives in `cadProfile.js` on the backend — a port of a frontend module, `profile.ts` — and the function is `extractRegions`. Its job: look at a pile of sketch primitives — lines, arcs, circles — and figure out which closed loops they form.

**MAYA:**
That sounds trivial. Connect the dots.

**THEO:**
It's so much less trivial than it sounds, for two reasons. First, point identity. A user draws a rectangle as four lines. To a human that's an obvious closed loop. But in the raw data you might have *eight* endpoints — each line has two, and the corners are two separate points that happen to sit in the same spot, or are joined only by a "coincident" constraint. So before anything, a step called `canonicalizePoints` unions points that are either tied by a coincident constraint *or* sitting within a hair of each other — ten-to-the-minus-four units. Now the four-line square reads as a genuine closed chain of four corners, not eight loose dots.

**MAYA:**
So it de-duplicates the corners first.

**THEO:**
Then it walks the loops. And the second non-trivial thing: nesting. Draw a square with a circle inside it — two closed loops, but not independent; the circle is a *hole* in the square. So the extractor does point-in-polygon testing — samples each loop, asks "is this one inside that one?" — and builds `ProfileRegion` records, each an outer boundary plus a list of holes.

**MAYA:**
The donut.

**THEO:**
The donut. Outer ring, inner hole. When you extrude that region, the kernel makes a tube — the hole gets subtracted automatically because the profile knew it was a hole. And if you draw two *disjoint* shapes — a separate circle and a separate triangle, not nested — those become two separate regions, and they'll extrude into two separate bodies. We'll hit that in the multi-body segment.

**MAYA:**
You said earlier the profile "preserves curve identity." What does that mean and why care?

**THEO:**
A subtle, important one. When the extractor walks a loop, each edge stays *typed*. A line stays a line. An arc stays an arc — an actual analytic arc, with a center and radius and direction — not a bunch of tiny straight segments approximating a curve. A circle stays a circle.

**MAYA:**
As opposed to chopping the curve into little line segments.

**THEO:**
Right — the lazy way, and a disaster for face count. Tessellate an arc into fifty little chords and extrude *that*, and your side wall becomes fifty tiny flat faces instead of one smooth curved face. Now fillet or measure against that — fifty faces where there should be one. So the requirement is explicit: typed loop, each edge a line or arc or circle or bezier, and the kernel builds one analytic face per edge. An extruded rectangle comes out with exactly six faces. Not hundreds of facets. Six.

**MAYA:**
Six — four walls, top, bottom.

**THEO:**
Top, bottom, four walls. Clean. Okay, so now we have a profile. Stage one's real work is calling the kernel to turn that profile into a 3D prism. And calling the kernel is *expensive*. It's a separate process — a Rust service running the OpenCascade geometry engine — and you talk to it over a remote-procedure-call channel. Every call has cost. So before we make that call, we check the filing cabinet.

**MAYA:**
The cache. From the cold open. The thing that decides what gets reused.

**THEO:**
The thing that decides what gets reused. It's a database table — the model's called `DesignBRepCache` — and BRep stands for "boundary representation," which is just the precise mathematical description of a solid that the kernel produces. The cache stores those, keyed by a fingerprint.

**MAYA:**
Define "fingerprint."

**THEO:**
The key is a tuple of four things plus a version number. Which model it belongs to. Which feature. A `paramHash` — and that's the interesting one — and an `upstreamHash`. Plus a `namingVersion`.

**MAYA:**
The `paramHash` — that's the fingerprint of the inputs?

**THEO:**
That's a hash — a SHA-256, truncated to thirty-two hex characters — computed over the feature's resolved inputs. The profile, the holes, the plane, the distance, the flipped flag, the end conditions, the second direction if there is one. All the concrete numbers. So the `paramHash` *is* "the exact recipe for this one step." Same inputs, same hash. Different distance, different hash.

**MAYA:**
And so on a rebuild —

**THEO:**
On a rebuild, for each feature you compute its `paramHash` from the current inputs and go to the cabinet. Row with that exact key — *hit* — pull the stored geometry straight out, zero kernel calls, bump a "last accessed" timestamp so the system knows it's hot. No matching row — *miss* — call the kernel, get the geometry, file it back under that key for next time.

**MAYA:**
And *this* is the cold-open answer. She changed the base plate from ten to eighteen — that one feature's `paramHash` changed, eighteen hashes differently than ten, cache miss, recompute. But —

**THEO:**
But here's the magic. *Why* doesn't everything else miss? It's all stacked on the base plate. Shouldn't the cooling slots' hash change too?

**MAYA:**
That's exactly what's bugging me.

**THEO:**
Because the `paramHash` is over the feature's *own resolved parameters*. The slot's parameters are its sketch, its depth, its spacing — none of which reference the base plate thickness. So its hash is *identical*. Cache hit. The slot doesn't care that the metal under it got thicker — its *recipe* didn't change.

**MAYA:**
Hang on — the slot has to be cut into the new, thicker plate. Reuse the old cached slot, isn't it cut into the *old* plate?

**THEO:**
And this is why the two-stage thing matters. The *prism* — the cutting volume, the slot shape — that's what's cached, and it genuinely is unchanged, the same shaped void. But stage two, the *composition*, actually subtracting that void from the current body, re-runs every time, cheaply, against whatever the body is now. Expensive "what shape is this slot" from cache; cheap "stamp it into the current metal" fresh. Reuse what didn't change, redo what did.

**MAYA:**
That is genuinely clever. The fingerprint is fine-grained enough that "the world around me changed" doesn't dirty my own cache entry.

**THEO:**
And that's the formal requirement, stated almost word for word: editing a global that drives one of ten extrudes should cause exactly one cache miss in the logs, not ten. Because the hash is over resolved values, the nine that don't reference it hash identically. There's a test that mutates an unused global and asserts an unrelated feature's `paramHash` is byte-for-byte the same.

**MAYA:**
Okay, what's the `namingVersion`? You mentioned it as part of the key.

**THEO:**
A footgun-prevention thing. The kernel doesn't just return a shape — it returns a shape *plus names* for the faces and edges, so the rest of the system can refer to "that face" stably. Occasionally we change the kernel — improve how it names things, or change the mesh format. And then every *old* cached row describes geometry in the *old* scheme. Blindly reuse it and you get a shape whose face names don't match what the current code expects. Maddening bugs.

**MAYA:**
So you version the scheme.

**THEO:**
There's a number — `NAMING_VERSION`, currently twenty — baked into the cache key and kept in lockstep with a matching constant in the kernel. Bump it, and every old row instantly stops matching; every affected feature re-runs and re-files under the new version. A cache-busting lever. The war story: forgetting to bump it when you change kernel output is a classic way to ship corruption — so it's deliberately one visible shared constant.

**MAYA:**
And the cache doesn't just grow forever?

**THEO:**
No — an eviction service runs hourly and deletes rows untouched for a couple of weeks, fourteen days by default. But every *hit* bumps the timestamp, so a row you keep using never goes cold. Only stale values — a distance you tried once and changed your mind about — fall off. And the whole cache is *derived*. Drop the entire table and nothing's lost; the feature tree is the truth, the cache rebuilds itself next time you open the part.

**MAYA:**
The truth is the recipe; the cache is just saved time.

**THEO:**
That's the whole philosophy. The recipe is authoritative; everything else is an optimization you can throw away.

## Segment 4 — The additive features: depth, spin, drag

**MAYA:**
Let's actually make some shapes. The 2D-to-3D verbs. You've got extrude, revolve, sweep, loft, and each one has a "cut" version. Walk me through them as a designer would feel them.

**THEO:**
Each gives a flat sketch depth a different way. Extrude pushes the outline straight out, perpendicular to its plane, into a block — rectangle becomes a box. Revolve spins it around a line, like a lathe — that's how you make anything round, a bottle, a shaft. Sweep drags it along a path, like squeezing toothpaste along a curve — pipes, handrails. And loft blends between two or more *different* outlines — a square at one end, a circle at the other, morphing between.

**MAYA:**
And the cut versions remove material instead of adding it.

**THEO:**
Same geometry, opposite sign. A cut-extrude builds the exact same prism, but instead of fusing it onto the body, it subtracts it — drills a rectangular pocket instead of adding a rectangular boss. There's a deep symmetry there: cut and add are the same shape with a different boolean operation at the end.

**MAYA:**
Let's get concrete on extrude, since it's the foundational one. What does the feature actually carry?

**THEO:**
A `sketchId`, a `distance`, and a surprising number of optional refinements. There's a `flipped` flag — a direction toggle. By default the prism grows along the sketch plane's normal, the "positive" side; flip it and it grows the other way. Real requirement — profiles need to grow either side of their plane without re-drawing the sketch.

**MAYA:**
What else?

**THEO:**
There's an `endCondition`, where extrudes get rich. Simplest is `blind` — exactly this distance, full stop. `midPlane` grows symmetrically both ways from the sketch plane. `throughAll` means "go far enough to pierce everything in the way." And the smart ones: `upToVertex`, `upToSurface`, `offsetFromSurface`, `upToBody` — "grow until you hit *this specific thing*," and if you later move that thing, the extrude follows.

**MAYA:**
So the extrude's *length* can be defined relative to other geometry, not just a hard number.

**THEO:**
Design intent again. "This boss should reach the top face" is more robust than "this boss is 12.4 millimeters tall" — if the face moves, the number's wrong but "reach the top face" is still right. There's also `direction2` — asymmetric growth both ways — and `regionIndices`, which picks *which* loops in a multi-loop sketch to extrude. And a `merge` flag for multi-body, which we'll get to.

**MAYA:**
That's a lot of knobs on what I thought was "push the thing out."

**THEO:**
It is, and most of the time you touch one of them. But they're all there because real machined parts need them. Revolve, by contrast, is simpler in its parameters: it carries an `axisLineId` — which is a line you drew in the sketch, whose two endpoints define the spin axis — plus an `angle`. Three-sixty degrees for a full revolve, less for a partial one, like a pie slice taken out of a wheel.

**MAYA:**
And the axis is a line *in the sketch itself*.

**THEO:**
A sketched line, yeah — you draw the profile and the axis line alongside it, and the revolve resolves that line into a world-space axis to spin around. Sweep needs *two* sketches — a `profileSketchId`, the cross-section, and a `pathSketchId`, the route; the profile gets carried along the path. And loft takes an *ordered* list of sketch ids, the sections it blends through.

**MAYA:**
Now there's a thing you mentioned that I want to make sure I understand — the live preview. The "ghost." Because there's something a little sneaky going on there, right? When I drag the distance slider, I see the shape grow instantly. But you told me the kernel is expensive and lives in another process.

**THEO:**
You caught the trick. The preview is a *lie* — a useful, fast, honest-about-being-a-lie lie. It's in a frontend file, `preview.ts`, and it builds a translucent triangle mesh — a ghost — *entirely in the browser*, zero kernel, no boolean, no round-trip. It takes the outline and the slider values and directly generates a rough triangle soup of roughly what you'll get.

**MAYA:**
How does it do that without the real geometry engine?

**THEO:**
For an extrude: tessellate the outline into a polygon, ear-clip it into triangles for the top and bottom caps, throw up side-wall quads connecting them. Ear-clipping's just a standard way to chop a polygon into triangles. It honors the flip, the second direction, the end conditions — `midPlane` symmetrizes, `throughAll` uses a big visual fallback since there's no real body to stop against. For a revolve it sweeps the profile around the axis in slices — at least eight, more for bigger angles — using Rodrigues' rotation, the standard "rotate this point around that axis" formula. For a sweep it carries the profile along the path with transport frames, sliding a cross-section along a curve without it spinning weirdly.

**MAYA:**
And for a *cut*, you said the ghost is the thing being removed.

**THEO:**
Shown in red. That's a deliberate UX call. If you're cutting a pocket, showing you the *resulting hole* is confusing — there's nothing there to look at. Showing you the *cutting volume* in red, the chunk that's about to be removed, makes the intent obvious. You see the red block sitting where the void will be. So the preview renders the cutting prism, tinted red, and the viewer knows red means "subtractive."

**MAYA:**
So the preview is fast because it's approximate, and approximate is fine because it's just for your eyes while you drag.

**THEO:**
Exactly. It's slightly less accurate for curved bodies — the ghost of a revolve is faceted where the real thing is smooth — but it updates every keystroke with no kernel round-trip, and the *moment you commit*, the real kernel builds the precise version. Fast and rough for the dragging, slow and exact for the commit. The two-speed thing again.

**MAYA:**
And when you do commit an extrude, there's a little courtesy it does — hiding the sketch?

**THEO:**
Small but nice. Extrude a sketch and the system automatically hides it. Once the sketch has *become* a solid, its flat 2D outline floating inside is just visual noise. SolidWorks does the same — consumed sketches collapse out of the way. So you extrude, the outline vanishes, you're left with the clean solid. It's a formal requirement, even — auto-hide the source sketch on extrude.

## Segment 5 — The finishing features

**MAYA:**
Okay. We've added material. Now the features that *modify* what's there — round it, bevel it, hollow it, multiply it. These feel different to me. Extrude takes a sketch. Fillet takes... an edge I click on in 3D?

**THEO:**
That's exactly the difference, and it creates a genuinely hard problem. The sketch-based features reference a *sketch by id*. The finishing features reference *topology* — a specific edge, a specific face — on a body that doesn't exist until the part is built. And topology is treacherous.

**MAYA:**
Treacherous how?

**THEO:**
Every time the geometry engine does a boolean — a fuse, a cut — it *renumbers* the faces and edges. OpenCascade doesn't promise "edge number seven" today is the same physical edge tomorrow. Add a feature upstream, the part rebuilds, and the edge you filleted is now internally called edge twelve. If your fillet stored "edge seven," it's rounding the wrong edge — or a face that no longer exists.

**MAYA:**
That sounds like it would break constantly. This is the "persistent naming problem," isn't it — I think we touched it in Season One.

**THEO:**
It's *the* persistent naming problem, and it's one of the genuinely hard problems in parametric CAD. Real commercial kernels have whole subsystems for it. Our approach here is pragmatic: we don't trust the internal numbers *at all* for the finishing features. We store the pick by its *geometry* — where it physically is in space.

**MAYA:**
Spell that out.

**THEO:**
When you click an edge to fillet it, we store an `EdgeRef3D` — and that's literally just the two endpoints of the edge, as world-space coordinates. The start point and the end point, in millimeters, in the part's coordinate system. Not "edge seven" — "the edge that runs from *here* to *there*."

**MAYA:**
And then on rebuild?

**THEO:**
On rebuild, the kernel takes your stored endpoints and finds the edge on the current body that's *closest* to them. It matches by geometry, not by id. So even though the internal numbering shuffled, the edge physically running from here to there is still physically running from here to there, and we find it by location. The edge-blend kernel op even tries the match in both pairings — start-to-start or start-to-end — because the edge's *direction* might have flipped too.

**MAYA:**
And faces, for the shell, work the same way?

**THEO:**
Same idea, slightly different data. A shell face is a `ShellFaceRef` — a face id *plus* a fallback, the face's origin and normal, "a flat patch sitting *here*, facing *this way*." The kernel matches by centroid and normal; the id is a hint, the geometry is the truth. The general principle across all the finishing features: pick in 3D, capture *where*, re-find by *where* on every rebuild. Robust against renumbering by construction.

**MAYA:**
Okay, the features themselves. Fillet first.

**THEO:**
Fillet — "round" in friendly terms — carries a list of those edge refs and a single `radius`. You pick edges, you set a radius, it rounds them. The kernel uses OpenCascade's fillet maker. There's a reserved per-edge `value` field, so eventually you could have a multi-radius fillet — different rounding on different edges in one feature — but the common case is one radius for the set.

**MAYA:**
And there's this "tangent propagation" toggle I saw. Default on. What's that doing?

**THEO:**
A lovely quality-of-life thing with real cleverness underneath. A circular hole's rim, internally, is often *four arc segments* joined end to end, not one circle. With tangent propagation *off*, you'd click all four arcs individually. With it *on* — the default — you click *one* arc, and the system grabs the other three.

**MAYA:**
How does it know which ones to grab?

**THEO:**
A module, `tangentPropagation.ts`, does a breadth-first walk. You give it the seed edge — the one you clicked — and the body's topology. It finds that edge, looks at every neighbor that shares an endpoint, and asks: "does this flow *smoothly* into what I've already got? No sharp corner?" If yes, add it and keep walking. It spreads along the smooth chain until it hits a real corner, where the chain stops.

**MAYA:**
"Flows smoothly" — how do you measure that?

**THEO:**
Compare the *directions* of the two edges at the shared endpoint — the tangents, which way each edge is heading right there — with a dot product, which tells you how aligned they are. Aligned past a threshold — the cosine of five degrees, about point-nine-nine-six — and they're tangent-continuous, no visible kink. Below that, there's a corner, and the chain terminates. Nice detail: it uses the *absolute value* of the dot, because at a shared endpoint the two edges might point opposite directions along the same line — antiparallel — and that should still count as smooth.

**MAYA:**
So one click on a hole rim, and the whole rim fillets. That's the SolidWorks-standard behavior.

**THEO:**
That's the standard, and now you can turn it off when you *don't* want it — when you really do mean just this one edge.

**MAYA:**
Chamfer next — that's the angled-cut cousin of fillet.

**THEO:**
Chamfer bevels an edge instead of rounding it — cuts it off at an angle. It has *three modes*, because production chamfers aren't always forty-five degrees. Equal distance — symmetric, the classic forty-five. Two distances — asymmetric, more on one face. Distance and angle — this far on one face, at this angle. So it carries a `distance`, a `mode`, and a `distance2` or `angle` depending on the mode. Machinists need all three.

**MAYA:**
Shell. You called it "scoop it hollow."

**THEO:**
Shell hollows a solid, leaving thin walls — a solid block into an open box. You pick the faces you want *open* — the lid — and give a wall thickness. The kernel offsets all the *other* faces inward by that thickness and removes the picked ones, leaving a thin-walled container with an opening where you picked. Carries the open faces, thickness, a direction, a tolerance. It's how you make any plastic or sheet-metal-like part — real parts are mostly thin walls.

**MAYA:**
And there's a nice paranoid check in the shell, I saw.

**THEO:**
The shell op is one of the touchier kernel operations — it can produce garbage the kernel *reports as success*. So there's an explicit empty-geometry check after: even if OpenCascade says "I succeeded," we look at the result, and if it's empty or malformed, we reject it. Trust-but-verify on a known-flaky operation.

**MAYA:**
Last group — patterns. Stamp copies.

**THEO:**
Patterns replicate existing features by applying transforms. Three kinds. Linear — march copies along one or two directions, "every ten millimeters, six times, and also four times in this other direction." Circular — spin copies around an axis, "twelve holes evenly around this bolt circle." And mirror — one reflected copy across a plane.

**MAYA:**
And the implementation — there's a module that turns the pattern into a list of moves?

**THEO:**
`pattern.ts`. It converts each pattern feature into a flat list of transforms — translates, rotates, mirrors — whose field names deliberately mirror the kernel's own transform type so the two stay in sync. A linear pattern walks an i-by-j grid and emits a translate for every cell *except* the (0,0) seed, the original you're copying. Circular emits count-minus-one rotations — minus one because slot zero is the original.

**MAYA:**
And the two circular modes — equal spacing versus specified angle?

**THEO:**
Equal spacing divides a total sweep evenly — "spread twelve holes across this whole 360." Specified angle uses a fixed step per copy — "every thirty degrees, however many that makes." Same machinery. Each rotation carries a snapshot of the axis, origin and direction frozen at pick time, so it survives renumbering — same trick as the edge picks. The kernel applies each transform to copy the source and fuses the copies in.

**MAYA:**
There's also mirror-body and move-copy-body, which sound like they overlap with patterns.

**THEO:**
Same family, but on whole *bodies* rather than features. Mirror-body reflects entire solids across a plane, with a `keepOriginals` flag for copy-versus-replace-in-place. Move-copy-body applies a rigid transform — optional translate plus optional rotate — with a `copy` flag for keep-versus-replace. "Slide this boss thirty millimeters and leave a copy." Both resolve to kernel transforms.

## Segment 6 — Datums: the invisible scaffolding

**MAYA:**
Let's go back to something you flagged and kept deferring — datums. The origin gives me three planes and three axes for free. Why would I ever need to build *more* reference geometry? Isn't three planes enough?

**THEO:**
For a shoebox, sure. But picture an angled face. You want to drill *perpendicular to that angled face* — no origin plane lines up with it. You need a sketch plane sitting *on* it, or parallel to it. Or a plane exactly halfway between two faces, to mirror across. Or one offset ten millimeters above a surface, to start a boss from. The origin planes can't express any of that. So you construct your own reference geometry — datums.

**MAYA:**
And a datum makes no metal. Pure reference.

**THEO:**
Pure reference — in the regen walk they get *folded into the datum list with no kernel call*. Scaffolding you hang real features off of. Three kinds — plane, axis, point — and the richness is *how many ways* you can construct each.

**MAYA:**
Lay them out.

**THEO:**
A datum plane has *eight* construction methods. Offset — parallel to a plane or face, shifted a distance. Parallel-through-point. Angle-through-edge — tilted, hinged around an edge. Three-points — the plane through three picked points, like three legs defining a tabletop. Mid-plane — halfway between two faces. Line-and-perpendicular-face. Point-and-perpendicular-edge. And tangent-to-cylinder, a plane that just kisses the side of a cylinder. Eight ways in, one plane out.

**MAYA:**
A real toolbox. Axes?

**THEO:**
Five methods. Two points. Along an edge. The intersection of two planes — where two planes cross is a line. The axis of a cylindrical face — straight down the middle of a bore. And point-and-perpendicular-face. And datum point has five too — on a vertex, center of a face, center of a circular edge, center of mass of a body, or a fraction along an edge, "forty percent down this line."

**MAYA:**
How does the code do this? Eighteen little geometry recipes.

**THEO:**
Three dispatch functions in `datum.ts` — `computeDatumPlane` across eight cases, `computeDatumAxis` and `computeDatumPoint` across five each. Each resolves its picked inputs and constructs the result. And here's the tie-back: these run *during regeneration*. The datum is re-derived against the *current* geometry every rebuild.

**MAYA:**
So if I build a plane offset ten millimeters above a face, and then the face moves —

**THEO:**
The plane follows it. Because it's not stored as fixed coordinates — it's stored as "ten millimeters above *that face*," and every regen recomputes it against where that face is *now*. That's the parametric promise extended to reference geometry. Your datums track the things they were attached to.

**MAYA:**
And the picks themselves — resolving "that face" — uses the same geometry-snapshot trick as the fillets?

**THEO:**
Same family of trick. A reference to a plane is either a datum reference — just an id, since datums are stable — or a face reference, which carries a fallback plane snapshot. So when you reference a *face*, you also store a frozen snapshot of where that face was — its origin and normal — and if the face id can't be found after a renumber, you reconstruct the plane from the snapshot. Vertices the same — a vertex reference carries a fallback position. The id is the fast path; the snapshot is the safety net.

**MAYA:**
There was an oddly specific note in here about the xz-plane and "right-handed." What's that about? Sounds like a bug fix in disguise.

**THEO:**
Exactly a bug fix in disguise, and a fun one. A plane has a basis — an x-axis, a y-axis, a normal. The "right-handed" convention says x crossed with y gives the normal pointing the expected way. Get it backwards and you've got a *left-handed* basis, which mirrors orientation-sensitive things. The original xz-plane was left-handed, and it was *mirroring sketch text* — engrave a part number on it and it came out backwards, like in a mirror. The fix flipped the xz-plane's x-axis to negative-x so all standard planes are consistently right-handed. One-line change, deeply confusing symptom.

**MAYA:**
Mirror-image text. That's the kind of bug that costs someone an afternoon.

**THEO:**
At least an afternoon.

## Segment 7 — The Hole Wizard

**MAYA:**
We've sort of been circling holes. You can obviously make a hole with a cut-extrude of a circle. So why is there a whole separate "Hole Wizard"?

**THEO:**
Because real holes for real fasteners follow *hardware standards*, and you don't want to look those up by hand. For an M4 screw — four-millimeter metric — there are *correct* dimensions. The clearance hole has a specific diameter so the screw passes freely. A counterbore for an M4 socket-head cap screw has a specific bore and depth so the head sits flush. A tapped hole uses a specific tap-drill diameter, smaller than clearance, leaving material to cut threads into. Nobody remembers these. They're in tables.

**MAYA:**
So the wizard *is* the table.

**THEO:**
The table plus a placement tool. The table lives in `holeSpecs.ts` — single source of truth. Two standards, ISO metric and ANSI inch. ISO covers M2 through M12; ANSI covers number-four screws up through half-inch. And each size carries every dimension you need: clearance drill, tap-drill, counterbore diameter and depth, countersink diameter and angle, thread pitch, thread major diameter.

**MAYA:**
And — important — everything's in one unit?

**THEO:**
Everything's in millimeters. Even the inch sizes are pre-converted to millimeters at the time the table's written, so there's exactly one unit flowing through the geometry. You do *not* want a mix of inches and millimeters meeting somewhere in the middle of a kernel call. The inch conversion happens once, up front, in the table.

**MAYA:**
You said "single source of truth," but there are two copies — frontend and backend?

**THEO:**
Right, and this is a discipline thing. The dropdown the user picks from reads the frontend table. But the actual geometry — the cutting — happens on the backend during regen, against a *backend mirror* of the same table. And those two have to agree perfectly, because if the UI thinks M4 counterbore is one diameter and the geometry cuts another, you've got a part that doesn't match its own label. So there's a backend `holeSpecs.js` that mirrors the frontend, and the requirement is explicit that they share one authoritative set of numbers.

**MAYA:**
How does placement work? I click on a face?

**THEO:**
You click a face where you want holes. Each click becomes a placement — capturing the face you hit, the click position, the face's centroid, and its normal. The click point is the hole *center*; the face normal is the *axis*, the direction it drills. So clicking a flat face drills straight into it, and you can drop several placements in one feature — five M4 clearance holes across one face in one go.

**MAYA:**
And then the geometry. The wizard drills a... what, exactly?

**THEO:**
The satisfying part: the Hole Wizard adds *no new kernel operations at all*. A helper — `_dispatchHole` — synthesizes each hole from primitives we already have. The drill is a cylinder — an extrude of a single-circle profile. A counterbore is a wider, shallower cylinder on top. A countersink is a *cone* — a revolve of a right-triangle profile around the hole axis. Counterbored hole: narrow cylinder plus wide cylinder. Countersunk: cylinder plus cone. All built from extrude and revolve.

**MAYA:**
And then all of those get subtracted from the body.

**THEO:**
Chained boolean cuts. It builds the cylinder-and-cone stack and subtracts it from the most-recent body with a chain of cut operations. The type of hole picks which primitives — a plain drill is just the cylinder; counterbore adds the wide cylinder; countersink adds the cone; tapped uses the *tap-drill* diameter, the smaller one, since you're leaving material for threads.

**MAYA:**
Which brings us to threads. Does it model the actual spiral?

**THEO:**
No — a deliberate, standard call. Real thread geometry, the actual helix, is expensive to compute and heavy to render, and you almost never need the true spiral for design intent. You just need anyone looking at the model to *know* it's tapped. So tapped holes get a "cosmetic thread" — a frontend-only translucent thread shell drawn *around* the tap-drill bore. An annotation, not geometry. The backend cuts the real tap-drill cylinder; the frontend draws a thread-looking shell over it.

**MAYA:**
So the *hole* is real, the *threads* are a costume.

**THEO:**
The hole is real metal removed; the threads are a costume that says "tapped." A fraction of the cost, and it communicates exactly what a machinist needs. SolidWorks does the same — cosmetic threads everywhere, real helices almost never.

**MAYA:**
And if I disagree with the standard dimension?

**THEO:**
Every dimension has an override. It pulls from the spec table by default, but there are per-dimension override fields, and at dispatch the override wins. Correct-by-default, deviate when your shop has a reason to.

## Segment 8 — Equations: math instead of magic numbers

**MAYA:**
Okay. The cold open promised that changing one number rippled correctly. The cache explained why it was *fast*. But you've also hinted at equations a few times — math relationships *between* dimensions. That's a different kind of ripple, right? Not "rebuild downstream," but "this number is *defined by* that number."

**THEO:**
Exactly the right distinction. The cache handles "recompute what changed." Equations handle "keep dependent numbers in lockstep *before* anything recomputes." They're SolidWorks-style global equations, and the idea is dead simple from the user's chair: instead of typing the same number in twenty places, you define a variable. `width = 20`. Then elsewhere, instead of typing 40, you write `length = 2 * width`. Or you set an extrude distance to `width / 4`. Change `width` once, everything built on it updates.

**MAYA:**
And it lives in a document attached to the model.

**THEO:**
There's an equations document, stored as a JSONB column right on the model. And it's basically a map — a set of entries. And here's a design subtlety: the entries are *two flavors in one map*. Some keys are bare global names — `width`, `length` — the variables you reference. And some keys are *target paths* — dotted strings that name a specific driven parameter. Like `feature.someId.distance`, or `sketch.someId.constraint.someOtherId`. A target path says "this exact feature parameter is driven by an expression."

**MAYA:**
So a global is "a named number I can reference," and a target is "a specific knob in the model bound to a formula."

**THEO:**
Right, and they share one map so the panel can show them together. Each entry has an expression — the formula text — and the resolver writes back a `lastValue` and an optional `error`.

**MAYA:**
How does it evaluate them? Because `length = 2 * width` only works if you compute `width` first.

**THEO:**
The genuinely nice computer-science bit. A resolver — `resolveEquations`, in `equations.ts` — parses every expression with a library called `expr-eval`, a small safe math evaluator. And crucially, `expr-eval` can tell you which *variables* an expression mentions. So for `length = 2 * width` it reports "depends on `width`." From all those dependencies, it builds a dependency graph — who needs whom.

**MAYA:**
And then sorts it.

**THEO:**
Topologically — which just means "find an order where everything you depend on comes before you." Compute `width` first, *then* `length`. It does this with a three-color depth-first search — white, gray, black, a standard graph traversal — to produce the safe evaluation order, then evaluates in that order so every formula sees finished values.

**MAYA:**
And the classic failure mode — I accidentally make two things depend on each other.

**THEO:**
A cycle. `a = b + 1`, `b = a + 1`. No valid order — each needs the other first. A naive evaluator loops forever. The three-color search *detects* it during traversal — touching a gray node, one it's currently in the middle of visiting, is a back-edge, a loop — and instead of hanging, records a clear "a → b → a" cycle error on every member. Readable error, not a frozen app.

**MAYA:**
And one bad equation doesn't poison the rest?

**THEO:**
No, errors are per-entry. A parse error, a cycle, an undefined variable, a result that comes out as infinity or not-a-number — each is reported independently against just that entry. The rest of the document still resolves. There's also a couple of gnarly edge cases handled — like if a user names a variable `length`, which happens to collide with a built-in function in the expression library, the resolver temporarily shadows the built-in so `length / 4` parses as *your* variable. And it clears the built-in math constants like pi and e so a user variable named `e` wins. There's an exported list of reserved names so the UI can warn you.

**MAYA:**
Now — the part that ties into the regen pipeline. You said equations resolve *before feature dispatch*. Walk me through where exactly.

**THEO:**
There's a backend mirror — `cadEquations.js`, a separate file because the backend's a different module system, but it implements the *same* algorithm on the *same* JSON shapes. A test suite feeds both versions identical fixtures and asserts identical output, so they can't drift.

**MAYA:**
Belt and suspenders.

**THEO:**
Has to be. The entry point is `applyEquationsToModel`. It resolves the document, walks the feature tree and sketch constraints, and *overwrites* every parameter whose target path resolved to a value. An extrude bound to `width / 4` gets its `distance` literally replaced with the computed number. It hands back a new feature tree and sketch document with all of that baked in — and `regenerateModel` calls it *as step one*, before dispatching a single feature.

**MAYA:**
Which is why the kernel only ever sees plain numbers.

**THEO:**
Never knows equations exist. By dispatch time, `width / 4` is just `5`. And it loops back to the cache beautifully — the `paramHash` is over *resolved* values. Change a global driving one of ten extrudes: that one's resolved distance changes, its hash changes, it misses. The other nine resolve to the same numbers, hash identically, hit. The equation change is *surgical* through the whole pipeline.

**MAYA:**
So the equations system and the cache aren't two separate features that happen to coexist — they're co-designed.

**THEO:**
They're co-designed. Resolve-before-hash is the linchpin that makes equation edits cheap. If you hashed the *formula* instead of the *result*, you'd lose that — every feature that even mentioned a touched variable would dirty. Hashing the resolved number means only the features whose *actual values* moved get recomputed.

**MAYA:**
And there's a panel for all this.

**THEO:**
A panel behind a "Σ Equations" button. Two tables — "Variables," your globals, with an always-present empty draft row that auto-promotes when you type in it; and "Used in," the parameter-bound entries with friendly labels like "f20 · distance" instead of the raw dotted path. The value column updates *live* as you type. And every numeric input across the editor accepts an expression, not just a number — you can type `width / 4` straight into the extrude distance box.

## Segment 9 — Multi-body and Combine

**MAYA:**
Last big piece. You've mentioned "bodies" and a `merge` flag a dozen times and kept saying "later." It's later. What's a multi-body part?

**THEO:**
Most parts are one connected lump. But some are *much* easier to build as several separate lumps you later join, subtract, or intersect — the classic SolidWorks complex-part workflow, build independent solids then combine. So a part can hold an *array* of bodies, and the regen pipeline tracks all of them.

**MAYA:**
And how does it decide whether a new feature joins the existing lump or starts a new one?

**THEO:**
The `merge` flag — "Merge result," a toggle on the additive features. True, which is the default — a missing flag counts as true — the new feature *fuses* into the most-recent body. False, it *seeds a brand-new body*. Two extrudes merge-on give you one fused solid; the second merge-off gives two separate solids in the same part.

**MAYA:**
Let me get the pipeline mechanics. The regen service tracks a `bodies` array —

**THEO:**
An array where each entry is one solid — id, BRep geometry, a parameter hash, faces, topology, centroid. Walking the features, for each it asks: additive, cut, or combine? Additive merge-on, fuse the new prism into the most-recent body. Merge-off, seed a new body. Cut subtracts from the most-recent body — actually cuts default to "all bodies," every body the prism touches loses material. Combine does an explicit boolean between named bodies.

**MAYA:**
And a body's id — how stable is it?

**THEO:**
It's *the id of the first feature that created it* — deliberately, so it stays stable across rebuilds. The body you're looking at is "the one extrude-three started," every regen. Subtle case: when a boolean *splits* a body in two, the piece whose centroid is closest to the *old* centroid keeps the original id; the other pieces become new bodies with suffixed ids. A cut that annihilates a body removes it from the roster.

**MAYA:**
Centroid-closest-keeps-the-id — a heuristic for "which piece is really the continuation."

**THEO:**
The pragmatic one — "the piece that stayed mostly where the old body was *is* the old body." Not perfect philosophically, but it keeps ids stable in the common cases.

**MAYA:**
And remember way back, the disjoint-shapes thing — a sketch with a separate circle and triangle.

**THEO:**
That lands here. If a single additive feature seeds a body but its sketch has *multiple disjoint regions* — two shapes that don't touch — they can't be one connected body. You can't have a single solid that's two separate islands. So they *fan out*, one body per region. Extrude "C A D" as three separate letters, you get three bodies. Same fan-out the patterns use when a copy lands disconnected.

**MAYA:**
And Combine is the *explicit* version of joining bodies.

**THEO:**
Combine is the deliberate boolean between existing bodies. An operation — add, subtract, or common — a target that survives and keeps its id, and a list of tool bodies folded in and then *consumed*, gone from the roster. Add is union. Subtract cuts the tools out of the target. Common keeps only the overlap. And if a subtract splits the target, same fan-out — each piece its own body.

**MAYA:**
So "build two overlapping blocks, then combine-add them into one" is the workflow.

**THEO:**
The canonical example, almost verbatim from the requirement. Build the blocks separate, combine-add, one solid. Or combine-common for just the overlap, combine-subtract to bite one out of the other. There's a Bodies panel listing every solid, so you can show, hide, and act on each independently. Plus the mirror-body and move-copy-body features — whole-body transforms.

**MAYA:**
And all of this is the same kernel boolean op underneath?

**THEO:**
Same op — `buildBoolean`, with Fuse, Cut, or Common as the mode. And the result gets *decomposed* — a walk over the solids in the output breaks a multi-solid result back into independent bodies. So the part tracks its multi-body state honestly instead of pretending a disconnected result is one thing.

## Segment 10 — Honest notes: where the edges fray

**MAYA:**
You've been good about the costumes and the heuristics. Before we recap, give me the honest list — where does this stuff *not* fully work, or work approximately?

**THEO:**
Happily. First and biggest: the profile loop walker has limits. The clean case — a single closed loop of lines and arcs — walks beautifully. The single-circle case has a fast path. Multiple disjoint loops work through a face-walker that splits curves at their intersections. But there are mixed cases — complicated multi-loop profiles mixing lines and arcs awkwardly — where extraction is more fragile, and the truly general curve-aware walker that'd handle *everything* gracefully isn't there yet. The honest note: a general walker is the clean fix and it's out of scope so far.

**MAYA:**
So a sufficiently weird sketch might not extract cleanly.

**THEO:**
It might give a "couldn't find a closed loop" error where a top-tier commercial tool would just figure it out. Common cases solid; pathological ones fray.

**MAYA:**
What else?

**THEO:**
The cache footguns. The `namingVersion` lever — change kernel output and *forget* to bump it, and you ship corruption, because old rows get reused against new code. It's one shared constant to make it hard to forget, but manual levers get forgotten. And the cache key has an `upstreamHash` field that's currently just empty for the per-region prisms — no upstream dependency captured at that layer yet. Fine *today* given the two-stage split, but if the dependency model got more complex you'd need to populate it.

**MAYA:**
And the geometry-keyed picks — matching edges by closest endpoints. That can't be foolproof.

**THEO:**
It can't. Robust against renumbering, which is the *common* failure — big win. But "closest geometry" has its own failure mode: move an edge *far enough* in a regen, or have two edges end up ambiguously close, and closest-match can grab the wrong one. The pairing-both-ways trick handles flipped direction, but it's fundamentally a nearest-neighbor heuristic standing in for true persistent naming. That's a hard, unsolved-in-general problem; this is the pragmatic eighty-percent version.

**MAYA:**
And the previews are admittedly approximate.

**THEO:**
The previews are honest lies — faceted where the real thing is smooth, no boolean, a big fake distance for through-all. Fine, because they're for your eyes during a drag and the real kernel runs on commit. But confuse the ghost for the real geometry and you'd be measuring a lie.

**MAYA:**
And cosmetic threads aren't threads.

**THEO:**
Cosmetic threads are a costume — no helix. Need the *real* thread geometry, for a thread-engagement simulation say, it isn't there. By design. The bore is real, the spiral is drawn-on.

**MAYA:**
That's a refreshingly honest tour.

**THEO:**
The thing I'd want a listener to take: none of these are *bugs*. They're *scoped decisions*. Approximate where approximate is fine, robust-enough where perfect is genuinely hard, and a clear note in the docs at every seam.

## Recap

**MAYA:**
Four big takeaways.

One: **the part is a recipe, not a cake.** Stored as an ordered, immutable list of features — origin, then sketches, extrudes, cuts, fillets, holes — and the order is *time*, not z-stacking. Each step builds on the result of the ones before it. Editing means editing a step in the past and replaying forward.

**THEO:**
And immutability isn't fussiness — it's what makes undo trivial and the UI's change-detection reliable. New tree every edit.

**MAYA:**
Two: **regeneration is a careful replay with a fingerprinted cache.** The backend resolves equations to plain numbers, walks features in order, extracts a typed profile from each sketch, and checks a content-keyed cache before every expensive kernel call. The fingerprint is over each feature's *own resolved inputs*, so changing one dimension only misses the features that actually depend on it. Change one of ten extrudes, nine stay cached.

**THEO:**
And the two-stage split — cache the expensive prism, redo the cheap composition — is what lets a downstream feature reuse its cached geometry even when the metal under it changed.

**MAYA:**
Three: **picks survive rebuilds because we store geometry, not numbers.** Fillets, chamfers, shells, datums — anything referencing topology stores *where it is in space*, not an internal id, because the kernel renumbers everything on every boolean. Match by location. Plus quality-of-life like tangent propagation grabbing a whole smooth chain from one click.

**THEO:**
The pragmatic answer to the persistent-naming problem. Eighty percent of the win, a fraction of the complexity.

**MAYA:**
Four: **equations, multi-body, and the cache are co-designed.** Equations resolve *before* dispatch so the kernel sees plain numbers — and because the cache hashes the *resolved* result, an equation edit ripples surgically. Multi-body tracks an array of solids with a `merge` toggle deciding fuse-versus-seed, Combine doing explicit booleans, and stable body ids that survive splits by a centroid heuristic.

**THEO:**
One line for the whole episode: the recipe is the truth, and everything else — the cache, the previews, the geometry-keyed picks — is an optimization or approximation you could throw away and rebuild from the recipe.

**MAYA:**
The truth is the list. Everything else is saved time.

## Teaser

**MAYA:**
Next time, we finally go through the door we've been knocking on all episode. Theo keeps saying "and then it calls the kernel" — the expensive separate Rust process running OpenCascade, the thing that turns a typed profile into a real boundary representation. Episode Eight, we go *inside the kernel*.

**THEO:**
We'll talk about what a boundary representation actually *is*, why it lives in a separate process speaking remote-procedure-call, why it's written in Rust wrapping a decades-old C++ geometry library, and what "build an analytic arc face instead of fifty chords" looks like from the *other* side of that call. Plus the naming schema — the thing whose version number we kept bumping today — from the kernel's point of view.

**MAYA:**
The math engine itself. Where the real geometry actually gets made.

**THEO:**
Bring a hard hat. It's all C++ and topology down there.

**MAYA:**
Until then.

---

# Episode 8 — Inside the Kernel

## Cold open

**THEO:**
Okay. I want to start with a confession about a piece of software I'm weirdly proud of. The geometry kernel — the thing that actually builds the 3D shapes in this CAD tool — is about twelve thousand lines of Rust. And the embarrassing truth is, it thinks it's a calculator.

**MAYA:**
A calculator.

**THEO:**
A calculator. You hand it a tiny instruction — "take this outline, push it ten millimeters, give me back the solid" — and it does exactly that one thing and shuts up. It doesn't know what a part is. It's never heard of a feature tree. It doesn't know who you are. It's a box that takes in math and spits out math.

**MAYA:**
That can't be right, though. We spent a whole episode last season talking about how this thing rounds edges, hollows out solids, classifies surfaces for the assembly tools. That's not a calculator, that's a — that's a brain.

**THEO:**
And yet. Every single one of those things is the calculator doing one arithmetic-shaped operation and forgetting it ever happened. There's no memory. No state between calls. You ask it twice, it does the work twice. The "brain" you're describing lives somewhere else entirely.

**MAYA:**
Okay. I don't buy it. Show me the math.

**THEO:**
[laughs] That is exactly the right response, and that's the whole episode. Let's open the box.

## Intro

**MAYA:**
Welcome back. This is the deep-dive season — Season 2 — where we stop being polite and actually crawl around inside the machine. If you're just joining: earlier this season we did the CAD modeler, the sketch solver, all of that. Today we go one layer down, to the engine underneath all of it. The geometry kernel.

**THEO:**
The part that turns intentions into triangles.

**MAYA:**
And Theo built this thing, so he gets to be smug about it for an hour. The plan: how the kernel is its own separate program and how the app talks to it. The actual operations — extrude, boolean, revolve, all the verbs — and what they really do underneath. Then the clever bits: how the kernel gives every surface a permanent name, how it tells flat from round, how it writes out files. And Theo has promised me honest footguns. The stuff held together with tape.

**THEO:**
There's always tape.

**MAYA:**
There's always tape. Let's go. Start with the "separate program" thing, because that surprised me.

## Segment 1 — The kernel is a different program entirely

**THEO:**
So here's the architecture in one sentence: the geometry kernel is a standalone Rust binary, and the main application — the Node backend, the part that serves the website — talks to it over a network connection, even when they're on the same machine.

**MAYA:**
Wait. Same machine, but they talk over the network? Why not just — call it? It's right there.

**THEO:**
Two reasons, and one of them is boring and one of them is interesting. The boring one is languages. The geometry math is built on OpenCASCADE — OCCT, the open-source industrial B-rep kernel that real CAD tools use under the hood. That's a giant C++ library. The web app is JavaScript. You do not want to embed a giant C++ geometry library inside your Node web server. So it lives in its own process, written in Rust, which wraps the C++ cleanly.

**MAYA:**
And the interesting reason?

**THEO:**
Isolation. Geometry is dangerous. Not dangerous like security — dangerous like, you ask OCCT to do something slightly degenerate and the C++ code throws an exception that, if it escapes, calls `std::terminate` and kills the whole process. Hard. No catching it.

**MAYA:**
It just... dies.

**THEO:**
It just dies. And if the kernel is *inside* your web server, when it dies, your whole website goes down because somebody drew a weird triangle. That's unacceptable. So we put a wall between them. The kernel can crash all it wants — and it does, sometimes — and the web app just notices, shrugs, and reconnects.

**MAYA:**
Okay, so it's a blast wall. When the geometry blows up, the explosion is contained in its own little room.

**THEO:**
That's the whole reason it's a separate process. Now — *how* do they talk. It's a thing called JSON-RPC 2.0 over TCP, which sounds fancy but is genuinely simple. JSON is just text. RPC means "remote procedure call" — I call a function over here, it runs over there. And the wire format is: one line of text is one message. You write a JSON object, you put a newline at the end, that's the request. The kernel writes a JSON object, newline, that's the reply.

**MAYA:**
Line-delimited. Like, literally the newline character is the punctuation.

**THEO:**
The newline is the period at the end of the sentence. Each message carries a method name — `buildExtrude`, `buildRevolve` — a bag of parameters, and an ID number. The ID is the clever part. Because the connection is shared. The backend has *one* long-lived connection to the kernel and it sends lots of requests down that pipe, possibly several at once. When replies come back, they come back tagged with the same ID you sent, so you can match the answer to the question.

**MAYA:**
Like a coat check. You hand over your coat, you get ticket forty-two, and when ticket forty-two comes back you know it's *your* coat, even if six other people are also checking coats.

**THEO:**
That's exactly the coat check. And in the code that's literally a map — a dictionary — from ID number to "here's the promise that's waiting for this answer." When a reply lands, you look up its ID, find the waiting promise, and hand it the result. The file's called `cadKernelClient.js` and that map is just named `pending`. ID to "resolve this, reject that, and here's your timeout."

**MAYA:**
There's a timeout?

**THEO:**
There's a timeout, and it matters. Default thirty seconds — because the kernel could wedge, get stuck in some pathological computation and just not answer, and you don't want the web request to hang forever. So every call arms a timer. And the timeout is overridable per call: for the cheap health-check ping, we set four seconds, because if the kernel can't answer "are you alive?" in four seconds, it's effectively dead and we want to know fast.

**MAYA:**
Hold on, why TCP specifically? You said same machine. There's a faster way to talk between two programs on the same box, right? Unix sockets.

**THEO:**
You've done your homework. Normally on the same machine you'd use a Unix domain socket — a little file on disk that acts as a pipe, faster than the network stack. We can't, for a mundane reason: in the standard dev setup, the Node backend runs *inside Docker*, in a container, and the kernel runs on the host, outside it. A Unix socket is a file, and that file lives on one side of the container wall. TCP crosses that wall; a socket file doesn't.

**MAYA:**
The container is a wall, TCP can climb it, a file can't.

**THEO:**
And one tiny tuning knob, because it's the kind of thing that bites you: both ends set `TCP_NODELAY`. By default TCP *batches* small messages before sending — waits a beat to see if more is coming. That's Nagle's algorithm. Great for bulk transfer, terrible for an interactive editor where every request is small and you want it gone *now*. So we turn the batching off on both sides. Otherwise you get a mysterious little stutter on every operation and spend a week not knowing why.

**MAYA:**
That's the kind of bug that ruins a month.

**THEO:**
And it's one line of code to prevent.

## Segment 2 — The receptionist and the bodyguard

**MAYA:**
So on the kernel side — the Rust side — something is sitting there listening. What's the shape of that?

**THEO:**
There's a file called `server.rs`, the receptionist at the front desk of the geometry engine. It sits by the phone. A message comes in — one line of JSON. It reads it, figures out which specialist to hand it to — "this is a `buildExtrude`, that goes to the extrude department" — waits for the answer, wraps it in the JSON-RPC envelope, writes the reply. Next message.

**MAYA:**
And there's a table that says "this method name goes to that function."

**THEO:**
Right, a function called `run_handler`, basically a switchboard. `ping` returns "ok, I'm alive." Then `buildExtrude`, `buildRevolve`, `buildBoolean`, `buildSweep`, `buildPattern`, `buildShell`, `buildEdgeBlend` — fillet and chamfer — `buildLoft`, and `exportStep` and `exportStl` for files. That's the entire public vocabulary. Ten or eleven verbs. Send a method that isn't in the table, you get a clean "method not found" instead of a crash.

**MAYA:**
That's a small vocabulary for twelve thousand lines.

**THEO:**
That's the point I keep making. The vocabulary is small. The depth behind each word is enormous. "Extrude" is one word and it's a couple thousand lines of careful handling underneath.

**MAYA:**
Okay so the receptionist routes the call. You mentioned the kernel can crash. Does the receptionist do anything to stop that?

**THEO:**
One of my favorite bits, because there's a beautiful asymmetry. The receptionist wraps every geometry call in something Rust calls `catch_unwind` — think of it as a bodyguard standing around the operation. If the *Rust* code panics — Rust's version of an unexpected error, an array index out of bounds, that kind of thing — the bodyguard catches it, turns it into a polite "internal error" response, and the connection keeps going. One bad request can't take down the whole server.

**MAYA:**
But you said earlier the C++ kills the whole process. So the bodyguard catches Rust panics but not...

**THEO:**
Not C++ exceptions. That's the asymmetry. `catch_unwind` only catches Rust's own panics. When OCCT — the C++ — throws an exception that escapes the bridge, it sails right past the bodyguard, calls `std::terminate`, and the process dies. So it's a two-layer defense. Layer one: the bodyguard keeps the server alive for everything recoverable. Layer two: for the unrecoverable C++ aborts, the program's entry point installs an OCCT "terminate handler" that at least logs *what* went wrong before the process goes down. You get a death note. And then —

**MAYA:**
And then somebody has to bring it back to life.

**THEO:**
Which is the bodyguard's partner. There's a supervisor — `cadKernelSupervisor.js`. Optional, off by default, because a lot of the time during development I'm running the kernel by hand and I don't want something fighting me to restart it. But when it's switched on, it owns the kernel's life. It spawns it, it pipes the kernel's logs into the main logs with a little `[cad-kernel]` prefix so you can see them, and when the kernel dies, it restarts it. With backoff.

**MAYA:**
Backoff meaning...

**THEO:**
Meaning if it crashes and you restart it instantly and it crashes again instantly, you don't want to sit in a tight loop hammering restart a thousand times a second. So you wait one second, then two, then four, doubling, capped at thirty seconds. And — this part matters — if it runs healthy for sixty seconds, you reset the backoff back to one. So a one-off crash recovers fast; a persistent crash-loop backs off gracefully instead of melting your CPU.

**MAYA:**
That's a very human pattern. "If you've been fine for a minute, I'll forgive the earlier stumble."

**THEO:**
It's exactly that. And here's the elegant thing about how loosely coupled these two are: the supervisor and the client don't actually coordinate. They don't talk to each other. The supervisor just restarts the binary. The client just notices the connection dropped, rejects all the in-flight calls with a "disconnected" error, and the *next* time someone makes a request, it quietly reconnects. They share exactly one piece of information — the address to connect to, in an environment variable — and otherwise they're strangers who happen to be very good at their jobs.

**MAYA:**
You said the client rejects all the in-flight calls when the connection drops. So if I'm mid-extrude and the kernel dies, that request just... fails?

**THEO:**
It fails cleanly. Which is the right outcome. The alternative — leaving a promise hanging forever waiting for a reply that will never come because the kernel that was going to send it no longer exists — is so much worse. Fail loud, fail fast, let the user retry.

## Segment 3 — Knowing the kernel is alive

**MAYA:**
You keep mentioning this ping. The "are you alive" message. Why does that need to be its own thing? Can't you just tell the kernel's down because your requests fail?

**THEO:**
The original design did basically that, and it was wrong in an instructive way. The editor needs to show whether the geometry engine is online — and if it's offline, *clear the 3D view* and put up an explicit "geometry engine offline" notice. Because the worst possible thing is to leave a stale picture on screen that the user thinks is live.

**MAYA:**
Right, you don't want me confidently making decisions about a model that's actually frozen and wrong.

**THEO:**
Catastrophic in a tool people use to make real parts. The original indicator was wired to a *different* channel — a WebSocket that streams progress during a regeneration. And that progress socket is best-effort; it drops sometimes for totally unrelated reasons. Whenever it dropped, the editor screamed "KERNEL OFFLINE" even though the kernel was perfectly fine and regular requests were working great.

**MAYA:**
So you were getting false alarms. The smoke detector going off because you made toast.

**THEO:**
Constant toast alarms. So the fix: stop inferring the kernel's health from an unrelated channel, and *ask it directly*. The editor polls — every few seconds it hits an endpoint that does one thing: send a real `ping` down the *same connection the actual geometry work uses*, with that four-second timeout. Kernel says "ok," we're online. Times out, we're offline.

**MAYA:**
Same connection is the key, right? Because you're testing the actual road you drive on, not some side street.

**THEO:**
That's the whole insight. Test the thing you depend on, not a proxy for it. And the endpoint always returns a successful HTTP response — it never errors — because the *answer* is the payload. It comes back saying `online: true` or `online: false`. The status isn't in whether the request succeeded; the status is in the body of the reply. So within about eight seconds of the kernel going down, the badge flips to offline, the 3D view clears, the notice appears. And when the kernel comes back, the next poll sees it, and the model repaints automatically. No refresh.

**MAYA:**
And the ping itself is dirt cheap on the kernel side.

**THEO:**
It's a single line in the switchboard. It returns "ok, true." No geometry, no allocation, nothing. It's the cheapest possible question, which is what you want from a heartbeat.

## Segment 4 — The shared dictionary

**MAYA:**
Before we get into the actual operations — you've now mentioned a bunch of message shapes. `buildExtrude` takes "a bag of parameters." Who decides what's in the bag? Because the JavaScript side and the Rust side both have to agree, right?

**THEO:**
This is the unsung hero file, and it's called `protocol.rs`. It's the shared dictionary. It is the written-down agreement between the two programs about what every message looks like. When the Rust side says "a `buildExtrude` request contains an outer loop of profile edges, an optional set of holes, a host plane, a distance, and a few optional flags" — that's defined in `protocol.rs`, in Rust's type system. And the TypeScript on the frontend mirrors those exact field names.

**MAYA:**
Mirrors — so it's two copies of the same definition, by hand, in two languages?

**THEO:**
By hand, yes. And there's literally a comment at the top of the file that says, in effect, "if you change a field name here, you must change it in the frontend in the same commit." It's a manual contract. Not automated. Which is a real cost — you can get them out of sync and things break in confusing ways — but the discipline is enforced by that comment and by tests, and it keeps the wire vocabulary in one canonical place.

**MAYA:**
What's actually in that dictionary? Give me the nouns.

**THEO:**
Okay, the core nouns. There's `Point2` — a 2D point, just x and y — for sketch-space coordinates. There's `Plane3` — a plane in 3D, defined by an origin and three axis directions plus a normal. That's how you say "this sketch lives *here* in space, oriented *this* way."

**MAYA:**
And the kernel uses all of those?

**THEO:**
Almost — there's a lovely little detail. The plane carries both a normal direction *and* the two in-plane axes. But the kernel only really needs the origin, the x-axis, and the normal. The y-axis it could compute itself by crossing the normal with the x-axis. But we send it anyway. Why? Because if both sides independently *recompute* the y-axis, they might disagree on the sign — one says up, one says down — and now your sketch is mirrored and you've spent an afternoon confused. So we carry the redundant value across the wire to guarantee both sides agree. Redundancy as a sign-agreement insurance policy.

**MAYA:**
Send the answer rather than risk two people doing the arithmetic differently.

**THEO:**
Then there's `ProfileEdge`, which is how you describe the outline you're going to extrude. It's a tagged union — meaning each edge declares what kind it is. A `Line` with a start and end point. An `Arc` with a center, radius, and angles. A `Circle` — center and radius, that's a full closed loop in one edge, a fast path. And `Bezier` — a list of control points, which is how *text* gets in. Letter shapes are Bézier curves.

**MAYA:**
Wait, you can extrude text? Like embossing a logo?

**THEO:**
You can extrude text, and when you do, each glyph's outline arrives as Bézier edges, and the kernel builds them as real smooth curves rather than chopping them into a thousand little straight segments. There's a dedicated path for it.

**MAYA:**
And the arc — you said it has a center and radius *and* angles. That feels like more than you need.

**THEO:**
Caught it again. Redundant on purpose. It has the analytic definition — center, radius, angles, sweep direction — *and* the actual world coordinates of its start and end. So the kernel builds the arc from the math, then double-checks the endpoints landed where the frontend said, without re-projecting. Belt and suspenders. Geometry is a domain where a tiny disagreement compounds into a broken solid, so the protocol is full of these redundancies that exist purely to make the two sides agree.

**MAYA:**
And then the replies. What comes back?

**THEO:**
The big one is `FaceMesh`. One per face of the resulting solid. It's got the triangles — flat arrays of positions, normals, and indices, which is exactly what a graphics card wants to draw. It's got a face ID and a "persistent name," which we'll spend real time on later because it's one of the cleverest parts. A flag for whether the face is flat. The list of which edges bound it. And optionally, a surface classification — "this is a plane pointing this way" or "this is a cylinder with this axis and radius." And alongside the faces, there's `Topology` — the graph of vertices and edges, so the viewer can draw crisp wireframe outlines.

**MAYA:**
That's the reply to basically every operation?

**THEO:**
Every build operation returns a base64 blob of the solid itself — the exact mathematical description, for storage and for feeding into the *next* operation — plus that array of face meshes, plus the topology. And the multi-body operations — boolean, pattern, shell, edge-blend — also return a breakdown into separate solids, because those operations can split one body into several. Hold that thought, it comes back.

## Segment 5 — The verbs, part one: pushing and spinning

**MAYA:**
Let's do the verbs. Start with the one you keep calling the foundational one.

**THEO:**
Extrude. It's the "push a flat outline through clay" operation. You draw a shape, you push it a distance along the direction the sketch is facing, you get a solid. A circle becomes a cylinder. A rectangle becomes a box. It is *the* foundational 3D CAD operation — without it, your sketches never become solids.

**MAYA:**
And underneath, in OCCT terms?

**THEO:**
Underneath it's an OCCT call called `MakePrism` — make a prism. But the interesting work is all *before* that call: building the flat face to push. Because the outline you got could be a single circle, could be Bézier text, could be a polygon with arcs in it, could have *holes*. And each of those needs different handling.

**MAYA:**
Holes meaning, like, extruding a washer — a disc with a hole in the middle.

**THEO:**
A donut, exactly. So there's a function — `build_profile_face` — that figures out which case you're in. Single circle? Fast path, build the face directly, done. Any Béziers? Hand it to the text-glyph path. Otherwise, the general path: walk the outline edge by edge, building it up.

**MAYA:**
And the general path is where the tape is.

**THEO:**
The general path is where the *defensiveness* is, and it's earned through pain. OCCT is extremely powerful and extremely unforgiving. Hand it a zero-length edge — two points that are actually the same point — and it doesn't return an error, it throws a C++ exception that becomes a process abort. Death. So before anything touches OCCT, the kernel validates: removes duplicate adjacent points, rejects zero-length edges, rejects degenerate collinear triples — a Y-junction that confuses the surface builder — and rejects outlines with essentially zero area.

**MAYA:**
It's checking the food for glass before it serves it to the chef who can't see.

**THEO:**
[laughs] Grim but accurate. OCCT is a brilliant blind chef who'll hurt himself on anything sharp, so the kernel is the prep cook who inspects everything first. And one more — orientation. OCCT needs the outline to wind counterclockwise for the solid to point the right way. So the kernel computes the signed area using the shoelace formula — genuinely, tenth-grade geometry — and if it's negative, reverses the whole edge list. And reversing an arc also swaps its start and end and flips which way it curves.

**MAYA:**
The shoelace formula. From tenth grade. Doing real work in an industrial CAD kernel.

**THEO:**
The classics never die. There's also a slick trick for two-directional extrudes. Say you push five millimeters one way and three the other. The naive approach builds two prisms and glues them — but gluing leaves an internal seam, a ghost face at the sketch plane where the halves meet, which confuses downstream operations. So instead the kernel slides the *start* plane back by three and extrudes the full eight in one shot. One prism, no seam. The two-directional extrude is secretly a single offset extrude.

**MAYA:**
That's the kind of cleverness that's invisible when it works and infuriating to discover you need.

**THEO:**
Most of the kernel is invisible-when-it-works. That's the job. Now — revolve. Same family. Instead of pushing the outline straight, you spin it around an axis. The pottery wheel. A profile spun 360 degrees around a line becomes a vase, a shaft, a ring.

**MAYA:**
And it reuses the same outline-building you just described?

**THEO:**
Identical. Same `build_profile_face`, same hole handling. The only new thing is the spin, which is an OCCT call called `MakeRevol`. But there's a subtlety that I love because it's so easy to get wrong and so visible when you do.

**MAYA:**
Go.

**THEO:**
OCCT has *two* ways to do a full revolve. One takes an angle — you pass 360 degrees. The other takes no angle at all, and it knows "no angle means all the way around, make it a properly closed surface."

**MAYA:**
Those sound like they should give the same answer.

**THEO:**
*Almost* the same, and the difference is a disaster. Pass 360 explicitly and OCCT builds a start boundary and an end boundary — and even though they're in the exact same place, they're separate geometry. So you get a visible seam running down your vase. A scar. The no-angle constructor builds a genuinely closed, wrap-around surface where start and end are *the same topological entity* — no seam, because there's nothing to seam. So the kernel checks: is the angle within a thousandth of a degree of 360? Yes, use the no-angle constructor, clean closed body. A partial revolve — 90 degrees — you *want* those start and end faces, so use the angle constructor.

**MAYA:**
So "almost exactly 360" gets special treatment.

**THEO:**
And that one branch is the difference between a clean cylinder and one with a scar down the side that no amount of zooming makes go away.

**MAYA:**
And if the revolve fails? Axis right through the middle of my outline?

**THEO:**
OCCT would normally throw and abort. But the kernel wraps the call so the failure comes back as a clean `None`, and turns it into a human error: "this usually means your profile sits on or crosses the axis, or self-intersects." The raw failure would just be a process death with a cryptic C++ message. The user deserves better.

## Segment 6 — The verbs, part two: dragging, copying, gluing

**MAYA:**
Next verb.

**THEO:**
Sweep. Extrude drags the outline in a straight line; sweep drags it along a *path*. A curved track. A circle swept along an arc gives you a bent pipe. A square swept along a winding route gives you ductwork. The path is a chain of line segments and arcs, and it can even be a closed circle for ring-shaped parts.

**MAYA:**
And I'm guessing there's an OCCT gotcha here too, given the pattern.

**THEO:**
You're learning my rhythm. Yes. OCCT has a simple sweep called `MakePipe`, and it's faster, but it has a brutal requirement: the path has to be *smooth*. C1-continuous is the jargon — no sharp corners. The moment your path has a hard corner — two straight segments meeting at an angle — `MakePipe` throws and aborts. And of course real paths have corners all the time. So the kernel uses the more forgiving sibling, `MakePipeShell`, which handles sharp corners gracefully. It does a bit more internal bookkeeping, costs a little more, but it doesn't fall over when you give it an L-shaped path.

**MAYA:**
Pick the tolerant tool because real input is messy.

**THEO:**
That's a recurring theme. The whole kernel is a negotiation between "the fast OCCT call" and "the OCCT call that survives real-world input," and we almost always pick survival. There's also a neat detail with holes in a swept profile — if you sweep a square-with-a-hole, the kernel sweeps the hole *separately* into its own little tube and then subtracts it from the solid. Because the vendored binding doesn't have a direct "sweep a compound face" call, so we do it by hand: sweep the outer, sweep the hole, cut one from the other.

**MAYA:**
So sweep secretly uses subtract. Which is — boolean. Let's do boolean.

**THEO:**
Boolean is the scissors and glue. Three operations between two solids. Fuse — union — glue them into one. Cut — subtract — punch one out of the other. Common — intersection — keep only the overlap. This is how you do multi-body modeling, and it's directly modeled on SolidWorks' "Combine" feature.

**MAYA:**
And the inputs to boolean are... two solids that already exist.

**THEO:**
Two solids that earlier operations already built. And here's a thing that surprised even me to write down clearly. Remember I said extrude returns a prism, and the backend "composes" it into the cumulative body? *Extrude itself doesn't fuse anything.* The kernel's extrude just makes the prism and hands it back. It's the *backend* — the JavaScript orchestration layer — that takes that prism and calls boolean to merge it into the running body. The kernel doesn't keep a cumulative body. It doesn't even know there *is* a cumulative body.

**MAYA:**
That's the "it's a calculator" thing again. It builds the one prism and forgets.

**THEO:**
It builds the prism and forgets everything. The memory — the sense of "this part is built from these features in this order, accumulating" — lives entirely in the backend, which we'll get to in a future episode. The kernel only ever sees "fuse these two specific blobs." Stateless. Every single time.

**MAYA:**
Okay so back to the boolean itself. Fuse, cut, common. Then what?

**THEO:**
Then a cleanup step that's surprisingly important. A boolean can leave the result a mess. Cut a box with a cylinder, and where the cylinder's edges cross a flat face, OCCT sometimes splits that one flat face into a bunch of pie-slice sub-faces — all in the same plane, all part of the same actual surface, but recorded as separate faces.

**MAYA:**
So a face that should be one flat rectangle is secretly chopped into shards.

**THEO:**
Shards that serve no purpose. So there's a cleanup call — `UnifySameDomain` — that finds adjacent faces on the same underlying surface and merges them back into one. Without it, a revolve cut into a box gives you ridiculous pie-slice faces everywhere. The cleanup makes the result look like a human designed it instead of like a chainsaw went through it.

**MAYA:**
And then the splitting-into-pieces thing you keep teasing.

**THEO:**
Now it pays off. After a boolean, a step called `decompose_into_solids` — because a single cut can split your body into disconnected pieces. Picture a ring; cut straight across it and now you have two separate arcs, two solids, that used to be one body. The kernel finds every disconnected piece and returns each one separately, with its own blob, center of mass, and volume.

**MAYA:**
Why does the kernel care? It's a calculator, it doesn't track bodies.

**THEO:**
It doesn't *track* them — it *reports* them. "Here are the three pieces, with their volumes and centers." Then the backend, which has memory, decides "the biggest piece is still the body the user was working on, keep its identity; these two little ones are new bodies." Kernel does the geometry — what split — backend does the bookkeeping — what each piece means. And if the boolean produces *zero* pieces — a cut that removed everything — the kernel returns an empty list and a clean "this cut produces zero volume" error instead of a useless empty shape.

**MAYA:**
And pattern? Copying things.

**THEO:**
Pattern is the copy-and-combine machine, and it's almost anticlimactic once you understand boolean, because it *is* boolean underneath. You give it one source solid and a list of moves. Each move is either a translation — slide by this much — a rotation — spin around this axis by this angle — or a mirror — reflect across this plane. The kernel applies each move to make a copy, then fuses all the copies together.

**MAYA:**
So the three pattern types — linear, circular, mirror — are all the same operation with different lists of moves.

**THEO:**
Exactly the same machine. A linear pattern of five holes is four "translate" moves. A circular pattern of six is five "rotate" moves at equal angular steps. A mirror is one "mirror" move. The *frontend* does the work of turning "I want eight bolts in a circle" into the list of rotation angles; the kernel just receives the list and grinds through it. And there's a default about whether the source is included — usually you want the original plus all the copies fused together. But you can ask for *just* the copies, as a free-floating separate body, for cases where you want the pattern to be its own thing.

**MAYA:**
You mentioned it fuses them one at a time. Is that a performance concern?

**THEO:**
An honest shortcut. It fuses sequentially — source union copy one, then that union copy two, down the line. A balanced tree fusing pairs would be faster for big N, but for typical patterns — twenty copies or fewer — the difference is imperceptible, and sequential is simpler to get correct. Documented as "could be faster for huge counts, we chose simple," rather than pretending it's optimal.

## Segment 7 — The verbs, part three: hollowing and rounding

**MAYA:**
Two verbs left. Shell and edge-blend.

**THEO:**
Shell is hollowing. You take a solid block, you say "remove the top face and make the walls two millimeters thick," and you get a box — an open container. It's how you make enclosures, housings, anything thin-walled. Underneath it's an OCCT operation with a magnificent name, `MakeThickSolidByJoin`. You hand it the faces to remove and a wall thickness, and it offsets all the remaining faces inward to create the cavity.

**MAYA:**
How does it know which faces to remove? I clicked the top face in the UI — how does that survive the trip to the kernel?

**THEO:**
Genuinely one of the hardest problems in the system, and it shows up in shell, fillet, and chamfer all the same way. OCCT renumbers faces every time it rebuilds a shape. So you cannot say "remove face number four" — face four might be a completely different face after the next regeneration. The number's meaningless across rebuilds.

**MAYA:**
So how do you point at a face reliably?

**THEO:**
*Geometrically*. When you pick the top face, the system records its center point and the direction it faces — its centroid and its normal. Physical facts that don't depend on OCCT's numbering. So the pick that travels to the kernel is "the face whose center is roughly *here* and which points roughly *that way*."

**MAYA:**
And the kernel goes hunting for the face that matches.

**THEO:**
A function called `match_picked_faces` scores every face against your pick — how far each center is from where you said, with a tolerance that scales to the part size. And the clever tiebreaker: if two faces have centers in nearly the same spot — the top and bottom of a thin plate — it uses the *normal* to break the tie. Top points up, bottom points down. Mostly distance, with a nudge toward the face pointing the way you said.

**MAYA:**
And if nothing's close enough, it gives up rather than guessing.

**THEO:**
Rejects it. And it also rejects *duplicate* matches — if two of your picks both resolve to the same actual face, that's a malformed request, and feeding `MakeThickSolid` a duplicate face list makes it choke. So it catches that up front.

**MAYA:**
You said shell has a limitation.

**THEO:**
Single thickness. `MakeThickSolidByJoin` applies one uniform wall to everything. Real CAD lets you say "this wall two millimeters, that wall five." That needs a lower-level OCCT path — initialize, then set an offset per face — which isn't in the vendored binding yet. So today, one thickness for the whole shell, written down honestly as a limitation. And shell is one of the operations most likely to produce a *technically-done-but-garbage* result — ask for walls thicker than the part supports and OCCT sometimes reports success but hands back a self-intersecting mess. So there's a guard: empty result means the offset was infeasible, return "thickness too large for this geometry" rather than a broken body.

**MAYA:**
Okay. Last verb. Edge-blend — that's fillet and chamfer together.

**THEO:**
One module, two operations, because they're so similar in structure. Fillet rounds a sharp edge into a smooth curve — imagine rolling a ball along the edge and the surface the ball traces. Chamfer cuts a flat bevel across the edge — like planing the corner off a board. Both work by you picking edges, and both find those edges the same geometric way shell finds faces — except for edges, the identity is the *two endpoints*. World-space coordinates of where the edge starts and where it ends.

**MAYA:**
And matching by endpoints has the same flavor as matching faces by center.

**THEO:**
Same flavor, with one extra wrinkle: an edge has a direction, but you might have recorded it start-to-end and OCCT might have it end-to-start. So the matcher checks both the direct pairing and the swapped pairing — start-to-start plus end-to-end, *or* start-to-end plus end-to-start — and takes whichever's closer. Otherwise you'd fail to match an edge purely because the two sides disagreed on which end is "first," which is a meaningless distinction for an edge.

**MAYA:**
And chamfer has the three modes.

**THEO:**
Three modes, straight out of SolidWorks. Equal distance — symmetric, a clean 45-degree bevel, same setback on both faces. Two distances — asymmetric, three millimeters on this face and one on that face, for when you want a shallow lead-in. And distance-and-angle — go in this far on the reference face and cut at this angle. The angle's validated to be strictly between zero and ninety degrees, because zero or ninety produce degenerate cuts.

**MAYA:**
The two-distance and angle modes need to know *which* face is the reference, right? "Three millimeters on *this* face."

**THEO:**
They do, and that's another little geometric lookup — `find_adjacent_faces` — which walks the body finding which faces actually touch the picked edge, and uses the first one it finds as the reference. An edge is shared by exactly two faces; for asymmetric modes you need to anchor your measurements to one of them, and that's how it picks.

**MAYA:**
And the failure mode for fillet is, what, asking for a radius that's too big?

**THEO:**
Radius too big for the edge — you ask for a ten-millimeter round on an edge that's only six millimeters from its neighbor and there's no room for the ball to roll. OCCT chokes, the result comes back empty, and the kernel turns that empty result into a human error: "this value is too large for the picked edge, or these faces can't be blended." Across all of these — shell, fillet, chamfer, boolean — the pattern is identical: do the operation, check if the blob came back empty, and if it did, that's your signal something went wrong, so emit a sentence a human can act on instead of a crash or a silent broken body.

## Segment 8 — From perfect math to triangles

**MAYA:**
So every one of these operations ends by handing back triangles. But you keep saying the kernel works in *perfect* math — exact curves, exact surfaces. Triangles aren't exact. Where does the conversion happen?

**THEO:**
There's a single shared output stage — a file called `shape_io.rs` — and every operation funnels through it at the end. It does four jobs, and they're worth taking one at a time because each is a small ingenious thing.

**MAYA:**
Go in order.

**THEO:**
Job one: serialize the solid. Take the exact mathematical B-rep — the boundary representation, the precise description of all the surfaces and edges and how they connect — and turn it into a blob of bytes we can send over the wire and store. And here's a slightly embarrassing implementation detail: the way it does that is by writing the shape to a *temporary file on disk* and reading the bytes back.

**MAYA:**
A file? Why a file? You're sending it over a network, why touch the disk at all?

**THEO:**
Because the vendored OCCT binding only exposes the "write this shape" function as "write it to a file path." There's no "write it to memory" function in the binding yet. So you write to a temp file, read it back, delete the temp file. It's silly, and there's a note that says "the in-memory version is future work." But it works, and here's the one non-obvious part: because multiple requests can run at once on that shared connection, the temp files are named with the process ID *and* an ever-incrementing counter, so two simultaneous operations never grab the same filename and stomp on each other.

**MAYA:**
The counter is the thing that keeps two cooks from using the same cutting board.

**THEO:**
That's the whole reason it's there. Job two — the big one — tessellation. Turning the perfect surfaces into triangles. The kernel collects every face, and for each one calls OCCT's mesher with a "chord tolerance" of point-oh-five.

**MAYA:**
Chord tolerance. Translate.

**THEO:**
Imagine a circle, and you're approximating it with straight line segments. The chord is one of those segments — a straight line cutting across the arc. The chord tolerance is the maximum gap you'll allow between the straight chord and the true curve it's approximating. Point-oh-five millimeters. So the mesher keeps subdividing a curved surface into finer triangles until no triangle's flat surface is ever more than five-hundredths of a millimeter away from the true mathematical surface.

**MAYA:**
So tighter tolerance, more triangles, smoother-looking but heavier.

**THEO:**
And point-oh-five is the sweet spot where a curved surface looks genuinely round at normal zoom without drowning the graphics card in triangles. And — this is a detail I really like — that exact same number, point-oh-five, is used by the *frontend's* tessellator, the one that draws the 2D sketch curves before they're ever extruded. Same tolerance on both sides. So the curve you see while sketching and the curve you see after extruding agree. They're tessellated to the same fineness. If those two numbers drifted apart, you'd get this subtle wrongness where the solid doesn't quite match the sketch that made it.

**MAYA:**
One magic number, deliberately shared in two places.

**THEO:**
And it's documented as load-bearing, so nobody innocently changes it on one side. Job three — topology. Building the clean graph of vertices and edges for the wireframe. And this has the single most surprising idea in the whole output stage: it *deletes* some edges on purpose.

**MAYA:**
Deletes edges? Why would you delete an edge?

**THEO:**
Because some edges aren't real — they're artifacts of the math. Take a cylinder. To describe its surface mathematically you have to "unwrap" it, like peeling a label off a soup can and laying it flat. And unwrapping makes a cut somewhere, a *seam*, where the two edges of the label meet. That seam exists in the math, but it's not a real edge on the physical cylinder — the cylinder's perfectly smooth all the way around. Draw the seam as a line and you've got a bogus line running down every cylinder in your model.

**MAYA:**
So the seam is real to the math and fake to the eye.

**THEO:**
And the kernel drops it. The detection's elegant: a real edge is shared by two *different* faces. A seam edge is referenced *twice by the same single face* — because it's where the face wrapped around and met itself. Owned twice by one face? Seam, throw it out.

**MAYA:**
That's a beautiful little test. "If you touch yourself twice, you're not real."

**THEO:**
[laughs] Yes. There's a second category: tangent edges. Where a rounded fillet meets a flat face, there's technically a boundary, but the surfaces meet *smoothly* — no visible crease. Drawing it as a hard line would make a smooth blend look creased. So the kernel detects those — two faces with nearly-parallel normals, within about five degrees — flags them tangent, and the viewer draws a faint dashed line. Real crease, solid line. Smooth blend, dashed. Math seam, no line at all.

**MAYA:**
Three kinds of edge, three treatments, all from how the faces meet.

**THEO:**
And curved edges get a polyline — the kernel samples points along the *true* curve and ships that, so the viewer draws one clean curve instead of each neighboring face drawing its own slightly-different approximation that doesn't line up. Job four is the decompose-into-solids we covered. So the output stage is: serialize, tessellate, build clean topology, split into bodies. Every operation ends there.

## Segment 9 — The permanent names

**MAYA:**
You've promised me the naming thing twice now. Cash it in. Why is naming a face hard?

**THEO:**
Here's the scenario that makes it hard, and it's the most important problem in parametric CAD. You build a box. You pick its top face and say "round this edge — put a fillet here." Now you go back and change the box's *height*. The whole part rebuilds from scratch. The question is: does your fillet survive? Does the system still know which edge you meant?

**MAYA:**
And if faces were just numbered one through six...

**THEO:**
Then after the rebuild, face four might be a totally different face, and your fillet jumps to the wrong edge, or vanishes, or corrupts the part. Because OCCT's internal numbering shuffles on every rebuild. The numbers are meaningless across regenerations. This is called the "persistent naming problem" and it's notoriously one of the hardest problems in the entire field of parametric CAD. Serious commercial kernels have whole research papers about it.

**MAYA:**
So what's the approach here?

**THEO:**
Name faces by *what they are*, not *where they landed in a list*. There's a structure called `PersistentName`, and it records: which feature produced this face, what *role* it plays in that feature, and a sub-index to disambiguate. So instead of "face four," a name is "the top cap of feature f1." Or "side number three of feature f1." Those descriptions are stable. The top cap of an extrude is always the top cap, no matter how OCCT numbers things internally, no matter what height you set.

**MAYA:**
So for an extrude — a box — the roles are like top, bottom, and side.

**THEO:**
Cap-top, cap-bottom, and side, assigned by geometry — where each face's center sits along the push direction. Center at the bottom, distance zero? Cap-bottom. Center at the far end? Cap-top. In between? Side. And side faces get sorted by their *angle* around the part, so "side zero" is always the same physical side across rebuilds, even when OCCT's internal order changes.

**MAYA:**
And these names get encoded into a string that travels with the face.

**THEO:**
The whole structure serializes to a compact JSON string, and that string is *both* the face's ID and its persistent name — same value. So when you pick a face you're really grabbing that descriptive string, and after a rebuild the kernel produces a face with that *same* string, and your selection re-binds. That's what lets a fillet survive an edit to an upstream feature.

**MAYA:**
But that's the extrude case, with obvious roles. What about a boolean result, where faces don't have clean roles?

**THEO:**
That's the harder case, and the answer's more humble. For operations without clean roles — boolean, revolve, sweep — there's a generic path: sort all faces by their center coordinates, x then y then z, and name them "side zero, side one, side two" in that order. And the reason *that's* stable is kind of beautiful: face centers move *continuously* as you tweak parameters. Nudge a dimension, every center shifts a little, but the *sorted order* stays the same. The order only reshuffles if the topology changes — a face actually appears or disappears.

**MAYA:**
So small tweaks are safe, but if you fundamentally change the shape, the names can shuffle.

**THEO:**
And that's the honest boundary of this approach. It's documented plainly: this gives you stability *within a session*, under *parameter* changes. Full topological naming — names that survive even when faces appear and disappear — is the genuinely-hard next step, and it's noted as future work rather than claimed as done. What ships today is "sort deterministically, name positionally within the sort," and that covers the overwhelmingly common case: you're tweaking dimensions, not restructuring the part.

**MAYA:**
There's a version number attached to all this, right? You mentioned it.

**THEO:**
The naming schema version. It's a single constant — currently twenty — and it's the lever for the whole naming and output system. Every time the naming rules change — we started building arcs as real OCCT arcs instead of approximations, we added hole support, we added the multi-body decomposition, the shell validity check — every one of those bumped the number. And it has to be bumped in *two* places at once: in the kernel's Rust, and in the backend's JavaScript, which mirrors the same constant. They must always agree.

**MAYA:**
Why does the backend need to know the naming version?

**THEO:**
Two reasons. One: the backend caches geometry. A cached result computed under naming version nineteen, kernel now on twenty? Stale, recompute it — the names might have changed meaning. The version is the cache-invalidation key. Two — for next episode's version-control system — every commit records which kernel and naming version produced it. So years later the system knows exactly which engine built a historical part. Provenance.

**MAYA:**
And the body-scoping you mentioned — where one feature makes several solids.

**THEO:**
Right, the last piece. The kernel names faces relative to the feature — "feature f2, side zero." But in a multi-body part, one feature can produce several disconnected solids, and they'd both have a "side zero." Collision. So the backend scopes the names per body — feature f2, body zero, side zero — so they stay unique. And it does the same for the topology edge IDs, prefixing them per body, because otherwise two bodies' local edge numbers would collide on the frontend's edge map and you'd get phantom lines leaking between bodies. It's plumbing, but it's the plumbing that keeps a ten-body part from cross-wiring its own edges.

## Segment 10 — Flat or round? The classifier the assembly needs

**MAYA:**
There's one more output I want to understand, because last season you said the assembly tool depends on it. Surface classification. Flat versus round.

**THEO:**
This is REQ 749, and it's the bridge between the kernel and the *assembly* mate solver, which is a whole episode of its own later. Here's the core problem: a triangle mesh can *show* you a round hole, but it can't *tell* you the hole's exact centerline or its exact radius. It's just a fan of flat triangles approximating a curve. And the mate solver — the thing that lines parts up, "put this bolt's shaft inside that hole, perfectly centered" — needs the *real numbers*. Where's the axis? What's the radius?

**MAYA:**
So the mesh is good enough to look at but not good enough to align by.

**THEO:**
You can't align two parts coaxially from triangle soup. So for every face it tessellates, the kernel *also* asks OCCT "what kind of surface is this, mathematically?" If the answer's "a plane," it records the origin and the outward normal. If it's "a cylinder," it records a point on the axis, the axis direction, and the radius. Anything else — cone, sphere, freeform — it just skips. Records nothing.

**MAYA:**
Why only those two?

**THEO:**
Because they're exactly what the mate solver needs right now. Coincident-plane mates — flat face against flat face — need plane normals and origins. Concentric mates — line up two round things on a shared axis — need cylinder axes and radii. That's the bread and butter of assembly: faces against faces, shafts in holes. Cones and spheres are a future extension, and the code's written so widening it touches one or two spots. But today: plane and cylinder, because that's what pays the rent.

**MAYA:**
And how does it actually ask OCCT what kind of surface it is?

**THEO:**
This is where we go all the way down to the FFI — the foreign function interface, the literal bridge between Rust and C++. There's an OCCT class, `BRepAdaptor_Surface`. Wrap it around a face, ask `GetType`, and it tells you: plane, cylinder, cone, sphere, and so on. That class wasn't in the binding originally, so it had to be *vendored in* — we forked the Rust-to-OCCT bridge library and added it ourselves.

**MAYA:**
Vendored meaning you copied the library in and modified it.

**THEO:**
Copied it in so we control it, and added three little files of bridge: one declaring the surface type and its accessors, one declaring the enum of surface types so Rust and C++ agree on what "plane" and "cylinder" mean as numbers, and one high-level Rust wrapper that ties it together — ask the type, package origin-and-normal for a plane, origin-axis-radius for a cylinder, nothing otherwise.

**MAYA:**
And the values come straight from the math, not the mesh.

**THEO:**
That's the whole point, and why they're *stable*. The axis and radius come from OCCT's exact internal description of the cylinder, not from measuring triangles. So they don't wobble with zoom, don't wobble with tessellation fineness, stay rock-solid across regenerations. The mate solver can trust them to align two components coaxially even as you tweak upstream dimensions. The hole moves, but its axis-as-a-concept stays a clean line the solver can grab.

**MAYA:**
And this rides along on the face mesh for free.

**THEO:**
An optional field. Plane or cylinder, it's there. Otherwise it's *omitted entirely* — not sent empty, just absent — so it costs nothing on the wire for the faces that don't have it. The solver picks it up downstream and never touches a triangle.

## Segment 11 — Writing it out, and the honest footguns

**MAYA:**
Last real topic: getting geometry *out* of the system. Files. STEP and STL.

**THEO:**
Two export operations, the simplest ops in the kernel — almost a palate cleanser. STEP is the precise, exact-geometry interchange format — curves stay curves, it's what you hand another CAD package or a shop's CAM software. STL is the triangle-mesh format, the de facto standard for 3D printers. Both take a list of body blobs, combine them, write to a temp file via the OCCT writer, read it back.

**MAYA:**
Temp file again.

**THEO:**
Same reason — the OCCT writers only write to file paths. STEP comes back as text. STL comes back as *binary*, which is awkward because our transport is JSON, which is text. So the STL bytes get base64-encoded to ride across the connection, and there's an explicit annotation making sure the field is named exactly `stlBase64` on the wire so both sides agree.

**MAYA:**
And an assembly with five parts?

**THEO:**
Combined into one OCCT "compound" — a container holding multiple solids — and written as one file. STEP keeps them as distinct products inside the file. STL flattens everything into one undifferentiated triangle soup, because binary STL has no concept of separate bodies. Not a bug — that's just what STL is.

**MAYA:**
Now — there's a thing in the docs about released parts exporting *without recomputing*. Explain that, because it sounds important.

**THEO:**
It's important and it's a little bit subtle. When you *release* a part — lock a revision as official — the system *freezes* its geometry. Stores the exact body blobs at that moment. So later, when someone downloads the STEP or STL of a released revision, the system does *not* re-run the kernel to rebuild the part. It pulls the frozen blobs and just re-serializes them into the requested format. The only kernel involvement is that final "turn these exact frozen bytes into a STEP file" step.

**MAYA:**
Why does that matter? Wouldn't rebuilding give the same answer?

**THEO:**
That's the trap — it *might not*. The kernel changes over time. We fix bugs, we improve operations, we bump that naming version. If you rebuild a two-year-old released part with today's kernel, you might get a *subtly* different result. And for a released, approved, manufactured part, "subtly different" is unacceptable. The file you download must match exactly what was approved and built. So we freeze the geometry at release and serve the frozen copy forever. The download is guaranteed identical to the locked revision, even after the kernel's been upgraded ten times.

**MAYA:**
Freeze the answer so you never have to trust the recompute.

**THEO:**
And there's a graceful degradation: if the kernel's down when you try to export a live model, you get a clean 503 — service unavailable — rather than a hang or a crash. The system stays honest about what it can and can't do at any moment.

**MAYA:**
Okay. There's also an IGES thing in the docs that you flagged as a discrepancy. What's that about?

**THEO:**
This is a good honest one. The export doc's *filename* mentions IGES — it's an older CAD interchange format. And if you go digging in the vendored OCCT bridge, there's an IGES reader and writer wired up — the FFI exists, it links the right OCCT library. *But* it is not exposed as a kernel operation, and there's no backend route for it. So IGES is a *latent capability* — the plumbing's in the basement, but there's no faucet connected to it upstairs. You cannot actually export IGES today. The doc calls this out explicitly so nobody reads the filename and assumes it's a shipped feature. It's not. It's STEP and STL only.

**MAYA:**
I appreciate that the docs flag their own discrepancies. So — give me the rest of the tape. The footguns.

**THEO:**
The big one — genuinely the thing most likely to waste a maintainer's afternoon — is the build system. The kernel uses a Rust-to-C++ bridge called cxx, and cxx only rebuilds a binding when the *Rust* file changes — it watches the `.rs` file's timestamp. But each binding is a *pair* — a Rust file and a C++ header, a `.hxx`. Edit *only the header*, and cxx looks at the Rust file, sees its timestamp unchanged, concludes "nothing to rebuild." Your header change silently doesn't take effect, and you're running old C++ against new expectations, going slowly insane.

**MAYA:**
So the fix is...

**THEO:**
Touch the Rust file. Literally update its timestamp so the bridge notices. Known sharp edge, written down so the next person doesn't lose a day. And it pairs with the other manual reality: kernel rebuilds aren't automatic. The kernel's a separate Docker service, rebuilt by hand when the Rust changes. The web app hot-reloads on every save; the kernel doesn't. So you can edit kernel code, see no effect, and forget you never rebuilt the binary. Two halves, two rebuild rhythms — forgetting that is its own class of confusion.

**MAYA:**
Two programs, two rebuild rhythms, and a build system that watches the wrong file. That's a lot of opportunity to fool yourself.

**THEO:**
It's the cost of the blast wall. Putting the kernel in its own process, its own language, its own build — that's what gives you the isolation and the safety. And the price is that the two halves don't move in lockstep, and you have to hold that in your head. Every architecture decision is a trade. The separate process buys you a crash that doesn't take down the website. It costs you a kernel you have to remember to rebuild.

## Recap

**MAYA:**
Let me try to pull this together. Four things.

**THEO:**
Go.

**MAYA:**
One: the kernel really is a calculator, and I've come around. A separate Rust program wrapping the industrial OCCT library, talking to the web app over line-delimited JSON messages — even on the same machine, because of the Docker wall — and it's *stateless*. Builds one shape per request and forgets. All the memory, the "this part is a sequence of features," lives in the backend. The kernel is the muscle; the brain is elsewhere.

**THEO:**
And it's in its own process so when geometry blows up, it blows up in its own little room.

**MAYA:**
Two: the operations are a small vocabulary with enormous depth. Extrude, revolve, sweep, boolean, pattern, shell, fillet, chamfer. Each maps to OCCT calls, and the real work is the *defensiveness* — validating outlines before the unforgiving C++ chef sees them, picking the tolerant call over the fast one, the no-angle revolve to avoid seams, cleaning up shard faces after booleans, turning every empty result into a human-readable sentence instead of a crash.

**THEO:**
The verbs are simple. Surviving real input is the hard part.

**MAYA:**
Three: every face gets a persistent *name* based on what it is — "top cap of feature f1" — not where it landed in a list, so your fillet survives when you change the box height. Stable within a session under parameter tweaks, honestly not yet across topology changes, and that's documented rather than oversold. Plus a schema version bumped in two places at once that stamps every commit with its provenance.

**THEO:**
Name things by what they are, not where they are. That's the whole trick, and the whole hard part.

**MAYA:**
Four: the kernel hands back *meaning*, not just triangles. It classifies each face as flat or cylindrical with the exact analytic axis and radius — from the math, not measured off the mesh — so the assembly solver can line up shafts in holes. It writes STEP and STL. Released parts export from *frozen* geometry so a download always matches what was approved. And the honest footguns: a build system that watches the wrong file, and a kernel you have to rebuild by hand.

**THEO:**
The triangles are for your eyes; the classification is for the machine that makes decisions. And the redundancy everywhere — the y-axis you could compute, the arc endpoints you could derive — all so two programs in two languages never quietly disagree about a sign. Geometry is unforgiving about disagreement. The protocol is paranoid on purpose, and that paranoia is a feature.

## Teaser

**MAYA:**
Next episode. We've been dancing around it the whole hour — "the backend has memory," "the kernel forgets," "released parts get frozen," "every commit records the kernel version." All of that points at one thing.

**THEO:**
The version control system. Which is, I will just say it, git for solid geometry. Content-addressed, the whole thing.

**MAYA:**
Content-addressed — meaning?

**THEO:**
Meaning a shape is identified by a fingerprint of its own contents, so identical geometry is stored exactly once, no matter how many times it appears across the whole history. Same idea git uses for source code, applied to 3D parts. Branches, commits, the freeze we kept mentioning, the provenance stamps — all of it lives there. The kernel forgets on purpose precisely *because* this system remembers everything.

**MAYA:**
So next time, we find out where the memory actually lives. That's Episode 9 — content-addressed version control for CAD. Bring a fingerprint.

**THEO:**
Bring a hash function.

**MAYA:**
[groans] We'll see you next time.

---

# Episode 9 — Content-Addressed Version Control

## Cold open

**THEO:**
Okay. So before we start, I want to show you something. I've got the database open — the actual production-shape tables for the part history. And I want you to find the "save" button. Like, the column where the saved file lives.

**MAYA:**
Sure. I'll just... scroll. There's a table called `VcsObjects`. There's a column called `hash`. There's a column called `content`. There's a column called `bytes`. And there's a table called `VcsRefs`. Where's the file?

**THEO:**
There isn't one. There's no file. There's no "current version" column anywhere. There's no row that says "this is the part as it exists right now."

**MAYA:**
Wait. Then what am I looking at? This is supposed to be a CAD app. Somebody designed a part. It has to be *somewhere*.

**THEO:**
It's in there. It's just not stored the way you'd expect. Every one of those rows is identified by a fingerprint of its own contents. The "current version" is a sticky note in the other table that points at one of these fingerprints. And the version before it. And the version before that — all the way back to the first save, all sitting in the same drawer, none of them more "current" than any other except for which sticky note points where.

**MAYA:**
So... the database *is* the history?

**THEO:**
The database is the history. There is no separate "the part" and "the history of the part." It's the same thing. Today I want to convince you that's not a clever trick — it's the only sane way to do this.

## Intro

**MAYA:**
Welcome back to the show. If you're just joining us — first, hi, second, you've walked into the deep end. This is Season 2, where we take the browser-based CAD system we spent Season 1 admiring from a distance and start opening the panels and poking at the wiring. I'm Maya.

**THEO:**
And I'm Theo. I built a lot of this, so when something is embarrassing, that's on me, and I promise to tell you which parts are embarrassing.

**MAYA:**
He really does. Last episode we did the geometry kernel — the Rust service that turns sketches into actual solid bodies. Today we're doing something completely different in flavor. Today is version control. The thing that lets two engineers work on the same part without destroying each other's work, lets you see exactly what changed between Tuesday and Friday, lets you release a revision and have it be frozen forever.

**THEO:**
And the punchline, which I already spoiled in the cold open, is that we didn't invent a CAD versioning system. We built a tiny git. Like, *git* git. Content-addressed objects, commits, branches, tags, the whole DAG. And then we taught it to speak CAD.

**MAYA:**
So my job today is to keep asking "but why not just save a file?" until you crack.

**THEO:**
I'm ready. I've been ready for years.

## Segment 1 — There is no save

**MAYA:**
Okay, let's start exactly there. The most boring possible version of this app: I edit a part, I hit save, it writes a JSON blob into a column called `model_json`, done. Why is that wrong?

**THEO:**
It's not *wrong* for a toy. It's wrong the moment you want any of four things, and a real engineering shop wants all four. You want history — what did this look like last month. You want concurrency — two people, one part, no clobbering. You want to know what *changed* between two versions, precisely, not "the JSON is different." And you want a release you can trust is frozen — bit for bit, forever, for the regulators.

**MAYA:**
And one JSON column gives me none of those.

**THEO:**
One JSON column gives you the *last* state and nothing else. If you want history on top of it, you start bolting on a `versions` table, and now you're copying the entire model every save, and a part with forty features is forty features copied even if you nudged one number. And then someone asks "what changed" and you're diffing two giant JSON blobs with no structure, and the answer is "everything is different because the formatting changed." You've reinvented a worse version control, badly, one feature request at a time.

**MAYA:**
So instead of bolting versioning onto storage, you made versioning *be* the storage.

**THEO:**
That's the whole move. There's a file — `backend/services/vcs/vcsService.js` — and that file is deliberately the dumbest, most generic thing in the codebase. It knows nothing about CAD. Nothing about sketches, extrudes, geometry, parts. It's an object store that does git's four tricks: content-addressed objects, trees, commits, and named refs. That's it. Everything CAD-specific is layered on top in separate files.

**MAYA:**
Why so insistent on it knowing nothing about CAD?

**THEO:**
Two reasons. One, the same store also versions *assemblies* — the things that bolt parts together. If the store knew about parts, I'd have to teach it about assemblies too, and the next thing, and the next. Domain-blind, I write the hard part — the git machinery — once, then bind it to CAD over here and to assemblies over there. You'll hear me say "written once" a lot today. It's the spine of the design.

**MAYA:**
And reason two?

**THEO:**
Reason two is that git already solved this. Linus Torvalds and a couple thousand contributors spent twenty years proving that content-addressed objects plus a commit DAG is the right shape for "track changes to a tree of stuff over time with branches." I am not smarter than that. The most senior engineering decision in this whole subsystem was the decision to copy homework.

**MAYA:**
[laughs] Put that on a mug. Okay — content-addressed. You keep saying it. Break it down like I've never heard the word "hash."

## Segment 2 — The fingerprint

**THEO:**
Let's do the warehouse analogy, because it actually maps perfectly. Picture a warehouse full of boxes. Every box has a label, and the rule is: the label is a fingerprint computed from whatever's inside the box. You run the contents through a math blender and out comes a 64-character code. Same contents in, same code out, every single time. Different contents — even one character different — totally different code.

**MAYA:**
And the math blender is the hash. SHA-256, you said earlier.

**THEO:**
SHA-256, right. It takes any amount of data and spits out a fixed 64-character hex string. The magic properties: it's deterministic — same input, same output, forever — and it's effectively collision-proof. You will not, in the lifetime of the universe, find two different things that blend to the same code. So that code isn't just a name. It's a name that *is* the contents. If I hand you the code, you can verify the box wasn't tampered with by re-blending what's inside and checking it matches.

**MAYA:**
Okay, here's my first real pushback. Why is "the label is computed from the contents" better than "I just number the boxes 1, 2, 3"? Numbering is so much simpler.

**THEO:**
Beautiful question, and it's the one that unlocks everything. Numbering gives you identity. Content-addressing gives you identity *and* deduplication *and* tamper-evidence — for free, as a side effect of the same fact.

Watch. Say two different snapshots share an identical feature — same extrude, 10 millimeters, same sketch. Under numbering, those are box 5 and box 12, two copies. Under content-addressing they blend to the *same fingerprint*, get the *same label*, and when I go to store the second one the warehouse says "already have that one" and doesn't store it again. One copy, automatically. I never wrote a line of deduplication logic. It falls out of the fingerprint being the address.

**MAYA:**
Ohh. So if I edit one feature out of forty and re-save, the other thirty-nine features blend to the exact same fingerprints they had before—

**THEO:**
—so thirty-nine of them are no-op stores. "Already have it, already have it, already have it." Only the one feature you touched gets a new fingerprint and a new box. Plus the table-of-contents, which we'll get to. So a save of a forty-feature model writes — what — two objects. Not forty. That's the "O of changes" property the docs keep flagging. Storage cost scales with what you *changed*, not with how big the model is.

**MAYA:**
And tamper-evidence — that's just the flip side?

**THEO:**
Exactly the flip side. You can't quietly swap a box's contents, because the moment you do, its fingerprint no longer matches its label. The label would be a lie, and re-blending catches the lie instantly. Immutability isn't a rule we enforce with permissions and triggers. It's physics. An object literally cannot change its contents and keep its identity. If the contents change, it's a different object with a different address. The old one is still sitting right there, untouched, addressable by its old fingerprint.

**MAYA:**
That's genuinely elegant. The thing that names it is the thing that verifies it is the thing that deduplicates it. One mechanism, three wins.

**THEO:**
And I want to name the file, because there's a real subtlety in it. The hashing lives in `vcsService.js`, in two functions — `hashJson` for the JSON objects and `hashBinary` for raw bytes like frozen geometry. And both of them do one sneaky thing first: they prepend the *kind* of the object to the contents before blending.

**MAYA:**
What does that buy you?

**THEO:**
Collision avoidance between kinds. Imagine I have a "blob" — a leaf, one feature — whose contents happen to serialize identically to a "tree" — a table of contents. Astronomically unlikely, but I don't want to bet the integrity of the whole store on "astronomically unlikely." So before blending, `hashJson` glues the word `"blob "` or `"tree "` or `"commit "` onto the front. Now a blob and a tree can never share a fingerprint even if their payloads matched, because their *preimages* — the stuff that went into the blender — differ by that prefix. It's a tiny line of code. It closes a door that would otherwise be very slightly ajar.

## Segment 3 — Canonical JSON, the linchpin

**MAYA:**
I want to go back to "same contents, same fingerprint," because I think there's a crack in it. JSON. If I write an object as `{a: 1, b: 2}` and you write it as `{b: 2, a: 1}` — same data, right? Same meaning. But the *text* is different. Different characters, different order. Won't those blend to two completely different fingerprints?

**THEO:**
You just found the single most load-bearing detail in the entire version control system, and you found it in about ninety seconds. Yes. If we hashed raw `JSON.stringify` output, your two objects — identical in meaning — would get different fingerprints. Deduplication breaks. Diff breaks. The whole edifice collapses, because the core promise was "equal content, equal hash," and now equal content gives me *un*equal hashes depending on what order I happened to assign the properties.

**MAYA:**
So how do you close it?

**THEO:**
There's a file whose entire job is closing it. `canonicalJson.js`. Sixty-two lines. It's one function — `canonicalJson` — and it is the linchpin. The docs literally call it that. Its job: take any JavaScript value and produce *the* canonical text for it. Not *a* text. *The* text. So that equal content always — always — produces byte-identical output, which then always produces an equal hash.

**MAYA:**
And the main thing it does differently from normal stringify is...

**THEO:**
Sorts the keys. When it serializes an object, it doesn't emit the keys in the order you assigned them — it grabs `Object.keys`, sorts them alphabetically, and emits them in that order, recursively, all the way down. So `{a:1,b:2}` and `{b:2,a:1}` both come out as the exact same string. Insertion order is *erased*. It cannot affect the fingerprint because the fingerprint never sees it.

**MAYA:**
But arrays it leaves alone, I assume? Because in an array, order is the whole point.

**THEO:**
Right, and that distinction matters enormously for us. In a CAD feature tree, the *order* of features is semantic — extrude-then-fillet is a different part than fillet-then-extrude. So arrays stay ordered; only object *keys* get sorted. Sequence where sequence means something, sorting where it doesn't.

**MAYA:**
What else does it do? You made it sound like there's more than just sorting.

**THEO:**
There are three other guards, all about a sneakier version of the same failure — two *different* values collapsing to one fingerprint. First: non-finite numbers. `NaN`, positive infinity, negative infinity. Regular `JSON.stringify` quietly turns all of those into `null`, so they'd all serialize identically and collide. Canonical JSON *throws* instead. If a `NaN` is trying to get into the store, something upstream is broken and I want to know loudly, not paper over it with a `null`.

**MAYA:**
Fail loud instead of silently corrupting an address. Okay. Second?

**THEO:**
Negative zero. In JavaScript, negative zero and positive zero are technically distinct but mean the same number. Canonical JSON collapses negative zero to plain zero, so they can't produce two fingerprints for what's mathematically one value. And third — `bigint` throws, because a bigint can't round-trip through JSON without losing precision, and a lossy serialization is a serialization you can't trust to be canonical.

**MAYA:**
There's a pattern in all four of those. Sorting keys, rejecting `NaN`, collapsing negative zero, rejecting bigint — every one of them is killing a way that "two things that should be equal end up unequal" or "two things that are different end up equal."

**THEO:**
That's *exactly* it, and you said it cleaner than the docs do. Canonical JSON exists to make the equivalence relation honest. Equal-in-meaning must map to equal-in-bytes, and different-in-meaning must map to different-in-bytes. Both directions. Get either one wrong and content addressing is a lie. And here's the kicker — almost nothing calls this function directly. It's used in exactly two places inside `vcsService.js`, deep in the hashing and the low-level put. Callers never touch it. It's invisible plumbing. But it is the plumbing the entire building's water pressure depends on.

**MAYA:**
And it's *sixty-two lines.* That's the part that gets me. The most important file is one of the smallest.

**THEO:**
The most important files usually are. The big files are where you're still figuring out what you're doing. The tiny ruthless ones are where you finally figured it out.

## Segment 4 — Blobs, trees, commits

**MAYA:**
Alright. You've mentioned blobs and trees and commits a few times and I've been letting it slide. Stop and define them. What are the actual kinds of box in this warehouse?

**THEO:**
Six kinds, technically, but three are the heart of it and the others are extensions. The model validates them to a fixed list: blob, tree, commit, geometry, component, thumbnail. Let's do the big three first, because if you get those, git itself becomes obvious.

A **blob** is a leaf. The smallest meaningful unit of content. In our CAD world, one blob is one feature — one extrude, one fillet — or one sketch. Just the raw content of that one thing, fingerprinted and filed.

**MAYA:**
So a blob doesn't know its own name or where it lives. It's just... the contents of one feature, addressed by fingerprint.

**THEO:**
Precisely. It's anonymous content. It doesn't know it's called "the base extrude." It doesn't know it comes third in the tree. It's just the stuff. Naming and ordering happen one level up.

**MAYA:**
Which is the tree.

**THEO:**
The **tree** is the table of contents. It's an ordered list of entries, and each entry is three things: a name, a kind, and a fingerprint. So a tree might say: entry one, name `feature:f2`, kind blob, fingerprint `abc123...`; entry two, name `sketch:s5`, kind blob, fingerprint `def456...`; and so on. The tree doesn't contain the features. It *points* at them, by fingerprint. It's the table of contents that says "this version of the model is made of these specific blobs, in this order."

**MAYA:**
And because it points by fingerprint, the tree is *also* content — it also gets its own fingerprint.

**THEO:**
Now you're thinking in content-addressing. Yes. The tree is itself an object with its own fingerprint, computed from the names and fingerprints it lists. So if I change one feature, that feature's fingerprint changes, which changes its *entry* in the tree, which changes the *tree's* fingerprint. The change ripples up exactly one path: one blob, one tree. Everything else is untouched and shared. That ripple is the whole efficiency story.

**MAYA:**
And the commit sits on top of the tree.

**THEO:**
The **commit** is the dated, signed snapshot. It points at exactly one tree — the table of contents for that whole version — and it carries the metadata: who made it, the message they wrote, the timestamp, the version info, and — this is the crucial bit — the *parents*. The fingerprints of the commit or commits that came immediately before this one.

**MAYA:**
And that's what chains them into history.

**THEO:**
That's the chain. Each commit points back at its parent, which points back at *its* parent, all the way to the very first commit, which has no parent. So from any commit you can walk backwards through the entire history. And — same trick as everywhere — the parents are *part of the commit's content*, so they're folded into its fingerprint. Which means you can't rewrite history without it being obvious. If I tried to sneak a different parent in, the commit's fingerprint changes, so it's a different commit, and the thing that used to point at the old one no longer reaches my forgery. The whole chain is tamper-evident, link by link. The docs call the result an immutable DAG — directed acyclic graph — and "tamper-evident" is the reason that matters for a regulated shop.

**MAYA:**
Hang on, one detail. You said the *caller* supplies the timestamp, not the commit function itself. Why does that matter?

**THEO:**
Because if `createCommit` called `Date.now()` internally, the fingerprint would depend on *when you ran it*, and the same logical commit made at two different instants would get two different addresses. By making the caller pass the timestamp in, we keep the hash reproducible — given the same inputs, including the same timestamp, you get the same commit fingerprint every time. It's the same obsession as canonical JSON: strip out every source of nondeterminism, because nondeterminism poisons content addressing.

**MAYA:**
You really are paranoid about that.

**THEO:**
Content addressing is a deal you make with determinism. The instant you let one non-deterministic thing leak into a preimage, the deal's off and you don't find out until your dedup silently stops working and your storage quietly triples. So yes. Paranoid. Professionally paranoid.

**MAYA:**
What about the other three kinds — geometry, component, thumbnail?

**THEO:**
Geometry is binary. When you *release* a part, we freeze its computed 3D shape — the actual solid body data from the kernel — and store it as raw bytes, addressed by a hash of those bytes via `putBinary`. Same dedup story, just over bytes instead of JSON. That's a whole episode of its own — next week, actually. Component is a reserved seam for assemblies: an object that references *another repository's* commit, so an assembly snapshot can record exactly which version of each child part it was built from. It's validated in the model today but mostly waiting for the assembly editor to fully land. And thumbnail is a little PNG preview captured at check-in time — interestingly, that one is *not* content-addressed. It's keyed per commit, because you look it up by "what's the thumbnail for commit X," not by its pixels. A deliberate exception to the rule, made because the access pattern is different.

**MAYA:**
I like that you have a rule strict enough that the exceptions are worth calling out.

## Segment 5 — Refs: the sticky notes

**MAYA:**
So we've got this warehouse full of immutable, fingerprinted boxes — blobs, trees, commits, all frozen forever. But you opened the show by saying there's a "current version." If everything's immutable, how does anything ever become current? How does the pointer move?

**THEO:**
The sticky notes. The refs. This is the *only* mutable thing in the entire system, and it's deliberately tiny. A ref is a name pointing at a fingerprint. That's the whole data structure. There's a second table, `VcsRefs`, and a row in it is basically: this repo, this name, this kind, points at this commit fingerprint.

**MAYA:**
And there are two kinds.

**THEO:**
Two kinds, and the difference between them is the entire governance model. A **branch** is a *mutable* sticky note. The name `main`, or `draft/01`, pointing at a commit. When you make a new commit, you peel the branch sticky note off the old commit and stick it on the new one. The commits never moved — they're immutable — but the *label* "main" now points somewhere newer. That's how "current" advances without anything ever being overwritten.

**MAYA:**
So "the current version" is literally just: follow the `main` sticky note, see which commit it's on, that commit points at a tree, the tree lists the blobs. That's the part.

**THEO:**
That's the entire read path. Ref to commit to tree to blobs. Four hops and you've reconstructed any version. And the *second* kind of sticky note is a **tag** — and a tag is *write-once*. Once you place it, it can never move. The function that creates them, `createTag`, literally throws an error if a tag of that name already exists. You cannot overwrite it. You cannot move it. It's nailed down.

**MAYA:**
And tags are for releases.

**THEO:**
Tags are for releases. When you cut revision `01` or revision `A` of a part, you place a tag with that name on the exact commit you released. And because the tag can never move and the commit it points at can never change its contents — content addressing again — you have an iron-clad guarantee: revision `A` is *this* geometry, byte for byte, forever. Nobody can quietly re-point `A` at a newer commit. The write-once tag plus the immutable commit is the regulatory backbone. When an auditor asks "prove revision A hasn't changed since you released it," the answer is "the tag is write-once and the commit is content-addressed — it's not that we *won't* change it, it's that we *can't*."

**MAYA:**
And there's a third operation on refs — you mentioned deleting?

**THEO:**
`deleteRef`. And here's the subtle, lovely thing: deleting a ref removes only the *sticky note*. The boxes it pointed at — every commit, every tree, every blob in that branch's history — stay right where they are in the warehouse. This is how we "archive" a branch. You don't trust some experimental branch anymore, you peel its sticky note off. The history doesn't vanish; it just stops having a convenient label. If those same commits are reachable from another branch, they're still fully alive. Objects are never deleted. Only pointers.

**MAYA:**
That's a really different mental model from deleting a file. Deleting the label versus deleting the thing.

**THEO:**
And it's *safe* in a way file deletion never is. The worst thing an archive can do is make some commits temporarily hard to find. It can never destroy them. In a system where a part might be a medical device component, "the worst case is you lose a label, never the data" is exactly the safety property you want.

**MAYA:**
One more thing on refs — you keep saying "this repo." Where does the repo come from? What *is* a repo here?

**THEO:**
Great catch, because it's not what you'd guess. Every ref and every object is scoped to a repo, and a repo is just a pair: a type and an id. The type is `cad` for parts, `assembly` for assemblies. And the id — this is the clever part — the id is the *part lineage root*.

**MAYA:**
Lineage root. Unpack that.

**THEO:**
In the manufacturing side of this app, when you cut a new revision of a part, you actually get a *new database row* for the part. Revision `01` is one `Parts` row, revision `02` is another, linked by a `previousRevisionID` pointer back to its predecessor. So a part isn't one row — it's a chain of rows.

**MAYA:**
And if you keyed the version history to a single row...

**THEO:**
...then every time manufacturing cut a revision, the CAD history would *fork* into a brand new empty repo and you'd lose continuity. So instead, there's a function — `repoForModel` in `cadVcsService.js` — that walks that `previousRevisionID` chain all the way back to the *original* part row, the lineage root, and uses *that* id as the repo id. With a cycle guard, in case the data's corrupt and the chain loops. So no matter which revision row you're sitting on, you resolve to the same repo, and the entire history — across every manufacturing revision — is one continuous, unbroken story.

**MAYA:**
So the repo follows the *part*, the real-world part, not the database bookkeeping of how many times it's been revised.

**THEO:**
The repo follows the *thing*. The platonic part. That's REQ 688 if anyone's keeping score, and it's the bit of glue that makes the abstract git store line up with the messy reality of a manufacturing parts table.

## Segment 6 — Serializing a CAD doc into the tree

**MAYA:**
Let me make sure I can build the bridge. We've got this generic store — blobs, trees, commits, refs — knowing nothing about CAD. And we've got a CAD model, which is, what, a feature tree and some sketches. How does one become the other? Who translates?

**THEO:**
One file. `cadSerializer.js`. Two functions — `cadSerialize` and `cadDeserialize` — and they are the *only* CAD-aware code anywhere near the object store. Everything else upstream is generic. This is the membrane between "CAD document" and "git tree."

**MAYA:**
And a CAD document is...?

**THEO:**
Three things, bundled: the `featureTree` — your ordered list of features — the `sketchDoc` — your sketches keyed by id — and `equations` — the parametric variables, like "width equals twice the height." That triple is the whole logical content of a part's design.

**MAYA:**
So how does `cadSerialize` turn that into a tree?

**THEO:**
It walks it and writes one blob per item. Every feature in the feature tree, in order, becomes its own blob, and gets a tree entry named `feature:` followed by its id. Every sketch becomes its own blob, entry named `sketch:` followed by its id — and it sorts those by key so the tree is deterministic. The equations object becomes one blob named `equations`. And then there's a fourth special entry: `meta`.

**MAYA:**
What's in meta?

**THEO:**
Meta is the reassembly instructions. Mainly it stores the feature *order* — the list of feature ids in sequence — because remember, order is semantic, and the tree alphabetizes its entry *names*, so I can't rely on entry order to reconstruct feature order. So meta records "the real order is f1, f7, f3." It also stashes any top-level bookkeeping that isn't a feature or a sketch — sequence counters, that kind of thing — so deserialization is perfectly lossless. The test for this is blunt: deserialize of serialize must deep-equal the original document, exactly. Round-trip with zero loss.

**MAYA:**
And the reason you split it into one-blob-per-feature instead of one-big-blob-for-the-whole-model — that's the dedup thing again.

**THEO:**
That's *everything*. If the whole model were one blob, then editing one feature would change the one blob, give it a new fingerprint, and you'd re-store the entire model every save. No sharing. But because each feature is its *own* blob with its *own* fingerprint, editing one feature changes exactly one blob plus the tree that lists it. The other thirty-nine blobs are byte-identical to last time, blend to the same fingerprints, and get deduplicated to nothing. Granularity *is* the efficiency.

**MAYA:**
And I'm guessing it's also what makes diff cheap. If each feature is separately fingerprinted, then comparing two versions is just comparing two lists of fingerprints.

**THEO:**
You're three segments ahead of me and I love it. Hold that exact thought, because it's the next segment. The per-feature granularity that makes storage cheap is the *same* property that makes diff cheap, which is the *same* property that makes cherry-pick possible. One design decision pays off in three completely different places. That's the sign you found the right abstraction — it keeps paying rent in rooms you didn't build it for.

## Segment 7 — Checkout, lock, check-in

**MAYA:**
Okay, but I'm still editing in a browser. I'm not thinking about commits and trees. I just open the part and start dragging things. Where does the git machinery actually touch my day?

**THEO:**
Through the working copy. So here's the layered picture. The thing you edit in the browser is backed by a database row — a `DesignCADModel` row. That row *is* your working copy. It's the document open on your desk. The commits in the store are the photocopies you've filed away. The row is live and mutable; the commits are frozen and permanent.

**MAYA:**
So the working copy is the one mutable, messy thing, and the history is the clean immutable record.

**THEO:**
Right. And the operations that move stuff between the two — checkout, check-in, undo, lock, history — those are written *once*, generically, in a factory called `makeWorkingCopy`, in `vcsWorkingCopy.js`. Same "write it once" gospel. CAD binds to it by handing over a little adapter: here's how to find my repo, here's how to serialize my document, here's how to apply a document back onto my row. Assembly hands over its own adapter. The checkout-and-lock logic itself is identical for both and lives in one place.

**MAYA:**
Let's walk a real session. I want to edit a part. Step one.

**THEO:**
Step one, you **check out**. And checkout does one critical thing beyond "let me edit": it acquires an *exclusive lock* on the branch, with your name on it. This is PDM-style — product data management — the standard CAD shop pattern. While you hold that lock, nobody else can edit this part. If somebody else tries to check it out, they get an HTTP 423 — "Locked" — and the error literally names *you* as the holder. "Maya has this checked out."

**MAYA:**
And that's to stop the clobbering problem from the top of the show.

**THEO:**
That's the whole reason locks exist. Two people editing one part, both hit save, one silently overwrites the other — that's the nightmare. The exclusive lock serializes it: one editor at a time, and everyone else can *see* who's holding it. No silent clobbering. The second person gets told, in plain language, who to go talk to.

**MAYA:**
What if the person who checked it out goes on vacation and forgets? Is the part locked forever?

**THEO:**
No, and this is a nice bit. The lock has a time-to-live. Default thirty minutes — configurable. When you check out, we stamp `lockExpiresAt` thirty minutes in the future. After that, the lock is *expired*, and an expired lock doesn't block anybody — the predicate that decides "is this locked by someone else" specifically checks that the lock is *unexpired*. There's also a background sweep, `sweepExpiredLocks`, that periodically bulk-clears stale locks across all rows. And on top of that, an admin can *force*-release a lock they don't hold — that's a more privileged route, gated behind the approve permission. So: holder can release, time can release, admin can force-release. Three escape hatches so a forgotten lock never bricks a part.

**MAYA:**
Good. So I'm checked out, I'm editing. I drag a face, I change a dimension. Is every drag a commit?

**THEO:**
No — and this is a distinction that matters a lot for keeping history clean. As you edit, the system **autosaves**. It persists your changes to that working-copy row constantly, so you never lose work, and it flips a `dirty` flag to remember there are uncommitted changes. But autosave does *not* commit. It doesn't create a snapshot. It's just keeping your desk from catching fire.

**MAYA:**
So autosave is "don't lose my work," and commit is "this is a milestone worth remembering."

**THEO:**
Perfectly put. Commits are deliberate. You reach a milestone — "okay, the mounting bracket is done" — and you **check in**, with a message. *That's* the snapshot. Check-in requires you to hold the lock, requires a message, then it does the whole pipeline we built: serialize your working document into a tree via `cadSerialize`, create a commit whose parent is the current branch head, advance the branch sticky note to the new commit, and clear the dirty flag. Now there's a permanent, named, fingerprinted photocopy in history, and your branch points at it.

**MAYA:**
Why split it that way? Why not just commit on every autosave and have a really detailed history?

**THEO:**
Because a history where every mouse-twitch is a commit is a history with no signal. You'd have ten thousand commits called "autosave" and zero way to find the moment the bracket got finalized. The split keeps the no-data-loss safety of autosave *and* keeps history meaningful — only the named checkpoints you chose. The docs put it well: users never lose in-progress work, but history contains only meaningful, named versions. Two different jobs, two different mechanisms, deliberately not merged.

**MAYA:**
One thing — does check-in release my lock?

**THEO:**
No. Deliberately not. You can check in five times in a row and keep the lock the whole time — you're still actively working. Releasing the lock is a *separate* action. The editor's UI usually does it for you after the check-in flow, but the underlying operation keeps them distinct. Check-in is "file a photocopy." Release is "hand the desk back."

**MAYA:**
And if I decide the whole session was a mistake?

**THEO:**
**Undo checkout.** It throws away everything since your last check-in. Mechanically: it clears the lock and the dirty flag, and — if there's a commit to roll back to — it re-reads that commit's tree, deserializes it, and slams it back over your working copy. So your row is restored to exactly the last filed photocopy, and the lock is handed back. If you'd never checked in at all — brand new part, no commits yet — it just unlocks, because there's nothing to roll back to. It's the "discard my changes and walk away" button, and because the last good state is an immutable commit, restoring it is trivially safe.

## Segment 8 — Branches and the protected main

**MAYA:**
We keep mentioning branches. `main`, `draft/01`. Let's do branches properly. What is a branch here, beyond a sticky note?

**THEO:**
At the storage level it really is *just* the sticky note — a mutable ref. But the *workflow* we built on top of branches is where it gets opinionated, and the opinions are strong. Here's the headline: **`main` is protected. You cannot edit `main`. Ever. Directly.**

**MAYA:**
Why? In normal git, `main` is just a branch like any other.

**THEO:**
In normal git, sure. But this is a manufacturing system, and `main` holds the *released* history — the revisions that real physical parts got built from. That history has to stay clean, linear, and auditable. So we made `main` read-only by rule. There's a function in the controller, `isLockedForEdit`, and it returns true whenever you're on `main` — full stop, independent of anything else. Checkout on `main`? Rejected, 423. Check-in on `main`? Rejected. Edits on `main`? Rejected. `main` advances *only* through the formal release flow, never by somebody dragging a face.

**MAYA:**
So if I can't edit `main`, where do I work?

**THEO:**
On a draft branch. And the system won't even let you forget. When you create a brand-new CAD model, `createForPart` does a little dance: it seeds an initial commit on `main` — `seedMain` — and then *immediately* auto-creates a branch called `draft/01`, switches your working copy onto it, and checks it out. So you land on `draft/01`, editable, from the very first second. You never even touch `main`. It's the protected official line; you live on drafts.

**MAYA:**
Hold on — `draft/01`. Where does the number come from? Is that the revision?

**THEO:**
It's the *derived* revision, and this is one of my favorite bits of cleverness, partly because it dodges a database landmine. A draft branch's displayed revision number is not stored anywhere. It's computed on the fly: take the highest released numeric revision that exists in the parts table for this part, and add one. That's `derivedDraftRev`.

**MAYA:**
Why derive it instead of just storing it?

**THEO:**
Because of that unique constraint on the parts table — name plus revision must be unique. If I minted a real `Parts` row for every draft branch, two concurrent drafts would both try to be revision `02` and collide. So no draft gets a parts row at all; the number is derived. And the side effect is beautiful: *every* concurrent draft shows the *same* number — "the next revision that would exist if I released." Three engineers, three drafts, all showing `draft/02`. Whoever releases first *claims* `02` — a real parts row gets created at release — and everyone else's derived number instantly bumps to `03`, because the max in the table moved. No collision ever, and the number floats correctly on its own.

**MAYA:**
That's slick. And it means the parts table stays the single source of truth for "what revisions really exist."

**THEO:**
The parts table is the oracle. The VCS derives from it; it never fights it. Now — the other branch operations. Create, list, switch, archive. Same gospel: written once, in `vcsBranchOps.js`, the `makeBranchOps` factory. Create a branch — defaults to branching off your current head. List the branches. Switch to another branch — which loads that branch's head document into your working copy. Archive — peel the sticky note.

**MAYA:**
Any guards on those?

**THEO:**
Two important ones. **Switch refuses while you're dirty** — 409 error. Because switching replaces your editable state with another branch's state, and if you've got uncommitted changes, switching would silently eat them. So we block it: check in or undo first, *then* switch. And **archive refuses on `main` and on your current branch** — you can't archive the official line, and you can't archive the branch you're standing on. Everything else is fair game.

**MAYA:**
And there was a detail about switching to `main` flipping a flag?

**THEO:**
Yes, and it's a tidy enforcement trick. When `switchBranch` moves you onto a branch, it sets a `releaseLocked` flag to true *only* if the branch name is `main`. So the instant you land on `main`, the working copy goes read-only, mechanically, without anyone having to re-check the branch name on every subsequent request. The protected-main rule gets enforced at the data level the moment you arrive, not re-litigated on every click.

**MAYA:**
There was also something about ids being random. You flagged it earlier.

**THEO:**
Right — feature and sketch ids are *globally random*, not sequential per document. And the reason is branches. Imagine ids were sequential — feature one, two, three. You branch off a part, and on each branch you add a new feature. On branch A it's "feature four," on branch B it's *also* "feature four" — but they're completely different features. Now when you try to merge those branches, the system sees two things both called "feature four" and conflates them. Catastrophe. Random global ids mean a feature created on branch A and a feature created on branch B have different ids no matter what, so a merge can tell them apart. The one exception is the origin feature, `f1`, which is a fixed shared seed every part starts with.

## Segment 9 — Diff: comparing two snapshots

**MAYA:**
Let's do diff, because you teased it and I want to see the payoff. I've got two snapshots — Tuesday's commit and Friday's commit. I want to know what changed. How?

**THEO:**
This is where all that per-feature granularity cashes out, and it's so clean it almost feels like cheating. The core is a function called `treeDiff` in `cadDiffService.js`. You give it two trees — two tables of contents — and it lines them up by entry name and compares fingerprints.

**MAYA:**
And because the fingerprint *is* the content...

**THEO:**
...comparing fingerprints *is* comparing content, but instantly. For each named entry — say `feature:f7` — there are four cases. Present in Tuesday but not Friday: *removed*. Present in Friday but not Tuesday: *added*. Present in both but the fingerprints *differ*: *modified*. Present in both with the *same* fingerprint: *unchanged*. And that last case is the magic one — if a feature's fingerprint is identical on both sides, I know it's unchanged *without ever looking inside it*. I don't deserialize it, I don't compare its fields, I don't touch the contents. Equal fingerprint, equal content, move on. So the cost of the diff scales with the number of things that actually *changed*, not the size of the model. A forty-feature part where you tweaked two features is a two-item diff, computed by comparing forty fingerprints, thirty-eight of which match instantly.

**MAYA:**
That's the "O of changes" thing again. The same property that made storage cheap and check-in cheap now makes diff cheap.

**THEO:**
Same property, third room, paying rent again. But "feature f7 changed" isn't enough for an engineer. They want to know *what* changed. So once `treeDiff` flags something as modified, a second pass — `attachEntryDetail` — opens just the changed boxes and digs in. For a modified feature or the equations, it computes a `paramDiff`: a field-level comparison. "Distance: 10 to 25." "Direction flipped." The actual old-value-to-new-value deltas. And it resolves a friendly display name — your feature's own name if it has one, otherwise a readable type label like "Extrude" or "Cut-Extrude" or "Fillet" — so the diff reads in human terms, not raw ids.

**MAYA:**
And sketches? A sketch is more complicated than a feature — it's a bunch of lines and constraints.

**THEO:**
Sketches get their own sub-diff, `sketchDiff`, because "the sketch changed" is uselessly vague. It indexes every entity — every line, arc, circle — by id, and every constraint by id, and classifies each one added, removed, or modified. And constraints carry their *values*, so a dimension edit reads exactly as "distance d1: 10 to 25." Not "the sketch is different" — the specific dimension, old and new. There's even a `meta` part that catches name and visibility changes. So a reviewer can see "you added two lines and changed one dimension from 10 to 25," precisely.

**MAYA:**
Is there a version of this for the *live* edits — the stuff I haven't checked in yet?

**THEO:**
`workingDiff`. Same machinery, but it diffs your *live working copy* against the commit you started from. It serializes your current document to a tree — same work as a check-in, minus actually committing — and diffs that against your base commit. That's what powers the check-in dialog: before you write your commit message, it shows you exactly what you're about to snapshot. "Here's what changed since you checked out." Review your own work before you file it.

**MAYA:**
You also mentioned a 3D diff. A visual one.

**THEO:**
Two flavors, and they go beyond the structural diff into actual geometry. `bodyDiff3D` regenerates the 3D shape of both commits and classifies each solid body — added, removed, modified, unchanged — where "modified" is decided by hashing the body's actual mesh data, its face positions and indices. And `faceNameDiff` is the pretty one: it returns the set of persistent face names from each commit, so the viewer can paint faces that exist only in the newer version *green* — added — and faces that exist only in the older version *red* — removed. You rotate the part and the change is right there in color.

**MAYA:**
Wait, "persistent face names" — why names? Why not just compare the geometry directly?

**THEO:**
Because a face can *move* without being a *different* face. If you make a part taller, the top face is in a new position but it's conceptually the same top face — it shouldn't light up as "removed and re-added." The persistent naming — which is a whole topic from the kernel episodes — gives each face a stable identity across edits. So a resized face keeps its name and reads as *unchanged*, while a genuinely new face gets a new name and lights up green. The color diff tracks *identity*, not raw position, which is what a human actually means by "what's new."

**MAYA:**
And regenerating the geometry for both commits — isn't that expensive? Running the kernel twice every time I open a diff?

**THEO:**
It can be, which is why there's a shortcut. The shared helper, `regenCommitGeometry`, checks: is this commit *frozen*? Released commits have their geometry frozen — stored as those binary geometry objects we mentioned. If it's frozen, we *load* the geometry straight from storage, zero kernel calls. Only un-frozen draft commits actually get regenerated. So diffing two released revisions touches the kernel *zero* times — it's all reading frozen bytes. That's the bridge into next week's episode, but the seam is right here in the diff service.

## Segment 10 — Merge, or rather, the deliberate refusal to merge

**MAYA:**
Okay. Branches. Two people, two parallel lines of work. Eventually somebody has to combine them. In normal git, you type `git merge` and it auto-merges. What happens here?

**THEO:**
Here's the strong opinion, and it's a *refusal*: there is no automatic merge. None. The system deliberately will not try to auto-combine two designs. There's no `merge` function that takes two branches and blends their trees.

**MAYA:**
That feels like a step *backward*. Git merges automatically all the time and it's great.

**THEO:**
For *text*, it's great — git merges line by line, and when two changes don't overlap it takes both. But a parametric CAD model isn't text, it's a dependency graph. Feature seven depends on the sketch from feature three, which depends on the datum from feature one. Blindly take "feature seven from branch A" and "feature three from branch B" and you can produce a model that references geometry that no longer exists and *regenerates into garbage* — looking fine until someone tries to manufacture it. Auto-merging a feature tree isn't safe, so we refuse to pretend it is. Reconciliation is *always* an explicit human choice.

**MAYA:**
Alright, I'll grant you that. So what are my actual tools?

**THEO:**
Two, both in `cadBranchService.js`. The small one is **cherry-pick**. You grab *one specific feature* from another branch's commit and splice it into your working copy. Just that one feature — and the sketches it needs come along automatically.

**MAYA:**
How does it know which sketches it needs?

**THEO:**
A helper called `referencedSketchIds`. It scans the feature for any field that references a sketch — a `sketchId`, a list of `sketchIds`, anything whose field name ends in "sketchId." It collects all of those, and pulls those sketches over too. Because a feature without its sketches is broken — an extrude with no profile is nothing. So cherry-pick is atomic: the feature *plus* its sketch dependencies, spliced in, working copy marked dirty. No commit — you review it and check in yourself. It's "I like that one improvement from the other branch, give me just that."

**MAYA:**
And the bigger tool?

**THEO:**
The bigger tool is the **feature-level merge**, and it exists for one specific, very common situation: your branch has fallen *behind* `main`. Picture it: you branched off `main` two weeks ago and you've been working. Meanwhile someone else finished *their* draft and released it — so `main` advanced. Now your branch is "behind main" — it doesn't have the latest released changes. And the system *blocks you from releasing* until you reconcile, because releasing a stale branch would clobber the changes that already shipped.

**MAYA:**
How does it even know I'm behind?

**THEO:**
`behindMain`. It walks your branch's ancestry — all the commits you can reach going backward — and asks: is `main`'s current head commit *in* that set? If `main`'s tip is one of your ancestors, you're up to date — you already contain it. If it's *not* in your ancestry, then `main` moved somewhere you haven't incorporated, and you're behind. Simple reachability check over the commit DAG. And `main` itself, by definition, is never behind.

**MAYA:**
So I'm behind. I hit merge. What happens?

**THEO:**
This is the careful part — `reconcileBranch`, built on `mergedReconcileDoc`. And the *direction* matters. It does not start from your branch and pull main in. It starts from **main's current document** — main's latest, the freshest released state — and then splices *your* selected changes on top.

**MAYA:**
Wait, back up. Why start from main and add my stuff, rather than start from my stuff and add main's?

**THEO:**
Because what you actually want is "main's latest *plus* my specific changes." If you started from your branch and tried to layer main's changes in, you'd risk your stale versions of shared features overwriting main's newer ones — last-writer-wins, blunt, dangerous. By starting from main's current doc as the base, main's latest is *guaranteed* to be the foundation, and you selectively add only the features and sketches that are genuinely *yours*. The user was explicit about this: "main's latest plus my specific changes," not a blunt overwrite.

**MAYA:**
And "selectively" — that's the checklist you mentioned earlier.

**THEO:**
The merge tool lists *every* feature and *every* sketch that differs between main and your branch — added, removed, or changed — and pre-ticks all of them by default. That's a full merge: take all my branch changes. But you can untick any item to say "actually, keep main's version of *that* one." For each thing you keep ticked: if your branch has that feature, it gets spliced into the base, with its sketches; if your branch *deleted* it, it gets removed from the base — a deletion is a change too. Unticked items just keep main's version. Then it commits the result onto your branch with a crucial detail — the parent is *main's head*.

**MAYA:**
Why does the parent being main's head matter?

**THEO:**
Because that's what makes you *no longer behind*. The new commit's parent is main's tip, so main's tip is now in your ancestry — `behindMain` flips to false — and you're cleared to release. You incorporated main's history *and* your chosen changes in one commit. It's a real merge commit in the DAG sense, just one whose *contents* were assembled by deliberate per-feature selection instead of automatic blending.

**MAYA:**
And there's a 3D preview before I commit?

**THEO:**
Yes — `mergedReconcileDoc` builds the merged document *without* committing, precisely so the editor can render a live 3D preview of "here's what you'll get." You see the result, with any per-feature regeneration errors flagged, *before* you pull the trigger. And the docs are honest here: there *is* an older `rebaseBranch` function that does the blunt whole-tree last-writer-wins thing. It still exists. But the UI deliberately drives the careful feature-level merge instead, because the surgical version is the one that's actually safe for a parametric model.

**MAYA:**
I really like that the headline feature is a *refusal*. "We don't auto-merge." Most systems would be embarrassed to say that.

**THEO:**
I think it's the most honest thing in the whole subsystem. Auto-merge for CAD is a promise you can't keep. Better to give the engineer a precise, previewable, per-feature tool and a clear rule — than to give them a magic button that's right eighty percent of the time and silently ships garbage the other twenty.

## Segment 11 — The history graph

**MAYA:**
Last piece. All these commits and branches — how does it become something I can actually *look at*? A picture of my part's history?

**THEO:**
`cadGraphService.js`, function `buildGraph`. It assembles the whole family tree of your part's snapshots in one shot, ready to render with no further database round-trips. The algorithm's a nice tour of everything we built today, so let me walk it.

**MAYA:**
Go.

**THEO:**
Step one: list every branch ref, and from each branch's tip, *walk* the ancestry backward — that's the `walk` primitive, breadth-first over parents, deduplicating shared ancestors as it goes. Union all those commits into one big map, so every commit reachable from any branch is collected exactly once.

**MAYA:**
And the deduplication matters because two branches share most of their history.

**THEO:**
Right — they diverge from a common point, so walking both would hit the shared trunk twice. The dedup collapses that. Step two is **lane assignment**, which is what gives you the visual columns. Everything reachable from `main` gets the `main` lane. Anything reachable *only* from some other branch — never from main — takes that branch's name and gets rendered in an "experiment" lane. So on screen, the official released line is one column, and the experimental side-branches sit off to the side. You see at a glance which work is on the trunk and which is off exploring.

**MAYA:**
Step three?

**THEO:**
Tags. List every tag ref, index them by which commit they point at. Those are your release markers — a commit with a tag gets a "released" badge and is marked state `released`; everything else is `draft`. Step four: resolve the authors. Every commit has an author id; we batch-fetch all the distinct users in *one* query — not one query per commit, which would be brutal on a long history — and attach each author's name and a little initials badge, "AL" style, generated from their display name.

**MAYA:**
And then it assembles the nodes.

**THEO:**
Each commit becomes a node carrying everything the UI needs: the full hash and a short four-character prefix for display, the parent hashes so the front end can draw the connecting lines of the DAG, the message, the timestamp, which branch it's on, its lane, any release tags, whether it's the current HEAD, the resolved author, and that released-or-draft state. HEAD, by the way, is just "which commit is the working copy's base" — the commit you're currently sitting on top of — falling back to main's tip. Then it sorts everything newest-first by timestamp and hands back a tidy bundle: the head, the list of branches with their tips, and the ordered nodes.

**MAYA:**
And the front end turns that into the actual screen.

**THEO:**
`cad-revision-list.component.ts`. Four views you toggle between. **Graph** — the visual family tree, with little thumbnail previews on each commit. **Diff** — pick any two commits, get the structural diff we built, with the green-and-red face coloring and the two 3D previews side by side. There's even a camera-lock toggle so when you rotate one preview, the other follows, locked together — and you can unlock them to inspect independently. **Log** — a plain commit table for people who want rows, not pictures. And **Branches** — the management tab: every branch with its head, the current one marked, and the create / open / merge / archive actions.

**MAYA:**
And "open version" — that's the read-only time machine?

**THEO:**
That's the one. Pick any past commit, hit "Open version," and it loads that exact historical snapshot full-screen in the editor — the feature tree, the full 3D, everything — but *read-only*. Editing tools switched off, a banner reminding you "this is a historical version." It reconstructs the document straight from that commit's tree, and — critically — it never touches your working copy or your current branch. You can wander around revision `A` from eight months ago in full 3D, then close it, and your live work is exactly where you left it. Look without any risk of touching.

**MAYA:**
And mechanically, "open version" is just... ref to commit to tree to blobs, the read path you described an hour ago.

**THEO:**
That's the whole thing. There's an endpoint, `getCommitDoc`, that takes a commit hash, deserializes its tree back into a feature tree and sketches and equations, and ships it to the editor. The exact same four-hop read path, the exact same `cadDeserialize`, the exact same machinery as everything else. Once you've got content-addressed commits, "open any version read-only" isn't a feature you build — it's a thing you get for free, because *every* version is just a commit you can deserialize. The whole history is uniformly addressable.

## Segment 12 — The honest footguns

**MAYA:**
Before we recap — you promised at the top you'd tell me the embarrassing parts. Pay up.

**THEO:**
Fair. The biggest one is a real bug we shipped and had to fix, and it's a perfect lesson in ordering. The release flow — which is mostly next episode — has to do two things: create the release commit and place the write-once tag, *and* advance the `main` sticky note. The first version did them in the wrong order: it advanced `main` *first*, then went to place the tag, and only *then* checked whether that tag already existed.

**MAYA:**
And if the tag already existed — like a double-click, or a race?

**THEO:**
Then it threw the error — but `main` had *already moved*. So you'd get an orphaned duplicate commit, `main` marched *past* the actually-tagged commit, and the history graph showed an untagged duplicate as the head while the released badge sat buried on an ancestor. The working copy's idea of where it was diverged from where `main` actually pointed. A genuine mess.

**MAYA:**
What was the fix?

**THEO:**
Reorder. Check whether the tag exists *up front*, before mutating anything, and create the tag *before* advancing `main`. That way, if there's a race, the worst case is a harmless unreachable commit object floating in the store that nothing points at — and unreachable objects are fine, they're just dead weight. They never corrupt the visible history. The principle: do the thing that can *fail* — the write-once tag check — before the thing that *mutates shared state* — moving `main`. Validate, then commit. Order your side effects so a failure leaves garbage, never corruption.

**MAYA:**
That's a good one. Any others?

**THEO:**
A smaller one in the merge reconcile — careful bookkeeping around dedup and tracking which features you've already "seen" while you splice, so a feature in both main and the branch doesn't get applied twice. The kind of off-by-one swamp any tree-merge code wades through.

And the broader honest note: a chunk of this is *reserved seams*, not finished features. The `component` object kind for assemblies referencing other parts' commits — validated in the model, waiting on the assembly editor. Cross-repo tables, `VcsChangeset` and `VcsUsage`, for atomic multi-part check-ins and a where-used index — wired but trivially empty for single parts today. We built the store domain-blind specifically so those seams *could* exist, but I won't pretend they're all carrying weight yet.

**MAYA:**
I appreciate you drawing the line between "shipped and load-bearing" and "scaffolded for later."

**THEO:**
It's the only honest way to talk about a system this size. The git core — objects, trees, commits, refs, canonical hashing, checkout, check-in, branches, diff, the feature-level merge, the graph — that's all real, tested, and running. The assembly cross-repo machinery is the next frontier. Same store, more bindings.

## Recap

**MAYA:**
Let me try to land this. Four things I'm taking away.

One: **there is no save and no "current version" — the database *is* the history.** Every object — feature, sketch, snapshot — is a box in a warehouse labeled with a SHA-256 fingerprint of its own contents. Identical content gets an identical fingerprint, so it's stored exactly once. The "current version" is just a sticky note — a ref — pointing at one of those frozen boxes.

**THEO:**
And that one fact — the fingerprint *is* the address — gives you dedup, tamper-evidence, and immutability all at once, for free, as a side effect of the same mechanism.

**MAYA:**
Two: **canonical JSON is the tiny linchpin the whole thing balances on.** Sixty-two lines that sort object keys and reject the values that would let two different things collide on one fingerprint. Equal meaning must give equal bytes, both directions, or content addressing is a lie.

**THEO:**
The smallest file, the heaviest job.

**MAYA:**
Three: **per-feature granularity pays rent in three rooms.** Because each feature is its own fingerprinted blob, editing one feature re-stores only that one — cheap *storage*. Comparing two versions is just comparing fingerprints, unchanged things skipped instantly — cheap *diff*. And you can splice one feature into another branch — *cherry-pick*. One design decision, three payoffs.

**THEO:**
That's the sign you picked the right seams. The abstraction keeps paying off where you didn't plan it.

**MAYA:**
And four: **the system refuses to auto-merge, on purpose, and protects `main` on purpose.** You never edit the official released line directly — you live on draft branches, with a derived revision number that floats correctly across everyone. And reconciliation is always a deliberate, previewable, per-feature choice — start from main's latest, add your specific changes — because auto-merging a parametric model is a promise you can't keep.

**THEO:**
Refusing to do the unsafe magic thing is, weirdly, the most senior decision in the whole subsystem.

**MAYA:**
And the whole thing is *written once* and bound twice — generic git store, CAD binding, assembly binding — which is why the same machinery will version a five-thousand-part assembly the same way it versions a single bracket.

**THEO:**
You could host this show.

**MAYA:**
I literally do.

## Teaser

**MAYA:**
Next episode, we finally open the box we kept pushing to the side of the table all night: **freeze and release.** What does it actually *mean* to release revision `A` of a part — to take a draft branch and turn it into a permanent, manufacturable, frozen-forever record? We've talked about write-once tags as the regulatory backbone, and about diffs that touch the kernel *zero* times because the geometry's frozen. Next time we find out exactly what gets frozen, how those binary geometry objects get stored and deduplicated, why a released commit can be diffed and re-opened without ever running the kernel again — and how the self-service development release and the approval-gated production release fit together with the manufacturing parts table.

**THEO:**
It's where the git machinery meets the real, regulated, physical world. The moment a fingerprint becomes a part number.

**MAYA:**
The moment software becomes steel. Thanks for listening — we'll see you next time.

**THEO:**
Bring a magnet.

[both laugh]

---

# Episode 10 — Freeze and Release

## Cold open

**THEO:**
Here's a sentence I want you to sit with, because it sounds impossible. A released part never calls the kernel again. Ever. You open revision A of a bracket from eight months ago, you spin it around in full 3D, you export it to a manufacturing file — and at no point does the geometry engine run. Not once.

**MAYA:**
Hold on. The geometry engine is the whole thing that turns the recipe into a shape. We spent an entire episode on it — the Rust service, the OCCT booleans, the persistent face names. And you're telling me when I open a released part, that machine just... doesn't fire?

**THEO:**
Doesn't fire. Sits there idle. You could turn it off entirely — unplug the kernel, delete the container — and every single released revision in the system would still open, still render, still export to STL and STEP, byte for byte identical to the day it shipped.

**MAYA:**
That can't be right. The shape has to come from *somewhere*. If the kernel didn't compute it, what's drawing the triangles on my screen?

**THEO:**
A photograph. We took a photograph of the geometry at the moment of release and filed it permanently. When you open the release, you're not recomputing the part — you're unwrapping the photograph. And today I want to convince you that this isn't a performance hack. It's a *correctness* requirement. For a regulated shop, a part you can recompute is a part you can't trust.

**MAYA:**
Okay. "A part you can recompute is a part you can't trust." That's the most backwards thing you've said all season, and I need you to walk me all the way back from it.

## Intro

**MAYA:**
Welcome back. I'm Maya, this is the show, and if you've been with us through Season 2 you know the deal by now: we take a real browser-based CAD system bolted onto a manufacturing app, and we open it up and stare at the gears. Last episode was the big one — content-addressed version control, the tiny git we built and taught to speak CAD. Warehouse of fingerprinted boxes, sticky notes for the current version, write-once tags for releases.

**THEO:**
And I'm Theo, I built it, and last episode I kept saying "that's next week's episode" every time geometry freezing came up. We must have deferred it four times.

**MAYA:**
Five. I counted.

**THEO:**
Five. So this is the box we kept pushing to the side of the table. Today is freeze and release. What it actually *means* to take a draft and turn it into a permanent, manufacturable, frozen-forever revision of a real physical part. The moment, as we said last time, that a fingerprint becomes a part number.

**MAYA:**
And I want to do this in a specific order, because there are really three intertwined things here and I keep wanting to conflate them. There's *freezing* — the photograph. There's *release* — the act of cutting a revision. And there's a whole *review and approval workflow* sitting next to it. They're separate machines that click together.

**THEO:**
Three machines, one ceremony. Let's start with the photograph, because everything else hangs off it.

## Segment 1 — Why a recipe isn't enough

**MAYA:**
So back up to the cold open. "A part you can recompute is a part you can't trust." Defend that. Because intuitively, a recipe feels *more* trustworthy than a photo. The recipe is the truth. The photo is just one rendering of it.

**THEO:**
That's the intuition, and it's exactly the intuition that gets a regulated shop in trouble. Let me lay out what a draft part actually *is* in this system, because we built it this way deliberately. A part is a recipe — an ordered list of features. Sketch a rectangle, extrude it ten millimeters, cut a hole, fillet an edge. While you're designing, the 3D shape you see on screen is computed *fresh from that recipe every single time you open it.* Nothing is stored. You open the part, the kernel re-runs the whole recipe, and out comes the body.

**MAYA:**
Which is great, because it always reflects my latest edits.

**THEO:**
Perfect for a draft. The instant you nudge a dimension, the shape updates, because the shape is always recomputed. There's no stale cached version lying around to get out of sync. Live recipe, live geometry. But now think about what "recompute from the recipe" actually depends on.

**MAYA:**
It depends on the kernel. The thing doing the computing.

**THEO:**
It depends on the kernel, and the kernel is *software*, and software changes. We ship a new version. We upgrade the OCCT library underneath it. We fix a bug in how a fillet gets blended. And here's the thing that should make your stomach drop a little: the *exact same recipe*, run through a *newer kernel*, can produce a *slightly different shape*.

**MAYA:**
Wait, really? The same numbers, the same steps, and the answer changes?

**THEO:**
It can. Geometry kernels do a staggering amount of floating-point work — intersecting surfaces, blending fillets, healing little gaps. Different versions make different micro-decisions. Usually the difference is invisible, a tessellation a hair finer, a blend a micron different. But "usually invisible" is not "guaranteed identical," and for a controlled, shipped revision of a medical-device component, "usually invisible" is a four-alarm fire.

**MAYA:**
Because revision A is a physical thing. Somebody machined metal to it. There are barcodes, work orders, a bill of materials, all pointing at "revision A of this part."

**THEO:**
And if revision A's geometry can *drift* — if opening it next year through a newer kernel gives you a subtly different shape than the one you actually built and shipped — then the documentation no longer matches the steel. The whole point of a revision is that it's *fixed.* Frozen. The number on the drawing means one exact shape forever. A recipe, by itself, doesn't give you that, because the recipe's output is hostage to whatever kernel happens to evaluate it.

**MAYA:**
So that's the inversion. The draft trusts the recipe *because* it wants to track changes. The release distrusts the recipe *because* it wants to never change.

**THEO:**
You nailed it, and there's one more nail. Remember from the kernel episodes — the computed BRep, the boundary representation, the actual solid-body data — that's *cached*, but the cache is *evictable*. We can throw it away to save space and recompute it on demand. Which is fine for a draft. But it means a released part's geometry, if we only kept the recipe, would be sitting on top of two things that are both unstable: an evictable cache and a moving kernel. The requirement that drives all of this — it's REQ 684 — says it plainly: the BRep cache is evictable and the kernel changes between versions, so a released revision is *not otherwise reproducible.* You have to freeze it.

**MAYA:**
"Not otherwise reproducible." That phrase is doing a lot of work.

**THEO:**
It's the whole thesis. Reproducibility isn't free. If you want a revision that produces the identical geometry every time, forever, immune to kernel upgrades, you cannot lean on recomputation. You have to capture the answer once and store the answer itself, not the question.

## Segment 2 — What freeze actually captures

**MAYA:**
Okay, I'm sold on *why.* Now the *what.* You keep saying "photograph." Be precise. When you freeze, what literally gets stored?

**THEO:**
Two things, per body. And let me define "body" first, because a part can have several. A body is one solid lump of material. Most brackets are one body. But a part might have two separate chunks that aren't touching — that's two bodies. Freeze operates per body. For each one, we store two artifacts.

**MAYA:**
Artifact one.

**THEO:**
Artifact one is the **BRep** — the boundary representation. This is the *real* geometry, the exact mathematical description of the solid. Every surface, every edge, every vertex, the precise curves and how they're stitched together into a watertight solid. This is the thing OCCT works in, the thing you'd export to a STEP file and machine from. It's the truth of the shape, down to the last micron. We store it as raw bytes.

**MAYA:**
And artifact two.

**THEO:**
Artifact two is the **mesh** — a tessellated snapshot. The BRep is exact but it's heavy and it's not something a web browser can draw directly. So we also store a triangle mesh: the shape approximated as a big bag of flat triangles, which is exactly what a 3D viewer renders. Positions, indices, the face groupings, the persistent face names so the viewer can color and pick individual faces. The mesh is the *renderable* version — what you actually see spinning on screen.

**MAYA:**
So BRep is for the math — exports, manufacturing — and mesh is for the eyes — the viewer. Why store both? Why not just keep the BRep and re-tessellate when someone opens it?

**THEO:**
Because re-tessellating means calling the kernel. And the kernel is the thing we're trying to never call again. If I kept only the BRep and re-meshed it on open, I'd be back to "the kernel ran, and a different kernel might mesh it differently." By storing the mesh *too*, opening a release reads the exact triangles we captured at release time. Zero computation. The viewer just unwraps the bag of triangles and draws them.

**MAYA:**
Right — and the BRep is there for when someone genuinely needs the exact math, like an export.

**THEO:**
Exactly — and even the export reads the *frozen* BRep, not a recomputed one. So both artifacts exist so that *every* consumer, viewer or exporter, reads stored bytes and never triggers a regen. Now — here's where last episode pays off. How do we store these two artifacts?

**MAYA:**
Content-addressed. Fingerprint of the contents is the address. The warehouse.

**THEO:**
Both of them go into the exact same content-addressed store we spent all of last episode on. The mesh snapshot gets stored as a *blob* — fingerprinted, deduplicated. Each body's BRep gets stored as a *geometry* object — that's one of the six box kinds I listed last time, the binary one — via `putBinary`, fingerprinted over its raw bytes. So freezing isn't some separate storage mechanism. It's the same warehouse, same fingerprints, same dedup, same immutability physics. The frozen geometry is *just more content* in the store.

**MAYA:**
And so the dedup story applies. If two revisions have a body that didn't change—

**THEO:**
—the BRep bytes are identical, blend to the same fingerprint, get stored exactly once. Revision 02 that only touched one feature out of forty? The bodies that didn't change share their frozen BReps with revision 01 for free. The freeze of a barely-changed part is almost entirely no-op stores. Same property, paying rent in yet another room.

## Segment 3 — The snapshot shape, and what it leaves out

**MAYA:**
You said the mesh snapshot is stored "without the BReps." But you also just said BReps get stored. I'm confused — are the BReps in the snapshot or not?

**THEO:**
Good catch, this is a real subtlety and there's a file where it lives. The snapshot — the mesh blob — deliberately does *not* contain the BReps. The BReps are stored *separately*, one binary object per body. The snapshot is the mesh-and-metadata part; the BReps are siblings next to it. They get glued back together only when you load.

**MAYA:**
Why split them? Why not one big blob with everything?

**THEO:**
Two reasons, and they're both about content-addressing being honest. First — and this is the function `meshSnapshot` in `cadFreezeService.js` — the snapshot has to be *content-stable.* It has to be the case that the same geometry always produces byte-identical snapshot. So `meshSnapshot` is ruthless about what it keeps. It keeps the features — each one's id, its body id, its faces with their positions and indices and persistent names, the topology, any error. It keeps a little list of bodies with their ids and names. It keeps the errors list. And then it *strips* everything that isn't content-stable.

**MAYA:**
Strips what, specifically?

**THEO:**
The BRep strings — those go to their own binary objects. And the per-feature cache flags — little bookkeeping booleans like "was this feature served from cache this time." Those flags depend on *runtime state*, not on the geometry. If I left a cache flag in the snapshot, then the *same shape* computed two different ways — once fresh, once from cache — would produce two *different* snapshots, two different fingerprints, and dedup would break. So `meshSnapshot` surgically removes anything that's about *how* the geometry was computed rather than *what* the geometry is.

**MAYA:**
Ahh. It's the canonical-JSON obsession from last episode, wearing a different hat. Strip every source of nondeterminism before you fingerprint.

**THEO:**
It's *exactly* the same discipline. Last episode it was sorting object keys and rejecting NaN. Here it's dropping cache flags and pulling out the BReps. Same goal: equal geometry must produce equal bytes, so it dedups and so a release is byte-stable. The docs even spell out the exclusion list — "BRep strings, per-feature cache flags, anything that is not content-stable or that is stored separately as binary." That last clause is the BReps.

**MAYA:**
And the second reason for splitting?

**THEO:**
Size and dedup granularity. BReps are *big* and they're binary. The mesh metadata is comparatively small JSON. By keeping them separate, a change that touches the mesh but not the underlying BRep — or vice versa — only re-stores the part that changed. And the binary BReps dedup independently per body. It's the same per-feature-granularity argument from last episode, applied one level down to the geometry artifacts. Fine-grained boxes share more.

**MAYA:**
So when I freeze, the output is — what's the actual data structure that gets recorded?

**THEO:**
A little manifest. `freezeGeometry` returns an object that's basically two fields: `meshHash` — the fingerprint of the mesh snapshot blob — and `bodies` — a list, one entry per body, each entry being a `bodyId` and a `brepHash`, the fingerprint of that body's frozen BRep bytes. That's it. That tiny manifest is the index. It says "the frozen mesh is at fingerprint X, and the frozen BReps are at fingerprints Y, Z, W, one per body."

**MAYA:**
And that manifest goes... where? It has to be attached to the release somehow.

**THEO:**
It goes into the commit. Specifically, into the commit's metadata, in a field called `frozen`. Remember from last episode, a commit carries metadata — author, message, timestamp, parents. We add one more field on a release commit: `meta.frozen`, and its value is that little manifest. `{ meshHash, bodies: [...] }`. So the release commit doesn't *contain* the geometry — it *points* at the frozen geometry by fingerprint, the same way a tree points at blobs. The commit says "my frozen geometry is over there, at these addresses."

**MAYA:**
And that's the flag. The presence of `meta.frozen` is how the system later knows "this commit is frozen, load the photo" versus "this is a draft, recompute."

**THEO:**
That's the entire switch. One field. If `meta.frozen` is set, you're looking at a release, load the stored geometry. If it's absent, you're looking at a draft, run the kernel. We'll see that branch in a second — it's a single `if`.

## Segment 4 — Load: reconstructing without the kernel

**MAYA:**
Okay. So I open a released revision. Walk me through what happens, mechanically, that *doesn't* involve the kernel.

**THEO:**
Three functions, all in the freeze factory, and I want to name the factory because it's the same pattern as everything in this system. The file is `vcsFreeze.js`, and the export is `makeFreeze` — a *factory*. It's written once, generically, knowing nothing about CAD, and then CAD *binds* it by supplying three callbacks. Just like `makeWorkingCopy` and the rest from last episode. Write the hard machinery once, bind it per domain.

**MAYA:**
What are the three callbacks CAD supplies?

**THEO:**
`regen` — "here's how to compute geometry from my model," which for CAD calls the kernel via `cadRegenService.regenerateModel`. `snapshot` — "here's how to strip my geometry down to a content-stable mesh," which is that `meshSnapshot` function we just dissected. And `reconstruct` — "here's how to glue stored BReps back onto a loaded snapshot." Three functions. CAD supplies its versions, assembly supplies its versions, and the factory wires them into the actual storage operations.

**MAYA:**
And the storage operations are the three you keep mentioning. Freeze, load, and the dispatcher.

**THEO:**
Right. `freezeGeometry` we covered — regen once, store mesh blob, store per-body BReps, return the manifest. Now the *load* path, which is the magic one. `loadFrozenGeometry`. You hand it the repo and that little `frozen` manifest from the commit. It does exactly two reads and one glue.

**MAYA:**
Walk it.

**THEO:**
Read one: fetch the mesh blob by its `meshHash`. That's a content-addressed lookup — fingerprint in, bytes out. Now you've got the mesh snapshot, the bag of triangles and face metadata. Read two: for each body in the manifest, fetch its BRep bytes by `brepHash`. Another content-addressed lookup per body. Now you've got all the BReps. And then the glue: call `reconstruct`, which takes the snapshot and a map of body-id to BRep, walks the snapshot's body list, and re-attaches each body's BRep by matching `body.id`. Out comes the full renderable geometry — mesh *and* BReps — exactly as it was at freeze time.

**MAYA:**
And the kernel?

**THEO:**
Never touched. Two storage reads and a merge. The docs are blunt about it — "stored objects only, zero kernel calls." That's REQ 685. There's no floating-point geometry work happening. We're just reading bytes we wrote at release time and stapling them back together.

**MAYA:**
And `reconstruct` does one more thing — you mentioned it marks something.

**THEO:**
It sets a flag, `frozen: true`, on the reconstructed geometry. So anything downstream — the viewer, an exporter — can tell "this geometry came from frozen storage, not a live regen." It's a little honesty marker that travels with the data. And then the third function, the dispatcher, `geometryForCommit` — this is the single `if` I promised. You give it a commit. It looks at the commit's `meta.frozen`. Is it set? Call `loadFrozenGeometry`, return the photo. Is it absent? It's a draft — call `regen`, run the kernel live. One branch decides the entire reproducibility story.

**MAYA:**
That's beautifully small. The whole "released parts never call the kernel" claim comes down to: there's a manifest in the commit meta, and a dispatcher that checks for it.

**THEO:**
The whole claim. And because that dispatcher is in *one* place, *everybody* gets the behavior for free. The viewer opening a version, the diff service comparing two commits, the exporter generating an STL — they all go through `geometryForCommit`, and they all get "frozen loads, draft regens" without ever thinking about it. Remember last episode, the diff that touched the kernel zero times when diffing two releases? *This* is why. The diff's geometry helper calls `geometryForCommit`, sees both commits are frozen, loads both from storage. Same dispatcher.

**MAYA:**
And drafts still regen, which is the point — a draft should reflect my live edits and the current kernel.

**THEO:**
That's the symmetry that makes it correct, not just fast. Drafts *must* regen — they're live, you want the newest kernel and your newest edits. Releases *must not* regen — they're frozen, you want the exact bytes from release day. The dispatcher enforces both halves with one check. Reproducibility for the frozen, liveness for the draft.

## Segment 5 — Thumbnails: the picture before the picture

**MAYA:**
Before we get to release proper, there's a smaller thing I want to nail down, because you mentioned a "photograph" and I think there are actually *two* kinds of picture floating around here. There's the frozen mesh, which is the real 3D you load. And there's... a thumbnail?

**THEO:**
Two completely different pictures, yes, and it's worth keeping them straight. The frozen mesh is the full interactive 3D — it's the thing you spin around. The thumbnail is a tiny flat *image*, a PNG, that shows up in the version-history list so you can see "oh, that commit, that's the one where the bracket got the second hole" at a glance, instantly, without loading the whole 3D.

**MAYA:**
And the reason you need a separate tiny image is — loading the full 3D for every row in a long history list would be brutal.

**THEO:**
It'd be miserable. Imagine a history with two hundred commits and the list tries to tessellate and render two hundred 3D scenes. So instead, every commit carries a little cached thumbnail. The history list shows the thumbnails immediately — that's REQ 710 — and then, when you actually click into a 3D preview, it shows that thumbnail as a *placeholder* while the real interactive mesh loads in behind it, and swaps when ready. That's REQ 711. Picture first, then the real thing fades in. Standard "show something instantly" trick.

**MAYA:**
Where does the thumbnail come from? Who takes it?

**THEO:**
The *client* takes it, at check-in. This is the primary path. When you check in — when you file a commit, from last episode — the browser is already rendering your model in the viewer. So it just grabs a low-resolution snapshot of that viewport, from the model's default view, as a PNG, and ships it up to be stored alongside the commit. The functions are `storeThumbnail` and `loadThumbnail` in `cadVcsService.js`. The PNG gets stored as a binary `thumbnail` object — that sixth box kind from last episode.

**MAYA:**
And last episode you flagged the thumbnail as the *one* box kind that's not content-addressed. It's keyed per commit.

**THEO:**
Right, and there's a wonderfully grubby reason for the exact key, which I love because it's the kind of detail you only learn by getting bitten. You'd think the natural key would be something like `thumb-` plus the commit hash. But the hash column in the store, `VcsObject.hash`, is a `varchar(64)` — exactly 64 characters, because a SHA-256 is 64 hex characters. If you prepend `thumb-` to a 64-character hash, you get 70 characters, and it overflows the column. So instead the key is `sha256` of the string `"thumb:" plus the commit hash` — you *hash* the composite to get back down to 64 characters. It's deterministic per commit, so it's a stable lookup, but it's a hash *of an identifier*, not a hash *of the pixels.* Which is why it's "not content-addressed" — two different commits with the identical thumbnail image still get different keys, because the key is derived from the commit, not the picture.

**MAYA:**
That's such a specific little scar. A column width forced the key design.

**THEO:**
Real systems are full of those. And there's a second thumbnail path, which the docs are careful to label *backfill-only*, and I want to be honest about what it is and isn't. There's a server-side SVG renderer — `cadThumbnailSvg.js`, function `renderGeometrySvg`. It takes geometry and produces a static, flat-shaded, isometric SVG image. No canvas, no raster library — it literally does a painter's algorithm, sorts the faces back-to-front and paints them, to mimic what the client mini-preview looks like.

**MAYA:**
Why have a server-side renderer at all if the client already captures the PNG?

**THEO:**
For the commits that exist from *before* client-capture was added. We introduced thumbnails partway through. All the commits made before that have no thumbnail. So there's a script — `backfill-cad-thumbnails.js` — that walks old commits and generates an SVG for each so they're not blank in the history. It's a one-time catch-up tool. And the critical honest caveat: it is *not* a runtime fallback. If you open a commit that has no thumbnail, the controller does *not* render an SVG on the fly — it returns a 404. No thumbnail, no picture, 404. The SVG path only runs from the backfill script, deliberately.

**MAYA:**
Why so strict? Why not fall back to rendering an SVG live when one's missing?

**THEO:**
Because a live server-side render is exactly the kind of "do real work on demand" that we keep designing *out* of the system. The whole spirit here is: precompute and store, then reads are cheap and predictable. A runtime SVG fallback would be a sneaky little compute path that fires unpredictably. Better to have a missing thumbnail honestly 404 — and a backfill tool you run deliberately — than a magic fallback that quietly burns CPU when you least expect it. It's the same philosophy as freezing the geometry. Capture once, serve forever, never recompute on the read path.

## Segment 6 — The workflow engine, the rulebook for grown-ups

**MAYA:**
Let's pivot to the second machine. You said freezing, release, and a review workflow are three things that click together. We've done freezing. Before release, I want the *workflow*, because I have a feeling release depends on it. What is the workflow engine?

**THEO:**
It's the approval rulebook, and it is — say it with me — *written once, generically, knowing nothing about CAD.* The file is `workflowEngine.js`. The docs describe it perfectly: it's "pure infrastructure — no serialization, no VCS objects, no document-specific logic." It's a state machine. It knows about *states* and *transitions* and *permissions*. It does not know what a sketch is.

**MAYA:**
So what are the states for a CAD design?

**THEO:**
Three. **Draft** — being worked on. **In review** — somebody's checking it. **Approved** — signed off. And the transitions between them are the interesting part, because each transition is guarded by a *permission*. There's a little declarative table — it's literally a JavaScript object called `CAD_WORKFLOW`. From draft, you can **submit** for review, and that requires the `cad.write` permission. From in-review, you can **approve**, which moves you to approved — and that requires a *different* permission, `cad.approve`. Or from in-review you can **reject**, back to draft, also requiring `cad.approve`. And from approved, you can **reopen** back to draft, requiring `cad.write` again.

**MAYA:**
The thing that jumps out is submit and approve need *different* permissions. Write versus approve.

**THEO:**
And that separation is the entire point of having a review workflow in a regulated shop. The person who *draws* the part is not allowed to be the person who *signs off* on the part. That's a bedrock principle in quality systems — separation of duties. The editor has `cad.write`; they can submit their work for review. The reviewer has `cad.approve`; they're the one who can bless it. If the same person held both, you'd have someone approving their own work, which defeats the purpose of review. So the permission split isn't a technicality — it encodes "a reviewer approves, an editor submits" into the engine itself.

**MAYA:**
And these permissions get checked *in the engine*, not just in some route handler?

**THEO:**
This is a detail I want to dwell on because it's a real design decision. The permission check lives *inside* `transition`, the engine function. Not in the API route. The route could enforce it too, but the *engine* is the one that refuses. So even if someone wired up a new code path that called the engine directly, bypassing the usual route, they *still* couldn't approve without `cad.approve`. The guard is at the bottom, at the machinery, not bolted on at the top. The rule travels with the engine.

**MAYA:**
Walk me through what `transition` actually does when I, say, try to approve something.

**THEO:**
Four steps, in order, and the order is the safety. Step one: find a transition in the table that matches the action "approve" *from the current state.* If you're in draft and you try to approve, there's no "approve from draft" row in the table — so it refuses with a 409, "that move doesn't make sense from where you are." Step two: check your permission. The matched transition says it needs `cad.approve`. Do you hold it? If not, 403, "you're not allowed." Step three: advance the state — write the new state down. Step four: fire a notification, best-effort.

**MAYA:**
409 for "wrong state," 403 for "wrong permission." Those are different failures and they get different codes.

**THEO:**
Deliberately different, because they mean different things to the user. 409 — conflict — is "the system isn't in a state where that's a legal move; maybe somebody already approved it, refresh and look." 403 — forbidden — is "the move is legal but *you* specifically can't make it; go find someone with approve rights." Conflating those into one generic error would leave the user guessing. Precise codes, precise meaning.

**MAYA:**
You said "best-effort" notification twice now. What does best-effort mean here, and why does it matter?

**THEO:**
It means: when a transition happens, we try to ping people — reviewers on submit, the author on approve or reject — but if that notification *fails to send*, the transition *still goes through.* The state change is the real event; the notification is a courtesy. In the engine, the notify hook is called inside a try-catch, and a throwing notifier is swallowed. That's REQ 706, and the test for it is specifically "a throwing hook does not fail the transition."

**MAYA:**
Why is that the right call? I could imagine wanting the notification to be guaranteed.

**THEO:**
Because the notification is *downstream* of the truth. The truth is "this design is now approved." If the push service is down, or the author unsubscribed, or there's a blip — none of that should *prevent the approval from being recorded.* You'd be coupling a hard state change to a flaky side channel — an approval silently failing because a push token expired. So: record the state change first, no matter what; *then* try to be nice and tell people. Notifications are the icing; never make the cake depend on the icing.

**MAYA:**
And there's a callback I want to close — the rulebook is generic. So is it used by anything besides CAD?

**THEO:**
There's a table, `WORKFLOWS`, that maps a document type to a workflow definition. And right now it has two entries: `cad` and `assembly` — and they *both point at the exact same `CAD_WORKFLOW` definition.* Assemblies use the identical draft-review-approved cycle and even the same `cad` permission resource. Adding a brand-new reviewable document type — say, one day you want to put requirements or harnesses through formal review — is a *single new entry in that table.* No engine code changes. The docs call that out as the whole rationale for REQ 703: a reusable declarative engine that can "later govern parts/harness/requirements by adding a transition table." Same gospel as the whole system — write the machinery once, bind it many times.

## Segment 7 — Per-branch state, the footgun and the fix

**MAYA:**
Here's a question that's been nagging me. Last episode you made a big deal that you live on *draft branches*, not on main, and there can be several drafts at once. If three people each have a draft branch, and each is at a different stage of review — one's in draft, one's in review, one's approved — where does the workflow store that? Because if it's one state per part, they'd stomp on each other.

**THEO:**
You found the exact subtlety, and it's REQ 739. The naive design would store one workflow state per *repo* — per part lineage. And that would be wrong, because, as you say, two draft branches could each independently be in review. The state isn't a property of the *part*; it's a property of the *branch.*

**MAYA:**
So how'd you fix it without a database migration? Because adding a "branch" column sounds like a schema change.

**THEO:**
Here's the lovely hack. The workflow state is stored in a table, `VcsWorkflowState`, keyed by a pair: a repo *type* and a repo *id*. And the engine treats that id as a totally opaque string — it never parses it, never assumes structure. So the CAD controller, when it talks to the engine, *composes* a richer id. Instead of just the lineage root, it builds the string `lineage-root` *colon* `branch-name`. So `568:draft/01` and `568:draft/02` are two *different* keys, even though they're the same part. There's a helper for it, `workflowRepo`. Each branch gets its own independent workflow state, and the engine is none the wiser — it just sees two different opaque strings.

**MAYA:**
No migration because the id column was already free-form text, so you just stuffed more structure into it.

**THEO:**
Exactly. The key was always a string; we just made the string carry the branch. Main keeps its own production-approval cycle on its own key; each draft has its own. Three drafts, three independent review states, zero schema changes. The engine's opacity about its own key is what made it extensible. It didn't *know* it was being keyed per-branch, so it didn't care.

**MAYA:**
You promised footguns last episode and delivered. Any in here?

**THEO:**
There's a sharp one, and it's the famous one I teased at the very end of last episode — the release-mutates-before-tag-check bug. It actually lives at the seam between this episode's two topics, freeze and release, so now's the time. Let me set it up properly because the *fix* is a beautiful general principle.

**MAYA:**
Go.

**THEO:**
Releasing has to do a few things atomically-ish: create the release commit carrying the frozen geometry, place the *write-once tag* naming the revision, and advance the `main` sticky note to point at the new commit. Remember from last episode, a tag is write-once — `createTag` throws if a tag of that name already exists. That's the regulatory backbone: revision A's tag can never move.

**MAYA:**
Right, the nailed-down sticky note.

**THEO:**
Now. The *first version* of the release code did these steps in the wrong order. It created the commit, advanced `main` to point at it *first*, and *then* went to place the tag — and only at that point discovered, "oh, this tag already exists, throw a 409."

**MAYA:**
And when would the tag already exist? Why would you release the same revision twice?

**THEO:**
A double-click. A race. A retry after a flaky network response where the first attempt actually succeeded. Any of the ordinary ways the same operation fires twice. And here's the damage: the second attempt has *already* created a duplicate commit and *already* marched `main` forward to point at it — *before* it hits the tag check and throws. So now `main` points at an untagged duplicate commit, the actual released-and-tagged commit is buried as an *ancestor*, and the history graph shows the wrong thing as the head. The released badge is sitting on a commit two steps back, and `main` has wandered past it. A genuine corruption of the visible history.

**MAYA:**
So the error was thrown, but the damage was already done before the throw.

**THEO:**
That's the whole bug in one sentence. The thing that *could fail* — the tag check — ran *after* the thing that *mutated shared state* — moving `main`. So a failure didn't cleanly abort; it left the world half-changed.

**MAYA:**
And the fix?

**THEO:**
Reorder, with a principle. The fix has two parts. One: check whether the tag exists *up front*, as the very first thing, before mutating *anything.* If revision 01 already has a tag, refuse immediately, 409, nothing touched. Two: when you do proceed, create the *tag before* you advance `main`. So the sequence becomes: check tag absence, freeze geometry, create commit, *create tag*, *then* advance main.

**MAYA:**
And why does tag-before-advance make the race safe? A race could still slip between creating the tag and advancing main.

**THEO:**
It could, but look at what's left if it does. If two releases race and both pass the up-front check, one of them creates the tag first and wins. The other tries `createTag` and *throws*, because the tag now exists — *before* it advanced main. So the loser leaves behind only an orphan commit object that nothing points at. And an unreachable commit is *harmless* — it's just dead weight in the warehouse, garbage that no ref reaches, invisible in the history. It never corrupts anything. Whereas in the old order, the loser had already moved `main`. So the principle is: **do the thing that can fail before the thing that mutates shared state.** Validate, then commit. Order your side effects so that a failure leaves garbage, never corruption.

**MAYA:**
"A failure leaves garbage, never corruption." That's a keeper. Garbage you can ignore. Corruption you have to surgically repair.

**THEO:**
And repairing it *was* surgical — you had to reset the `main` ref back to the tagged commit so the orphans became unreachable. A whole incident. All avoided by moving one line. The release factory, `makeRelease` in `vcsRelease.js`, now bakes the correct order in: write-once guard *first*, tag *before* branch advance. It's step one and step four of five in the documented sequence, and they're in that order *on purpose.*

## Segment 8 — Release tier one: a draft branch becomes a number

**MAYA:**
Okay. Third machine. Release itself. Last episode you kept mentioning two tiers — a development release and a production release. Let's finally do them. Start with the everyday one.

**THEO:**
The everyday one is releasing a *draft branch onto main.* And the headline is: it's **self-service.** You don't need anyone's approval. As long as you have `cad.write` — the basic "I can edit CAD" permission — you can do it yourself. That's REQ 716 and 737. This is your engineering checkpoint: "this design is good, stamp it as a numbered revision."

**MAYA:**
Self-service feels surprising for something this consequential. Last episode you said `main` is *protected* — you can't even edit it. And now I can just... release onto it, by myself, no sign-off?

**THEO:**
And that's the right tension to feel, so let me draw the line carefully. You can't *edit* main. Releasing isn't editing — it's the one sanctioned, structured way main advances. The protection means "no dragging faces on main"; it doesn't mean "main never moves." Main moves *only* through release, which is exactly the controlled gateway. And the *number* you mint here — `01`, `02`, `03` — is a *development* revision. It's an engineering milestone, not the formal externally-controlled production revision. The heavyweight approval lives on the *next* tier, the letter revisions. So the numeric tier being self-service is fine: it's the engineering team's own internal checkpoint cadence. The gate goes on production.

**MAYA:**
Got it. So the numbers are engineering's, the letters are formal. Let me hear the actual sequence of a branch release.

**THEO:**
It's a function in the controller, `releaseBranchToMain`. First, the gates. The branch must be *checked in* — that's REQ 715. You cannot release work in progress. Concretely: `dirty` must be false, and there must be a base commit. If you've got uncommitted changes on your desk, release refuses — check in first. Second gate: you can't be *behind main.* Remember from last episode, if main advanced past where your branch started, you're "behind," and releasing a stale branch would clobber what already shipped. So if you're behind, release is blocked until you do that feature-level merge we covered last time. Check those two gates, and then the real work starts.

**MAYA:**
Which is minting the number.

**THEO:**
Minting the number. And this is where the VCS reaches over and shakes hands with the *manufacturing parts table.* There's a service, `partRevisionService`, that owns revision identity for the whole app — not just CAD. It has a function `createNewRevision` that produces the next *numeric* revision. It looks at the parts table, finds the highest released numeric revision for this part lineage, adds one, and *creates an actual new `Parts` row* with that revision. Zero-padded — `01`, `02`. So the moment of release is the moment a real database row for "revision 02 of this part" comes into existence.

**MAYA:**
That connects to something from last episode — the *derived* draft revision. You said draft branches don't get a parts row; their number is computed as "highest released plus one." So this is the moment that computed number becomes *real.*

**THEO:**
This is *exactly* that moment, and I love that you connected them. Last episode: three concurrent drafts all show `draft/02` because `02` is derived, not claimed — nobody's minted a parts row yet. The instant *one* of them releases, `createNewRevision` mints the real `02` parts row, claims it, and the *other two drafts' derived numbers instantly bump to `03`*, because the max in the table just moved. The derivation floats correctly the whole time, and release is the event that crystallizes one floating number into a concrete row. The parts table is the oracle; release is when the oracle speaks.

**MAYA:**
Okay, the number's minted. Now the freeze and the tag.

**THEO:**
Now it calls into the release factory — `cadVcsService.release`, which wraps that `makeRelease` machinery. And that's where everything from the first half of this episode fires: serialize the doc to a tree, *freeze the geometry* — regen once, store the mesh and BReps, build the manifest — create the release commit with `meta.frozen` set, place the *write-once tag named for the revision* — `01` or `02` — and advance `main` to the new commit. In the correct order: tag before advance, write-once-guard first. The frozen geometry and the revision number are now permanently welded together by that tag.

**MAYA:**
And there's a detail about the *parents* of that commit you flagged earlier — REQ 746.

**THEO:**
Yes, and it's a nice "do it git's way" decision. When the branch releases onto main, you could *squash* — collapse all the branch's work into one fresh commit on main and throw away the branch's individual commit history. We deliberately *don't.* The release passes a `parents` override into the factory, setting the new commit's parent to the *branch's own head.* So the branch's commits become genuine *ancestors of main.* The whole development history — every check-in you made on `draft/02` — is preserved in main's ancestry, git-style, not flattened. That's REQ 746. Your incremental work survives as real history.

**MAYA:**
Why keep all that detail? A squash is cleaner.

**THEO:**
For a regulated design history, the *detail is the value.* An auditor asking "show me how this revision evolved" wants the real sequence of check-ins, not a single squashed lump. Cleaner-looking history is worse history when traceability is the product. So we chain off the branch head and keep every step. The `parents` override on the release factory exists precisely so the same generic factory can do both squashed and chained releases — CAD chooses chained.

**MAYA:**
And then the locking, and the branch goes away.

**THEO:**
The finale. Three things. `releaseLocked` gets set to true on the CAD design — we'll unpack that in a second, it's one of three locks. `Parts.revisionLocked` gets set on the parts row — manufacturing's immutability flag. And the draft branch's ref gets *deleted* — archived. Remember from last episode, deleting a ref removes only the sticky note; the commits live on, now as ancestors of main. So the branch *as a workspace* is gone, but the *work* is fully preserved in main's history. The draft did its job — it carried the work to release — and now it's retired.

## Segment 9 — The three locks, at depth

**MAYA:**
You just dropped `releaseLocked` and `Parts.revisionLocked` and I know there's a third one — the checkout lock from last episode. You said "three locks" multiple times. I want all three, clearly distinguished, because I keep blurring them.

**THEO:**
They blur because they're all called "locks" and they all say "you can't change this," but they're three *different* mechanisms protecting three *different* things, and even the HTTP error codes differ. Let me do them one at a time.

**MAYA:**
Lock one.

**THEO:**
Lock one: `lockedByUserID` — the **checkout lock.** This is the transient, who's-got-the-pencil lock from last episode. PDM-style. When you check out a part to edit it, your user id goes in `lockedByUserID`, with an expiry. It means "Maya is actively editing this right now; nobody else gets a pencil." It's *temporary* — thirty-minute default, auto-expires, can be force-released by an admin. It's about *concurrency* — stopping two people from clobbering each other in the same editing session. When you violate it — try to check out something someone else holds — you get a **423**, "Locked," and the error names the holder.

**MAYA:**
Lock two.

**THEO:**
Lock two: `releaseLocked` — the **CAD design lock.** This is *permanent*, and it's about *the design being released.* Once you dev-release a design, `releaseLocked` goes true on that `DesignCADModel`, and the design is read-only *forever.* Not for thirty minutes — forever. A released design cannot be edited again. The point of a release is that it's frozen; editing it would defeat that. To make changes, you don't edit — you make a *new revision*, which we'll get to. So `releaseLocked` is "this specific design snapshot is shipped; it's done."

**MAYA:**
And lock three.

**THEO:**
Lock three: `Parts.revisionLocked` — the **manufacturing lock.** This one lives on the *parts table*, not the CAD design, and it's manufacturing's own immutability flag. It's the parts system saying "this revision is locked for *manufacturing* purposes" — BOMs, barcodes, work orders all depend on it being fixed. It predates CAD entirely; it's part of the broader inventory app. Release sets *both* `releaseLocked` *and* `Parts.revisionLocked`, because the release is simultaneously freezing the design *and* fixing the manufacturing revision.

**MAYA:**
So one's about *who's editing right now*, one's about *this design is shipped*, and one's about *manufacturing can rely on this.* Concurrency, design-freeze, manufacturing-freeze.

**THEO:**
Perfectly carved. And here's a sharp distinction I want you to keep: the *error codes* differ by what kind of lock you hit. The checkout lock — `lockedByUserID` — gives a **423**, "Locked," because it's literally a resource-locked-by-another-session situation, which is what 423 is *for.* The release locks — `releaseLocked` and the revision lock — give a **409**, "Conflict." Because hitting *those* isn't "someone else has the pencil," it's "what you're asking conflicts with the state of the world — this thing is released, your edit doesn't fit." Different *kind* of refusal, different code.

**MAYA:**
Let me make sure I have the mapping. If I try to *check out* a part someone else is editing — 423, checkout lock. If I try to *edit or release* a design that's already been released — 409, release lock.

**THEO:**
That's it exactly. A controller helper, `isLockedForEdit`, also folds in "you're on main" — main is always locked for edit, 423 — and the release-state guards layer the 409s on top. Three locks, two codes, and the code tells you *which kind of wall* you hit: 423 means "wait, someone's working" or "this is the protected line"; 409 means "this is frozen, you need a new revision."

**MAYA:**
And that "you need a new revision" is the escape hatch from the design lock.

**THEO:**
Right, and it's worth seeing because it closes the loop. A released design is read-only — `releaseLocked`. So how do you ever change a shipped part? You make a *new revision.* There's a function, `newRevision`. It mints the next numeric revision via `partRevisionService`, and creates a *fresh, editable* `DesignCADModel` that *copies the design forward* — the feature tree, the sketches, the equations, the default view, all copied — into a new unlocked working copy. That's REQ 720. And critically, it preserves the *lineage repo*, so the new revision's history is continuous with the old one. You're not starting from scratch; you're branching the design forward into a new editable revision. The old one stays frozen; the new one is yours to edit.

**MAYA:**
And from last episode — checking out a released revision *automatically* triggers this.

**THEO:**
Right, REQ 730. If you try to check out a locked, released revision to edit it, rather than just refusing, the system helpfully does the new-revision dance for you — copies it forward into a fresh editable revision and puts *you* on that. So "I want to change this shipped part" smoothly becomes "here's a new revision to edit," without you having to know the ceremony. The lock isn't a dead end; it's a fork in the road.

## Segment 10 — Release tier two: the letter revision

**MAYA:**
So the development release gives me numbers, self-service, frozen, locked. Now the second tier — the production release, the letters. What's different?

**THEO:**
Two big differences, and they're the whole reason it's a separate tier. Difference one: it's **approval-gated.** Not self-service. To do a production release you need the `cad.approve` permission *and* the workflow has to be in the *approved* state. So the review workflow we built in segment six — that gate clicks in *here.* You can't production-release until a reviewer has actually approved the design through the workflow. That's REQ 721. Difference two: it mints a **letter** revision — `A`, `B`, `C` — instead of a number, and crucially, it carries the *exact same frozen geometry* as the development release it's based on. That's REQ 722, 740.

**MAYA:**
Let me make sure I understand the relationship between numbers and letters. Numbers are engineering's internal milestones, and a letter is the formal, blessed, externally-released version of one of those.

**THEO:**
That's the model. You iterate through `01`, `02`, `03` as engineering checkpoints — fast, self-service, each one frozen. At some point a design is *ready for the world* — it goes through review, a reviewer approves it, and *then* someone with approve rights cuts the production release: revision `A`. And revision `A` is *geometrically identical* to the development revision it came from. Not "regenerated to be the same." *Literally the same bytes.*

**MAYA:**
How do you guarantee literally-the-same? Even a re-freeze could in principle differ if the kernel moved between the dev release and the production release.

**THEO:**
And *this* is the most elegant move in the whole release system, so let me say it carefully. The production release does *not* re-freeze. It does *not* regenerate. It does not call the kernel *at all.* What `productionRelease` does is: it takes the *development release's existing commit* — the one already frozen, already carrying `meta.frozen` — and it places a *new write-once tag*, the letter `A`, *on that same commit.*

**MAYA:**
Oh. So `01` and `A` are two tags pointing at the *same* commit.

**THEO:**
The identical commit. Same tree, same `meta.frozen`, same frozen mesh blob, same frozen BRep bytes — because it's the *same object*, addressed by the same fingerprint. There's literally nothing to differ, because nothing is recomputed. Identical-geometry isn't a guarantee we *check*; it's a guarantee *by construction.* Two labels, one frozen box. The letter revision and the number revision are the same photograph with two captions.

**MAYA:**
That's gorgeous. The content-addressing makes "same geometry" not a property you verify but a property that's *impossible to violate.*

**THEO:**
That's the payoff of everything from last episode landing here. Because the commit is content-addressed and immutable, and the tag is write-once, "revision A has the exact geometry of dev revision 02" reduces to "tag A points at the same commit hash as tag 02." It's a pointer equality. You can't fake it, you can't drift it, and an auditor can verify it by reading two tags. The whole freeze-and-content-address apparatus exists so that *this* — the most important guarantee in a regulated release, "the production part is identical to the approved one" — is trivially, mechanically true.

**MAYA:**
What are the actual mechanics? You said it mints the letter, tags the same commit, in a transaction.

**THEO:**
`productionRelease`. It guards: `releaseLocked` must already be true — you can only production-release something that's *already* been dev-released, you can't skip the numeric tier. And `workflowEngine.canRelease` must be true — which, remember, is just `state === 'approved'`. Both gates pass, and then, inside a *database transaction*: it mints the next letter via `partRevisionService.releaseToProduction`, it creates a new `DesignCADModel` whose base commit *is the existing dev release commit*, and it `createTag`s the letter on that same frozen commit. All atomic — if any step fails, the whole thing rolls back, no half-state. And then a nice housekeeping touch: it *resets the per-branch workflow back to draft*, so the next round of changes starts a fresh review cycle.

**MAYA:**
The letters themselves — `A`, `B`, `C` — is it just the alphabet?

**THEO:**
Almost, and the exceptions are a charming bit of real-world wisdom. The letters run `A` through `Y` but *skip* `I`, `O`, `Q`, `S`, `X`, and `Z`. Then after `Y` it goes `AA`, `AB`, and so on.

**MAYA:**
Why skip those six?

**THEO:**
Legibility on a physical drawing or a stamped part. `I` looks like `1`. `O` looks like `0`. `Q` looks like `O` which looks like `0`. `S` looks like `5`. `Z` looks like `2`. `X` is often reserved or ambiguous. On an engineering drawing where someone's reading a revision off a smudged print or a laser-etched plate, you do *not* want `REV O` versus `REV 0` ambiguity. So the revision letters deliberately avoid the confusable ones. It's in `partRevisionService.REV_LETTERS`. A tiny humane detail that has nothing to do with software and everything to do with someone squinting at a part on a shop floor.

## Segment 11 — Exports, and continuity across the whole lineage

**MAYA:**
Two more things I want to close. First — exports. You said at the very top a released part exports to STL and STEP without the kernel. But STL and STEP are geometry file formats. Doesn't *writing* them require geometry work?

**THEO:**
Writing them requires *reading* geometry and *serializing* it — and the geometry it reads is the *frozen* geometry, not a fresh regen. That's the whole trick. The function is `exportRelease`. You ask for, say, an STL of revision `A`. It resolves the *write-once tag* named `A` — finds the commit it points at — and that commit is frozen, it has `meta.frozen`. So it pulls the per-body BReps from *frozen storage* via `geometryForCommit` — the dispatcher we built, which sees the commit is frozen and *loads* rather than regenerates. Zero kernel calls to *get* the geometry.

**MAYA:**
But then it has to turn those BReps into an actual STL or STEP file. That part?

**THEO:**
That part does call the kernel — but only as a *serializer*, not a *computer.* This is a distinction worth holding. There's a function `exportBodyBreps` that hands the *already-frozen, already-final* BRep bytes to the kernel and says "write these out as STL" or "write these out as STEP." For STL it uses the OCCT `exportStl` operation — tessellate-and-write to the STL format. For STEP, `exportStep`. The kernel isn't *recomputing the shape* — the shape is fixed, it's the frozen BRep. The kernel is just doing a format conversion on geometry that's already decided.

**MAYA:**
So there's a meaningful difference between "the kernel computes the geometry" — which never happens for a release — and "the kernel transcodes already-frozen geometry into a file format."

**THEO:**
That's the precise line, and it's why I can honestly say a released part's *geometry* never gets recomputed even though an export does touch the kernel. The geometry — the actual shape — comes entirely from frozen storage. The kernel's only job at export is "take this fixed BRep and emit the bytes of an STL file." The shape was decided at release; export just reformats it. And because the BReps come from the frozen tag, the exported file *always matches exactly what was locked.* You download revision `A`'s STEP today, next year, after three kernel upgrades — identical file, because it's serializing the same frozen bytes.

**MAYA:**
And if the kernel happens to be down when I want an export?

**THEO:**
Then the *transcoding* can't happen, so it degrades to a 503 — "service unavailable, try again." But note what *didn't* break: the *geometry* is still safe in frozen storage, fully intact. The viewer can still show you the part from the frozen mesh with the kernel dead; you just can't generate a download *file* until it's back. Frozen geometry, kernel-independent; export *serialization*, kernel-dependent.

**MAYA:**
Last thing. Continuity. We've now got numeric revisions, new-revision copies, *and* letter revisions, all for one part. That's a lot of separate-sounding things. Do they hang together as one history, or is it fragmented?

**THEO:**
One continuous history, and the reason is the single most important glue from last episode: the repo is keyed to the *lineage root.* Remember — when manufacturing cuts a new revision, you get a brand-new `Parts` row, linked back to its predecessor. If we keyed CAD history to the *row*, every revision would start a fresh empty history and you'd lose the thread. Instead, `repoForModel` walks back through `previousRevisionID` to the *original* part row and uses *that* as the repo id. So no matter which revision you're sitting on — dev `02`, a new-revision copy, production `A` — you resolve to the *same repo*, the same warehouse, the same commit graph.

**MAYA:**
So the numeric line, the copies, and the letter line are all commits in *one* graph.

**THEO:**
All one graph. That's REQ 724. The dev releases chain along main as numeric tags. New-revision copies branch forward preserving lineage. Production releases tag the same frozen commits with letters. Every one of those is a commit or a tag in the *single* lineage-root repo. So you can open the history of a part and see the *entire* story — `01`, `02`, `A`, `03`, `B` — as one connected DAG, across every manufacturing revision, unbroken. The bookkeeping of "how many parts rows exist" never fragments the design history, because the history follows the *part*, the platonic part, not the rows.

**MAYA:**
And that's the same point that closed last episode — the repo follows the thing, not the database.

**THEO:**
Same point, and *this* is where it cashes out hardest. Because release is exactly the moment new parts rows get minted — every dev release makes a row, every production release makes a row. If the repo were keyed to rows, *release itself* would shatter the history every single time. It's *because* the repo is lineage-rooted that release can mint all the rows it wants and the history stays whole. The lineage-root decision and the release machinery are made for each other.

## Recap

**MAYA:**
Let me land this one. Four takeaways.

One: **a released part is a photograph, not a recipe — and that's a correctness requirement, not a speed trick.** Because the kernel changes between versions and the BRep cache is evictable, a recipe alone isn't reproducible. So at release, the geometry is computed *once* and frozen — each body's exact BRep plus a renderable mesh, stored as content-addressed objects, indexed by a tiny manifest in the commit's `meta.frozen`. Opening or exporting a release loads those bytes back with *zero* kernel computation. The shape was decided at release and can never drift.

**THEO:**
And freezing isn't a new storage system — it's the *same* content-addressed warehouse from last episode, so frozen geometry dedups across revisions for free. A body that didn't change shares its frozen BRep automatically.

**MAYA:**
Two: **the review workflow is a generic, declarative rulebook, separate from release.** Draft, in-review, approved. Submit needs `cad.write`; approve needs the *different* `cad.approve` — encoding "the person who draws it isn't the person who signs it." The permission check lives in the *engine*, not just the route. State is keyed per *branch*, so concurrent drafts review independently. And notifications are best-effort — the state change is the truth, the ping is a courtesy that can fail without breaking anything.

**THEO:**
One declarative table, two bound document types, and a missing-migration problem solved by stuffing the branch name into a free-form id string.

**MAYA:**
Three: **two release tiers, and content-addressing makes the hard guarantee free.** A draft branch releases onto main *self-service* — `cad.write` — minting the next *numeric* revision: freeze, write-once tag, advance main keeping the branch's commits as ancestors, lock, archive the branch. Then a production release — *approval-gated*, `cad.approve` plus workflow-approved — mints the next *letter* revision by tagging the *same frozen commit.* "The shipped part is geometrically identical to the approved one" isn't checked; it's *impossible to violate*, because it's pointer equality on one immutable box.

**THEO:**
Two captions, one photograph. And the letters skip the confusable ones so nobody misreads `REV O` as `REV 0` on a shop floor.

**MAYA:**
And four: **three locks, two error codes, one continuous history.** The checkout lock — transient, who's-editing, 423. The release lock — permanent, this-design-is-shipped, 409. The manufacturing revision lock — the parts table's own immutability, also 409. To change a shipped part you don't edit it — you fork a new revision forward, copying the design, preserving lineage. And because the repo is keyed to the *lineage root*, not the database row, every dev number, every copy, and every production letter lives in *one* unbroken commit graph — which matters most precisely *because* release is the moment new rows get minted.

**THEO:**
If the repo followed the rows, release would shatter the history on every cut. Lineage-rooting is what lets release mint freely and keep the story whole.

**MAYA:**
And the honest footgun, because you owe one every episode: release used to advance `main` *before* checking the write-once tag, so a double-click could march main past the real release and corrupt the visible history. Fixed by checking the tag up front and creating it *before* advancing main — so a race leaves harmless garbage, never corruption.

**THEO:**
Do the thing that can fail before the thing that mutates shared state. Validate, then commit. That one's worth tattooing somewhere.

**MAYA:**
On the other arm from "bring a magnet."

**THEO:**
[laughs] Running out of arms.

## Teaser

**MAYA:**
So we've spent two whole episodes on a single part — versioning it, diffing it, branching it, freezing it, releasing it. Next episode, we go up a level, and honestly it's the one I've been most curious about all season: **assemblies.** What happens when you take a dozen *released* parts and bolt them together into one machine — and you want the bolts to actually mean something. "This face mates flush against that face." "This shaft is coaxial with that hole." "These two plates stay six millimeters apart."

**THEO:**
And the hard core underneath it — the **mate solver.** Because a mate isn't a drawing; it's a *constraint.* "Coaxial" is an equation. "Flush" is an equation. And when you've got fifty parts and two hundred mates, somebody has to *solve* that whole system simultaneously and place every part in space so that *all* the constraints are satisfied at once — or honestly tell you they can't be. That's a genuinely hard numerical problem, and it's the beating heart of the assembly editor.

**MAYA:**
And I already know your answer to "why not just let people drag parts into place by eye" is going to make me feel naive for asking.

**THEO:**
Drag by eye and the first time a part upstream changes a dimension, your whole machine falls apart and nobody knows why. Constraints are the thing that *survive* change. But we'll save that for the solver.

**MAYA:**
The episode where the parts finally have to get along. Thanks for listening — we'll see you next time.

**THEO:**
Bring two parts and a wrench.

[both laugh]

---

# Episode 11 — Assemblies and the Mate Solver

## Cold open

**MAYA:**
Okay. Before the intro, I need you to settle something, because I watched you demo this yesterday and I've been thinking about it ever since. You had two parts on the screen — a bracket and a bolt — and you clicked a face on one and a face on the other and said "these touch," and the bolt *flew* into position. Not snapped. Flew. It traveled there over, like, a fraction of a second, and it wobbled a little as it landed. So I have to ask. The solver — is it doing physics?

**THEO:**
[laughs] No. Everybody asks me that. It looks like physics. It is not physics. There's no gravity, there's no momentum, nothing is falling. What you watched was the solver doing *calculus*. Sixty times a second.

**MAYA:**
Calculus. The bolt is doing calculus at it flies.

**THEO:**
The bolt is sitting still, doing nothing, it's an idiot. The *solver* is doing calculus. Every frame — every sixtieth of a second — it asks a question: "how wrong is everything right now, and which direction makes it less wrong?" That direction is a derivative. It takes a small step that way, redraws, and asks again. The wobble you saw? That's it overshooting slightly and correcting. That's not a bounce. That's a math engine homing in on an answer.

**MAYA:**
So the thing that *looks* like a part settling under gravity is actually—

**THEO:**
Is actually a least-squares problem converging. Same shape, completely different cause. And once you see that, you can never un-see it. Let's get into it.

## Intro

**MAYA:**
Welcome back to Season Two, where we open the hood and poke around. By now you've got the tour. A browser-based CAD tool stapled onto a manufacturing inventory app, a Rust-and-OCCT geometry kernel doing the heavy 3D math, a git-like version control system underneath it all. We did sketches, we did the kernel, we did the version control. This episode we go up a level — from single parts to *assemblies*. Multiple parts, arranged together.

**THEO:**
And this is the one I've been waiting for, because the centerpiece of the whole assembly system is the thing from the cold open. The mate solver. It's the single hardest, densest piece of code in the entire project, and I want to actually walk through it. Not hand-wave. Walk through it.

**MAYA:**
We're going deep on the solver. But there's a whole world around it too — how an assembly is even stored, how it gets drawn, patterns, mirrors, exploded views, interference checking. The solver's the star, but it's got a supporting cast.

**THEO:**
Right. So here's the plan. First, what an assembly *is* as data — because it's surprisingly humble. Then regeneration: how you turn that data into a picture. Then we spend a long, loving time on the solver itself. Then the toolbox — patterns, mirror, subassemblies. Then the looking-at-it features — explode, section, display states. Then analysis — does anything crash into anything, how heavy is it, where's the balance point. And I promised I'd be honest about the rough edges, so we'll do that too.

**MAYA:**
That's a lot.

**THEO:**
It's the deep one. Let's go. Start me at the bottom. What *is* an assembly?

## Segment 1 — An assembly is a list

**MAYA:**
So an assembly. In my head it's this complicated 3D thing, a machine, lots of parts. What's actually stored?

**THEO:**
A list. Mostly. The whole assembly — the entire thing — is one JSON document. We call it the `assemblyDoc`. And if you opened it up and read it, your first reaction would be "that's it?"

**MAYA:**
What's in it?

**THEO:**
Two main lists and some bookkeeping. The first list is *instances*. The second list is *mates*. Plus there are some counters and a few extra lists for patterns and exploded views and saved visibility states, but the heart is: instances and mates.

**MAYA:**
Define instance for me.

**THEO:**
An instance is "one copy of a part, sitting somewhere." It's a line on a checklist. Each instance has an `instanceId` — a little name like `i1`, `i2`, `i3`. It has a `partID`, which says *which* part this is a copy of. And it has a `placement`, which is where it sits and how it's turned.

**MAYA:**
And the placement is...?

**THEO:**
Two pieces. A `translate`, which is three numbers — x, y, z — where the part is in space. And a `quaternion`, which is four numbers describing how it's *rotated*. We did quaternions a couple episodes back — four numbers that encode an orientation without the gimbal-lock headaches you get from angles. So placement is "here, turned this way." Translate plus quaternion.

**MAYA:**
Why an ID *and* a part ID? Why not just... the part?

**THEO:**
Because the same part shows up many times. The classic example: twenty bolts. You don't have twenty bolt parts. You have *one* bolt part, and twenty instances, all pointing at the same `partID`, each with its own placement. The instance is the *placed copy*. The part is the *thing being copied*. Instance `i7` and instance `i12` might both be "bolt number 4471," but `i7` is in the top-left hole and `i12` is in the bottom-right.

**MAYA:**
Got it. So twenty lines on the checklist, all saying "one bolt, here." What are the other flags on an instance?

**THEO:**
Three little booleans. `grounded`, `suppressed`, and `visible`. `Grounded` means "this part is nailed down, the solver isn't allowed to move it" — we'll come back to that hard when we do the solver, it's load-bearing. `Suppressed` means "pretend this instance doesn't exist for now" — it's like commenting out a part; it won't be drawn, won't be in the parts count, nothing. And `visible` is just show or hide it in the viewer — it still exists, still counts, you just can't see it.

**MAYA:**
Suppressed versus invisible. Suppressed is "gone for all purposes," invisible is "still here, just hidden."

**THEO:**
Exactly that distinction. A hidden part is still in the bill of materials. A suppressed part isn't.

**MAYA:**
Okay, and a mate? That's the other list.

**THEO:**
A mate is a *rule* about two instances. It says "this face on instance A relates to this face on instance B, in this way." So a mate record has a `type` — one of eight, we'll go through them — and it has an `a` and a `b`. The `a` is `{instanceId, faceId}`: which instance, which face on it. The `b` is the same. And then optionally a `value` — like, for a "keep these twelve millimeters apart" mate, the twelve lives in `value` — and a `flip` flag for when you want the relationship the other way around.

**MAYA:**
So a mate is "face A-something touches face B-something." It references faces by ID.

**THEO:**
By ID. And hold onto that, because there's a subtle bridge there that bites us later. The document stores a *face ID* — just a string name like `f2`. But the solver doesn't care about face IDs. The solver wants to know, mathematically, *what surface is that* — is it a flat plane, and if so where's it pointing? Is it a cylinder, and if so where's its axis? Somebody has to translate "face f2" into "a plane at this origin with this normal." That translation happens right before solving. We'll get there.

**MAYA:**
Noted. Now — wait. You said an assembly is its own document, attached to a part. But also bolts are parts. And the assembly is... a part? I'm confused about the layering.

**THEO:**
Good, because this is the cleverest design decision in the whole subsystem and it's worth slowing down for. An assembly *is a Part*. Capital P, the same Part entity as a bolt or a bracket or a sheet of aluminum. In the inventory database, an assembly has a part row just like everything else.

**MAYA:**
Why?

**THEO:**
Two reasons, both about *not* building new machinery. One: because an assembly is a part, it can be a component *inside another assembly*. A gearbox is an assembly — but it's also a part you drop into the bigger machine. The nesting comes free because the "thing" and the "container" are the same kind of object. Two: because it's a part, it shows up in bills of materials, it flows through ordering and kitting and planning — all the inventory tooling that already exists. We didn't write any of that. The assembly just *is* a part, so it inherits all of it.

**MAYA:**
So how does the system know a given part is an assembly versus a regular part?

**THEO:**
By its category. There's a part category literally named "Assembly." And here's a detail I'm weirdly proud of: the code checks the category by *name*, the string "Assembly" — not by a hardcoded ID number. So when the controller decides "is this part eligible to have an assembly built for it," it looks up the category and asks `category.name === 'Assembly'`.

**MAYA:**
Why does name-versus-number matter? Seems like a tiny thing.

**THEO:**
Because IDs drift between environments. That category might be ID 4 in the test database, ID 9 in production, ID 17 on someone's laptop. Hardcode `=== 4` and your code is correct on exactly one machine and silently wrong everywhere else. The *name* is stable. The tests happen to use ID 4, but the production code never mentions the number 4 — it asks for the name. The kind of thing that doesn't matter until 3 a.m. on a deploy, and then it matters enormously.

**MAYA:**
So the humble version: an assembly is a JSON document — a list of placed instances and a list of mate rules — hanging off a part that happens to live in the "Assembly" category.

**THEO:**
That's the whole spine. Everything else — every picture, every analysis, every export — is *derived* from that document. Nothing geometric is stored. You move a part, you change a number in the instances list. That's the edit. The geometry gets recomputed from scratch.

**MAYA:**
Which brings us to: how does a list of numbers become a picture?

## Segment 2 — Regeneration: from list to picture

**THEO:**
This is regeneration. There's a service — `assemblyRegenService` — and the entry point is a function called `regenerateAssembly`. You hand it the document, it hands you back one combined chunk of geometry you can draw. It runs in phases, and I like to say them out loud in order: resolve, solve, transform, scope, compose.

**MAYA:**
Walk me through resolve.

**THEO:**
Resolve means: for each instance, go get its actual shape. The instance just says "part 4471, here." Resolve turns "part 4471" into a real mesh — triangles, vertices, the works. And there's a fork in the road. If the instance points at a regular CAD part, we go run *that part's* regeneration — the single-part pipeline we talked about in the CAD episodes — and get its mesh out. If the instance points at *another assembly* — a subassembly — we recursively call `regenerateAssembly` on that one and treat the whole result as a single rigid blob.

**MAYA:**
So resolve can call itself. Assemblies inside assemblies.

**THEO:**
Recursively, yeah. A gearbox subassembly resolves by resolving all *its* parts and mating *them*, and then the parent treats the finished gearbox as one solid lump it can place. We'll come back to the recursion and the safety rails around it. For now: resolve gets you, per instance, a real mesh.

**MAYA:**
And there's a frozen-geometry shortcut you mentioned for the single-part stuff?

**THEO:**
There's *meant* to be. Let me be honest — this is one of the rough edges. The idea is: if an instance points at a *released*, frozen version of a part, you shouldn't have to re-run the geometry kernel at all. The shape is locked, it's stored, just load it. That's a real optimization and the version-control system absolutely supports it. But in the assembly resolver as it stands today, that frozen-reuse path is *planned, not implemented*. Right now it does a live regeneration every time. So I won't oversell it. The hook is there in spirit, the shortcut isn't wired yet.

**MAYA:**
I appreciate the honesty. Okay — resolve gets meshes. Then solve.

**THEO:**
Then solve. If there are any mates, we run the mate solver — the big one — and it figures out where every non-grounded instance actually goes. If there are *no* mates, we skip the solver entirely and just use the placements as stored. Solver's the next segment, so let me keep moving. After solve, every instance has a final pose: where it sits, how it's turned.

**MAYA:**
Then transform.

**THEO:**
Then transform. And here's a neat efficiency trick. We already have the mesh from resolve — triangles sitting at the part's *own* origin, like the part hasn't been placed yet. To put it in the assembly, you'd think we'd ask the geometry kernel to move it. We don't. We just take the triangles we already tessellated and multiply every vertex by the placement matrix ourselves. Plain matrix math. No kernel call.

**MAYA:**
Why does avoiding the kernel matter?

**THEO:**
The kernel is the expensive, heavyweight, precise-geometry engine — OCCT, in Rust, over a network call. Transforming a mesh you already have is just arithmetic. Multiply each point by a rotation and add a translation. The viewer needs the transformed mesh anyway to draw it, so we do the cheap thing: move the triangles we have, don't ask the kernel to remake them in a new spot. We move the normals too — the little vectors that say which way a surface faces — so lighting still works after the part's been rotated.

**MAYA:**
Then scope. This is the one with the colons.

**THEO:**
[laughs] The colons. Yes. Here's the problem scope solves. Inside one part, faces have names — `f0`, `f1`, `f2`. Bodies too — `body0`. Fine, unique within that part. But now I've got two copies of the same bolt in my assembly. Both of them, internally, call their threaded face `f2`. If I just dump both into one combined geometry, I've got two faces both named `f2` and the system can't tell them apart. Click one, you might select the other.

**MAYA:**
So you rename them.

**THEO:**
We *prefix* them with the instance ID. The scoping function literally builds a string: instance ID, two colons, the original ID. So instance `i1`'s threaded face becomes `i1::body0::f2`. Instance `i2`'s becomes `i2::body0::f2`. Now they're globally unique. The double colon is just a separator that won't show up inside a normal ID. It's namespacing — the same idea as folders, or like how two people can both be named "Sam" as long as you say which family.

**MAYA:**
`i1::body0::f2`. Instance one, body zero, face two. Reads like a file path.

**THEO:**
It is basically a path. And it nests. If a subassembly has a part with face `f2`, and that subassembly is instance `i1` of the parent, you end up with the inner scoping *under* the outer scoping. The path just gets longer the deeper you nest. Always unambiguous.

**MAYA:**
And then compose is just... gluing it all into one.

**THEO:**
Compose is the accumulation. You walk every instance — and every pattern copy, but hold that — transform its faces and vertices and edges, scope all the IDs, and pile it into one big result. And the result isn't *just* triangles. It's a structured object: all the faces, all the vertices, all the edges, a list of bodies — and crucially, a per-instance *roster*. The roster says "instance `i1` owns these body IDs, instance `i2` owns those." So the viewer can still answer "which part did I just click?" even though everything's been melted into one geometry.

**MAYA:**
And I think you mentioned each body also carries some extra baggage for later?

**THEO:**
Right — each body in the composed result also carries its untransformed BRep — the precise kernel shape, still at the origin, *not* moved — plus its placement, its volume, and its centroid. The mesh gets moved during compose; the precise BRep stays put and gets moved later, kernel-side, only when something actually needs it — export, or interference checking. We keep the cheap thing (mesh) pre-placed and the expensive thing (BRep) lazily placed. And volume and centroid ride along for mass properties. We'll use all of that in the analysis segment.

**MAYA:**
And you keep saying "hold that" about pattern copies. Are we ever going to—

**THEO:**
Whole segment coming. Quick preview: a pattern of ten bolts doesn't store ten instances. It stores *one* seed and a rule, "repeat ten times," and the copies get manufactured right here during regen, in a step called expand between solve and transform. Document stays tiny. Park it; I'll pay it off.

**MAYA:**
Parked. Okay. I've been patient. Let's do the solver.

## Segment 3 — The solver, part one: what are we even solving?

**THEO:**
The solver. Okay. Deep breath. I want to build this up slowly because every piece matters and if I skip one it won't make sense.

**MAYA:**
Take your time. Start with the goal. In plain words, what is the solver trying to do?

**THEO:**
Plain words. I have some parts. I have some rules about how they relate. "These two faces touch." "This shaft is centered in that hole." "Keep these twelve millimeters apart." Each rule is satisfied or it's broken, and if it's broken, you can measure *how* broken — by a number. The solver's job: move the parts around until every rule is satisfied. Until every "how broken is this" number is zero.

**MAYA:**
And the number — how-broken-is-this — has a name.

**THEO:**
A residual. That word's going to come up a hundred times so let's nail it. A residual is the leftover error. "These faces should touch; they're three millimeters apart" — the residual is three. When the faces actually touch, the residual is zero. The solver is a machine for driving residuals to zero.

**MAYA:**
So every rule produces a residual — a number that's zero when the rule's happy.

**THEO:**
Some rules produce *several* numbers, actually, because some relationships are richer than a single quantity. "These faces touch" is really two ideas — they have to be *parallel* facing opposite ways, *and* they have to be at zero distance. So it's multiple residuals. But the principle holds: every residual is an error you want to be zero.

**MAYA:**
Okay. And what's the solver allowed to change? It can move the parts. How do you describe "move the parts" as math?

**THEO:**
This is the parameterization, and it's the part people skip and then get lost. So I won't skip it. Here's the question: what are the *knobs* the solver can turn?

**MAYA:**
Position and rotation of each part?

**THEO:**
Exactly. Each part that's allowed to move has six knobs. Three for position — slide it in x, y, z. Three for rotation — spin it around three axes. Six numbers per part. That's the famous "six degrees of freedom." A free rigid body in space has exactly six ways to move.

**MAYA:**
Six per part. And if I have, say, four parts that can move?

**THEO:**
Twenty-four knobs. The solver stacks all of them into one big list of numbers — we call it the twist vector, or just `x`. If three parts are free, `x` has eighteen entries. The solver's whole job is finding the values of those eighteen numbers that make all the residuals zero. That's it. That's the entire problem. Find the knob settings that zero out the errors.

**MAYA:**
You said "parts that are allowed to move." That's the grounded thing.

**THEO:**
That's grounding, and it's essential. If *every* part is free, the whole assembly can float off into space together — there's nothing to be positioned *relative to*. The math has no anchor. So at least one part has to be grounded. Nailed down. Zero knobs. It doesn't move, it gets no entries in the twist vector, it's the fixed reference everything else is positioned against.

**MAYA:**
And if the user forgets to ground anything?

**THEO:**
The solver grounds the first instance automatically. Right at the start, it checks "is anybody grounded?" and if nobody is, it grabs instance number one and pins it. SolidWorks does the exact same thing — "fix the first part." It's such a common need that we don't make you ask for it. There always has to be an anchor, so if you didn't pick one, you get one.

**MAYA:**
Alright. So now I've got the setup. A big vector of knobs — six per free part. A pile of residuals — errors I want at zero. One part nailed down. Now... how does it actually find the answer? Because "try every combination" is obviously insane.

**THEO:**
Insane and impossible — these are continuous numbers, there's infinitely many combinations. No. The method has a name, and it's a mouthful, and I'm going to say it and then take it completely apart. It's called Levenberg-Marquardt.

**MAYA:**
[laughs] Say it again slowly.

**THEO:**
Levenberg-Marquardt. Two guys, Levenberg and Marquardt, decades apart, who built a least-squares optimization method that is *the* workhorse for exactly this kind of problem — "I have a bunch of errors, find the parameters that minimize them." It's in the file. The file's literally called `mateSolver.ts`. It's maybe four hundred lines and most of them are this one idea.

**MAYA:**
Okay. Take it apart. How does Levenberg-Marquardt actually find the answer?

## Segment 4 — The solver, part two: how Levenberg-Marquardt works

**THEO:**
Let me build it in layers, easiest idea first. Layer one: hill descent. Imagine the total error — all the residuals squared and summed — as a *landscape*. A terrain. Every possible setting of the knobs is a point on the ground, and the *height* at that point is how wrong the assembly is. High ground is very wrong. The bottom of a valley is zero error — the answer.

**MAYA:**
So solving is finding the lowest point in the landscape.

**THEO:**
Rolling downhill to the valley floor. And how do you go downhill when you're standing somewhere? You look at the slope under your feet and step in the steepest-down direction. That's gradient descent — the most basic version. Feel the slope, step down, repeat.

**MAYA:**
And the slope is a derivative. Calculus. The cold open.

**THEO:**
The slope is the derivative, yes. But here's the thing — basic gradient descent is *slow and dumb*. It zigzags. It takes tiny cautious steps. For a problem like ours, you'd be there all day. So there's a smarter method, layer two: Gauss-Newton.

**MAYA:**
What does Gauss-Newton do differently?

**THEO:**
Gradient descent only knows the slope — first derivative. Gauss-Newton also estimates the *curvature* — how the slope is changing — and uses that to *jump*. Instead of "step a little bit downhill," it says "given the slope and the curvature, the bottom is probably *way over there*," and it leaps straight at it. When it works, it's spectacularly fast — it can nail the answer in a couple of steps.

**MAYA:**
When it works. I hear a "but."

**THEO:**
Big but. Gauss-Newton is overconfident. When you're far from the answer, or the landscape is weird and bumpy, those big confident leaps can overshoot wildly — fling you to a *higher* spot than where you started. It's a sprinter with no brakes. Great on a straightaway, death on a curve.

**MAYA:**
So gradient descent is slow but safe. Gauss-Newton is fast but reckless. And let me guess — Levenberg-Marquardt is the marriage.

**THEO:**
That's *exactly* what it is, and it's why it's beautiful. Levenberg-Marquardt blends the two with a single dial. The dial is a number called lambda. When lambda is small, the method behaves like Gauss-Newton — big confident jumps. When lambda is large, it behaves like gradient descent — small, cautious, safe steps. And — here's the genius — it *adjusts the dial automatically as it goes*.

**MAYA:**
How does it decide which way to turn the dial?

**THEO:**
By whether the last step actually helped. Each iteration, it computes a step, *tentatively* takes it, and checks: is the total error lower than before? If yes — great, that step worked, I can afford to be bolder — it *shrinks* lambda. More Gauss-Newton, bigger next jump. If the step made things *worse* — it *rejects* the step entirely, doesn't take it, *grows* lambda to be more cautious, and tries again from the same spot with a smaller, safer step.

**MAYA:**
So it's constantly negotiating its own aggressiveness. Bold when it's winning, timid when it stumbles.

**THEO:**
Self-tuning courage. In our code, on a successful step lambda gets cut in half — be bolder. On a failed step lambda gets multiplied by four — be way more careful — and it'll retry up to eight times before giving up on that iteration. Those exact numbers, the half and the four and the eight, are right there in the solver.

**MAYA:**
And the wobble I saw in the cold open — the bolt overshooting and correcting — that's lambda being too small for a moment?

**THEO:**
That's a confident step that slightly overshot, then a correction. You're literally *watching* Levenberg-Marquardt negotiate with itself in real time. The "physics wobble" is the algorithm finding its footing.

**MAYA:**
That genuinely changes how I see it. Okay — there's one piece you've been dancing around. The slope and the curvature. You need derivatives. How do you get the derivative of "how wrong is this assembly"? That seems hard to do on paper.

**THEO:**
It *is* hard on paper, and that's the next big idea, so let's give it room.

## Segment 5 — The solver, part three: the Jacobian, the honest hack

**THEO:**
The object that holds all the slopes is called the Jacobian. Big word, simple idea. The Jacobian is a table. Down the side: every residual — every error. Across the top: every knob — every degree of freedom. And each cell answers one question: "if I wiggle *this* knob a tiny bit, how much does *that* error change?"

**MAYA:**
So it's a giant grid of "this knob affects that error by this much."

**THEO:**
Every knob crossed with every error. If I nudge bolt number two a hair to the left, how much does the "these faces touch" error change? How much does the "stay twelve apart" error change? Fill in the whole grid and you've got the Jacobian — the complete map of how every adjustment ripples into every rule. That map is *exactly* what Levenberg-Marquardt needs to decide where to step.

**MAYA:**
Okay. So how do you compute it? You said paper is hard.

**THEO:**
There are two ways, and I want to be totally candid about which one we picked and why. Way one: you sit down with calculus and *derive a formula* for each cell, by hand. Analytic derivatives. Exact, fast, elegant. And a genuine pain to write, easy to get subtly wrong, and you have to redo the math for every single mate type.

**MAYA:**
And way two?

**THEO:**
Way two is almost cheating, and it's what we do. It's called finite differences, or numerical differentiation. Instead of deriving the slope, you *measure* it. You want to know how knob seven affects all the errors? Just... wiggle knob seven. Nudge it by a tiny amount — in our code the tiny amount is `1e-6`, a millionth — recompute all the residuals, see how much they moved, divide by the nudge. That ratio *is* the slope. You measured it instead of deriving it.

**MAYA:**
Wait. That's it? You just poke each knob and watch what happens?

**THEO:**
That's *literally* it. "How does this affect that? Let me poke it and find out." It's the same thing you'd do in real life if someone handed you a control panel with mystery dials. You'd wiggle a dial and watch the gauges. The solver does that for every knob — wiggle, measure, wiggle, measure — and assembles the whole Jacobian out of measurements.

**MAYA:**
That feels too easy. What's the catch?

**THEO:**
Two catches, and they're real. First, it's *slower*. To fill one column of the table — one knob's effect on every error — you have to recompute *all* the residuals once. So if you've got eighteen knobs, that's eighteen full re-evaluations of the entire error set, every single iteration, just to build the Jacobian. An analytic formula would give you the whole column instantly. Second, it's slightly *inexact* — you're approximating the slope with a tiny step, so there's a hair of error baked in.

**MAYA:**
So why pick the slower, fuzzier way?

**THEO:**
Because it's *robust and simple*, and for assemblies of the size we deal with, the slowness doesn't matter. A few dozen parts, a few dozen mates — the solver still finishes in milliseconds. The numerical Jacobian *just works*, for *every* mate type, with zero per-mate calculus. When I add a new kind of mate, I write the residual — the "how wrong is this" function — and the derivatives come for *free*, because the solver just pokes it. I never derive a Jacobian by hand. That's a huge multiplier on how fast I can add features.

**MAYA:**
And it's flagged as something you'd improve later.

**THEO:**
It's an explicit, written-down "perf follow-up." If assemblies got huge — thousands of parts — the numerical Jacobian would become the bottleneck and we'd switch to analytic derivatives for speed. But that's a problem we don't have, so we took the simple robust thing now and left a note. Honestly that's the recurring theme of this whole project: do the simple correct thing, leave an honest comment about the faster harder thing, move on.

**MAYA:**
Alright. We've got the landscape, the self-tuning lambda dial, and the Jacobian by poking. Put it together. What does one iteration actually look like, start to finish?

**THEO:**
One iteration. Step by step. One: compute all the residuals at the current poses — how wrong is everything right now. Two: build the Jacobian by poking each knob — the full map of slopes. Three: from those, Levenberg-Marquardt computes a proposed step — "move the knobs *this* way by *this* much." Four: tentatively apply it and recompute the total error. Five: did it improve? If yes, keep it and shrink lambda. If no, throw it away, grow lambda, retry. Six: check if we're done — is the error tiny, or did the step barely move anything? If done, stop. If not, loop back to one.

**MAYA:**
And done means?

**THEO:**
Two stopping conditions. Either the total error drops below a threshold — the residuals are essentially zero, everything's satisfied — or the steps get so small that we're clearly not making progress anymore. There's a cap too: eighty iterations max. If it hasn't settled in eighty rounds, we stop and report what we've got. The tolerance for "essentially zero" is `1e-7`. Tiny.

**MAYA:**
And the whole loop runs both in the browser and on the server, you said earlier.

**THEO:**
This is one of my favorite facts about the system. The *exact same algorithm* exists twice. There's `mateSolver.ts` in the browser — TypeScript — and `assemblyMateSolver.js` on the server — plain JavaScript. Same math, same constants, same residual formulas, character for character equivalent. The browser one runs while you *drag* a part, so it snaps into place live with no server round-trip. The server one is the *authoritative* one — it runs when you save, and its answer is what gets stored. Browser for instant feedback, server for the official record. Kept deliberately in sync.

**MAYA:**
Why not just one, on the server?

**THEO:**
Latency. Round-trip to the server on every mouse-move and dragging feels like molasses. So the browser carries its own copy for the interactive feel. But you can't *trust* the browser as the source of truth — different machine, could drift. So when you actually save, the server re-solves from scratch and *its* answer wins. Fast feedback from the browser, trustworthy truth from the server.

**MAYA:**
Okay. We've done the engine in the abstract. Now I want the eight mates. What are the actual rules, and what does "how wrong is this" look like for each?

## Segment 6 — The eight mates and their residuals

**THEO:**
Eight mate types. Let me group them so it's not just a list. There's a family about *flat faces*, a family about *round things*, a couple of *numeric* ones, and two oddballs. And for each, I'll tell you the rule and roughly what the residual measures.

**MAYA:**
Start with the flat-faces family.

**THEO:**
The headline mate is *coincident*. Two flat faces, flush against each other — like a book lying flat on a table. This is the most common mate in any assembly. And it's actually two ideas welded together. First, the faces have to be *parallel but facing opposite ways* — the table points up, the book's bottom points down, they're anti-parallel. Second, the gap between them has to be *zero* — flush, not floating. So the residual has two parts: an orientation error — how far off "anti-parallel" they are — and a separation error — how big the gap is. Four numbers total. Drive all four to zero and the book's on the table.

**MAYA:**
You said "anti-parallel, or parallel if flip." That's the flip flag.

**THEO:**
Right. Sometimes you want the faces pointing the *same* way instead of opposite — depends which side of the part you picked. The flip flag swaps the residual from "make these anti-parallel" to "make these parallel." Same mate, opposite handedness. It's a little escape hatch for "you grabbed the back face, I'll flip the sense."

**MAYA:**
Okay. Next in the flat family?

**THEO:**
*Parallel* and *perpendicular*. These are pure orientation — they don't care about distance at all, just angle. Parallel: two faces should point the same direction. The residual is the *cross product* of their two normals — and the cross product is zero exactly when two vectors are parallel, so that's a clean three-number "how unparallel are you." Perpendicular: two faces should be at right angles. The residual there is the *dot product* of the normals — dot product is zero exactly when two vectors are perpendicular. One number. Beautiful little uses of vector algebra: cross-is-zero means parallel, dot-is-zero means square.

**MAYA:**
Those are elegant. Now the numeric ones.

**THEO:**
*Distance* and *angle*. These are the ones with a `value`. Distance is like coincident — same orientation idea — but instead of "gap is zero" the rule is "gap is *this specific number*." Keep these faces twelve millimeters apart. So the residual is "actual gap minus twelve." Zero when the gap is exactly twelve. Angle is similar for orientation: "these faces should be at *this* angle to each other" — say thirty degrees. The residual measures how far the current angle is from the target. These two are how you parameterize an assembly — turn a number, the parts move.

**MAYA:**
The round-things family.

**THEO:**
The star of that family is *concentric*. Two cylindrical things sharing an axis — a shaft in a hole, a bolt in a bore. This is the "bolt snaps into the hole" mate from the cold open. The rule is: the two *axes* must be the same line. And "same line" is two conditions — the axes must be *parallel* (same direction) and they must be *coincident* (no sideways offset between them). So the residual has a parallel part — cross product of the two axis directions again — and an offset part measuring how far apart the two lines are sideways. Six numbers total. When they're all zero, the shaft is dead-center in the hole, perfectly aligned.

**MAYA:**
And concentric leaves the part free to slide and spin, right? A bolt in a hole can still go in and out and rotate.

**THEO:**
Exactly, and that's important and we'll hit it in the next segment when we talk about degrees of freedom. Concentric pins the axis but leaves two freedoms: slide along the axis, spin around it. That's *correct* — a real bolt in a real hole can do both until something else stops it.

**MAYA:**
The oddballs.

**THEO:**
*Tangent* and *lock*. Tangent is a cylinder touching a flat face — a pipe resting on a tabletop, kissing it along a line. The rule: the cylinder's axis has to be *parallel* to the plane, and the distance from the axis to the plane has to equal the cylinder's *radius* — because that's exactly when the round surface just grazes the flat one. Two residuals. It's a slightly fiddly one but it falls right out of "axis parallel to plane, and the right distance away."

**MAYA:**
And lock?

**THEO:**
Lock is the special one, and it's special in *how* it works, not just what it does. Lock says "these two parts are welded — they move together as one rigid group, never changing their relationship." Now, here's the clever bit. The residual for lock isn't a fixed geometric formula like the others. Instead, at the *very start* of each solve, the solver *captures* the current relationship between the two parts — how B sits relative to A, right now — and stores it. Then the residual for the rest of the solve is "drive B back to *that captured* relationship." So whatever else happens, those two stay glued in exactly the arrangement they had when the solve began.

**MAYA:**
So lock is a snapshot. It photographs the relationship and then enforces the photograph.

**THEO:**
A snapshot it enforces. And there's housekeeping around it — the snapshot is captured at the top of the solve and *cleared* at the end, so it's fresh every time and doesn't leak between solves. It's stored in a little module-level map that gets wiped clean on the way in and the way out. Stateless between calls. That detail matters because the same solver function runs over and over during a drag — you don't want a stale snapshot from three frames ago contaminating this one.

**MAYA:**
That's all eight. Coincident, parallel, perpendicular, distance, angle, concentric, tangent, lock. And the bridge you mentioned way back — the face ID becoming actual geometry — happens where?

**THEO:**
Right before all of this. Remember the document stores a *face ID*, just `f2`. But every residual formula I just described needs *real geometry* — a plane's origin and normal, a cylinder's axis and radius. So there's a translation step. The regeneration pipeline builds a little lookup table: for each instance, "face `f2` is a plane at this origin pointing this way," "face `f5` is a cylinder with this axis and this radius." Where does *that* come from? The kernel. When the kernel tessellates a part, it also *classifies* each face — flat, cylindrical, whatever — and reports the analytic description. The solver consumes that classification, not the raw mesh. So it never needs the heavyweight kernel itself at solve time. It just needs the kernel's *summary* of what each face is.

**MAYA:**
So by the time a mate reaches the solver, "face f2" has become "a plane, here, pointing this way."

**THEO:**
Resolved to pure math. And if it *can't* be resolved — the face doesn't exist anymore, or it's some surface that can't be mated — that mate is *skipped*, with an error recorded, and the rest of the assembly still solves. That's a deliberate choice: one broken mate shouldn't blow up the whole solve. Note it, skip it, carry on. The user sees the error, the rest of the parts still find their places.

**MAYA:**
Good. Now — you keep saying "degrees of freedom" and "under-constrained, fully constrained." That's a whole verdict the solver gives. How does it know?

## Segment 7 — The verdict: under, fully, over

**THEO:**
This is the part that makes the solver genuinely *useful* as opposed to just a positioner, and it's lovely. After the solver finishes, it tells you one of three things about your assembly. Under-constrained: the parts can still move — you haven't pinned them down enough. Fully constrained: everything's locked, exactly one arrangement, nothing can wiggle. Over-constrained: your rules *contradict each other* and can't all be satisfied at once.

**MAYA:**
And those three verdicts are the SolidWorks experience — that thing where it tells you a part is still "under-defined."

**THEO:**
Same idea, yeah. It's essential feedback. "Did I finish positioning this, or is it still floppy? Or did I accidentally tell it two contradictory things?" Without that, you'd be guessing.

**MAYA:**
So how does it *compute* the verdict? Where does "this part can still slide" come from mathematically?

**THEO:**
This is the prettiest math in the whole thing, and I'll try to do it justice without drowning you. Remember the Jacobian — the table of "how does each knob affect each error." Hidden in that table is the answer to "how many independent ways can the parts still move *without breaking any rule*."

**MAYA:**
Unpack that.

**THEO:**
A degree of freedom that's still *free* is a direction you could nudge the parts where *no residual changes*. You move, and nothing gets more wrong — because nothing's stopping you. A direction that's *constrained* is one where moving immediately makes some residual worse — a rule pushes back. So the number of *constrained* directions is, mathematically, the *rank* of a certain matrix built from the Jacobian.

**MAYA:**
Rank. Define rank for me without a linear algebra textbook.

**THEO:**
Rank is the number of genuinely *independent* constraints you have. Here's the intuition. Say you tell a part three different rules, but two of them are secretly saying the same thing — redundant. You *think* you have three constraints; you really have two independent ones. Rank counts the *independent* ones. It sees through redundancy. So rank equals "how many directions are actually pinned down."

**MAYA:**
And then the free directions are...

**THEO:**
Total knobs minus pinned directions. If I have six degrees of freedom on a part and my mates pin down four of them, rank is four, and six minus four is *two* free. Those two are exactly the slide-along-axis and spin-around-axis we talked about with concentric. The math hands you the number two, and it *means* "this bolt can still go in/out and rotate."

**MAYA:**
So the spec actually pins specific numbers. Let me see if I have them. One coincident mate on a free part leaves... three free?

**THEO:**
Three. Coincident pins three of the six — it flattens the part against a face, which kills one position freedom and two tilt freedoms — and leaves three: you can still slide the part around *on* that face in two directions, and spin it. Three free, verdict: under-constrained. Concentric leaves *two* free — slide and spin, like we said. And if you stack three coincident mates in three different directions — boxing the part in from three sides — you pin all six, rank is six, zero free, verdict: *fully constrained*. The part has exactly one place to be.

**MAYA:**
And over-constrained — the contradiction case?

**THEO:**
That one's detected differently — not from rank, from *failure to converge*. Picture two distance mates on the *same pair of faces*: one says "ten millimeters apart," the other says "twenty millimeters apart." The faces can't be both ten and twenty apart at once. There's *no* setting of the knobs that zeros both residuals. The solver runs, can't get the total error to zero, hits its iteration cap still unhappy — and that non-convergence *is* the over-constrained signal. If it couldn't satisfy the rules, the rules contradict.

**MAYA:**
So the logic is: didn't converge means over-constrained. Converged with free directions left means under-constrained. Converged with zero free means fully constrained.

**THEO:**
You just stated the exact decision the code makes, in order. Not converged, it's over. Converged but free directions remain, it's under. Converged and fully pinned, it's fully. Three lines. And every one of those cases has a test that pins the number — one coincident gives three, concentric gives two, three orthogonal coincidents give zero, two conflicting distances gives over, a lock gives zero. Those tests are the contract. If someone breaks the solver, those numbers change and the tests scream.

**MAYA:**
That's genuinely elegant — that "how floppy is this assembly" falls out of a property of the same table you needed for the solve anyway.

**THEO:**
It's free information. You built the Jacobian to *solve*. The rank of it, almost as an afterthought, tells you the *constraint state*. Two birds.

**MAYA:**
Okay. I think I finally actually understand the solver. Can we come up for air? Tell me about the fun stuff. Patterns. The bolt-times-ten thing you parked forever ago.

## Segment 8 — The toolbox: patterns, mirror, subassemblies

**THEO:**
Paying off the parked thing. Patterns. The whole point of a pattern is: you placed *one* part, and you want *many*, arranged regularly, without placing each by hand. Two flavors. Linear: copies in a straight line, evenly spaced. "Ten brackets, twenty-five millimeters apart." Circular: copies arranged around a circle. "Eight bolts evenly around this bolt circle."

**MAYA:**
And the trick you teased — the document doesn't store ten brackets.

**THEO:**
It stores *one* — the seed — and a pattern *rule*: "linear, ten copies, this spacing." The copies don't exist in the document at all. They get *manufactured* during regeneration, in that expand step I mentioned, the one between solve and transform. The expander reads the rule, grabs the seed's already-resolved mesh — no new kernel work, it reuses the seed's geometry — and stamps out the copies at computed positions.

**MAYA:**
So linear expansion is just... seed position plus spacing, plus spacing again, plus spacing again.

**THEO:**
Copy `i` sits at the seed's position plus the spacing times `i`. Copy one is one step over, copy two is two steps over, and so on. Same orientation as the seed, just shifted. Circular's a touch more involved — each copy is the seed *rotated* around an axis by a fixed angular step. Copy one is rotated one step around the circle, copy two is two steps, evenly fanning around. We cap it at a thousand copies so a typo doesn't try to make a billion bolts and melt the server.

**MAYA:**
Smart. And mirror — that's the third one, and you made it sound different from patterns.

**THEO:**
Mirror's special because it's not a *repositioned* copy — it's a *reflected* one. Opposite-hand. The classic case: a left bracket and a right bracket. They're not the same part moved to the other side. The right one is a genuine *mirror image* — like your left and right hands. You can't rotate one into the other; you have to flip it through a mirror.

**MAYA:**
So how do you make a mirror image of a mesh?

**THEO:**
You reflect every vertex across a plane — flip its position to the mirror-image position. Easy enough. But there's a gotcha, and it's a good one. When you reflect a 3D shape, you turn it inside out, *normal*-wise. Every triangle's "which way am I facing" flips. The outside becomes the inside. If you just reflect the points and leave the triangles alone, the part renders *inside-out* — lit wrong, dark where it should be bright, you can see *through* it.

**MAYA:**
So you have to fix the triangles too.

**THEO:**
You reverse their *winding*. A triangle is three points in an order, and that order — clockwise or counterclockwise — is what defines which side is "out." Reflecting flips the handedness, so you swap two of the three corners on every triangle to flip the order *back*. Now the reflected part faces outward correctly. There's a `flip` flag that rides along with mirror copies precisely to trigger that winding-swap during the transform step. Reflect the points, reverse the winding, and you get a proper opposite-hand part that looks right.

**MAYA:**
And here's where I sense another honest-notes moment, because you said "for the mesh." What about export?

**THEO:**
[laughs] You're learning my tells. Yes. Honest note. The mirror works *perfectly* for the *rendered mesh* — what you see on screen is a correct, properly-reflected, properly-lit opposite-hand part. But when you *export* the assembly to a real CAD file — STEP, for a machine shop — the precise solid geometry, the BRep, is *not yet* reflected. The exported mirror copy carries the *seed's* un-reflected shape.

**MAYA:**
Wait, so the screen shows the right bracket but the export gives me a left bracket in the right bracket's spot?

**THEO:**
In the mirror case, roughly yes — the export approximates the mirror copy with the seed's shape. It's flagged in a comment, right in the code, as a known approximation. For linear and circular patterns, export is *fine* — those are just rotations and translations, which the kernel applies cleanly to the real solid. It's *specifically* the reflection that the export path doesn't carry through yet, because reflecting a precise BRep is more involved than reflecting a mesh. So: render is correct, mirror export is approximate. I'd rather tell you that than have you find out at the machine shop.

**MAYA:**
Appreciated. Genuinely. Okay — subassemblies. The recursion. You said an assembly can contain an assembly.

**THEO:**
And this is where the "an assembly *is* a part" decision pays off enormously. A subassembly is just an instance whose part happens to be an assembly. When the resolver hits one, instead of fetching a single part's mesh, it *recursively regenerates the whole subassembly* — solves *its* mates, places *its* parts, composes *its* geometry — and hands the finished result back as one rigid blob. The parent doesn't care that it's secretly a hundred parts. It treats the whole gearbox as a single component it can place.

**MAYA:**
And recursion always makes me nervous. What stops an assembly from containing itself and looping forever?

**THEO:**
Cycle detection, and there are *two* layers of it. The obvious nightmare: assembly A contains assembly B contains assembly A. Regenerate A, which regenerates B, which regenerates A, which... forever. Server melts. So before *every* edit that could create a cycle — every insert, every replace — there's a guard called `assertAcyclic` that walks the whole reference graph and checks: does this assembly, anywhere down the chain, contain *itself*? If yes, reject the edit. You physically cannot save a cyclic assembly.

**MAYA:**
And the second layer?

**THEO:**
The same check also runs at the *top* of regeneration, as a backstop. Even if a bad cycle somehow got into the data, regen refuses to start. And there's a nice touch: the simplest case — inserting the assembly's *own part* into itself — is caught *without even touching the database*. Pure logic, "is this part ID my own part ID." So it works in the unit tests with no database at all, and identically on both database backends. The cheap obvious case is caught cheaply; the deep nested case by the graph walk.

**MAYA:**
One more in this family — replace-component. You swap one part for another.

**THEO:**
Quick one. You've got a placeholder bracket and you want to swap in the real, revised bracket. Replace-component rewrites which part an instance points at — keeps its *placement*, keeps its *mates*. The mates still reference faces by ID, so as long as the new part has compatibly-named faces, the mates just keep working — they re-resolve against the new geometry. If a face the mate needed *doesn't* exist on the new part, that mate surfaces as an *error* — loudly — rather than getting silently dropped. Same philosophy as before: never quietly throw away a user's constraint. If it breaks, tell them.

**MAYA:**
Good. Let's switch from *building* the assembly to *looking* at it. Explode, section, all that.

## Segment 9 — Looking at it: explode, section, display states

**THEO:**
Three ways to *look* at an assembly without changing what it *is*. First, the exploded view — the furniture-instruction diagram. Parts pulled apart in space so you can see how they stack together.

**MAYA:**
How's that stored?

**THEO:**
Each instance gets an *offset* — a direction and distance to push it out — and there's a single global *factor* from zero to one. Factor zero: everything's in its assembled position, fully together. Factor one: everything's pushed all the way out along its offset, fully exploded. And because it's one smooth number, a slider between zero and one *animates* the assembly coming apart and back together. Drag the slider, watch it bloom open.

**MAYA:**
And the offsets — do I have to set each part's explode direction by hand?

**THEO:**
You can, but there's an auto-explode. It finds the *center* of the whole assembly, then for each part it sets the offset to "push this part *away* from the center" — radially outward, like an explosion frozen in time. Parts near the middle barely move, parts on the edges fling out far. One click, instant usable exploded view, then you tweak from there if you want.

**MAYA:**
Edge case — what if a part is *exactly* at the center? It's got no "away from center" direction.

**THEO:**
Caught it. If a part sits right on the centroid, "away from center" is a zero-length direction — undefined, can't push it anywhere. So there's a fallback: parts at the dead center get fanned out along one axis by their index instead, so they still separate visibly rather than staying buried. Little robustness detail, but those are the ones that make a feature feel finished instead of janky.

**MAYA:**
And here's a thing you said earlier that surprised me — the explode is *frontend only*?

**THEO:**
The *application* is, yeah. The server composes the assembly in its *assembled* position. The offsets are stored in the document, but the actual displacement — pushing each part out by its offset times the factor — happens in the *browser*, as a presentation layer on top. The server's geometry is never disturbed. So dragging the explode slider doesn't bother the server at all — it's instant, local, just shifting meshes in the viewer.

**MAYA:**
Makes sense — explode doesn't *change* the design. Section view next?

**THEO:**
Section view slices the assembly with a flat plane so you can see *inside* it. Check that an interior part actually fits, look at clearances, see the guts. You pick an axis — X, Y, or Z — and a position, and everything on one side of that plane is clipped away. Toggle it off, the whole thing's back.

**MAYA:**
And that's a renderer trick, not a geometry change.

**THEO:**
Pure renderer. Three.js — the 3D library in the browser — has a built-in *clipping plane* feature. You hand the renderer a plane and it just refuses to draw anything past it. Nothing's actually cut — the geometry is whole, you're just not *showing* part of it. Flip the toggle and it draws everything again. And the lovely thing is it's the *same viewer* the single-part CAD modeler uses — so section view was "written once" and both the part editor and the assembly editor get it. No duplicated code.

**MAYA:**
Third one — display states.

**THEO:**
Display states are saved *show/hide* configurations. Picture a complex assembly. You want to look at just the frame, so you hide all the fasteners — dozens of bolts. Tedious to do, *worse* to undo. So you do it once, then *save* that configuration as a named display state — "Frame Only." It records exactly which instances are hidden. Later, one click re-applies it: every part snaps back to that saved show/hide pattern. You can have many — "Frame Only," "Electronics Only," "Fully Dressed" — and flip between them instantly.

**MAYA:**
So a display state is just a name plus a list of which parts are hidden.

**THEO:**
That's the entire thing. A name and a list of hidden instance IDs. Saving snapshots the currently-hidden set. Applying sets every part's visible flag to match. Dead simple, genuinely useful. And it ties back to that `visible` flag from the very first segment — the "hidden but still counts" flag. Display states are just saved patterns of that flag.

**MAYA:**
Alright. Last big chunk — the analysis. Does anything crash, how heavy is it. Then the BOM, then we wrap.

## Segment 10 — Analysis: interference and mass

**THEO:**
Two analyses engineers run before they ever cut metal. First: interference detection. The question is brutally simple — "do any two parts occupy the *same space*?" Because if they do, you literally cannot build it. Two solid objects can't be in the same place. It means a mistake in the design.

**MAYA:**
And checking that precisely sounds expensive — every part against every other part, exact geometry.

**THEO:**
It is, which is why it's done in *two phases*, and this is a classic pattern worth knowing. Phase one, the broad phase, is fast and rough. For each part, you compute its *bounding box* — the smallest axis-aligned box that contains it. Just a box, six numbers. Then for every pair of parts, you ask "do their *boxes* overlap?" Boxes overlapping is trivial arithmetic — compare some min and max numbers on each axis. If two boxes *don't* overlap, the parts definitely don't either — done, skip them, no expensive check needed.

**MAYA:**
So the boxes filter out all the obviously-fine pairs cheaply.

**THEO:**
The vast majority of pairs, instantly. In a big assembly, *most* parts are nowhere near each other — their boxes are miles apart, ruled out in a heartbeat. Only the pairs whose *boxes* overlap are *suspicious* — they *might* truly intersect, or they might just be close. Those few suspicious pairs go to phase two.

**MAYA:**
Phase two being the expensive exact check.

**THEO:**
The narrow phase. For each suspicious pair, you ask the *kernel* to compute the actual *intersection* of the two precise solids — a boolean "common" operation: what volume do these shapes *share*? Empty means they were just close, false alarm. A chunk of shared volume means they genuinely overlap — flag it. Exact, but only run on the handful of pairs the broad phase couldn't rule out.

**MAYA:**
Broad phase to skip the easy ones, narrow phase for the precise verdict on the few that survive. And the BReps — you said the precise shapes were kept un-placed.

**THEO:**
This is exactly where they get placed. In compose, the mesh got moved but the precise BRep stayed at the origin, lazily. The narrow phase is "later" — right before the boolean check, it bakes each part's placement into its BRep, kernel-side, so the two solids are in their real assembled positions before being intersected. The cheap mesh was placed eagerly for drawing; the expensive BRep, lazily, only when an analysis demands it.

**MAYA:**
And what if the kernel's down?

**THEO:**
Then you can't do the exact check — no narrow phase. So it *degrades gracefully*: it reports the *broad-phase candidates* — the pairs whose boxes overlapped — as "potential interferences." It's saying "I can't confirm precisely right now, but *these* pairs are close enough to be worth your attention." Honest about its own uncertainty rather than just failing. Each result is tagged: confirmed-interfering, confirmed-clear, or candidate-but-unconfirmed.

**MAYA:**
Good degradation. Mass properties — the heavy-and-balance one.

**THEO:**
Mass properties answers "how big is it and where's the balance point." Total volume, and center of mass — the balance point. And this one's *pure arithmetic*, no kernel needed at all, because remember each composed body carries its *volume* and its *centroid* along with it.

**MAYA:**
So total volume is just... add them up?

**THEO:**
Sum every part's volume. Done. The center of mass is slightly cleverer — it's the *volume-weighted average* of all the part centroids. Weighted, because a big heavy part should pull the balance point toward itself more than a tiny one. So a part's centroid counts in proportion to its volume. Add up each centroid times its volume, divide by total volume, and you've got the assembly's balance point. The kind of thing you'd compute by hand for a seesaw — heavy kid sits closer to the middle — just in 3D, over many parts.

**MAYA:**
And the centroids are already in the right place because of the transform step.

**THEO:**
Right — they got moved into world position back in compose, same as the mesh. So by the time mass properties runs, every centroid is already where the part actually *sits* in the assembly. You just weight and average. And if some part *didn't* report a volume — maybe its kernel computation didn't return mass data — it gets *skipped and counted*, so the result honestly tells you "I summed forty of forty-two bodies." You know when the answer is partial rather than getting a confidently-wrong number.

**MAYA:**
That honesty-about-partialness theme keeps coming up.

**THEO:**
It's a design value. A result that lies to you is worse than a result that says "I'm not sure." Every analysis in here would rather under-claim than over-claim.

**MAYA:**
Last thing before we wrap — the BOM. The parts list. You teased it way back when you said "an assembly is a part so it gets BOMs for free."

**THEO:**
The bill of materials. The parts list — which parts, how many of each. And it's *derived*, stored nowhere, just like everything else. You walk the instance list, count by part ID, skip the suppressed ones. Three instances of part A and one of part B gives you "A times three, B times one." Two lines. The instances *are* the truth; the BOM is just a count of them.

**MAYA:**
And syncing it into inventory?

**THEO:**
There's a sync button. The CAD-derived parts list gets *pushed* into the inventory's bill-of-materials records, under the assembly's own part — remember, the assembly *is* a part, so it can be a BOM parent. It writes one bill-of-material row per distinct component, with the count as the quantity, *replacing* whatever was there before so it's always current. And the moment that sync lands, every *other* tool in the system — ordering, kitting, planning — can work from the CAD-defined structure. The whole inventory side doesn't know or care it came from CAD. It's just a BOM. That's the entire payoff of "an assembly is a part" — the CAD assembly structure flows straight into manufacturing with zero new plumbing.

**MAYA:**
And one small detail I want to confirm — does the BOM count pattern copies? Ten bolts from a pattern — is that ten in the BOM or one?

**THEO:**
Good catch, and it's a *subtle* one. The BOM is over the *authored instances* in the document — *before* pattern expansion. A pattern that *renders* as ten bolts but is *stored* as one seed plus a rule is counted as what's literally in the instances list. It's a known nuance — the count is over authored instances, not expanded render units. Worth knowing if a patterned BOM quantity ever looks off. It counts the document, not the picture.

**MAYA:**
Noted. Okay. I think that's the whole machine. Bring us home.

## Recap

**MAYA:**
Let me try to pull out the big takeaways, and you correct me.

One. An assembly is humble. It's a JSON document — a list of placed *instances* and a list of *mate* rules — hanging off a part in the "Assembly" category. And it's a *part*, which is the keystone trick: nesting and bills of materials and the whole inventory pipeline come for free because the container and the contents are the same kind of thing. Everything visual is *derived* from that document, nothing geometric is stored.

**THEO:**
Nailed it. The "an assembly is a part" decision pays for itself five times over.

**MAYA:**
Two. The solver is not physics, it's calculus. It treats "how wrong is the whole assembly" as a landscape and rolls downhill to the valley floor where every rule is satisfied. The method, Levenberg-Marquardt, is a self-tuning blend of a reckless-but-fast jumper and a slow-but-safe stepper, governed by one dial that gets bolder when it's winning and timid when it stumbles. And the derivatives it needs — the Jacobian — it gets by *poking each knob and measuring*, not by hand calculus. Slower, but robust, and free for every new mate type.

**THEO:**
And the wobble you saw in the cold open was that exact negotiation, live. That's the line I want people to keep.

**MAYA:**
Three. Eight mate types, each one a residual — a "how wrong is this" number, or several — that the solver drives to zero. Coincident is two flat faces flush. Concentric is a shaft centered in a hole. Parallel, perpendicular, distance, angle, tangent, and lock — where lock photographs a relationship and then enforces the photo. And the verdict — under, fully, or over constrained — falls out *for free* from the rank of the Jacobian you already built: how many directions can the parts still move without breaking a rule.

**THEO:**
That free verdict is my favorite single fact in the subsystem. You built the table to solve; it also tells you how floppy your assembly is.

**MAYA:**
Four. The supporting cast, all derived at regeneration time. Patterns stamp many copies from one seed and a rule. Mirror makes a true reflected opposite-hand part — reflect the points, reverse the winding — though, honest note, the *export* of a mirror is still approximate. Subassemblies recurse, guarded by two layers of cycle detection. Explode and section and display states are pure presentation, mostly browser-side. Interference uses a cheap bounding-box pass to filter, then an exact kernel check on survivors — and degrades gracefully when the kernel's down. Mass properties is pure arithmetic over per-body volumes and centroids. And the BOM is just a count of instances that syncs straight into the manufacturing system.

**THEO:**
That's the whole thing. And the through-line — say it with me — derive everything from one humble document, do the simple correct thing, and leave honest comments about the harder faster thing you didn't build yet.

**MAYA:**
The frozen-reuse shortcut that isn't wired. The numerical Jacobian you'd someday make analytic. The mirror export that carries the un-reflected shape. The BOM counting authored instances, not render copies. You told me all of them.

**THEO:**
Because the system that pretends it has no rough edges is the one that hurts you. The one that *names* them, you can trust.

## Teaser

**MAYA:**
So we've now gone room by room through this whole house. Sketches and the constraint solver. The geometry kernel. The version control. And today, assemblies and the mate solver — the densest, hardest core of the lot.

**THEO:**
Which means there's exactly one thing left to do, and it's the thing we've been *gesturing* at the whole season without ever quite explaining.

**MAYA:**
Every episode, you'd say something like "the assembly editor *is* the CAD editor, in a different mode." Or "section view was written once, both editors get it." Or "an assembly rides the *same* version control as a single part." You kept dropping these "it's the same machine underneath" lines and moving on.

**THEO:**
Because that's the finale. Next episode is the architecture episode — how a *single-part* CAD modeler and a *multi-part* assembly editor and a *git-like* version control system are, underneath, *one* set of shared bindings written *once* and reused everywhere. How a part and an assembly flow through the *exact same* save, branch, release, and freeze machinery. The trick that let one small team build what looks like three separate products and is really one.

**MAYA:**
The "written once" payoff. We've been collecting the IOUs all season — and next time he actually pays them.

**THEO:**
Every single one. It's the most satisfying episode to write because it's where all the seams disappear.

**MAYA:**
Episode twelve. The architecture finale. Come see how the magician did it. We'll see you there.

---

# Episode 12 — Written Once: The Architecture

## Cold open

**THEO:**
Remember, way back in Episode 4 — Season 1 finale — when I told you CAD and assembly are secretly the same app, and you looked at me like I'd said the moon was a sandwich?

**MAYA:**
I remember the smugness. You'd been teasing "the big idea" for three episodes. And then in Episode 5 — first episode of this season — you said it again, you put a number on it, you said "we settle the score in Episode 12." Like it was a debt you were going to pay.

**THEO:**
It is a debt. And today I pay it. Today I bring the receipt.

**MAYA:**
[laughs] Okay, but I want to be a hostile auditor about this. Because "the same app" is the kind of thing engineers *say*. It sounds clean. It sounds like a TED talk. And usually when you go look, there's a folder called `assembly` and a folder called `cad` and they're each forty thousand lines and they quietly disagree about everything.

**THEO:**
That's the honest worry. And here's the claim I'm going to defend for the next hour, with actual file names: the part where you check a design out, edit it, save a snapshot, make a branch, compare two versions, freeze it, release it, walk it through review — every bit of that is written *one time*. Not copied. Not "mostly shared." One implementation. And a single-part CAD model and a hundred-part assembly both run through the exact same code, distinguished by a tiny object — a couple hundred lines — that answers, like, six questions.

**MAYA:**
Six questions and you get a whole second product for free.

**THEO:**
Six questions. And the receipt is that when I added thumbnails to version history, assemblies got thumbnails the same afternoon and I didn't open the assembly code once. That's the test. That's how you know it's actually one app and not two apps holding hands.

**MAYA:**
Show me the six questions. Cold-open's over. Let's go.

## Intro

**MAYA:**
Welcome back. This is the show where we take one real piece of software — a browser-based CAD and assembly tool, with a Rust-and-OCCT geometry kernel underneath, all bolted onto a manufacturing inventory app — and we open it up and look at how it genuinely works, not how the marketing slide says it works. I'm Maya. I ask the questions a sharp listener would ask, and I push back when something smells too clean.

**THEO:**
And I'm Theo. I designed and built the system we're dissecting. I'm the one who has to live with the decisions.

**MAYA:**
And this is Episode 12. Which is not just any episode — this is the *finale*. The end of Season 2, and the end of the whole series. Twelve episodes. So today does double duty. First half of the job: we finally, properly explain "written once" — the architecture that ties the entire system together. The thing Theo's been promising since Season 1.

**THEO:**
The spine. We've spent eleven episodes touring the organs. Today we look at the skeleton that holds them in the right places.

**MAYA:**
And the second half of the job is the wrap. We zoom all the way back out, we recap the whole arc — all four pillars, the regen heartbeat, content-addressed history, the mate solver, all of it — we talk about what we'd do differently, and we say goodbye properly. Because you don't get to do a finale twice.

**THEO:**
No pressure.

**MAYA:**
[laughs] None at all. Okay. Before we get fancy, give me the shape of today. What are the segments?

**THEO:**
Five chunks, then the wrap. One: the binding-and-factory pattern, in full, the payoff — what's actually written once and how the "six questions" thing works. Two: the shared editor — the one screen that's both editors. Three: the data model — where all of this lives in the database, the tables. Four: the API surface and permissions — the web addresses, and the one keyring that locks both doors. Five: a "things we learned the hard way" segment, the footguns, the scar tissue. And then we reflect: when does "write it once" actually pay off versus when is it a trap, what I'd change, and the real cost of the bet.

**MAYA:**
And then we go home.

**THEO:**
And then we go home.

## Segment 1 — The binding and the factory: what "written once" actually means

**MAYA:**
Start me at the very bottom. What is the thing that's written once? Give me the noun.

**THEO:**
The noun is a *factory*. And I want to be careful with that word, because "factory" gets thrown around. Here's exactly what I mean. There's a function called `makeWorkingCopy`. You hand it a small object — I'll call it a *binding* — and it hands you back a bundle of operations: checkout, check-in, undo-checkout, release-the-lock, the history reader. A whole working-copy subsystem, built and returned, customized for one document type.

**MAYA:**
So `makeWorkingCopy` is a function that *builds* a piece of software, and you have to feed it something to build it.

**THEO:**
Right. It's a function that returns functions. You call it once at startup — `makeWorkingCopy(cadBinding)` — and you get the CAD working-copy operations. You call it again — `makeWorkingCopy(assemblyBinding)` — and you get the assembly working-copy operations. Same factory. Two products. The factory's *body* — the actual logic of checkout and check-in — is written one time and shared.

**MAYA:**
Okay, use the coffee analogy from somewhere, I know you have one.

**THEO:**
[laughs] I have one and the docs literally use it, so here it is. Picture a coffee machine that can make espresso or tea. The machine — the heating element, the pump, the buttons, the timer — is one device. To switch drinks you drop in a little pod. The pod says: this much water, this grind, this temperature. The machine doesn't change. Only the pod changes.

**MAYA:**
And the machine is the factory.

**THEO:**
The machine is version control. It knows how to lock a document, save a snapshot, branch, compare two snapshots, freeze a finished design. The pod — the binding — is a plain object full of small functions that answer the questions the machine *can't* answer on its own. Because the machine doesn't know what a CAD model *is*. It doesn't know what an assembly *is*. It just knows the verbs.

**MAYA:**
So what are the questions on the pod? You said six. Give me the actual list.

**THEO:**
Let me give you the binding contract, field by field, because this is the whole ballgame. There's a field called `repoFor` — "given this model, which repository do you belong to?" There's `docOf` — "reach into this database row and pull out the serializable document, the part of you worth saving." There's `serialize` and `deserialize` — "turn that document into stored objects and get me a hash back" and the reverse, "given a hash, read it back into a document." There's `applyDoc` — "given a document I just read back, produce the patch that restores it onto the working-copy row." There's `commitMeta` — "any extra metadata you want stamped on every commit." And for the freeze machine specifically, three more: `regen`, "rebuild your 3D geometry"; `snapshot`, "give me a mesh with no heavy data, something I can fingerprint"; and `reconstruct`, "given frozen pieces, rebuild renderable geometry."

**MAYA:**
That's more than six.

**THEO:**
[laughs] It's nine if you're counting strictly, plus a `noun` field that's literally just the word "model" or "assembly" so the error messages read right — "this *assembly* is checked out by someone else" instead of "this *model*." But the *spirit* is six-ish: who am I, what's my document, how do I save and load it, how do I restore it, and how do I rebuild my shape. Everything else the machine already knows.

**MAYA:**
Let me make this concrete, because "document" is doing a lot of work. When the CAD pod answers `docOf` — what comes out?

**THEO:**
For CAD, `docOf` returns an object with three things: `featureTree`, `sketchDoc`, and `equations`. The feature tree is the recipe — the ordered list of steps, extrude, cut, fillet, the stuff we spent Episode 7 on. The sketch doc is all your 2D sketches. And equations is the SolidWorks-style "length equals width times two" relationships. Three pieces.

**MAYA:**
And the assembly pod?

**THEO:**
The assembly pod's `docOf` returns one thing: `assemblyDoc`. A single blob. Inside it there's a list of component instances — "part 42 sitting here, rotated like this" — and a list of mates — "this bolt is concentric with that hole." But from the machine's point of view it's one document.

**MAYA:**
So here's the part I want to poke. CAD's document is three pieces and assembly's is one piece. That's a real difference. How does the same machine swallow both?

**THEO:**
Because the machine never looks *inside* the document. That's the discipline, and it's the whole trick. The machine says "binding, serialize this for me," and the binding hands back a tree hash — a single fingerprint of the whole thing. The machine doesn't care whether under that hash there were three blobs or one blob or three hundred. It just got a hash. It writes a commit pointing at that hash, advances the branch, clears the dirty flag, done.

**MAYA:**
So serialize is where the difference lives, and it's *sealed inside the pod*.

**THEO:**
Sealed inside the pod. Let me show you how parallel the two serializers actually are, because it's almost suspiciously tidy. The CAD serializer — file's called `cadSerializer.js` — writes one blob per feature, one blob per sketch, one blob for the equations, and a little meta blob recording the feature order. Then it bundles those into a tree and hashes the tree. The assembly serializer — `assemblySerializer.js` — writes one blob per component instance, one blob per mate, and a meta blob. Then bundles and hashes.

**MAYA:**
One blob per *feature*, one blob per *instance*. That's the same shape with the nouns swapped.

**THEO:**
The same shape with the nouns swapped. And that granularity isn't cosmetic — it's load-bearing. Because each feature is its own blob with its own fingerprint, when you edit one feature and re-save, only *that* blob gets a new hash. The other nineteen features? Same content, same hash, already in storage, not rewritten. That's the structural-sharing thing we hit in Episode 8. And it's *also* what makes a clean feature-level diff possible, and feature-level cherry-pick. Per-blob granularity buys you three things at once: cheap storage, precise diff, surgical cherry-pick. Same for assembly: per-instance blobs mean you can diff at the "this one component moved" level.

**MAYA:**
Okay. So that's `makeWorkingCopy`. You said there are four factories. Walk me through the others, quickly — what does each one build?

**THEO:**
Four factories, all in the `backend/services/vcs/` folder, all the same pattern — take a binding, return operations. `makeWorkingCopy`, we did: checkout, check-in, undo, lock, history. Inside it lives the whole PDM-style exclusive-lock protocol — the "you can't check this out, Dana has it" logic, the lock expiry, the 423 error code. All document-agnostic. The binding only supplies `docOf`, `serialize`, `deserialize`, `applyDoc`.

**MAYA:**
423 — that's the "locked" HTTP status. We met it in the version-control episodes.

**THEO:**
The "this resource is locked, come back later" code. Second factory: `makeBranchOps`. Create a branch, list branches, switch branches, archive a branch. The interesting one is switch — it reads the branch's head commit, calls the binding's `deserialize` to turn it back into a document, calls `applyDoc` to slam that document onto your working copy, and — this is a nice detail — it sets `releaseLocked` to true if and only if the branch you switched to is named `main`. Because `main` is the protected, released line. You don't freely edit main; you branch off it.

**MAYA:**
So the "main is special and read-only" rule lives in the shared branch factory, not in CAD-specific code.

**THEO:**
In the shared factory. Both document types inherit "main is protected" for free. Third factory: `makeFreeze`. This is the geometry-freezing one. On release, it calls the binding's `regen` once to build the geometry, stores a `snapshot` — a mesh blob with no heavy BReps — plus one binary BRep object per body, and records the manifest: here's the mesh hash, here are the bodies. And then the payoff: there's a function `geometryForCommit`, and if a commit has frozen geometry stamped on it, that function short-circuits and rebuilds the shape from the frozen pieces using the binding's `reconstruct` — with *zero* kernel calls.

**MAYA:**
Zero. So opening a released part doesn't re-run the Rust engine.

**THEO:**
Never. We froze it on purpose so the released geometry is exactly, byte-for-byte, what was approved. Re-running the kernel might — might — produce something a hair different if a library updated. Freezing removes that risk and it's faster. Fourth factory: `makeRelease`. It returns one operation, `release`, and it's a careful little dance: it refuses a duplicate tag *before* it mutates anything — I'll come back to why that ordering matters, it's a footgun we'll get to — then serializes the doc, freezes the geometry into the new commit, claims the write-once tag, *then* advances the branch.

**MAYA:**
And all four of those — working copy, branch ops, freeze, release — are written once and fed both pods.

**THEO:**
Written once. Fed both pods. Now, there's a fifth thing that isn't a factory exactly, it's a registry: the workflow engine. The review process — draft, then in-review, then approved. That's a generic declarative engine. There's a table in code called `WORKFLOWS`, and it maps a document type to a transition table. And here's the punchline: the assembly entry in that table just *points at the CAD workflow*. Literally `assembly: CAD_WORKFLOW`. Same states, same transitions, same permission guards. Assemblies adopt the entire review lifecycle by sharing one line.

**MAYA:**
That's almost a cheat.

**THEO:**
It's the good kind of cheat. The engine itself reads and writes the current state to a table, checks the actor has permission to make the move — submitting needs write, approving needs the approve permission — advances the state, and fires off a notification. If the notification fails, the transition still succeeds; a flaky email never blocks an approval. And there are two more document-agnostic services riding on top of the object store directly. One builds the version-history graph — that branching commit-tree picture — and it's repo-keyed, so it draws the graph for a CAD repo or an assembly repo with the same code. The other is the diff engine.

**MAYA:**
The diff engine is the one I'd expect to need to know the difference between a feature and a bolt.

**THEO:**
And it mostly doesn't! Here's the elegant bit. The core diff is `treeDiff`, and it compares two trees purely by entry hash. If two subtrees have the same hash, they're identical, skip them — that's how it runs in time proportional to what *changed*, not the size of the whole model. It never has to understand content to know two things are equal; equal hashes mean equal content, that's the content-addressing guarantee. The *only* place it gets document-aware is cosmetic: when it formats a human label for a changed entry, there's a function that special-cases the names. A CAD entry starting with `feature:` becomes "Feature so-and-so." An assembly entry starting with `instance:` becomes "Component so-and-so." A `mate:` entry becomes "such-and-such mate." That's it. That's the entire amount of assembly-awareness in the diff engine. A label lookup.

**MAYA:**
So even the diff — the thing that feels like it *should* be deeply different per document — is one engine with a cosmetic name table on the very end.

**THEO:**
One engine, cosmetic name table on the end. And that's the segment, really. That's "written once." Four factories, one workflow registry, a graph builder and a diff engine — all document-agnostic — and two little pods that answer the handful of questions the machine genuinely can't.

## Segment 2 — The shared editor: one screen, two products

**MAYA:**
So that's the backend. The machine. But when I sat in front of this thing, I was looking at a *screen*. And in Episode 4 you had me in an "assembly editor" and earlier you'd had me in a "CAD editor." Different editors. Were they?

**THEO:**
No. And this is the part I'm proudest of, honestly, because the backend "written once" thing — fine, that's a known pattern, factories and bindings, an experienced engineer nods. The frontend doing it too is rarer, because UIs *love* to fork. You add one special case for assemblies and six months later you've got two components that share a name and nothing else. We didn't fork it. There is one editor component. It's called `cad-editor.component.ts`. The assembly editor *is* the CAD editor.

**MAYA:**
How does one component be two things?

**THEO:**
There's a signal — a reactive flag — called `assemblyMode`. And it gets set from the route. When you navigate to the assembly editor URL, the route carries a little piece of data, `assemblyMode: true`, and the component reads it on load. When that flag is on, the component injects an assembly controller and an assembly service, and it swaps two things: the source of the geometry it's displaying, and which panels show up in the ribbon — the toolbar.

**MAYA:**
Swaps the geometry source and the ribbon panels. And keeps what?

**THEO:**
Keeps everything else. The 3D viewer — the thing that renders the model, orbits, the lighting, the selection highlighting — that's `cad-viewer`, reused untouched. The measurement tools — measure a distance, an angle, a radius — reused untouched. And the entire version-control surface, which is a tab in the ribbon called "File": checkout, check-in, branches, the workflow buttons, release, compare two versions, merge — all of that is *one* set of UI, and every button in it just calls whichever API the mode points at.

**MAYA:**
Wait. So the "check out this design" button doesn't know or care whether it's a part or an assembly?

**THEO:**
It knows which *API endpoint* to hit, and that's the only thing the mode changes. In CAD mode the File tab's buttons call `/api/design/cad-model/...`; in assembly mode they call `/api/design/assembly/...`. Same buttons, same layout, same behavior, different address. Which is exactly the backend story mirrored up into the UI — the buttons are written once, the binding is "which URL."

**MAYA:**
Okay, push-back time. That sounds great until the editor gets enormous. One component that has to do everything for two pretty different things — that's a god component waiting to happen. A two-thousand-line file with `if assemblyMode` sprinkled through it.

**THEO:**
That is the real cost, and I'm not going to pretend it isn't. The editor *is* the biggest, busiest component in the frontend, and it grows every time either product grows. That's the price of the bet. I'll defend it on the reflection at the end, because I think the alternative was worse — but you're right to flag it. The honest version is: the shared *viewer* and the shared *File tab* and the shared *measurement* — those seams are clean, they barely know which mode they're in. The editor *shell* that wires them together is where the complexity pools. We concentrated the mess in one known place instead of smearing it across two parallel components. That's a real tradeoff, not a free lunch.

**MAYA:**
So the route wiring is the actual switch. Show me that, because it's almost funny how small it is.

**THEO:**
It is almost funny. In the routes file, there's a route for `parts/:id/cad/editor` and it loads `CadEditorComponent`. And there's a route for `parts/:id/assembly/editor` and it *also* loads `CadEditorComponent` — same component class — with one extra line of data: `assemblyMode: true`. That one boolean on a route is the entire fork between "I am a single-part CAD editor" and "I am a multi-part assembly editor." Everything downstream of that flag is shared.

**MAYA:**
One boolean. That's the whole second product on the frontend.

**THEO:**
One boolean and a couple of injected services it triggers. And the landing pages are split — there's a "CAD Models" list and an "Assemblies" list, those are genuinely two small components because they list different things — but the moment you click into *edit*, you're in the one editor.

## Segment 3 — The data model: where it all lives

**MAYA:**
Let's go down to the database. Because all this checkout, branch, commit, freeze stuff — it has to land somewhere in tables. Draw me the picture in words. What are the tables and who points at whom?

**THEO:**
The cleanest way to hold it in your head is: the database splits into three jobs. The desk, the filing cabinet, and the logbook. Let me do them in order.

**MAYA:**
The desk first.

**THEO:**
The desk is the thing you're working on *right now*. Two tables. `DesignCADModel` — that's the live, editable CAD working copy, one open document. And `DesignAssembly` — the live, editable assembly working copy. Each one is a single row representing "the document currently on your desk." And here's the structural payoff of "written once" showing up in the schema: both of those tables carry the *exact same* block of version-control columns.

**MAYA:**
Same columns. Name them.

**THEO:**
`branchName` — which version line am I on, defaults to main. `baseCommitHash` — the commit I was checked out from, the sixty-four-character fingerprint. `dirty` — a boolean, do I have unsaved edits. Then three lock columns — `lockedByUserID`, `lockedAt`, `lockExpiresAt` — the PDM checkout lock, who's got it and until when. `defaultView` — a saved camera angle, which is a preference, not versioned content. And `releaseLocked` — am I read-only because I've been released. That whole block is byte-for-byte the same on both tables.

**MAYA:**
And the *difference* between the two desk tables?

**THEO:**
Only the document columns. `DesignCADModel` has three: `featureTree`, `sketchDoc`, `equations` — all JSONB, all structured-JSON columns. `DesignAssembly` has one: `assemblyDoc`, also JSONB. That's the entire schema-level difference between a CAD working copy and an assembly working copy. Three content columns versus one. The version-control machinery columns are identical because the version-control machinery is identical.

**MAYA:**
There's a thing I want to make sure I caught. You keep saying "one working copy." Is that enforced, or just a convention?

**THEO:**
Enforced, and it's a nice trick. There's a partial unique index on each table — for CAD it's `design_cad_models_part_unique_active` — and it enforces "one active working copy per part," but only *where the active flag is true*. So you can soft-delete an old one and create a new one and the index doesn't complain, because the deleted one isn't active. The reason that matters: revisions of a part are *not* extra rows in this table. A revision is a tag in version control. There's exactly one live desk per part at a time. The history lives elsewhere.

**MAYA:**
Which is the filing cabinet. Take me there.

**THEO:**
The filing cabinet is the content-addressed object store, and the star table is `VcsObject`. This is the heart of the whole VCS. Every feature blob, every tree, every commit, every chunk of frozen geometry, every component reference, every thumbnail — one row here. And the primary key is a *triple*: `repoType`, `repoId`, and `hash`.

**MAYA:**
Unpack the triple. Slowly. Because that triple is doing a lot.

**THEO:**
`repoType` is `cad` or `assembly` — a namespace. `repoId` is the lineage-root part id — I'll explain "lineage" in a second. And `hash` is the SHA-256 fingerprint of the object's content. Put them together and you get: every object is uniquely identified by what repo it belongs to plus what it contains. Two identical objects — same content, so same hash, in the same repo — collapse to one row. Write it twice, you get one row, no error, no duplicate. That's content addressing, that's the storage efficiency we keep coming back to.

**MAYA:**
And "lineage." You've used it three times now.

**THEO:**
Lineage is the part's whole life across renumbering. In manufacturing, a part gets revised — revision 1, revision 2, revision A — and each revision is technically a new Part row in the inventory database, linked back to the previous one by a `previousRevisionID` field. If we keyed the repository to a single Part row, every revision would start a *fresh* empty history. That's wrong. You want one continuous story. So `repoFor` — remember, that's a binding function — walks `previousRevisionID` all the way back to the original part, the lineage root, and uses *that* id as `repoId`. Every revision of a part shares one repository. One continuous history across the part's entire life.

**MAYA:**
And `repoType` keeps CAD and assembly from colliding on the same part.

**THEO:**
Exactly that. The same physical part could have a CAD model *and* be referenced in assemblies — distinct `repoType` values, so their objects never share rows even though `repoId` is the same. Clean separation, same key structure.

**MAYA:**
Inside `VcsObject`, what are the kinds of thing? You rattled off blob, tree, commit, geometry, component, thumbnail.

**THEO:**
Six kinds. Three are the git-classic core. A `blob` is a leaf — one feature, one sketch, one mate. A `tree` is an ordered list of named pointers to children — "feature colon abc points at this hash." A `commit` wraps a tree with parents, author, message, timestamp, and a little metadata bag — kernel version, naming version. Those three compose into the git-like graph: commit points at tree, tree points at blobs. Then three more. `geometry` is binary — the frozen BRep bytes from the kernel, one body per object. `component` is an assembly thing — it references another repository's commit, "this assembly used revision-such-and-such of that child part." And `thumbnail` is a little PNG snapshot captured on check-in so the history view has pictures. JSON kinds use a `content` column; binary kinds use a `bytes` column; exactly one of the two is filled per row.

**MAYA:**
And the objects never change.

**THEO:**
Never. The table doesn't even have an `updatedAt`. Write once, immutable forever. That's what makes the fingerprint trustworthy — if content could change, the hash would lie.

**MAYA:**
Okay, so objects are the photographs. What are the labels? Branches and tags.

**THEO:**
That's the second filing-cabinet table: `VcsRef`. A ref is a named pointer at a commit. Two kinds. A `branch` is a sticky note you can move — `main` advances every time you check in. A `tag` is a permanent label — `release 01`, or a production letter like `A` — set once at release, never moved. And there's a unique index on repo-plus-name so you can't have two refs fighting over the same name in one repo. The write-once-ness of tags isn't a database constraint, interestingly — it's enforced in the service layer. The update-ref function checks: is this existing ref a tag? Then refuse to move it.

**MAYA:**
Service-layer gate. So the rule lives in code, not in the schema.

**THEO:**
In code. Which is a deliberate choice and occasionally a footgun, because it means anything bypassing that service function could in principle move a tag. The discipline is "everyone goes through `vcsService`." Now — the logbook, job three. There are a few tables here. `DesignCADModelHistory` and `DesignAssemblyHistory` — append-only audit logs. Every meaningful change — created, updated, checked out, released — writes a row: who, when, before-state, after-state. That's the human-facing paper trail, the "who released this and when" answer. It's separate from the VCS commit history, which is the *geometry* trail. Two different histories for two different questions.

**MAYA:**
Why two? That feels redundant.

**THEO:**
It feels redundant and it isn't. The VCS commit graph answers "what did the geometry look like at each save." The audit log answers "what administrative actions happened to this record." A checkout doesn't make a commit — nothing about the geometry changed — but it absolutely makes an audit row, because someone took the lock. Different granularity, different question.

**MAYA:**
What else is in the logbook?

**THEO:**
Three support tables. `VcsWorkflowState` — the review state, draft or in-review or approved, one row per repo. And it's got a sharp detail: the `repoId` for *workflow* is composed as the lineage-root part id, a colon, and the *branch name*. So workflow state is per-branch. Part 42 on `main` and part 42 on `draft/01` have separate review states. That's deliberate — you can have two draft branches both in review at once, and main keeps its own production-approval cycle, independent. And if there's no row at all, that *means* the initial state, draft. A brand-new model starts in draft with zero database writes.

**MAYA:**
Absence means default. Clever — you don't have to write a row to say "this is in the starting state."

**THEO:**
Cheap and clean. Then two reserved-ish tables. `VcsChangeset` — a placeholder for "I edited a part and the assembly that uses it in one atomic save," bundling commits across repos. The table exists, the model loads, but *nothing writes to it yet* — it's a schema seam, wired in early so we won't need a migration when the assembly editor needs it. Honest status: empty.

**MAYA:**
You built the drawer before you had anything to put in it.

**THEO:**
Built the drawer early, on purpose, because adding a drawer later to a content-addressed store is painful. The last one, `VcsUsage`, *does* get written: it's a where-used reverse index. When an assembly commit references a child part's commit, a row records "this child is used by this parent assembly commit." So the question "if I revise this part, which assemblies use it?" is one indexed lookup instead of scanning every assembly commit ever made. Forward edge in the objects, reverse edge in `VcsUsage`.

**MAYA:**
And there was one more — a cache?

**THEO:**
`DesignBRepCache`. And I want to be careful to file it correctly, because people confuse it with the geometry history. This is a *performance cache* for draft editing, CAD only. When you regenerate a model, each feature's computed 3D output gets cached, keyed by four things: which model, which feature, a hash of that feature's parameters, and a hash of all the upstream geometry feeding into it. If you change a feature near the top of a twenty-feature model, only the downstream features get a changed upstream-hash and have to recompute. Everything above the change is a cache hit, loaded instantly, no kernel call.

**MAYA:**
That's the regen heartbeat from Episode 7, basically — only recompute what changed.

**THEO:**
That's the storage side of the regen heartbeat. And the crucial filing distinction: this cache is *disposable*. You can delete every row in it and lose nothing — next regen rebuilds it. The *durable* geometry, the released stuff, lives as immutable `geometry`-kind objects in `VcsObject`, frozen onto release commits. Cache is scratch; the object store is the record. There's even a `namingVersion` field on the cache so that when we change how faces get named, old cache rows get ignored automatically. Mismatched naming version, skip the row, recompute.

**MAYA:**
Okay. Desk, filing cabinet, logbook. Two working copies that share VCS columns, one immutable object store keyed by repo-and-hash, audit logs, workflow state, a where-used index, a reserved changeset drawer, and a disposable geometry cache. Did I get it?

**THEO:**
You got it. And the through-line — say it with me — both working copies carry the same VCS columns, both write into the same object store, keyed so each part lineage owns one continuous repository. The data model *is* "written once" expressed in tables.

## Segment 4 — The API surface and the one keyring

**MAYA:**
Let's go up a layer to the web addresses. The API. Because the browser has to call the backend somehow. What does that surface look like?

**THEO:**
Two parallel address books. `/api/design/cad-model/` with a bunch of endpoints hanging off it, and `/api/design/assembly/` with a deliberately parallel set. And the first nice thing: nobody wired those up by hand. There's a loader, `backend/api/index.js`, that scans the folders and mounts anything containing a `routes.js` file. So the `design/cad-model` folder and the `design/assembly` folder get mounted automatically at those addresses. Drop in a folder with routes, it appears.

**MAYA:**
Convention over configuration. What's actually *at* those addresses?

**THEO:**
Both surfaces expose the full version-control verb set, because both ride those shared factories. Checkout, check-in, undo-checkout, force-unlock, list commits, the graph, branches — list, create, switch, archive — workflow, release, production-release, diff two commits, reconcile. That whole vocabulary appears on *both* address books, identically, because it's the same machine underneath. Then each side adds its own specialty verbs. The assembly side adds the multi-part stuff: insert an instance, update an instance, add a mate, remove a mate, patterns, exploded views, display states, interference checking, mass properties, sync the bill of materials. The CAD side adds single-part stuff: cherry-pick, rebase, working-diff, set-default-view, regenerate-from-recipe.

**MAYA:**
So the shared spine is the VCS verbs, and each grows its own arms for what's genuinely unique.

**THEO:**
That's the shape exactly. The spine is identical; the arms differ because a part and an assembly genuinely *do* different things. You don't add mates to a single part. You don't cherry-pick a feature into an assembly. So those verbs live only where they make sense. But checkout? Branch? Release? Same verb, both books.

**MAYA:**
Now the keyring. You teased "one keyring locks both doors." This is the permissions thing.

**THEO:**
This is the one I'd hold up as the cleanest small decision in the whole system. Every route is two middlewares stacked: first `checkToken` — are you logged in, valid session — then `checkPermission`, with a resource and an action. And the resource for *every* CAD and assembly route is the same single string: `cad`. There is no separate `assembly` permission resource. Both doors, one keyring.

**MAYA:**
Why does that matter? It sounds like a small thing.

**THEO:**
It's small and it's load-bearing in two ways. One, conceptually it's correct — design work is design work; an org that trusts you to edit parts trusts you to edit assemblies, they're the same job. Splitting them would've been a fake distinction. Two — and this is the pragmatic one — reusing `cad` meant we didn't add a new permission resource, which meant we didn't have to bump the hardcoded permission count in the test suite. There's a test that asserts "the system has exactly N permissions," and every new resource means editing that number and re-justifying it. By reusing `cad`, assemblies cost zero new permissions. Zero test churn on the permission count.

**MAYA:**
Four keys on that one ring, right? You mentioned them.

**THEO:**
Four actions. `read` — look at anything, every GET, every listing, every history, every export. `write` — create, edit, checkout, check-in, branch, edit mates, and — important — *development* release. `delete` — soft-delete a model, remove an instance or a mate. And `approve` — the reviewer key. `approve` gates force-unlock and *production* release. So an admin can hand a designer read-plus-write — full design power, they can build and dev-release all day — while reserving `approve` for an engineering reviewer. The release-to-production gate is approval-only. That split is the whole point of having four actions instead of one.

**MAYA:**
There was a nuance in the docs about *where* the approve check actually happens. Something about the workflow route being a bit different.

**THEO:**
Good catch, and it's a subtle one. Most routes wear their permission on their sleeve — production-release is gated right there in the middleware with `checkPermission cad approve`. But the *workflow transition* route — the one you call to move from in-review to approved — is mounted with only `cad read` on the *route*. The real gate is *inside* the workflow engine.

**MAYA:**
Wait, that sounds like a hole. The route only requires read?

**THEO:**
It sounds like a hole and it isn't, here's why. The workflow route is generic — it's the same endpoint for *every* transition, submit, approve, reject, reopen. You can't put a single static permission on the route, because submit needs `write` and approve needs `approve` — different permissions for different moves through the *same* endpoint. So the route just checks you're allowed to *look* at the workflow, and then the engine, when it processes the specific transition, checks the specific permission that move requires. Approve-the-design checks `cad.approve` *in the engine*. The gate moved one layer in, from the route middleware to the transition logic, because that's the only place that knows which transition you're attempting.

**MAYA:**
So the rule "approve gates release" is still enforced — it just lives in the engine for the workflow path, not in the URL wiring.

**THEO:**
Enforced, just relocated to where the knowledge is. The static routes — direct production-release — enforce it in the middleware. The dynamic workflow route enforces it in the engine. Same rule, two enforcement points, depending on whether the path is static or generic. It's the kind of thing that looks inconsistent until you see *why*, and then it's obviously the only way it could work.

**MAYA:**
And on the frontend, the routes carry the same keyring.

**THEO:**
Every browser route — the landing pages, the editor — is guarded by a login guard and a permission guard, and the permission guard's resource is, again, `cad`. So the whole front-to-back access story is: one resource, four actions, both products. You grant `cad.read` and `cad.write` to your designers and `cad.approve` to your reviewers, and you've configured access for the entire CAD-and-assembly world in one stroke.

## Segment 5 — Things we learned the hard way

**MAYA:**
Okay. I love a clean architecture story but I trust a scar-tissue story more. Give me the footguns. The stuff that bit you. The "we learned this the hard way" segment.

**THEO:**
[laughs] My favorite segment, honestly, because this is the real engineering. Five of them. First one — and this one bites everybody who writes tests against this schema — table cleanup ordering. When the test suite tears down between tests, it wipes the tables. But a bunch of these design and VCS tables have foreign keys to Part and User with `onDelete: RESTRICT`.

**MAYA:**
Restrict meaning "you can't delete the parent while a child points at it."

**THEO:**
Right. So if you try to wipe the `Parts` table while a `DesignCADModelHistory` row still references a part, the database slams the door — restrict violation, the delete fails, the test setup explodes. The fix is dumb and absolutely mandatory: in the test setup file, the cleanup list — `tablesToClean` — has to list every child table *before* its parents. `DesignCADModelHistory`, `DesignAssembly`, all of them, sit at the *top* of that list, cleaned first, so that by the time you get to wiping Part and User, nothing points at them anymore.

**MAYA:**
And if you add a new table and forget?

**THEO:**
You get a cryptic restrict error in some unrelated test's teardown and you lose forty-five minutes. It's documented now precisely because it cost somebody those forty-five minutes. New table with a Part or User FK on restrict? Goes at the top of the cleanup list. That's the rule.

**MAYA:**
Number two.

**THEO:**
`displayName` is unique on the Users table. Sounds innocent. But there's a test helper that spins up an authenticated user, and it defaults the display name to "Test User." So the first time you call it in a test, fine. But if a single test needs *two* users — say you're testing "Dana has it checked out, can Sam check it out" — the second call tries to make *another* "Test User," hits the uniqueness constraint, and the test dies with a database error that has nothing to do with what you're testing.

**MAYA:**
So the lock-contention test, the exact thing this whole system cares about, is the one most likely to trip it.

**THEO:**
The exact one. Two users in one test is the checkout-conflict scenario, which is core. The fix is trivial once you know — give the second user a distinct display name — but the failure is mystifying until you know. So it's written down.

**MAYA:**
Three. And I think you owe me this one — the permission count.

**THEO:**
The permission-count one, which I half-told earlier. There's a test that asserts the total number of permissions in the system is exactly some number. It's a guard against accidentally adding or dropping a permission. Good test. But it means *every* new permission resource forces you to edit that number and explain why it changed. When we built assemblies, the lazy instinct is "new feature, new permission resource, `assembly`." If we'd done that, we'd have added four actions — read, write, delete, approve — bumped the count by four, edited the test, justified it. Instead we reused `cad`. Zero new permissions. Zero count change. The test didn't even notice assemblies exist. And the *conceptual* win — that design is one job — and the *practical* win — no test churn — pointed the same direction. When both the clean answer and the lazy answer agree, take it.

**MAYA:**
Four.

**THEO:**
Four is an assembly test-fixture thing, and it's a nice "watch your assumptions" lesson. To test assemblies you need a Part that's *eligible* to be an assembly. And eligibility is decided by the part's category — there's an "Assembly" category. In the test fixtures, that category happens to have id 4. So the tempting shortcut in a test is to hardcode "category id 4" when you make your fixture part.

**MAYA:**
And the trap is...

**THEO:**
The trap is that the *production code* doesn't resolve eligibility by id. It resolves it by *name* — it looks up the category named "Assembly." The id is an accident of fixture-seeding order; the name is the contract. So a test that hardcodes id 4 is coupling to an accident. If the seed order ever changes, id 4 becomes something else, your fixture is suddenly a "Bracket" or whatever, and the test breaks for a reason that has nothing to do with the code under test. The lesson — match the production code's contract. Production resolves by name, so the test should think in terms of name, not the magic number it happens to map to today.

**MAYA:**
Couple to the contract, not the coincidence. Five.

**THEO:**
Five is the best one, because it's a real ordering bug we actually shipped and had to fix, and it's about release. Remember I said `makeRelease` refuses a duplicate tag *before* mutating anything? The original version didn't. The original `release` did the natural thing: it created the release commit, advanced the `main` branch to point at it, and *then* checked "wait, does this release tag already exist?"

**MAYA:**
And if it already existed?

**THEO:**
It threw an error — write-once, you can't re-tag. But by then it had *already* created the commit and *already* moved main forward. So a double-click, or a race, or a retried request would leave you with an orphan duplicate release commit, and main pointing *past* the actually-tagged commit. The history graph would show an untagged commit as the head, and the "released" badge sitting on a buried ancestor below it. The repo looked corrupted. The released marker and the branch head had diverged.

**MAYA:**
Because you did the irreversible mutation *before* the check that would've said "don't."

**THEO:**
Before the check. Classic ordering bug. The fix is just: check first, mutate second. Refuse the duplicate tag *up front*, before you touch anything. And — extra belt-and-suspenders — claim the write-once tag *before* you advance the branch, so that even in a true race, the worst case is a harmless unreachable commit object that nobody points at, instead of a moved branch. Reorder the dance so the irreversible step is last and the check is first. It's a one-line conceptual change and it took a corrupted-looking repo to learn it.

**MAYA:**
So the "freeze before tag, check before mutate" ordering in `makeRelease` is a *scar*. It looks like deliberate elegance and it's actually a lesson written into the code.

**THEO:**
Most elegance is a scar if you look closely. The clean code is clean *because* the messy version hurt.

## Segment 6 — Reflection: when "write it once" pays, and when it's a trap

**MAYA:**
Alright. This is the reflection. And I want to be the auditor one more time, because it would be too easy to end on "and it was all wonderful." When does "write it once" actually pay off, and when is it the premature-abstraction trap that every senior engineer warns juniors about?

**THEO:**
It's a real knife-edge and I want to give you the honest version, not the victory-lap version. "Write it once" pays off when there's a *clean seam*. When the two things you're unifying genuinely share a spine and differ only at well-defined joints, where you can name the joints. We could name our joints precisely — serialize, deserialize, regen, freeze. Six or nine functions, crisply defined. The differences between CAD and assembly *fit through that interface* without leaking. When that's true, sharing is pure win: half the code, no drift, a feature added once shows up everywhere.

**MAYA:**
And when is it a trap?

**THEO:**
It's a trap when you abstract *before* you can see the seam. When you've got one thing, and you *imagine* a second thing, and you build the elaborate plug-and-socket machinery for the second thing before it exists. Then you're guessing where the joints go, and you guess wrong, and every real requirement that shows up later has to be bent to fit an interface you invented in a vacuum. That's premature abstraction. The machinery costs more than it saves, and worse, it *lies* — it implies a flexibility that doesn't actually hold.

**MAYA:**
So what made *your* case the good kind and not the bad kind?

**THEO:**
Honestly? We built CAD *first*, completely, as a single concrete thing, with no abstraction. The factories didn't exist. It was just "the CAD VCS." And only *then*, when assembly came along as a real second requirement — not an imagined one, a real one with real mates and real instances — did we look at the working CAD code and ask "what actually has to differ?" And the answer was small and clean: how you serialize, how you regen, how you freeze. So we extracted the factories *from* working code, with the seam visible, validated by a second real case. That's the difference. We didn't abstract for an imaginary future. We refactored a concrete present once the future *arrived and showed us its shape*.

**MAYA:**
That's a meaningfully different story than "we designed a beautiful plugin architecture up front."

**THEO:**
Completely different, and I'd argue it's the *only* safe way to get here. The rule I'd give: don't build the second thing's abstraction until you have the second thing in front of you, demanding it. Two concrete cases before you generalize. One is a guess. Two is a seam.

**MAYA:**
What would you do differently? You don't get to just claim victory.

**THEO:**
Two things, real ones. First — the editor component. I said it earlier and I meant it: that thing is *big*, and it grows with both products, and the `assemblyMode` flag threads through more of it than I'd like. If I did it again I'd push harder to keep the shared *shell* thin and move more of the mode-specific behavior out into the injected services and the swapped panels, so the shell is closer to "a frame that hosts a viewer, a File tab, and a ribbon" and further from "a thing that knows what an assembly is." We got the *backend* seam beautifully clean. The *frontend* seam is good but it's the place the abstraction strains, exactly like I warned in Episode 5 it might.

**MAYA:**
You called your own shot in Episode 5. You said "the abstraction strains where the two document types genuinely differ, and knowing what to leave *out* of the shared machine is as important as what to put in."

**THEO:**
And the editor is where it strained. I'll own that. Second thing I'd do differently — the `VcsChangeset` table. The empty drawer. I built it early so a future cross-repo atomic save wouldn't need a migration. Defensible. But it's been sitting empty for a while now, and an empty table that "we'll use eventually" is a small lie in the schema — a reader sees it and assumes it does something. I'm not *sorry* I built the seam, content-addressed stores really are painful to migrate, but I'd be more disciplined about either using a seam soon or documenting loudly that it's reserved. We did document it. But the honest tension is real: the line between "wisely pre-wired" and "speculative cruft" is thin, and `VcsChangeset` sits right on it.

**MAYA:**
And the cost of the shared editor growing large — is that a "we'll pay it someday" cost or a "it's fine actually" cost?

**THEO:**
It's a "we concentrated the cost on purpose and it's manageable, but it requires vigilance" cost. The bet was: one big well-known complex component is better than two parallel medium-complex components that drift. I still believe that bet. A god-component you *know about* and tend deliberately beats two siblings that silently disagree. But it's not free, and the failure mode if you stop tending it is that the `assemblyMode` branches multiply until the shared-ness is fiction. So the price isn't paid once — it's a *subscription*. You keep paying it by keeping the shell honest. That's the truthful version.

**MAYA:**
A subscription, not a one-time fee. I like that. And the score — Episode 5 you said "we're keeping score on this bet all season." What's the final score?

**THEO:**
The final score: the bet won, decisively, on the backend, and won on points, with an asterisk, on the frontend. Backend — four factories, one workflow registry, one diff engine, one graph builder, two tiny bindings — that's as clean a "written once" as I've ever shipped, and the proof is that assembly features land without touching assembly-specific VCS code, because there mostly *isn't* any. Frontend — one editor, one viewer, one File tab, one measurement stack, one keyring, one boolean on a route — also genuinely shared, but the editor shell is where the seam is under tension and where the subscription comes due. Net: the receipt is real. CAD and assembly *are* the same app. I'd make the same bet again. I'd just keep a closer eye on that one component.

## Recap

**MAYA:**
Okay. This is the part where I pull out the takeaways — except today I've got two jobs, so first the takeaways *from this episode*, then the wrap of the whole series. Episode takeaways. Theo, four. Go.

**THEO:**
One. **The factories are written once and parameterized by a binding.** `makeWorkingCopy`, `makeBranchOps`, `makeFreeze`, `makeRelease` — each takes a small pod of functions and returns a whole subsystem. CAD and assembly supply pods that differ only in how a document is saved, loaded, restored, regenerated, and frozen. Checkout, branching, diff, freeze, release, and the review workflow exist *one time*.

**MAYA:**
Two.

**THEO:**
Two. **The difference between the two products is tiny and well-defined.** CAD's document is feature-tree-plus-sketches-plus-equations, a tree of blobs; assembly's is one assembly-doc blob. The machine never looks inside — it just gets a hash. The frontend's whole fork is one boolean, `assemblyMode`, on a route, loading the *same* editor component. The backend's whole fork is two two-hundred-line bindings.

**MAYA:**
Three.

**THEO:**
Three. **The data model is "written once" in tables.** Both working copies — `DesignCADModel` and `DesignAssembly` — carry an identical block of version-control columns and write into the *same* content-addressed object store, `VcsObject`, keyed by repo-type, lineage-root part id, and content hash, so each part's whole life is one continuous repository. And one permission resource — `cad`, four actions — locks both doors.

**MAYA:**
Four.

**THEO:**
Four. **The clean seam is what made the abstraction safe, and we found it by building CAD first.** "Write it once" pays when you can name the joints and the differences fit through them — and it's a trap when you abstract before the second real case exists. We refactored a working concrete CAD system into factories *when assembly arrived and showed us the seam*, not before. Two concrete cases before generalizing. One is a guess; two is a seam.

**MAYA:**
And the scar tissue, as a bonus: clean cleanup ordering in the tests, unique display names, reusing the permission resource to dodge a count bump, coupling to the category *name* not its id, and check-before-mutate in release so a double-click can't corrupt the repo. Most elegance is a scar if you look closely.

**THEO:**
That's the lot.

**MAYA:**
Now — the big one. The series. Twelve episodes. Walk it back with me, because I want the listener to feel the whole shape one time before we let them go.

**THEO:**
Let's do it. Season 1 was the friendly tour — four episodes to get oriented. Episode 1: what parametric CAD even *is* — that a model is a *recipe*, an ordered list of steps, not a frozen lump of geometry. Episode 2: down into the geometry kernel, the Rust-and-OCCT engine doing the real 3D math. Episode 3: the time machine — version control, git-for-CAD, branch and release a part like source code. Episode 4: assemblies, the mate solver, and the first tease of the big idea.

**MAYA:**
And then we went deep. Season 2.

**THEO:**
Episode 5: first principles, properly — why browser CAD, why ship the recipe and not the cake, and the four pillars laid out as a map for the whole season. Episode 6: sketching and the constraint solver — the Newton-Raphson engine that snaps your wobbly rectangle into exact shape, the same solver that ships in FreeCAD, running dozens of times a second. Episode 7: 2D to solid — extrude, revolve, the feature tree, and the parametric rebuild, the *regen heartbeat*, where you change step two and steps three through twelve all replay.

**MAYA:**
Keep going. The back half.

**THEO:**
Then the deep machinery. The kernel internals — how OCCT actually turns a profile into a body, persistent face naming, the topology. The content-addressed history in full — blobs, trees, commits, the SHA-256 fingerprints, structural sharing, how editing one feature re-hashes one blob and shares the rest. The mate solver in real depth — degrees of freedom, how concentric-plus-coincident drops a floating bolt down a hole without you typing a single number. And the assembly subsystem — instances, mates, patterns, BOMs, interference, exploded views. Every pillar, taken apart and put back together.

**MAYA:**
The four pillars. Say them as a set, one last time.

**THEO:**
Four pillars. One — **parametric modeling**: the part is a recipe you replay, not a file you save. Two — **the geometry kernel**: a real Rust-and-OCCT engine doing the hard solid math, frozen on release so what's approved is exactly what ships. Three — **content-addressed version control**: git for geometry, every snapshot a fingerprint, branches that move and tags that never do, one continuous history per part lineage. Four — **the unification**, today's episode: CAD and assembly are one app, written once, two thin bindings, one editor, one keyring. The recipe, the engine, the history, and the seam that holds them together.

**MAYA:**
The recipe, the engine, the history, and the seam. That's the whole system in eleven words.

**THEO:**
That's the whole system in eleven words. And it started, way back in Episode 5, with a sentence that sounded wrong: a part's shape is not a file you save, it's a history you replay. Everything we built is in service of that one inversion. Ship the recipe. Keep every version. Bake the cake only when someone needs to look at it. And — the part it took us twelve episodes to earn — bake it for parts and assemblies with the *same oven*.

## Teaser

**MAYA:**
So this is the spot where I'd normally say "next time, on the show" — and there isn't a next time. This is the finale. So instead, let me point you somewhere real. Theo, if someone finishes this and wants to actually *read* the thing — the genuine architecture, the file names, the requirements, the footguns we only had time to gloss — where do they go?

**THEO:**
There's a documentation tree, `docs/cad-system/`, and it's the real thing — not marketing, the actual engineering docs. There's a system overview, then a page per pillar: the CAD modeler, the kernel, the version control, the assembly. And an architecture section that is, basically, this episode in written form — the unified VCS bindings, the data model table by table, the API and route surface, the permission gating. Every requirement we mentioned by number is in there with its rationale and its test. If today was the helicopter view of the skeleton, those docs are the X-rays.

**MAYA:**
And it's honest in there. The footguns are written down. The empty `VcsChangeset` drawer is labeled as reserved. The scars are scars on the page too.

**THEO:**
That was the whole ethos of the docs and the whole ethos of this show: tell the truth about the tradeoffs. The approximate bits are flagged approximate. The unfinished bits are flagged unfinished. A system you understand honestly is a system you can actually change. We tried never to hand-wave.

**MAYA:**
So that's where we leave you — `docs/cad-system/`, if you want to keep going. Read the receipts yourself.

**THEO:**
Read the receipts. They hold up.

**MAYA:**
Okay. Twelve episodes. We took one real piece of software — a browser CAD tool, a Rust geometry kernel, a git-like version-control system, all bolted to an inventory app for a real manufacturing shop — and we cracked it all the way open. I came in able to ask "but why not just save a file?" and I'm leaving able to tell you exactly why the file is the cake and the recipe is the part. That's a genuinely different brain than I started with.

**THEO:**
That was the entire goal. Not to make you a CAD engineer — to make the black box stop being black. To let you look at any serious piece of software and believe, correctly, that it's *knowable*. There's no magic in here. There's a recipe, an engine, a history, and a seam. Smart, careful, scarred — but knowable.

**MAYA:**
To everyone who rode all twelve of these with us — thank you. Genuinely. You gave a couple of people an hour at a time to geek out about parametric solids and content-addressed commits, and that's a real gift. We hope you walk away seeing the software around you a little more like a thing with gears and a little less like a wall.

**THEO:**
Thank you. It's been an absolute joy. Go build something. And when it gets complicated — write the second thing concretely before you abstract it. Find the seam. Then write it once.

**MAYA:**
Find the seam. Then write it once. That's the show. I'm Maya.

**THEO:**
I'm Theo.

**MAYA:**
This has been the whole series. Take care of yourselves — and we'll see you out there in the deep end.

[both laugh]

**THEO:**
See you in the deep end.

---

