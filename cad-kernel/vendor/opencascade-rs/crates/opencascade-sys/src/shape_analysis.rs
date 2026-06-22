pub use inner::*;

#[cxx::bridge]
mod inner {
    unsafe extern "C++" {
        include!("opencascade-sys/include/shape_analysis.hxx");

        // OCCT 8.0 changed ShapeAnalysis_FreeBounds::ConnectEdgesToWires to take
        // handle<NCollection_HSequence<TopoDS_Shape>> (the base) instead of
        // handle<TopTools_HSequenceOfShape> (the derived), breaking this binding.
        // Its only caller — Wire::from_unordered_edges — is unused dead code, so
        // the binding is removed rather than ported. Re-add (with a base/derived
        // converting wrapper) if from_unordered_edges is ever needed.
        type TopoDS_Shape = crate::topo_ds::TopoDS_Shape;
    }
}
