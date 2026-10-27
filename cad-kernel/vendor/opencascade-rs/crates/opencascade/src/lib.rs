use thiserror::Error;

pub mod angle;
pub mod bounding_box;
// kicad module removed in this vendored copy — depended on kicad-parser.
pub mod mesh;
pub mod primitives;
pub mod section;
pub mod workplane;

mod law_function;
mod make_pipe_shell;

/// Re-export of the C++ std::terminate handler installer from
/// opencascade-sys. Callers (kernel main) invoke this once at startup
/// so any uncaught C++ exception logs `what()` to stderr before
/// aborting — see opencascade-sys's `message.rs` for rationale.
pub use opencascade_sys::message::install_terminate_handler;

#[derive(Error, Debug)]
pub enum Error {
    #[error("failed to write STL file")]
    StlWriteFailed,
    #[error("failed to read STEP file")]
    StepReadFailed,
    #[error("failed to read IGES file")]
    IgesReadFailed,
    #[error("failed to write STEP file")]
    StepWriteFailed,
    #[error("failed to write IGES file")]
    IgesWriteFailed,
    #[error("failed to read BREP file")]
    BrepReadFailed,
    #[error("failed to write BREP file")]
    BrepWriteFailed,
    #[error("failed to triangulate Shape")]
    TriangulationFailed,
    #[error("encountered a face with no triangulation")]
    UntriangulatedFace,
    #[error("at least 2 points are required for creating a wire")]
    NotEnoughPoints,
}
