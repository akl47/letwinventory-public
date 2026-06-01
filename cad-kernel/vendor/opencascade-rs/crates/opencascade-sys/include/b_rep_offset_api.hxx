#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Tool.hxx>
#include <Law_Function.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
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
inline std::unique_ptr<TopoDS_Shape> try_offset_solid_inward(
    const TopoDS_Shape& shape,
    double thickness,
    double tolerance) {
  std::fprintf(stderr,
    "[shell:cpp] try_offset_solid_inward: thickness=%.6f tol=%.6f\n",
    thickness, tolerance);
  std::fflush(stderr);
  try {
    BRepOffsetAPI_MakeOffsetShape mos;
    mos.PerformByJoin(
      shape,
      -thickness,                                 // negative = inward
      tolerance,
      BRepOffset_Skin,
      Standard_False,                             // intersection
      Standard_False,                             // self_intersection
      GeomAbs_Intersection,                       // join type
      Standard_True);                             // RemoveInternalEdges
    if (!mos.IsDone()) {
      throw std::runtime_error(
        "Inner offset: operation did not complete. The body's "
        "narrowest dimension may be smaller than 2x thickness.");
    }
    const TopoDS_Shape& result = mos.Shape();
    // Diagnostic: count solids + faces in the result. If the offset
    // produces just a surface shell (no closed solid), the subsequent
    // boolean subtract will silently no-op against the original body
    // and the user sees an "unshelled" result. BRepCheck_Analyzer
    // tells us whether the shape is geometrically valid.
    int n_solids = 0, n_faces = 0;
    for (TopExp_Explorer e(result, TopAbs_SOLID); e.More(); e.Next()) n_solids++;
    for (TopExp_Explorer e(result, TopAbs_FACE); e.More(); e.Next()) n_faces++;
    BRepCheck_Analyzer chk(result);
    bool valid = chk.IsValid();
    std::fprintf(stderr,
      "[shell:cpp] try_offset_solid_inward result: solids=%d faces=%d IsValid=%d\n",
      n_solids, n_faces, valid ? 1 : 0);
    std::fflush(stderr);
    if (n_solids == 0) {
      throw std::runtime_error(
        "Inner offset: result has no solid (got a surface shell only). "
        "BRepOffset_Skin mode produced an open offset surface instead of "
        "a closed solid — the body geometry may not support uniform "
        "inward offset at this thickness.");
    }
    if (!valid) {
      throw std::runtime_error(
        "Inner offset: result fails geometric validity check.");
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure& e) {
    throw std::runtime_error(std::string("Inner offset: ") +
      (e.GetMessageString() ? e.GetMessageString() : "(no message)"));
  } catch (const std::exception&) {
    throw;
  } catch (...) {
    throw std::runtime_error("Inner offset: unknown C++ exception");
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
