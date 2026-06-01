//! `exportStep` — combine the model's body BReps into a single STEP file.
//!
//! Bodies are passed in as base64 BREP (the same payloads the cache stores and
//! the boolean ops consume). They're deserialized, combined into a compound
//! (STEP holds multiple solids in one file), written to a temp `.step` via the
//! OCCT `STEPControl_Writer`, and returned as text.

use anyhow::{anyhow, Context, Result};
use opencascade::primitives::{Compound, Shape};

use crate::ops::shape_io::deserialize_brep_from_base64;
use crate::protocol::{ExportStepParams, ExportStepResult};

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
