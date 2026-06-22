#pragma once
#include "rust/cxx.h"
#include <NCollection_List.hxx>
#include <Standard_Failure.hxx>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <memory>

// ── OCCT 8.0 compatibility ──────────────────────────────────────────────────
// OCCT 8.0 removed the legacy `Handle_<Class>` typedefs that DEFINE_STANDARD_HANDLE
// used to emit (only the `Handle(Class)` macro / `opencascade::handle<Class>` form
// remains). The cxx bridge shims still reference `Handle_<Class>`, so re-create the
// ones they use here (this header is included by every shim). Include each class's
// real header so the typedef is valid for both plain classes and OCCT's typedef'd
// collection handle types (HArray/HSequence).
#include <Geom_Surface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Plane.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <Geom2d_Ellipse.hxx>
#include <Poly_Triangulation.hxx>
#include <TopTools_HSequenceOfShape.hxx>
#include <Law_Function.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <TColgp_Array1OfDir.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <Standard_Type.hxx>
// OCCT 8.0 trimmed transitive includes; shims that used these collection types
// via other headers now need them explicitly. Provide the common ones globally.
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
// OCCT 8.0 removed the per-instance iterator header
// <TopTools_ListIteratorOfListOfShape.hxx>; the type is now the list's nested
// Iterator. Re-create the legacy typedef so the shims compile unchanged.
typedef TopTools_ListOfShape::Iterator TopTools_ListIteratorOfListOfShape;
#ifndef OCCT_LEGACY_HANDLE_COMPAT
#define OCCT_LEGACY_HANDLE_COMPAT
typedef opencascade::handle<Geom_Surface> Handle_Geom_Surface;
typedef opencascade::handle<Geom_Curve> Handle_Geom_Curve;
typedef opencascade::handle<Geom_Plane> Handle_Geom_Plane;
typedef opencascade::handle<Geom_TrimmedCurve> Handle_Geom_TrimmedCurve;
typedef opencascade::handle<Geom_BSplineCurve> Handle_Geom_BSplineCurve;
typedef opencascade::handle<Geom_CylindricalSurface> Handle_Geom_CylindricalSurface;
typedef opencascade::handle<Geom_BezierSurface> Handle_Geom_BezierSurface;
typedef opencascade::handle<Geom_BezierCurve> Handle_Geom_BezierCurve;
typedef opencascade::handle<Geom2d_Curve> Handle_Geom2d_Curve;
typedef opencascade::handle<Geom2d_TrimmedCurve> Handle_Geom2d_TrimmedCurve;
typedef opencascade::handle<Geom2d_Ellipse> Handle_Geom2d_Ellipse;
typedef opencascade::handle<Poly_Triangulation> Handle_Poly_Triangulation;
typedef opencascade::handle<TopTools_HSequenceOfShape> Handle_TopTools_HSequenceOfShape;
typedef opencascade::handle<Law_Function> Handle_Law_Function;
typedef opencascade::handle<TColgp_HArray1OfPnt> Handle_TColgp_HArray1OfPnt;
typedef opencascade::handle<Standard_Type> Handle_Standard_Type;
#endif

// Generic template constructor
template <typename T, typename... Args> std::unique_ptr<T> construct_unique(Args... args) {
  return std::unique_ptr<T>(new T(args...));
}

// Exception-catching variant of construct_unique. OCCT operations
// (BRepPrimAPI_MakeRevol, BRepOffsetAPI_MakePipe, BRepAlgoAPI_Cut, etc.)
// frequently throw Standard_Failure from their constructors when given
// degenerate input — profile coincident with revolve axis, sharp-corner
// path the pipe builder can't handle, booleans on non-intersecting
// shapes, etc.
//
// cxx's Result<UniquePtr<T>> wrapping is supposed to catch these at the
// bridge boundary, but in practice it doesn't reliably engage for the
// `construct_unique` template — the exception propagates out, terminate()
// gets called (because the destructor of the half-built object may itself
// throw during stack unwinding), and the kernel process aborts.
//
// This helper does the try/catch IN C++ where it's reliable, returning
// a null unique_ptr on failure. Rust binds it as a normal UniquePtr<T>
// return and checks .is_null() to detect failure.
template <typename T, typename... Args>
std::unique_ptr<T> try_construct_unique(Args... args) {
  try {
    return std::unique_ptr<T>(new T(args...));
  } catch (const Standard_Failure&) {
    return std::unique_ptr<T>();
  } catch (const std::exception&) {
    return std::unique_ptr<T>();
  } catch (...) {
    return std::unique_ptr<T>();
  }
}

// Install a std::terminate handler that logs whatever exception is about
// to abort the process. We CAN'T recover from terminate without UB, but
// at least logging "what()" tells us which OCCT call to wrap next. The
// process still aborts (docker restarts the container), but the next
// log line gives diagnosable context.
inline void install_terminate_handler() {
  std::set_terminate([]() {
    std::exception_ptr current = std::current_exception();
    if (current) {
      try {
        std::rethrow_exception(current);
      } catch (const Standard_Failure& e) {
        std::fprintf(stderr,
          "[cad-kernel] terminate: uncaught Standard_Failure: %s\n",
          e.GetMessageString() ? e.GetMessageString() : "(no message)");
      } catch (const std::exception& e) {
        std::fprintf(stderr,
          "[cad-kernel] terminate: uncaught std::exception: %s\n", e.what());
      } catch (...) {
        std::fprintf(stderr, "[cad-kernel] terminate: uncaught unknown exception\n");
      }
    } else {
      std::fprintf(stderr, "[cad-kernel] terminate called without active exception\n");
    }
    std::fflush(stderr);
    std::abort();
  });
}

// Type casting
template <typename T, typename U> inline U upcast(T src) { return src; }
template <typename T, typename U> inline const U &upcast_ref(const T &src) { return src; }

// Generic List
template <typename T> std::unique_ptr<std::vector<T>> list_to_vector(const NCollection_List<T> &list) {
  return std::unique_ptr<std::vector<T>>(new std::vector<T>(list.begin(), list.end()));
}

template <typename T> const T &handle_try_deref(const opencascade::handle<T> &handle) {
  if (handle.IsNull()) {
    throw std::runtime_error("null handle dereference");
  }
  return *handle;
}
