use crate::{
    angle::Angle,
    law_function::law_function_from_graph,
    make_pipe_shell::make_pipe_shell_with_law_function,
    primitives::{
        make_axis_1, make_point, make_vec, EdgeIterator, JoinType, Shape, Solid, Surface, Wire,
    },
    workplane::Workplane,
};
use cxx::UniquePtr;
use glam::{dvec3, DVec3};
use opencascade_sys as ffi;

/// Analytic surface classification of a face (see [`Face::surface_kind`]).
/// Only the kinds the assembly mate solver needs are represented.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FaceSurface {
    Plane { origin: DVec3, normal: DVec3 },
    Cylinder { origin: DVec3, axis: DVec3, radius: f64 },
}

pub struct Face {
    pub(crate) inner: UniquePtr<ffi::topo_ds::TopoDS_Face>,
}

impl AsRef<Face> for Face {
    fn as_ref(&self) -> &Face {
        self
    }
}

impl Face {
    pub(crate) fn from_face(face: &ffi::topo_ds::TopoDS_Face) -> Self {
        let inner = ffi::topo_ds::TopoDS_Face_to_owned(face);

        Self { inner }
    }

    fn from_make_face(
        make_face: UniquePtr<ffi::b_rep_builder_api::BRepBuilderAPI_MakeFace>,
    ) -> Self {
        Self::from_face(make_face.Face())
    }

    pub fn from_wire(wire: &Wire) -> Self {
        let only_plane = false;
        let make_face =
            ffi::b_rep_builder_api::BRepBuilderAPI_MakeFace_wire(&wire.inner, only_plane);

        Self::from_make_face(make_face)
    }

    pub fn from_surface(surface: &Surface) -> Self {
        const EDGE_TOLERANCE: f64 = 0.0001;

        let make_face =
            ffi::b_rep_builder_api::BRepBuilderAPI_MakeFace_surface(&surface.inner, EDGE_TOLERANCE);

        Self::from_make_face(make_face)
    }

    #[must_use]
    pub fn extrude(&self, dir: DVec3) -> Solid {
        let prism_vec = make_vec(dir);

        let copy = false;
        let canonize = true;

        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let mut make_solid =
            ffi::b_rep_prim_api::BRepPrimAPI_MakePrism_new(inner_shape, &prism_vec, copy, canonize);
        let extruded_shape = make_solid.pin_mut().Shape();
        let solid = ffi::topo_ds::TopoDS::Solid(extruded_shape);

        Solid::from_solid(solid)
    }

    #[must_use]
    pub fn extrude_to_face(&self, shape_with_face: &Shape, face: &Face) -> Shape {
        let profile_base = &self.inner;
        let sketch_base = ffi::topo_ds::TopoDS_Face_new();
        let angle = 0.0;
        let fuse = 1; // 0 = subtractive, 1 = additive
        let modify = false;

        let mut make_prism = ffi::b_rep_feat::BRepFeat_MakeDPrism_new(
            &shape_with_face.inner,
            profile_base,
            &sketch_base,
            angle,
            fuse,
            modify,
        );

        let until_face = ffi::topo_ds::cast_face_to_shape(&face.inner);
        make_prism.pin_mut().perform_until_face(until_face);

        Shape::from_shape(make_prism.pin_mut().Shape())
    }

    #[must_use]
    pub fn subtractive_extrude(&self, shape_with_face: &Shape, height: f64) -> Shape {
        let profile_base = &self.inner;
        let sketch_base = ffi::topo_ds::TopoDS_Face_new();
        let angle = 0.0;
        let fuse = 0; // 0 = subtractive, 1 = additive
        let modify = false;

        let mut make_prism = ffi::b_rep_feat::BRepFeat_MakeDPrism_new(
            &shape_with_face.inner,
            profile_base,
            &sketch_base,
            angle,
            fuse,
            modify,
        );

        make_prism.pin_mut().perform_with_height(height);

        Shape::from_shape(make_prism.pin_mut().Shape())
    }

    /// Returns None when OCCT's revolve constructor throws (profile
    /// coincident with axis, axis crosses profile interior, etc.). The
    /// exception is caught at the cxx bridge via Result<UniquePtr<...>>
    /// so it doesn't abort the kernel process.
    #[must_use]
    pub fn revolve(&self, origin: DVec3, axis: DVec3, angle: Option<Angle>) -> Option<Solid> {
        let revol_vec = make_axis_1(origin, axis);
        let copy = false;
        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        // `None` → OCCT's no-angle BRepPrimAPI_MakeRevol constructor:
        // the surface wraps parametrically (closed revolution), the
        // start and end positions of the profile coincide as the SAME
        // topology entity, so the source profile's edges don't appear
        // as visible seam edges. `Some(angle)` routes through the
        // angle-bearing constructor for partial revolves.
        // try_construct_unique returns a null UniquePtr on exception —
        // see opencascade-sys bindings_common.hxx for the C++ try/catch.
        // MakeRevol's constructor can also "succeed" with IsDone=false
        // (degenerate input that doesn't throw in the ctor but leaves
        // the builder in a not-done state). Calling Shape() in that
        // case throws BRep_API: command not done, which we catch by
        // checking IsDone() first.
        let make_solid = match angle {
            Some(a) => ffi::b_rep_prim_api::BRepPrimAPI_MakeRevol_new(
                inner_shape, &revol_vec, a.radians(), copy,
            ),
            None => ffi::b_rep_prim_api::BRepPrimAPI_MakeRevol_full_new(
                inner_shape, &revol_vec, copy,
            ),
        };
        if make_solid.is_null() {
            return None;
        }
        if !make_solid.IsDone() {
            return None;
        }
        let mut make_solid = make_solid;
        let revolved_shape = make_solid.pin_mut().Shape();
        let solid = ffi::topo_ds::TopoDS::Solid(revolved_shape);

        Some(Solid::from_solid(solid))
    }

    /// Fillets the face edges by a given radius at each vertex
    #[must_use]
    pub fn fillet(&self, radius: f64) -> Self {
        let mut make_fillet = ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet2d_new(&self.inner);

        let face_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);

        // We use a shape map here to avoid duplicates.
        let mut shape_map = ffi::top_tools::new_indexed_map_of_shape();
        ffi::top_exp::TopExp::MapShapes(
            face_shape,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_VERTEX,
            shape_map.pin_mut(),
        );

        for i in 1..=shape_map.Extent() {
            let vertex = ffi::topo_ds::TopoDS::Vertex(shape_map.FindKey(i));
            ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet2d_add_fillet(
                make_fillet.pin_mut(),
                vertex,
                radius,
            );
        }

        make_fillet.pin_mut().Build(&ffi::message::Message_ProgressRange_new());

        let result_shape = make_fillet.pin_mut().Shape();
        let result_face = ffi::topo_ds::TopoDS::Face(result_shape);

        Self::from_face(result_face)
    }

    /// Chamfer the wire edges at each vertex by a given distance
    #[must_use]
    pub fn chamfer(&self, distance_1: f64) -> Self {
        // TODO - Support asymmetric chamfers.
        let distance_2 = distance_1;

        let face_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);

        let mut make_fillet = ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet2d_new(&self.inner);

        let mut vertex_map = ffi::top_tools::new_indexed_map_of_shape();
        ffi::top_exp::TopExp::MapShapes(
            face_shape,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_VERTEX,
            vertex_map.pin_mut(),
        );

        // Get map of vertices to edges so we can find the edges connected to each vertex.
        let mut data_map = ffi::top_tools::new_indexed_data_map_of_shape_list_of_shape();
        ffi::top_exp::TopExp::MapShapesAndAncestors(
            face_shape,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_VERTEX,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_EDGE,
            data_map.pin_mut(),
        );

        // Chamfer at vertex of all edges.
        for i in 1..=vertex_map.Extent() {
            let edges = ffi::topo_ds::shape_list_to_vector(data_map.FindFromIndex(i));
            let edge_1 = edges.get(0).expect("Vertex has no edges");
            let edge_2 = edges.get(1).expect("Vertex has only one edge");
            ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet2d_add_chamfer(
                make_fillet.pin_mut(),
                ffi::topo_ds::TopoDS::Edge(edge_1),
                ffi::topo_ds::TopoDS::Edge(edge_2),
                distance_1,
                distance_2,
            );
        }

        let filleted_shape = make_fillet.pin_mut().Shape();
        let result_face = ffi::topo_ds::TopoDS::Face(filleted_shape);

        Self::from_face(result_face)
    }

    /// Offset the face by a given distance and join settings
    #[must_use]
    pub fn offset(&self, distance: f64, join_type: JoinType) -> Self {
        let mut make_offset =
            ffi::b_rep_offset_api::BRepOffsetAPI_MakeOffset_face_new(&self.inner, join_type.into());
        make_offset.pin_mut().Perform(distance, 0.0);

        let offset_shape = make_offset.pin_mut().Shape();
        let result_wire = ffi::topo_ds::TopoDS::Wire(offset_shape);
        let wire = Wire::from_wire(result_wire);

        wire.to_face()
    }

    /// Sweep the face along a path to produce a solid
    #[must_use]
    pub fn sweep_along(&self, path: &Wire) -> Solid {
        let profile_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let mut make_pipe =
            ffi::b_rep_offset_api::BRepOffsetAPI_MakePipe_new(&path.inner, profile_shape);

        let pipe_shape = make_pipe.pin_mut().Shape();
        let result_solid = ffi::topo_ds::TopoDS::Solid(pipe_shape);

        Solid::from_solid(result_solid)
    }

    /// Forgiving sweep using `BRepOffsetAPI_MakePipeShell` — unlike
    /// `Face::sweep_along` (which uses MakePipe and requires the path to
    /// be C1-continuous), this accepts paths with sharp corners.
    /// Returns `None` when OCCT's builder fails to produce a solid
    /// (degenerate inputs, profile coplanar with start tangent, etc.)
    /// rather than throwing a C++ exception that would abort the process.
    #[must_use]
    pub fn sweep_along_shell(&self, path: &Wire) -> Option<Solid> {
        let profile_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let mut shell = ffi::b_rep_offset_api::BRepOffsetAPI_MakePipeShell_new(&path.inner);
        // false = ConstantBinormal trihedron law: the cross-section orientation
        // is propagated by the discrete frame of the path, which behaves well
        // through sharp corners. Frenet would twist with curvature changes.
        shell.pin_mut().SetMode(false);
        shell.pin_mut().Add(profile_shape, false, false);
        // Build returns Result via cxx — a C++ exception (StdFail_NotDone,
        // gp_VectorWithNullMagnitude, etc.) lands here as an Err instead
        // of aborting the kernel process. Either an error or a !IsDone
        // means we couldn't sweep; return None and let the caller emit a
        // human-readable error.
        if shell.pin_mut().Build(&ffi::message::Message_ProgressRange_new()).is_err() {
            return None;
        }
        if !shell.IsDone() {
            return None;
        }
        shell.pin_mut().MakeSolid();
        let pipe_shape = shell.pin_mut().Shape();
        let result_solid = ffi::topo_ds::TopoDS::Solid(pipe_shape);
        Some(Solid::from_solid(result_solid))
    }

    /// Sweep the face along a path, modulated by a function, to produce a solid
    #[must_use]
    pub fn sweep_along_with_radius_values(
        &self,
        path: &Wire,
        radius_values: impl IntoIterator<Item = (f64, f64)>,
    ) -> Solid {
        let law_function = law_function_from_graph(radius_values);
        let law_handle = ffi::law::Law_Function_to_handle(law_function);

        let profile_wire = ffi::b_rep_tools::outer_wire(&self.inner);
        let mut make_pipe_shell =
            make_pipe_shell_with_law_function(&profile_wire, &path.inner, &law_handle);

        // Build now returns Result via cxx — preserve the prior
        // unwrap-on-error semantics here so callers of this helper
        // continue to behave the same way (panic on exception, which is
        // caught at the kernel's RPC boundary).
        make_pipe_shell.pin_mut().Build(&ffi::message::Message_ProgressRange_new())
            .expect("sweep_along_with_radius_values: pipe build failed");
        make_pipe_shell.pin_mut().MakeSolid();
        let pipe_shape = make_pipe_shell.pin_mut().Shape();
        let result_solid = ffi::topo_ds::TopoDS::Solid(pipe_shape);

        Solid::from_solid(result_solid)
    }

    pub fn edges(&self) -> EdgeIterator {
        let explorer = ffi::top_exp::TopExp_Explorer_new(
            ffi::topo_ds::cast_face_to_shape(&self.inner),
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_EDGE,
        );

        EdgeIterator { explorer }
    }

    pub fn center_of_mass(&self) -> DVec3 {
        let mut props = ffi::g_prop::GProps_new();

        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let skip_shared = false;
        let use_triangulation = false;
        ffi::b_rep_g_prop::BRepGProp::SurfaceProperties(
            inner_shape,
            props.pin_mut(),
            skip_shared,
            use_triangulation,
        );

        let center = ffi::g_prop::GProp_GProps_CentreOfMass(&props);

        dvec3(center.X(), center.Y(), center.Z())
    }

    pub fn normal_at(&self, pos: DVec3) -> DVec3 {
        let surface = ffi::b_rep::BRep_Tool_Surface(&self.inner);
        let projector = ffi::geom_api::GeomAPI_ProjectPointOnSurf_new(&make_point(pos), &surface);
        let mut u: f64 = 0.0;
        let mut v: f64 = 0.0;

        projector.LowerDistanceParameters(&mut u, &mut v);

        let mut p = ffi::gp::new_point(0.0, 0.0, 0.0);
        let mut normal = ffi::gp::new_vec(0.0, 1.0, 0.0);

        let face = ffi::b_rep_g_prop::BRepGProp_Face_new(&self.inner);
        face.Normal(u, v, p.pin_mut(), normal.pin_mut());

        dvec3(normal.X(), normal.Y(), normal.Z())
    }

    pub fn normal_at_center(&self) -> DVec3 {
        let center = self.center_of_mass();
        self.normal_at(center)
    }

    /// Analytic classification of this face's underlying surface (REQ 749).
    /// Returns `Some` for planar and cylindrical faces — the two surface kinds
    /// the assembly mate solver consumes — and `None` for everything else.
    ///
    /// For planes the origin/normal come from the existing orientation-aware
    /// `center_of_mass`/`normal_at_center` (so the normal points outward); only
    /// cylinder axis + radius need the surface adaptor.
    pub fn surface_kind(&self) -> Option<FaceSurface> {
        let adaptor = ffi::b_rep_adaptor::BRepAdaptor_Surface_new(&self.inner);
        match adaptor.GetType() {
            ffi::geom_abs::GeomAbs_SurfaceType::GeomAbs_Plane => Some(FaceSurface::Plane {
                origin: self.center_of_mass(),
                normal: self.normal_at_center(),
            }),
            ffi::geom_abs::GeomAbs_SurfaceType::GeomAbs_Cylinder => {
                let loc = ffi::b_rep_adaptor::BRepAdaptor_Surface_cyl_location(&adaptor);
                let dir = ffi::b_rep_adaptor::BRepAdaptor_Surface_cyl_direction(&adaptor);
                let radius = ffi::b_rep_adaptor::BRepAdaptor_Surface_cyl_radius(&adaptor);
                Some(FaceSurface::Cylinder {
                    origin: dvec3(loc.X(), loc.Y(), loc.Z()),
                    axis: dvec3(dir.X(), dir.Y(), dir.Z()),
                    radius,
                })
            }
            _ => None,
        }
    }

    pub fn workplane(&self) -> Workplane {
        const NORMAL_DIFF_TOLERANCE: f64 = 0.0001;

        let center = self.center_of_mass();
        let normal = self.normal_at(center);
        let mut x_dir = dvec3(0.0, 0.0, 1.0).cross(normal);

        if x_dir.length() < NORMAL_DIFF_TOLERANCE {
            // The normal of this face is too close to the same direction
            // as the global Z axis. Use the global X axis for X instead.
            x_dir = dvec3(1.0, 0.0, 0.0);
        }

        let mut workplane = Workplane::new(x_dir, normal);
        workplane.set_translation(center);
        workplane
    }

    pub fn union(&self, other: &Face) -> CompoundFace {
        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let other_inner_shape = ffi::topo_ds::cast_face_to_shape(&other.inner);

        let mut fuse_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Fuse_new(inner_shape, other_inner_shape);

        let fuse_shape = fuse_operation.pin_mut().Shape();

        let compound = ffi::topo_ds::TopoDS::Compound(fuse_shape);

        CompoundFace::from_compound(compound)
    }

    #[must_use]
    pub fn intersect(&self, other: &Face) -> CompoundFace {
        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let other_inner_shape = ffi::topo_ds::cast_face_to_shape(&other.inner);

        let mut common_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Common_new(inner_shape, other_inner_shape);

        let common_shape = common_operation.pin_mut().Shape();

        let compound = ffi::topo_ds::TopoDS::Compound(common_shape);

        CompoundFace::from_compound(compound)
    }

    pub fn subtract(&self, other: &Face) -> CompoundFace {
        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);
        let other_inner_shape = ffi::topo_ds::cast_face_to_shape(&other.inner);

        let mut fuse_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Cut_new(inner_shape, other_inner_shape);

        let cut_shape = fuse_operation.pin_mut().Shape();

        let compound = ffi::topo_ds::TopoDS::Compound(cut_shape);

        CompoundFace::from_compound(compound)
    }

    pub fn surface_area(&self) -> f64 {
        let mut props = ffi::g_prop::GProps_new();

        let inner_shape = ffi::topo_ds::cast_face_to_shape(&self.inner);

        let skip_shared = false;
        let use_triangulation = false;
        ffi::b_rep_g_prop::BRepGProp::SurfaceProperties(
            inner_shape,
            props.pin_mut(),
            skip_shared,
            use_triangulation,
        );

        // Returns surface area, obviously.
        props.Mass()
    }

    pub fn orientation(&self) -> FaceOrientation {
        FaceOrientation::from(self.inner.Orientation())
    }

    #[must_use]
    pub fn outer_wire(&self) -> Wire {
        let inner = ffi::b_rep_tools::outer_wire(&self.inner);

        Wire { inner }
    }
}

pub struct CompoundFace {
    inner: UniquePtr<ffi::topo_ds::TopoDS_Compound>,
}

impl AsRef<CompoundFace> for CompoundFace {
    fn as_ref(&self) -> &CompoundFace {
        self
    }
}

impl From<Face> for CompoundFace {
    fn from(face: Face) -> Self {
        let face = ffi::topo_ds::cast_face_to_shape(&face.inner);
        let mut compound = ffi::topo_ds::TopoDS_Compound_new();
        let brep_builder = ffi::b_rep::BRep_Builder_new();
        let topo_builder = ffi::b_rep::BRep_Builder_upcast_to_topods_builder(&brep_builder);
        topo_builder.MakeCompound(compound.pin_mut());
        let mut compound_shape = ffi::topo_ds::TopoDS_Compound_as_shape(compound);
        topo_builder.Add(compound_shape.pin_mut(), face);
        Self::from_compound(ffi::topo_ds::TopoDS::Compound(&compound_shape))
    }
}

impl CompoundFace {
    pub(crate) fn from_compound(compound: &ffi::topo_ds::TopoDS_Compound) -> Self {
        let inner = ffi::topo_ds::TopoDS_Compound_to_owned(compound);

        Self { inner }
    }

    #[must_use]
    pub fn clean(&self) -> Self {
        let shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);
        let shape = Shape::from_shape(shape).clean();

        let compound = ffi::topo_ds::TopoDS::Compound(&shape.inner);

        Self::from_compound(compound)
    }

    #[must_use]
    pub fn extrude(&self, dir: DVec3) -> Shape {
        let prism_vec = make_vec(dir);

        let copy = false;
        let canonize = true;

        let inner_shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);

        let mut make_solid =
            ffi::b_rep_prim_api::BRepPrimAPI_MakePrism_new(inner_shape, &prism_vec, copy, canonize);
        let extruded_shape = make_solid.pin_mut().Shape();

        Shape::from_shape(extruded_shape)
    }

    /// Returns None when OCCT's revolve constructor throws — see
    /// Face::revolve for the same exception-catching pattern.
    #[must_use]
    pub fn revolve(&self, origin: DVec3, axis: DVec3, angle: Option<Angle>) -> Option<Shape> {
        let revol_axis = make_axis_1(origin, axis);
        let copy = false;
        let inner_shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);
        // See Face::revolve above — `None` selects OCCT's closed-revolution
        // constructor that doesn't preserve the profile's edges as seams.
        let make_solid = match angle {
            Some(a) => ffi::b_rep_prim_api::BRepPrimAPI_MakeRevol_new(
                inner_shape, &revol_axis, a.radians(), copy,
            ),
            None => ffi::b_rep_prim_api::BRepPrimAPI_MakeRevol_full_new(
                inner_shape, &revol_axis, copy,
            ),
        };
        if make_solid.is_null() {
            return None;
        }
        // See Face::revolve — guard Shape() with IsDone() to catch the
        // "constructor returned but builder not done" failure mode.
        if !make_solid.IsDone() {
            return None;
        }
        let mut make_solid = make_solid;
        let revolved_shape = make_solid.pin_mut().Shape();

        Some(Shape::from_shape(revolved_shape))
    }

    #[must_use]
    pub fn union(&self, other: &CompoundFace) -> CompoundFace {
        let inner_shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);
        let other_inner_shape = ffi::topo_ds::cast_compound_to_shape(&other.inner);

        let mut fuse_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Fuse_new(inner_shape, other_inner_shape);

        let fuse_shape = fuse_operation.pin_mut().Shape();

        let compound = ffi::topo_ds::TopoDS::Compound(fuse_shape);

        CompoundFace::from_compound(compound)
    }

    #[must_use]
    pub fn intersect(&self, other: &CompoundFace) -> CompoundFace {
        let inner_shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);
        let other_inner_shape = ffi::topo_ds::cast_compound_to_shape(&other.inner);

        let mut common_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Common_new(inner_shape, other_inner_shape);

        let common_shape = common_operation.pin_mut().Shape();

        let compound = ffi::topo_ds::TopoDS::Compound(common_shape);

        CompoundFace::from_compound(compound)
    }

    #[must_use]
    pub fn subtract(&self, other: &CompoundFace) -> CompoundFace {
        let inner_shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);
        let other_inner_shape = ffi::topo_ds::cast_compound_to_shape(&other.inner);

        let mut fuse_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Cut_new(inner_shape, other_inner_shape);

        let cut_shape = fuse_operation.pin_mut().Shape();

        let compound = ffi::topo_ds::TopoDS::Compound(cut_shape);

        CompoundFace::from_compound(compound)
    }

    pub fn set_global_translation(&mut self, translation: DVec3) {
        let shape = ffi::topo_ds::cast_compound_to_shape(&self.inner);
        let mut shape = Shape::from_shape(shape);

        shape.set_global_translation(translation);

        let compound = ffi::topo_ds::TopoDS::Compound(&shape.inner);
        *self = Self::from_compound(compound);
    }
}

#[derive(Debug, Copy, Clone, PartialEq)]
pub enum FaceOrientation {
    Forward,
    Reversed,
    Internal,
    External,
}

impl From<ffi::top_abs::TopAbs_Orientation> for FaceOrientation {
    fn from(orientation: ffi::top_abs::TopAbs_Orientation) -> Self {
        match orientation {
            ffi::top_abs::TopAbs_Orientation::TopAbs_FORWARD => Self::Forward,
            ffi::top_abs::TopAbs_Orientation::TopAbs_REVERSED => Self::Reversed,
            ffi::top_abs::TopAbs_Orientation::TopAbs_INTERNAL => Self::Internal,
            ffi::top_abs::TopAbs_Orientation::TopAbs_EXTERNAL => Self::External,
            ffi::top_abs::TopAbs_Orientation { repr } => {
                panic!("TopAbs_Orientation had an unrepresentable value: {repr}")
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        let face = Workplane::xy().rect(7.0, 5.0).to_face();
        assert!(
            (face.surface_area() - 35.0).abs() <= 0.00001,
            "Expected surface_area() to be ~35.0, was actually {}",
            face.surface_area()
        );
    }
}
