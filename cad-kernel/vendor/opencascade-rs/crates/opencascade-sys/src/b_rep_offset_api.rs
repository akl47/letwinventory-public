// Cache-bust marker: cxx's build.rs only invalidates on .rs source mod
// time, not .hxx changes. Touching this file forces a rebuild when the
// paired b_rep_offset_api.hxx changes. v13 — inner-offset prefer sharp join.
pub use inner::*;

#[cxx::bridge]
mod inner {
    #[derive(Debug)]
    #[repr(u32)]
    pub enum BRepOffset_Mode {
        BRepOffset_Skin,
        BRepOffset_Pipe,
        BRepOffset_RectoVerso,
    }

    unsafe extern "C++" {
        include!("opencascade-sys/include/b_rep_offset_api.hxx");

        type TopoDS_Shape = crate::topo_ds::TopoDS_Shape;
        type TopoDS_Face = crate::topo_ds::TopoDS_Face;
        type TopoDS_Wire = crate::topo_ds::TopoDS_Wire;
        type GeomAbs_JoinType = crate::geom_abs::GeomAbs_JoinType;
        type TopTools_ListOfShape = crate::top_tools::TopTools_ListOfShape;
        type Message_ProgressRange = crate::message::Message_ProgressRange;
        type Handle_Law_Function = crate::law::Handle_Law_Function;

        type BRepOffset_Mode;

        type BRepOffsetAPI_MakeOffset;
        #[cxx_name = "construct_unique"]
        pub fn BRepOffsetAPI_MakeOffset_face_new(
            face: &TopoDS_Face,
            join: GeomAbs_JoinType,
        ) -> UniquePtr<BRepOffsetAPI_MakeOffset>;
        #[cxx_name = "construct_unique"]
        pub fn BRepOffsetAPI_MakeOffset_wire_new(
            wire: &TopoDS_Wire,
            join: GeomAbs_JoinType,
        ) -> UniquePtr<BRepOffsetAPI_MakeOffset>;
        pub fn Perform(self: Pin<&mut BRepOffsetAPI_MakeOffset>, offset: f64, alt: f64);
        pub fn Shape(self: Pin<&mut BRepOffsetAPI_MakeOffset>) -> &TopoDS_Shape;
        pub fn Build(self: Pin<&mut BRepOffsetAPI_MakeOffset>, progress: &Message_ProgressRange);
        pub fn IsDone(self: &BRepOffsetAPI_MakeOffset) -> bool;

        type BRepOffsetAPI_MakeThickSolid;
        #[cxx_name = "construct_unique"]
        pub fn BRepOffsetAPI_MakeThickSolid_new() -> UniquePtr<BRepOffsetAPI_MakeThickSolid>;
        // Bare-method binding kept for back-compat; new code should use
        // `try_make_thick_solid_by_join` below so OCCT's
        // `Standard_Failure` (not derived from `std::exception`) gets
        // caught in C++ and translated into a Rust Err instead of
        // tripping `std::terminate`.
        #[allow(clippy::too_many_arguments)]
        pub fn MakeThickSolidByJoin(
            self: Pin<&mut BRepOffsetAPI_MakeThickSolid>,
            shape: &TopoDS_Shape,
            closing_faces: &TopTools_ListOfShape,
            offset: f64,
            tolerance: f64,
            offset_mode: BRepOffset_Mode,
            intersection: bool,
            self_intersection: bool,
            join_type: GeomAbs_JoinType,
            remove_intersecting_edges: bool,
            progress: &Message_ProgressRange,
        );
        // Walk `shape`, find cylindrical/toroidal faces with radius
        // strictly less than `max_radius` AND with all boundary edges
        // tangent (G1) to their neighbors, and remove them via
        // BRepAlgoAPI_Defeaturing. Returns the defeatured shape, or
        // a deep copy of the original when no fillets matched. Used
        // by Shape::shell as a fallback when MakeThickSolid fails on
        // a body with fillets too small for the offset distance.
        pub fn try_remove_small_fillets(
            shape: &TopoDS_Shape,
            max_radius: f64,
        ) -> Result<UniquePtr<TopoDS_Shape>>;

        // Offset a solid INWARD by `thickness` to produce a smaller
        // closed solid. Used by the subtraction-pipeline fallback in
        // Shape::shell as the inner cavity that gets subtracted from
        // the original body.
        pub fn try_offset_solid_inward(
            shape: &TopoDS_Shape,
            thickness: f64,
            tolerance: f64,
        ) -> Result<UniquePtr<TopoDS_Shape>>;

        // Stage-0 "simple" shell (tried before the join pipeline):
        // remove the closing faces to form an open shell, then
        // BRepOffset_MakeSimpleOffset + BuildSolidFlag on it. A local
        // face-offset-and-sew with NO global surface-surface
        // intersection — faster and more robust than MakeThickSolidByJoin,
        // but it doesn't resolve self-intersection, so the result is
        // validity-gated and the caller falls back on failure. `offset`
        // is signed (negative = inward), matching the join path.
        pub fn try_simple_offset_shell(
            shape: &TopoDS_Shape,
            closing_faces: &TopTools_ListOfShape,
            offset: f64,
            tolerance: f64,
        ) -> Result<UniquePtr<TopoDS_Shape>>;


        // All-in-one shell shim. Owns the MakeThickSolid lifecycle
        // entirely inside C++ — the build call, IsDone() check,
        // Shape() access, AND the destructor are all wrapped in one
        // try/catch. Returns a deep-copied TopoDS_Shape so the Rust
        // caller never touches the MakeThickSolid object directly.
        // See `b_rep_offset_api.hxx` for the full rationale.
        #[allow(clippy::too_many_arguments)]
        pub fn try_shell(
            shape: &TopoDS_Shape,
            closing_faces: &TopTools_ListOfShape,
            offset: f64,
            tolerance: f64,
            offset_mode: BRepOffset_Mode,
            intersection: bool,
            self_intersection: bool,
            join_type: GeomAbs_JoinType,
            remove_intersecting_edges: bool,
            progress: &Message_ProgressRange,
        ) -> Result<UniquePtr<TopoDS_Shape>>;
        pub fn Shape(self: Pin<&mut BRepOffsetAPI_MakeThickSolid>) -> &TopoDS_Shape;
        pub fn Build(
            self: Pin<&mut BRepOffsetAPI_MakeThickSolid>,
            progress: &Message_ProgressRange,
        );
        pub fn IsDone(self: &BRepOffsetAPI_MakeThickSolid) -> bool;

        type BRepOffsetAPI_MakePipe;
        #[cxx_name = "construct_unique"]
        pub fn BRepOffsetAPI_MakePipe_new(
            spine: &TopoDS_Wire,
            profile: &TopoDS_Shape,
        ) -> UniquePtr<BRepOffsetAPI_MakePipe>;
        pub fn Shape(self: Pin<&mut BRepOffsetAPI_MakePipe>) -> &TopoDS_Shape;

        type BRepOffsetAPI_MakePipeShell;
        #[cxx_name = "construct_unique"]
        pub fn BRepOffsetAPI_MakePipeShell_new(
            spine: &TopoDS_Wire,
        ) -> UniquePtr<BRepOffsetAPI_MakePipeShell>;
        pub fn SetMode(self: Pin<&mut BRepOffsetAPI_MakePipeShell>, is_frenet: bool);
        pub fn Add(
            self: Pin<&mut BRepOffsetAPI_MakePipeShell>,
            profile: &TopoDS_Shape,
            with_contact: bool,
            with_correction: bool,
        );
        pub fn SetLaw(
            self: Pin<&mut BRepOffsetAPI_MakePipeShell>,
            profile: &TopoDS_Shape,
            law: &Handle_Law_Function,
            with_contact: bool,
            with_correction: bool,
        );
        // Build is the most common throw site (StdFail_NotDone, etc.).
        // Returning Result<()> wraps it in a C++ try/catch via the cxx
        // bridge, so an OCCT exception surfaces as a Rust Err instead
        // of std::terminate() aborting the kernel process.
        pub fn Build(self: Pin<&mut BRepOffsetAPI_MakePipeShell>, progress: &Message_ProgressRange) -> Result<()>;
        pub fn MakeSolid(self: Pin<&mut BRepOffsetAPI_MakePipeShell>) -> bool;
        pub fn Shape(self: Pin<&mut BRepOffsetAPI_MakePipeShell>) -> &TopoDS_Shape;
        pub fn IsDone(self: &BRepOffsetAPI_MakePipeShell) -> bool;

        type BRepOffsetAPI_ThruSections;
        #[cxx_name = "construct_unique"]
        pub fn BRepOffsetAPI_ThruSections_new(
            is_solid: bool,
        ) -> UniquePtr<BRepOffsetAPI_ThruSections>;
        pub fn AddWire(self: Pin<&mut BRepOffsetAPI_ThruSections>, wire: &TopoDS_Wire);
        pub fn CheckCompatibility(self: Pin<&mut BRepOffsetAPI_ThruSections>, check: bool);
        pub fn Shape(self: Pin<&mut BRepOffsetAPI_ThruSections>) -> &TopoDS_Shape;
        pub fn Build(self: Pin<&mut BRepOffsetAPI_ThruSections>, progress: &Message_ProgressRange);
        pub fn IsDone(self: &BRepOffsetAPI_ThruSections) -> bool;
    }
}
