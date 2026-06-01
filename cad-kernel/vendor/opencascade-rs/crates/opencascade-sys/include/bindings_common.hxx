#pragma once
#include "rust/cxx.h"
#include <NCollection_List.hxx>
#include <Standard_Failure.hxx>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <memory>

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
