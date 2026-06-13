#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_MakeSimpleOffset.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Check.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Law_Function.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shell.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TCollection_AsciiString.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Torus.hxx>
#include <bindings_common.hxx>
#include <stdexcept>
#include <string>

// MakeThickSolidByJoin throws `Standard_Failure` (OCCT's own exception
// type, NOT derived from `std::exception`) on infeasible offsets —
// thickness larger than the body's narrowest curvature, self-
// intersecting offset surfaces, picked faces that can't be cleanly
// removed. cxx's `Result<()>` auto-wrapping only catches
// `std::exception`, so a bare `Standard_Failure` escapes the bridge
// and trips `std::terminate` (with or without an active exception,
// depending on what's currently unwinding). This shim catches the
// OCCT exception in C++ and rethrows it as `std::runtime_error`,
// which cxx WILL convert into a Rust `Err`. Mirror's the rationale of
// `try_construct_unique` in bindings_common.hxx — same problem class,
// same fix.
// Defeature small fillets — cylindrical or toroidal faces whose
// minimum radius is below `max_radius` AND whose boundary edges are
// all tangent (G1 continuous) with their neighbors. This catches
// fillets that would otherwise break MakeThickSolid when the offset
// distance exceeds the fillet radius — removing them "squares" the
// affected corners, which is exactly the SolidWorks "ignore fillets
// smaller than the shell thickness" behavior.
//
// The tangent-boundary check is what disambiguates a fillet from a
// regular cylinder (e.g. a hole): a hole's boundary edges meet the
// adjacent faces at a sharp corner, so their continuity is C0
// (vertex match only), not G1.
//
// Returns the defeatured shape on success, or a deep-copy of the
// original shape when no fillets matched the criteria. Throws on
// OCCT failure so the caller's try/catch can translate to Err.
// NOTE: this helper is RESERVED for a future "square only the inner
// corner of the shell" pipeline that offsets a defeatured copy of the
// body inward and subtracts it from the original. It is NOT currently
// wired up in `Shape::shell` — using it directly there has the wrong
// semantics (it squares the OUTER fillets, which the user wants
// preserved). Keep the binding so the subtraction pipeline can reuse
// it without re-implementing fillet detection.
inline std::unique_ptr<TopoDS_Shape> try_remove_small_fillets(
    const TopoDS_Shape& shape,
    double max_radius) {
  std::fprintf(stderr,
    "[shell:cpp] try_remove_small_fillets: max_radius=%.6f\n", max_radius);
  std::fflush(stderr);
  try {
    TopTools_IndexedDataMapOfShapeListOfShape edge_face_map;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map);

    TopTools_ListOfShape to_remove;
    for (TopExp_Explorer face_exp(shape, TopAbs_FACE); face_exp.More(); face_exp.Next()) {
      TopoDS_Face face = TopoDS::Face(face_exp.Current());
      BRepAdaptor_Surface surf(face, Standard_False);
      GeomAbs_SurfaceType st = surf.GetType();
      double r = 0;
      if (st == GeomAbs_Cylinder) {
        r = surf.Cylinder().Radius();
      } else if (st == GeomAbs_Torus) {
        // Torus has major + minor; the FILLET radius is the minor
        // (the cross-section), not the path around the major axis.
        r = surf.Torus().MinorRadius();
      } else {
        continue;  // not a fillet-shaped surface
      }
      // Defeature when the fillet radius is less than OR EQUAL to
      // the offset distance (with a small floating-point margin).
      const double epsilon = 1.0e-6;
      if (r > max_radius + epsilon) continue;

      // Walk the face's edges and count tangent (G1+) vs sharp (C0)
      // neighbors. The key disambiguator: a fillet ALWAYS has at
      // least one tangent edge — the long edges along its length
      // where the cylinder/torus smoothly meets the adjacent planar
      // face. The short "cap" edges at the fillet's ends can be
      // sharp (where the fillet meets a planar top/bottom face)
      // without disqualifying the face from removal.
      //
      // A regular cylindrical HOLE has ZERO tangent edges — its
      // circular boundaries meet the surrounding planar faces at
      // sharp 90° angles. That's how we keep holes / drilled
      // features intact while removing genuine fillets.
      int tangent_count = 0;
      for (TopExp_Explorer edge_exp(face, TopAbs_EDGE); edge_exp.More(); edge_exp.Next()) {
        const TopoDS_Edge& edge = TopoDS::Edge(edge_exp.Current());
        if (!edge_face_map.Contains(edge)) continue;
        const TopTools_ListOfShape& adj = edge_face_map.FindFromKey(edge);
        // Find the OTHER face sharing this edge.
        TopoDS_Face neighbor;
        bool found = false;
        for (TopTools_ListIteratorOfListOfShape it(adj); it.More(); it.Next()) {
          if (!it.Value().IsSame(face)) {
            neighbor = TopoDS::Face(it.Value());
            found = true;
            break;
          }
        }
        if (!found) continue;  // single-face edge — open boundary
        GeomAbs_Shape cont = BRep_Tool::Continuity(edge, face, neighbor);
        // GeomAbs_G1 is the "first-derivative continuous" / smooth-
        // tangent class. Anything <= GeomAbs_C0 is a sharp corner.
        if (cont >= GeomAbs_G1) {
          tangent_count++;
        }
      }
      if (tangent_count > 0) {
        to_remove.Append(face);
      }
    }
    std::fprintf(stderr,
      "[shell:cpp] try_remove_small_fillets: %d faces marked for removal\n",
      to_remove.Size());
    std::fflush(stderr);
    if (to_remove.IsEmpty()) {
      // Nothing matched — caller can shell the original body directly.
      // Return a deep copy so the caller has a single shape-ownership
      // model regardless of whether defeaturing applied.
      return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(shape));
    }
    BRepAlgoAPI_Defeaturing df;
    df.SetShape(shape);
    df.AddFacesToRemove(to_remove);
    df.Build();
    if (!df.IsDone()) {
      throw std::runtime_error(
        "Defeaturing: operation did not complete. The fillets adjacent "
        "to the picked area may be load-bearing for other features; "
        "removing them produced invalid geometry.");
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(df.Shape()));
  } catch (const Standard_Failure& e) {
    throw std::runtime_error(std::string("Defeaturing: ") +
      (e.GetMessageString() ? e.GetMessageString() : "(no message)"));
  } catch (const std::exception&) {
    throw;
  } catch (...) {
    throw std::runtime_error("Defeaturing: unknown C++ exception");
  }
}

// Offset a solid INWARD by `thickness` — produces a closed solid
// that's the same shape as the input but smaller. Used by the
// subtraction-pipeline fallback in Shape::shell to build the inner
// cavity that gets subtracted from the original body, preserving the
// original outer fillets in the result.
// ONE inward-offset attempt with a specific join type + tolerance. The whole
// MakeOffsetShape lifetime — PerformByJoin, Shape(), AND the destructor — sits
// inside the try block so an OCCT Standard_Failure from any of them becomes a
// std::runtime_error instead of tripping std::terminate across the bridge.
inline std::unique_ptr<TopoDS_Shape> offset_inward_once(
    const TopoDS_Shape& shape,
    double thickness,
    double tolerance,
    GeomAbs_JoinType join,
    bool intersection) {
  try {
    BRepOffsetAPI_MakeOffsetShape mos;
    mos.PerformByJoin(
      shape,
      -thickness,                                 // negative = inward
      tolerance,
      BRepOffset_Skin,
      intersection ? Standard_True : Standard_False, // complete intersection:
                                                  // ON lets OCCT trim crossing
                                                  // offset faces so a region
                                                  // thinner than 2x the offset
                                                  // self-trims to empty (vanishes
                                                  // from the void) instead of
                                                  // returning a null shape
      Standard_False,                             // self_intersection
      join,                                       // join type (Arc | Intersection)
      Standard_True);                             // RemoveInternalEdges
    if (!mos.IsDone()) {
      throw std::runtime_error(
        "operation did not complete (body's narrowest dimension may be "
        "smaller than 2x thickness)");
    }
    const TopoDS_Shape& result = mos.Shape();
    // Guard NULL *before* constructing BRepCheck_Analyzer. The analyzer's
    // ctor throws OCCT's cryptic internal "BRepCheck_Analyzer::Init() - NULL
    // shape" Standard_Failure on a null shape — useless to the user. A null
    // result here means OCCT silently gave up: the inward offset
    // self-intersects at this join type / tolerance.
    if (result.IsNull()) {
      throw std::runtime_error(
        "OCCT produced a null shape (offset self-intersects at this join type)");
    }
    int n_solids = 0, n_faces = 0;
    for (TopExp_Explorer e(result, TopAbs_SOLID); e.More(); e.Next()) n_solids++;
    for (TopExp_Explorer e(result, TopAbs_FACE); e.More(); e.Next()) n_faces++;
    // If the offset produces just a surface shell (no closed solid), the
    // subsequent boolean subtract silently no-ops and the user sees an
    // "unshelled" result — reject it here so the next attempt runs.
    if (n_solids == 0) {
      throw std::runtime_error(
        "result has no solid (open offset surface, not a closed solid)");
    }
    BRepCheck_Analyzer chk(result);
    if (!chk.IsValid()) {
      throw std::runtime_error("result fails geometric validity check");
    }
    std::fprintf(stderr,
      "[shell:cpp] offset_inward_once OK: solids=%d faces=%d\n", n_solids, n_faces);
    std::fflush(stderr);
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure& e) {
    throw std::runtime_error(
      std::string(e.GetMessageString() ? e.GetMessageString() : "(no message)"));
  }
}

// Inward solid offset with a retry chain. Two dimensions matter:
//   • complete-intersection flag: ON makes OCCT trim crossing offset faces, so
//     a region thinner than 2x the offset self-trims to EMPTY (vanishes from
//     the void) instead of returning null — this is what lets the subtraction
//     pipeline leave thin regions solid. We try it ON first, since OFF returns
//     a null shape on exactly those bodies.
//   • join type x tolerance: Arc is "most forgiving for concave corners";
//     loose tolerance gives OCCT slack when the tight pass collapses a patch.
inline std::unique_ptr<TopoDS_Shape> try_offset_solid_inward(
    const TopoDS_Shape& shape,
    double thickness,
    double tolerance) {
  std::fprintf(stderr,
    "[shell:cpp] try_offset_solid_inward: thickness=%.6f tol=%.6f\n",
    thickness, tolerance);
  std::fflush(stderr);
  double loose = thickness * 0.1;
  if (loose < tolerance) loose = tolerance;
  struct Attempt { GeomAbs_JoinType join; double tol; bool inter; const char* name; };
  // Intersection join FIRST: it miters offset faces into SHARP corners, so a
  // prismatic body keeps its flat faces and no cylindrical "rolled corner"
  // faces are invented. Arc join (which rolls every corner with a fillet of
  // radius = offset, multiplying faces and edges) is only a fallback for when
  // the sharp miter can't be computed. The intersection flag (3rd column) is
  // what lets either join survive a thin region that self-trims to empty.
  const Attempt attempts[] = {
    {GeomAbs_Intersection, tolerance, true,  "inter/Intersection/tight"},
    {GeomAbs_Intersection, loose,     true,  "inter/Intersection/loose"},
    {GeomAbs_Intersection, tolerance, false, "Intersection/tight"},
    {GeomAbs_Arc,          tolerance, true,  "inter/Arc/tight"},
    {GeomAbs_Arc,          loose,     true,  "inter/Arc/loose"},
    {GeomAbs_Arc,          tolerance, false, "Arc/tight"},
  };
  std::string last_err = "(none)";
  for (const auto& a : attempts) {
    try {
      auto out = offset_inward_once(shape, thickness, a.tol, a.join, a.inter);
      std::fprintf(stderr, "[shell:cpp] inner offset attempt %s SUCCESS\n", a.name);
      std::fflush(stderr);
      return out;
    } catch (const std::exception& e) {
      last_err = e.what();
      std::fprintf(stderr,
        "[shell:cpp] inner offset attempt %s err: %s\n", a.name, last_err.c_str());
      std::fflush(stderr);
    }
  }
  throw std::runtime_error(std::string("Inner offset: ") + last_err);
}

// ── Stage 0: simple (Parasolid-style) shell ──────────────────────────
// Remove the picked faces to form an open shell, then offset that shell
// with BRepOffset_MakeSimpleOffset + BuildSolidFlag — a LOCAL face-
// offset-and-sew that SKIPS the global surface-surface intersection pass
// MakeThickSolidByJoin runs (BRepOffset_Inter3d). That pass is both the
// slow part and the fragile part (a single bad offset-face pair fails the
// whole op), so the simple offset is markedly faster AND succeeds on
// geometry the join offset chokes on — the same algorithmic split that
// makes Parasolid (SolidWorks / Onshape) quick and robust here.
//
// Caveat: MakeSimpleOffset does NOT resolve self-intersection, so a
// deeply concave region offset past its local concave radius yields a
// self-overlapping solid. We therefore gate the result through
// BRepCheck_Analyzer and let the Rust caller fall back to the join
// pipeline when it comes back invalid.
inline std::unique_ptr<TopoDS_Shape> try_simple_offset_shell(
    const TopoDS_Shape& shape,
    const TopTools_ListOfShape& closing_faces,
    double offset,
    double tolerance) {
  std::fprintf(stderr,
    "[shell:cpp] try_simple_offset_shell: offset=%.6f tol=%.6f\n",
    offset, tolerance);
  std::fflush(stderr);
  try {
    // Picked faces to remove, matched by IsSame (orientation-independent:
    // TopTools_MapOfShape hashes on TShape + Location, not orientation).
    TopTools_MapOfShape remove_set;
    for (TopTools_ListIteratorOfListOfShape it(closing_faces); it.More(); it.Next()) {
      remove_set.Add(it.Value());
    }
    // Open shell = every body face EXCEPT the removed ones, each kept with
    // its in-solid orientation so the offset travels the right way.
    BRep_Builder builder;
    TopoDS_Shell open_shell;
    builder.MakeShell(open_shell);
    int kept = 0, removed = 0;
    for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
      if (remove_set.Contains(e.Current())) { removed++; continue; }
      builder.Add(open_shell, TopoDS::Face(e.Current()));
      kept++;
    }
    std::fprintf(stderr,
      "[shell:cpp] simple offset: kept=%d removed=%d\n", kept, removed);
    std::fflush(stderr);
    if (kept == 0) {
      throw std::runtime_error("no faces remain after removing the picked faces");
    }
    if (removed == 0) {
      throw std::runtime_error("none of the picked faces matched a face on the body");
    }

    BRepOffset_MakeSimpleOffset mso;
    mso.Initialize(open_shell, offset);   // signed: negative = inward
    mso.SetBuildSolidFlag(Standard_True); // close the wall into a solid
    mso.SetTolerance(tolerance);
    mso.Perform();
    if (!mso.IsDone()) {
      TCollection_AsciiString msg = mso.GetErrorMessage();
      throw std::runtime_error(
        std::string("did not complete: ") +
        (msg.Length() ? msg.ToCString() : "(no message)"));
    }
    const TopoDS_Shape& result = mso.GetResultShape();
    if (result.IsNull()) {
      throw std::runtime_error("produced a null shape");
    }
    int n_solids = 0;
    for (TopExp_Explorer e(result, TopAbs_SOLID); e.More(); e.Next()) n_solids++;
    if (n_solids == 0) {
      throw std::runtime_error(
        "produced no solid (BuildSolidFlag could not close the wall)");
    }
    // MakeSimpleOffset skips self-intersection handling — validity is NOT
    // guaranteed. This gate is what lets the caller fall back to the join
    // pipeline on concave bodies the simple offset overlaps.
    BRepCheck_Analyzer chk(result);
    if (!chk.IsValid()) {
      throw std::runtime_error(
        "result fails geometric validity check (likely self-intersection "
        "on a concave region at this thickness)");
    }
    // BRepCheck_Analyzer validates each face/edge but NOT global self-
    // interference. The degenerate thin-wall case — where the requested wall
    // exceeds ~half a thin region's local thickness, so its two inner offset
    // surfaces collapse onto (or cross) the outer faces — produces coincident
    // / overlapping faces that pass the per-face check yet render as z-fighting
    // plus imprinted edges. A self-interference check catches that so the
    // caller falls through to the subtraction pipeline, which leaves regions
    // thinner than the wall solid (the Parasolid/Onshape behaviour). bTestSE is
    // off (small edges are legitimate here); bTestSI on is the part we want.
    BRepAlgoAPI_Check si_check(result, Standard_False, Standard_True);
    if (!si_check.IsValid()) {
      throw std::runtime_error(
        "result self-intersects — the wall is thicker than a thin region of "
        "the body can hold, so the offset surfaces overlap (needs the "
        "leave-thin-regions-solid subtraction path)");
    }
    std::fprintf(stderr, "[shell:cpp] simple offset OK (no self-interference): solids=%d\n", n_solids);
    std::fflush(stderr);
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure& e) {
    throw std::runtime_error(std::string("simple offset: ") +
      (e.GetMessageString() ? e.GetMessageString() : "(no message)"));
  }
}

// All-in-one shell shim. Owns the MakeThickSolid lifecycle entirely
// inside C++ so EVERY throw point — the build call, IsDone(), Shape()
// access, AND the destructor — sits inside the try/catch. Earlier
// attempts caught only the build call; OCCT's destructor or a later
// Shape() access still threw `Standard_Failure` outside that scope
// and tripped std::terminate. Returning a deep-copied
// `unique_ptr<TopoDS_Shape>` lets the Rust caller never touch the
// MakeThickSolid object directly, so no further OCCT access can
// throw across the bridge.
//
// On success: returns a non-null UniquePtr<TopoDS_Shape> holding the
// shelled body. On failure: throws std::runtime_error (which cxx
// translates into a Rust Err) carrying the OCCT message or a generic
// "did not complete" hint when OCCT failed silently.
inline std::unique_ptr<TopoDS_Shape> try_shell(
    const TopoDS_Shape& shape,
    const TopTools_ListOfShape& closing_faces,
    double offset,
    double tolerance,
    BRepOffset_Mode offset_mode,
    bool intersection,
    bool self_intersection,
    GeomAbs_JoinType join_type,
    bool remove_intersecting_edges,
    const Message_ProgressRange& progress) {
  try {
    BRepOffsetAPI_MakeThickSolid mts;
    mts.MakeThickSolidByJoin(
      shape, closing_faces, offset, tolerance, offset_mode,
      intersection, self_intersection, join_type,
      remove_intersecting_edges, progress);
    std::fprintf(stderr,
      "[shell:cpp] try_shell: offset=%.6f tol=%.6f IsDone=%d\n",
      offset, tolerance, mts.IsDone() ? 1 : 0);
    std::fflush(stderr);
    if (!mts.IsDone()) {
      throw std::runtime_error(
        "OCCT MakeThickSolid: operation did not complete "
        "(IsDone()==false). Most likely the thickness is too large "
        "for the body's narrowest dimension or sharpest curvature, "
        "or the picked faces share an edge that breaks the offset.");
    }
    // OCCT sometimes reports IsDone()==true on a malformed result —
    // especially when the offset distance exactly matches a fillet
    // radius, the inner offset surface collapses to a zero-area
    // patch and the build "succeeds" with a self-intersecting body.
    // BRepCheck_Analyzer catches these: it does a deep geometric
    // validity walk (face/edge/vertex consistency, curve continuity,
    // bounding-box sanity) and reports IsValid==false for anything
    // degenerate. We treat that as a build failure so the caller's
    // fallback pipeline runs instead of returning garbage geometry.
    BRepCheck_Analyzer analyzer(mts.Shape());
    bool valid = analyzer.IsValid();
    std::fprintf(stderr,
      "[shell:cpp] try_shell: BRepCheck_Analyzer.IsValid=%d\n", valid ? 1 : 0);
    std::fflush(stderr);
    if (!valid) {
      throw std::runtime_error(
        "OCCT MakeThickSolid: result fails geometric validity check. "
        "The offset distance likely matches or near-matches an existing "
        "fillet radius, producing self-intersecting or zero-area "
        "surfaces.");
    }
    // Deep-copy the shape out so the result outlives `mts`. The
    // TopoDS_Shape value type is a handle wrapper — copying is cheap
    // and shares the underlying TShape data.
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mts.Shape()));
    // `mts` destructs here, still inside the try block.
  } catch (const Standard_Failure& e) {
    throw std::runtime_error(std::string("OCCT MakeThickSolid: ") +
      (e.GetMessageString() ? e.GetMessageString() : "(no message)"));
  } catch (const std::exception&) {
    throw;  // already a std::exception — let cxx handle it
  } catch (...) {
    throw std::runtime_error("OCCT MakeThickSolid: unknown C++ exception");
  }
}
