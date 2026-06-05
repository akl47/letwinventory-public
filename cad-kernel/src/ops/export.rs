//! `exportStep` — combine the model's body BReps into a single STEP file.
//!
//! Bodies are passed in as base64 BREP (the same payloads the cache stores and
//! the boolean ops consume). They're deserialized, combined into a compound
//! (STEP holds multiple solids in one file), written to a temp `.step` via the
//! OCCT `STEPControl_Writer`, and returned as text.

use anyhow::{anyhow, Context, Result};
use opencascade::primitives::{Compound, Shape};

use crate::ops::shape_io::{brep_to_base64, deserialize_brep_from_base64};
use crate::protocol::{ExportStepParams, ExportStepResult, ExportStlParams, ExportStlResult};

/// Combine the body BReps into a binary STL file (base64-encoded for transit).
/// Mirrors `export_step` but writes via OCCT's `StlAPI_Writer` + an incremental
/// mesh at the requested chord tolerance.
pub fn export_stl(params: &ExportStlParams) -> Result<ExportStlResult> {
    if params.breps.is_empty() {
        return Err(anyhow!("no bodies to export"));
    }
    let mut shapes: Vec<Shape> = Vec::with_capacity(params.breps.len());
    for (i, b) in params.breps.iter().enumerate() {
        shapes.push(
            deserialize_brep_from_base64(b).with_context(|| format!("deserialize body {i} BRep"))?,
        );
    }
    let shape: Shape = if shapes.len() == 1 {
        shapes.into_iter().next().unwrap()
    } else {
        Compound::from_shapes(shapes.iter()).clean()
    };
    let tol = if params.tolerance > 0.0 { params.tolerance } else { 0.01 };
    let path = std::env::temp_dir().join(format!("cad-export-{}.stl", std::process::id()));
    shape
        .write_stl_with_tolerance(&path, tol)
        .map_err(|e| anyhow!("STL write failed: {e:?}"))?;
    let bytes = std::fs::read(&path).context("read STL temp file")?;
    let _ = std::fs::remove_file(&path);
    Ok(ExportStlResult { stl_base64: brep_to_base64(&bytes) })
}

pub fn export_step(params: &ExportStepParams) -> Result<ExportStepResult> {
    if params.breps.is_empty() {
        return Err(anyhow!("no bodies to export"));
    }
    let mut shapes: Vec<Shape> = Vec::with_capacity(params.breps.len());
    for (i, b) in params.breps.iter().enumerate() {
        shapes.push(
            deserialize_brep_from_base64(b).with_context(|| format!("deserialize body {i} BRep"))?,
        );
    }
    // One body exports directly; multiple bodies become a compound.
    let shape: Shape = if shapes.len() == 1 {
        shapes.into_iter().next().unwrap()
    } else {
        Compound::from_shapes(shapes.iter()).clean()
    };

    let path = std::env::temp_dir().join(format!("cad-export-{}.step", std::process::id()));
    shape
        .write_step(&path)
        .map_err(|e| anyhow!("STEP write failed: {e:?}"))?;
    let step = std::fs::read_to_string(&path).context("read STEP temp file")?;
    let _ = std::fs::remove_file(&path);
    Ok(ExportStepResult { step })
}
