//! Operation handlers for the kernel RPC. Each public submodule exposes a
//! `build` entry point used by the dispatcher in `server.rs`.

pub mod boolean;
pub mod edge_blend;
pub mod export;
pub mod extrude;
pub mod pattern;
pub mod revolve;
pub mod shape_io;
pub mod shell;
pub mod sweep;
