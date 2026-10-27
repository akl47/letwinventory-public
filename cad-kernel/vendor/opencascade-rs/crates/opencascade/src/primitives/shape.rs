use crate::{
    mesh::{Mesh, Mesher},
    primitives::{
        make_axis_1, make_axis_2, make_dir, make_point, make_point2d, make_vec, BooleanShape,
        Compound, Edge, EdgeIterator, Face, FaceIterator, FaceSurface, ShapeType, Shell, Solid,
        SolidIterator, Vertex, Wire,
    },
    Error,
};
use cxx::UniquePtr;
use glam::{dvec2, dvec3, DVec3};
use opencascade_sys as ffi;
use std::path::Path;

pub struct Shape {
    pub(crate) inner: UniquePtr<ffi::topo_ds::TopoDS_Shape>,
}

impl AsRef<Shape> for Shape {
    fn as_ref(&self) -> &Shape {
        self
    }
}

impl From<Vertex> for Shape {
    fn from(vertex: Vertex) -> Self {
        let shape = ffi::topo_ds::cast_vertex_to_shape(&vertex.inner);

        Self::from_shape(shape)
    }
}

impl From<&Vertex> for Shape {
    fn from(vertex: &Vertex) -> Self {
        let shape = ffi::topo_ds::cast_vertex_to_shape(&vertex.inner);

        Self::from_shape(shape)
    }
}

impl From<Edge> for Shape {
    fn from(edge: Edge) -> Self {
        let shape = ffi::topo_ds::cast_edge_to_shape(&edge.inner);

        Self::from_shape(shape)
    }
}

impl From<&Edge> for Shape {
    fn from(edge: &Edge) -> Self {
        let shape = ffi::topo_ds::cast_edge_to_shape(&edge.inner);

        Self::from_shape(shape)
    }
}

impl From<Wire> for Shape {
    fn from(wire: Wire) -> Self {
        let shape = ffi::topo_ds::cast_wire_to_shape(&wire.inner);

        Self::from_shape(shape)
    }
}

impl From<&Wire> for Shape {
    fn from(wire: &Wire) -> Self {
        let shape = ffi::topo_ds::cast_wire_to_shape(&wire.inner);

        Self::from_shape(shape)
    }
}

impl From<Face> for Shape {
    fn from(face: Face) -> Self {
        let shape = ffi::topo_ds::cast_face_to_shape(&face.inner);

        Self::from_shape(shape)
    }
}

impl From<&Face> for Shape {
    fn from(face: &Face) -> Self {
        let shape = ffi::topo_ds::cast_face_to_shape(&face.inner);

        Self::from_shape(shape)
    }
}

impl From<Shell> for Shape {
    fn from(shell: Shell) -> Self {
        let shape = ffi::topo_ds::cast_shell_to_shape(&shell.inner);

        Self::from_shape(shape)
    }
}

impl From<&Shell> for Shape {
    fn from(shell: &Shell) -> Self {
        let shape = ffi::topo_ds::cast_shell_to_shape(&shell.inner);

        Self::from_shape(shape)
    }
}

impl From<Solid> for Shape {
    fn from(solid: Solid) -> Self {
        let shape = ffi::topo_ds::cast_solid_to_shape(&solid.inner);

        Self::from_shape(shape)
    }
}

impl From<&Solid> for Shape {
    fn from(solid: &Solid) -> Self {
        let shape = ffi::topo_ds::cast_solid_to_shape(&solid.inner);

        Self::from_shape(shape)
    }
}

impl From<Compound> for Shape {
    fn from(compound: Compound) -> Self {
        let shape = ffi::topo_ds::cast_compound_to_shape(&compound.inner);

        Self::from_shape(shape)
    }
}

impl From<&Compound> for Shape {
    fn from(compound: &Compound) -> Self {
        let shape = ffi::topo_ds::cast_compound_to_shape(&compound.inner);

        Self::from_shape(shape)
    }
}

impl From<BooleanShape> for Shape {
    fn from(boolean_shape: BooleanShape) -> Self {
        boolean_shape.shape
    }
}

pub struct SphereBuilder {
    center: DVec3,
    radius: f64,
    z_angle: f64,
}

impl SphereBuilder {
    pub fn build(self) -> Shape {
        let axis = make_axis_2(self.center, DVec3::Z);
        let mut make_shere =
            ffi::b_rep_prim_api::BRepPrimAPI_MakeSphere_new(&axis, self.radius, self.z_angle);

        Shape::from_shape(make_shere.pin_mut().Shape())
    }

    pub fn at(mut self, center: DVec3) -> Self {
        self.center = center;
        self
    }

    pub fn z_angle(mut self, z_angle: f64) -> Self {
        self.z_angle = z_angle;
        self
    }
}

pub struct ConeBuilder {
    pos: DVec3,
    height: f64,
    bottom_radius: f64,
    top_radius: f64,
    z_angle: f64,
}

impl ConeBuilder {
    pub fn build(self) -> Shape {
        let axis = make_axis_2(self.pos, DVec3::Z);
        let mut make_cone = ffi::b_rep_prim_api::BRepPrimAPI_MakeCone_new(
            &axis,
            self.bottom_radius,
            self.top_radius,
            self.height,
            self.z_angle,
        );

        Shape::from_shape(make_cone.pin_mut().Shape())
    }

    pub fn at(mut self, pos: DVec3) -> Self {
        self.pos = pos;
        self
    }

    pub fn bottom_radius(mut self, bottom_radius: f64) -> Self {
        self.bottom_radius = bottom_radius;
        self
    }

    pub fn top_radius(mut self, top_radius: f64) -> Self {
        self.top_radius = top_radius;
        self
    }

    pub fn height(mut self, height: f64) -> Self {
        self.height = height;
        self
    }

    pub fn z_angle(mut self, z_angle: f64) -> Self {
        self.z_angle = z_angle;
        self
    }
}

pub struct TorusBuilder {
    pos: DVec3,
    z_axis: DVec3,
    radius_1: f64,
    radius_2: f64,
    angle_1: f64,
    angle_2: f64,
    z_angle: f64,
}

impl TorusBuilder {
    pub fn build(self) -> Shape {
        let axis = make_axis_2(self.pos, self.z_axis);
        let mut make_torus = ffi::b_rep_prim_api::BRepPrimAPI_MakeTorus_new(
            &axis,
            self.radius_1,
            self.radius_2,
            self.angle_1,
            self.angle_2,
            self.z_angle,
        );

        Shape::from_shape(make_torus.pin_mut().Shape())
    }

    pub fn at(mut self, pos: DVec3) -> Self {
        self.pos = pos;
        self
    }

    pub fn z_axis(mut self, z_axis: DVec3) -> Self {
        self.z_axis = z_axis;
        self
    }

    pub fn radius_1(mut self, radius_1: f64) -> Self {
        self.radius_1 = radius_1;
        self
    }

    pub fn radius_2(mut self, radius_2: f64) -> Self {
        self.radius_2 = radius_2;
        self
    }

    pub fn angle_1(mut self, angle_1: f64) -> Self {
        self.angle_1 = angle_1;
        self
    }

    pub fn angle_2(mut self, angle_2: f64) -> Self {
        self.angle_2 = angle_2;
        self
    }

    pub fn z_angle(mut self, z_angle: f64) -> Self {
        self.z_angle = z_angle;
        self
    }
}

impl Shape {
    pub(crate) fn from_shape(shape: &ffi::topo_ds::TopoDS_Shape) -> Self {
        let inner = ffi::topo_ds::TopoDS_Shape_to_owned(shape);

        Self { inner }
    }

    /// Make a shape that models empty space.
    pub fn empty() -> Self {
        // NOTE: It may seem like using `TopoDS_Shape()` directly should work,
        //       but shape operations such as union fail on actual "null shapes".

        // Construct an empty compound
        let mut compound = ffi::topo_ds::TopoDS_Compound_new();
        let builder = ffi::b_rep::BRep_Builder_new();
        let topods_builder = ffi::b_rep::BRep_Builder_upcast_to_topods_builder(&builder);
        topods_builder.MakeCompound(compound.pin_mut());

        let inner = ffi::topo_ds::TopoDS_Compound_as_shape(compound);

        Self { inner }
    }

    /// Group `shapes` into a single TopoDS_Compound with NO boolean — purely
    /// topological. Feeding many tool solids to ONE boolean op (e.g.
    /// `body.union(&Shape::compound_of(copies))`) lets OCCT resolve every seam
    /// in a single pass; folding them in one-at-a-time re-tolerances the whole
    /// body per instance and accumulates fuzzy sliver loss at coincident faces,
    /// which under-reports volume. The empty case yields an empty compound.
    pub fn compound_of<'a>(shapes: impl IntoIterator<Item = &'a Shape>) -> Self {
        let mut compound = ffi::topo_ds::TopoDS_Compound_new();
        let builder = ffi::b_rep::BRep_Builder_new();
        let topods_builder = ffi::b_rep::BRep_Builder_upcast_to_topods_builder(&builder);
        topods_builder.MakeCompound(compound.pin_mut());
        let mut inner = ffi::topo_ds::TopoDS_Compound_as_shape(compound);
        for s in shapes {
            topods_builder.Add(inner.pin_mut(), &s.inner);
        }
        Self { inner }
    }

    /// Make a box with one corner at corner_1, and the opposite corner
    /// at corner_2.
    pub fn box_from_corners(corner_1: DVec3, corner_2: DVec3) -> Self {
        let min_corner = corner_1.min(corner_2);
        let max_corner = corner_1.max(corner_2);

        let point = ffi::gp::new_point(min_corner.x, min_corner.y, min_corner.z);
        let diff = max_corner - min_corner;
        let mut my_box =
            ffi::b_rep_prim_api::BRepPrimAPI_MakeBox_new(&point, diff.x, diff.y, diff.z);

        Self::from_shape(my_box.pin_mut().Shape())
    }

    /// Make a box with `width` (x), `depth` (y), and `height` (z)
    /// centered around the origin.
    pub fn box_centered(width: f64, depth: f64, height: f64) -> Self {
        let half_width = width / 2.0;
        let half_depth = depth / 2.0;
        let half_height = height / 2.0;

        let corner_1 = dvec3(-half_width, -half_depth, -half_height);
        let corner_2 = dvec3(half_width, half_depth, half_height);
        Self::box_from_corners(corner_1, corner_2)
    }

    /// Make a box with `width` (x), `depth` (y), and `height` (z)
    /// extending into the positive axes
    pub fn box_with_dimensions(width: f64, depth: f64, height: f64) -> Self {
        let corner_1 = DVec3::ZERO;
        let corner_2 = dvec3(width, depth, height);
        Self::box_from_corners(corner_1, corner_2)
    }

    /// Make a cube with side length of `size`
    /// extending into the positive axes
    pub fn cube(size: f64) -> Self {
        Self::box_with_dimensions(size, size, size)
    }

    /// Make a centered cube with side length of `size`
    pub fn cube_centered(size: f64) -> Self {
        Self::box_centered(size, size, size)
    }

    /// Make a cylinder with base at point `p`, radius `r`, and height `h`.
    /// Extends from `p` along axis `dir`.
    pub fn cylinder(p: DVec3, r: f64, dir: DVec3, h: f64) -> Self {
        let cylinder_coord_system = make_axis_2(p, dir);
        let mut cylinder =
            ffi::b_rep_prim_api::BRepPrimAPI_MakeCylinder_new(&cylinder_coord_system, r, h);

        Self::from_shape(cylinder.pin_mut().Shape())
    }

    /// Make a "default" cylinder with radius `r` and height `h`.
    /// The base is at the coordinate origin, and extends along the Z axis.
    pub fn cylinder_radius_height(r: f64, h: f64) -> Self {
        Self::cylinder(DVec3::ZERO, r, DVec3::Z, h)
    }

    /// Make a cylinder from start point `p1` and end point `p2`,
    /// with radius `r`.
    pub fn cylinder_from_points(p1: DVec3, p2: DVec3, r: f64) -> Self {
        let dir = p2 - p1;
        Self::cylinder(p1, r, dir, dir.length())
    }

    /// Make a cylinder centered at point `p`, with radius `r`, and height `h`.
    /// Extends along axis `dir`.
    pub fn cylinder_centered(p: DVec3, r: f64, dir: DVec3, h: f64) -> Self {
        let p = p - (dir.normalize() * (h / 2.0));
        Self::cylinder(p, r, dir, h)
    }

    pub fn sphere(radius: f64) -> SphereBuilder {
        SphereBuilder { center: DVec3::ZERO, radius, z_angle: std::f64::consts::TAU }
    }

    pub fn cone() -> ConeBuilder {
        ConeBuilder {
            pos: DVec3::ZERO,
            height: 1.0,
            bottom_radius: 1.0,
            top_radius: 0.0,
            z_angle: std::f64::consts::TAU,
        }
    }

    pub fn torus() -> TorusBuilder {
        TorusBuilder {
            pos: DVec3::ZERO,
            z_axis: DVec3::Z,
            radius_1: 20.0,
            radius_2: 10.0,
            angle_1: -std::f64::consts::PI,
            angle_2: std::f64::consts::PI,
            z_angle: std::f64::consts::TAU,
        }
    }

    pub fn shape_type(&self) -> ShapeType {
        self.inner.ShapeType().into()
    }

    #[must_use]
    pub fn fillet_edge(&self, radius: f64, edge: &Edge) -> Self {
        self.fillet_edges(radius, [edge])
    }

    #[must_use]
    pub fn variable_fillet_edge(
        &self,
        radius_values: impl IntoIterator<Item = (f64, f64)>,
        edge: &Edge,
    ) -> Self {
        self.variable_fillet_edges(radius_values, [edge])
    }

    #[must_use]
    pub fn chamfer_edge(&self, distance: f64, edge: &Edge) -> Self {
        self.chamfer_edges(distance, [edge])
    }

    #[must_use]
    pub fn fillet_edges<T: AsRef<Edge>>(
        &self,
        radius: f64,
        edges: impl IntoIterator<Item = T>,
    ) -> Self {
        let mut make_fillet = ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet_new(&self.inner);

        for edge in edges.into_iter() {
            make_fillet.pin_mut().add_edge(radius, &edge.as_ref().inner);
        }

        Self::from_shape(make_fillet.pin_mut().Shape())
    }

    #[must_use]
    pub fn variable_fillet_edges<T: AsRef<Edge>>(
        &self,
        radius_values: impl IntoIterator<Item = (f64, f64)>,
        edges: impl IntoIterator<Item = T>,
    ) -> Self {
        let radius_values: Vec<_> = radius_values.into_iter().collect();
        let mut array = ffi::t_col_gp::TColgp_Array1OfPnt2d_new(1, radius_values.len() as i32);

        for (index, (t, radius)) in radius_values.into_iter().enumerate() {
            array.pin_mut().SetValue(index as i32 + 1, &make_point2d(dvec2(t, radius)));
        }

        let mut make_fillet = ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet_new(&self.inner);

        for edge in edges.into_iter() {
            make_fillet.pin_mut().variable_add_edge(&array, &edge.as_ref().inner);
        }

        Self::from_shape(make_fillet.pin_mut().Shape())
    }

    #[must_use]
    pub fn chamfer_edges<T: AsRef<Edge>>(
        &self,
        distance: f64,
        edges: impl IntoIterator<Item = T>,
    ) -> Self {
        let mut make_chamfer = ffi::b_rep_fillet_api::BRepFilletAPI_MakeChamfer_new(&self.inner);

        for edge in edges.into_iter() {
            make_chamfer.pin_mut().add_edge(distance, &edge.as_ref().inner);
        }

        Self::from_shape(make_chamfer.pin_mut().Shape())
    }

    /// Multi-radius fillet — each picked edge gets its own radius in a
    /// single MakeFillet call (rolling balls interact correctly at
    /// junction vertices). Matches SolidWorks "multiple radius" mode.
    #[must_use]
    pub fn fillet_edges_per<T: AsRef<Edge>>(
        &self,
        items: impl IntoIterator<Item = (f64, T)>,
    ) -> Self {
        let mut make_fillet = ffi::b_rep_fillet_api::BRepFilletAPI_MakeFillet_new(&self.inner);
        for (radius, edge) in items.into_iter() {
            make_fillet.pin_mut().add_edge(radius, &edge.as_ref().inner);
        }
        Self::from_shape(make_fillet.pin_mut().Shape())
    }

    /// Hollow this solid into a thin-walled body by removing
    /// `faces_to_remove` (open faces) and offsetting the remainder by
    /// `offset` along each remaining face's inward / outward normal.
    /// Positive offset thickens outward (adds material); negative
    /// thickens inward (removes material). `tolerance` controls how
    /// closely OCCT must approximate the offset — 1e-3 mm is a sane
    /// default for typical body sizes. Uses BRepOffsetAPI_MakeThickSolid
    /// with the standard Skin offset mode + Arc join (most forgiving for
    /// concave corners).
    /// Shell a solid into a thin-walled body. Two-stage approach:
    ///
    /// 1. **Direct** — try OCCT's MakeThickSolid against the original
    ///    body with four parameter combinations (Intersection/Arc join
    ///    × tight/loose tolerance). Most parts succeed here.
    ///
    /// 2. **Subtraction pipeline** — when stage 1 fails (typically
    ///    because the body has fillets ≤ offset distance that would
    ///    self-intersect when offset), build the shell as
    ///    `original − (inner_solid ∪ punch-through prisms)` where the
    ///    inner solid is the original DEFEATURED-and-offset-inward by
    ///    thickness. The original outer surface (with fillets intact)
    ///    is preserved by virtue of being the subtraction MINUEND;
    ///    inner cavity corners square at the defeatured locations;
    ///    picked faces become open boundaries via the prisms.
    pub fn shell<F: AsRef<Face>>(
        &self,
        faces_to_remove: impl IntoIterator<Item = F>,
        offset: f64,
        tolerance: f64,
    ) -> Result<Self, String> {
        let picked: Vec<F> = faces_to_remove.into_iter().collect();
        let orig_face_count = self.faces().count();
        eprintln!(
            "[shell] start: offset={:.6}, tolerance={:.6}, picked_count={}, orig_face_count={}",
            offset, tolerance, picked.len(), orig_face_count,
        );

        let mut closing_faces = ffi::top_tools::new_list_of_shape();
        for face in &picked {
            let face_shape = ffi::topo_ds::cast_face_to_shape(&face.as_ref().inner);
            closing_faces.pin_mut().Append(face_shape);
        }

        // ── Stage 0: simple (Parasolid-style) local offset ───────────
        // A face-offset-and-sew that skips the global surface-surface
        // intersection MakeThickSolidByJoin runs — faster, and succeeds on
        // bodies the join offset can't handle. It doesn't resolve self-
        // intersection, so it's validity-gated in C++; on failure we fall
        // through to the join pipeline below.
        eprintln!("[shell] stage0 simple offset: offset={:.6}, tol={:.6}", offset, tolerance);
        match ffi::b_rep_offset_api::try_simple_offset_shell(
            &self.inner,
            closing_faces.as_ref().unwrap(),
            offset,
            tolerance,
        ) {
            Ok(shape) => {
                // MakeSimpleOffset leaves spurious seam/imprint edges — faces
                // come back split with extra boundary edges (and coincident
                // imprints where the wall meets a region thinner than the
                // offset). UnifySameDomain merges the coplanar pieces and drops
                // the redundant edges, the same cleanup Stage 2 already runs.
                eprintln!("[shell] stage0 simple offset SUCCESS (unifying same-domain faces)");
                let cleaned = Self::from_shape(shape.as_ref().unwrap()).clean();
                return Ok(cleaned);
            }
            Err(e) => {
                eprintln!("[shell] stage0 simple offset failed, falling to stage1: {}", e);
            }
        }

        // ── Stage 1: direct MakeThickSolid retry chain ───────────────
        let attempts: [(ffi::geom_abs::GeomAbs_JoinType, f64); 4] = [
            (ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Intersection, tolerance),
            (ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Arc,          tolerance),
            (ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Intersection, (offset.abs() * 0.1).max(tolerance)),
            (ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Arc,          (offset.abs() * 0.1).max(tolerance)),
        ];
        let mut stage1_err = String::new();
        for (i, (join, tol)) in attempts.into_iter().enumerate() {
            let join_name = match join {
                ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Intersection => "Intersection",
                ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Arc => "Arc",
                _ => "?",
            };
            eprintln!(
                "[shell] stage1 attempt {}: join={}, tol={:.6}",
                i + 1, join_name, tol,
            );
            let progress = ffi::message::Message_ProgressRange_new();
            match ffi::b_rep_offset_api::try_shell(
                &self.inner,
                closing_faces.as_ref().unwrap(),
                offset,
                tol,
                ffi::b_rep_offset_api::BRepOffset_Mode::BRepOffset_Skin,
                true,                                   // intersection
                false,                                  // self_intersection
                join,
                false,                                  // remove_intersecting_edges
                &progress,
            ) {
                Ok(shape) => {
                    eprintln!("[shell] stage1 attempt {} SUCCESS", i + 1);
                    return Ok(Self::from_shape(shape.as_ref().unwrap()));
                }
                Err(e) => {
                    eprintln!("[shell] stage1 attempt {} err: {}", i + 1, e);
                    stage1_err = format!("{e}");
                }
            }
        }

        eprintln!("[shell] stage1 EXHAUSTED, falling to stage2 subtraction pipeline");

        // ── Stage 2: conforming-punch offset pipeline ────────────────
        // Build the cavity explicitly instead of offsetting the whole
        // body. The whole-body inward offset is what OCCT cannot do
        // when ANY region of the body is thinner than 2x the wall —
        // the offset surfaces cross there and the operation returns
        // null/invalid (Intersection join) or invents rolled-corner
        // cylinder faces (Arc join). Steps:
        //   1. PUNCH: extrude each picked face through the body and
        //      intersect with the body — the conforming column of
        //      material behind each opening. It stops at the body's
        //      far boundary and follows curved walls exactly.
        //   2. EXTEND: re-extrude every punch face that lies in a
        //      picked face's plane OUTWARD. Without this the inward
        //      offset would put a wall across the opening (and leave a
        //      thickness-sized lip at edges where a picked face meets
        //      a retained face).
        //   3. OFFSET: shrink the extended punch inward by t via the
        //      existing Intersection-first retry chain. The punch is a
        //      simple solid with no thin regions, so the sharp join
        //      succeeds where the whole-body offset could not.
        //   4. SUBTRACT + CLEAN: body − cavity, then UnifySameDomain
        //      merges coplanar faces (e.g. the cavity floor into a
        //      coplanar retained face) and drops redundant edges.
        // Regions thinner than the wall never enter the punch, so they
        // stay solid — the Parasolid/SolidWorks/Onshape behaviour.
        let thickness = offset.abs();

        // Through-all prism length: comfortably beyond the body.
        let mut cmin = [f64::INFINITY; 3];
        let mut cmax = [f64::NEG_INFINITY; 3];
        for f in self.faces() {
            let c = f.center_of_mass();
            for (i, v) in [c.x, c.y, c.z].into_iter().enumerate() {
                if v < cmin[i] { cmin[i] = v; }
                if v > cmax[i] { cmax[i] = v; }
            }
        }
        let through_all = 3.0
            * ((cmax[0] - cmin[0]).powi(2)
                + (cmax[1] - cmin[1]).powi(2)
                + (cmax[2] - cmin[2]).powi(2))
            .sqrt()
            .max(1.0)
            + 100.0;

        // 1. Conforming punch.
        let mut punch_acc: Option<Self> = None;
        for (i, face) in picked.iter().enumerate() {
            let f = face.as_ref();
            let c = f.center_of_mass();
            let n = f.normal_at(c);
            let dir = glam::dvec3(-n.x * through_all, -n.y * through_all, -n.z * through_all);
            let raw: Self = f.extrude(dir).into();
            eprintln!(
                "[shell] stage2 punch {}: centroid=({:.3},{:.3},{:.3}) normal=({:.3},{:.3},{:.3}) len={:.1}",
                i, c.x, c.y, c.z, n.x, n.y, n.z, through_all,
            );
            punch_acc = Some(match punch_acc {
                None => raw,
                Some(p) => p.union(&raw).into(),
            });
        }
        let punch_raw = punch_acc.ok_or_else(|| "shell: no faces picked".to_string())?;
        // clean(): the ∩ leaves seam edges splitting the punch's surfaces
        // into coplanar/cosurface fragments (e.g. a D-prism comes back with
        // 6 faces instead of 4). MakeOffsetShape nulls on seam-split
        // surfaces, so unify them before going further.
        let punch: Self = Into::<Self>::into(self.intersect(&punch_raw)).clean();
        let punch_faces: Vec<Face> = punch.faces().collect();
        eprintln!("[shell] stage2 conforming punch: {} faces", punch_faces.len());
        if punch_faces.is_empty() {
            return Err(format!(
                "shell failed (direct: {stage1_err}; punch: picked faces do not bound any body material)"
            ));
        }

        // 2. Extend through the openings — SEQUENTIALLY. Each pick's pass
        // re-collects coplanar faces from the GROWING solid, so pick 2's
        // stub also extrudes over pick 1's stub-top. Without that, two
        // stubs whose source faces share an edge (adjacent removed faces)
        // touch only along a line — a non-manifold union that nulls
        // MakeOffsetShape — and the wrap-around corner stays closed.
        let stub_len = thickness * 2.0 + 2.0;
        let mut punch_ext: Option<Self> = None;
        let mut stub_count = 0usize;
        for face in &picked {
            let f = face.as_ref();
            let pc = f.center_of_mass();
            let pn = f.normal_at(pc);
            let current_faces: Vec<Face> = match &punch_ext {
                None => punch.faces().collect(),
                Some(p) => p.faces().collect(),
            };
            let mut stubs_this: Vec<Self> = Vec::new();
            for pf in &current_faces {
                let fc = pf.center_of_mass();
                let fnm = pf.normal_at(fc);
                let dot = fnm.x * pn.x + fnm.y * pn.y + fnm.z * pn.z;
                if dot < 0.999 { continue; }
                // Same plane: centroid offset along the normal ~ 0.
                let d = (fc.x - pc.x) * pn.x + (fc.y - pc.y) * pn.y + (fc.z - pc.z) * pn.z;
                if d.abs() > 1.0e-4 { continue; }
                let dir = glam::dvec3(pn.x * stub_len, pn.y * stub_len, pn.z * stub_len);
                stubs_this.push(pf.extrude(dir).into());
            }
            for stub in &stubs_this {
                let grown: Self = match punch_ext.take() {
                    None => punch.union(stub).into(),
                    Some(p) => p.union(stub).into(),
                };
                punch_ext = Some(grown);
                stub_count += 1;
            }
        }
        eprintln!("[shell] stage2 extended punch with {} opening stub(s)", stub_count);
        if stub_count == 0 {
            return Err(format!(
                "shell failed (direct: {stage1_err}; punch: no punch face lies in a picked face's plane — re-pick the open faces)"
            ));
        }
        // Same rationale as the post-∩ clean: stub unions imprint seam
        // edges along the opening boundaries that derail the offset.
        let punch_ext = punch_ext.expect("stub_count > 0 implies punch_ext").clean();
        eprintln!("[shell] stage2 punch_ext cleaned: {} faces", punch_ext.faces().count());

        // 3. Build the cavity. PRIMARY route: per-face WALL-SLAB
        // subtraction — fully boolean, no surface offsetting at all.
        // For each retained boundary face of the punch, subtract the
        // wall material that face owes:
        //   plane    → the face extruded INWARD by t (a prism);
        //   cylinder → the concentric tube between R−t and R (material
        //              inside) or R and R+t (a hole wall), built from two
        //              cylinder solids.
        // Faces coplanar with a pick get NO slab — the cavity stays flush
        // with the opening. This produces the MITERED sharp-corner cavity
        // (the Intersection-join semantics) by construction and sidesteps
        // MakeOffsetShape entirely — which matters because OCCT's offset
        // returns null on solids with tangent plane↔cylinder junctions
        // (e.g. a D-shaped profile, where the flat side meets the curve
        // tangentially). Falls back to the offset routes below when a
        // punch face is neither planar nor cylindrical.
        let punch_wall_faces: Vec<Face> = punch.faces().collect();
        let mut slab_cavity: Option<Self> = None;
        let mut slab_unsupported: Option<String> = None;
        for pf in &punch_wall_faces {
            let fc = pf.center_of_mass();
            let fnm = pf.normal_at(fc);
            // Opening face? (coplanar with a pick) → no wall slab.
            let mut is_opening = false;
            for face in &picked {
                let p = face.as_ref();
                let pc = p.center_of_mass();
                let pn = p.normal_at(pc);
                let dot = fnm.x * pn.x + fnm.y * pn.y + fnm.z * pn.z;
                if dot < 0.999 { continue; }
                let d = (fc.x - pc.x) * pn.x + (fc.y - pc.y) * pn.y + (fc.z - pc.z) * pn.z;
                if d.abs() < 1.0e-4 { is_opening = true; break; }
            }
            if is_opening { continue; }
            let slab: Self = match pf.surface_kind() {
                Some(FaceSurface::Plane { .. }) => {
                    // Prism into the solid: the outward normal negated.
                    let dir = glam::dvec3(-fnm.x * thickness, -fnm.y * thickness, -fnm.z * thickness);
                    pf.extrude(dir).into()
                }
                Some(FaceSurface::Cylinder { origin, axis, radius }) => {
                    let a = axis.normalize();
                    // Convex (material inside the cylinder) when the face's
                    // outward normal points away from the axis at the
                    // centroid; a hole wall points toward it.
                    let to_c = glam::dvec3(fc.x - origin.x, fc.y - origin.y, fc.z - origin.z);
                    let radial = to_c - a * to_c.dot(a);
                    let convex = radial.dot(glam::dvec3(fnm.x, fnm.y, fnm.z)) > 0.0;
                    let (r_out, r_in) = if convex {
                        (radius + thickness * 0.5, radius - thickness)
                    } else {
                        (radius + thickness, radius - thickness * 0.5)
                    };
                    // Workplane perpendicular to the axis, centered well
                    // below the punch; cylinders span 'through_all'.
                    let seed = if a.x.abs() < 0.9 { glam::dvec3(1.0, 0.0, 0.0) } else { glam::dvec3(0.0, 1.0, 0.0) };
                    let xdir = (seed - a * seed.dot(a)).normalize();
                    let base = glam::dvec3(origin.x, origin.y, origin.z) - a * (through_all * 0.5);
                    let mut wp = crate::workplane::Workplane::new(xdir, a);
                    wp.set_translation(base);
                    let outer_wire = wp.circle(0.0, 0.0, r_out);
                    let outer: Self = Face::from_wire(&outer_wire).extrude(a * through_all).into();
                    if r_in > 1.0e-6 {
                        let inner_wire = wp.circle(0.0, 0.0, r_in);
                        let inner: Self = Face::from_wire(&inner_wire).extrude(a * through_all).into();
                        outer.subtract(&inner).into()
                    } else {
                        outer // wall consumes the whole cylinder
                    }
                }
                _ => {
                    slab_unsupported = Some(format!(
                        "punch face at ({:.2},{:.2},{:.2}) is neither planar nor cylindrical",
                        fc.x, fc.y, fc.z,
                    ));
                    break;
                }
            };
            slab_cavity = Some(match slab_cavity.take() {
                None => punch.subtract(&slab).into(),
                Some(c) => c.subtract(&slab).into(),
            });
        }

        if slab_unsupported.is_none() {
            if let Some(cav0) = slab_cavity {
                // Extend the cavity OUT through the openings (sequentially,
                // same corner logic as the punch stubs) so the final
                // subtract cuts with clean overshoot instead of coincident
                // faces, then carve.
                let mut cav = cav0.clean();
                eprintln!("[shell] stage2 slab cavity: {} faces", cav.faces().count());
                for face in &picked {
                    let f = face.as_ref();
                    let pc = f.center_of_mass();
                    let pn = f.normal_at(pc);
                    let cav_faces: Vec<Face> = cav.faces().collect();
                    let mut prisms: Vec<Self> = Vec::new();
                    for cf in &cav_faces {
                        let fc = cf.center_of_mass();
                        let fnm = cf.normal_at(fc);
                        let dot = fnm.x * pn.x + fnm.y * pn.y + fnm.z * pn.z;
                        if dot < 0.999 { continue; }
                        let d = (fc.x - pc.x) * pn.x + (fc.y - pc.y) * pn.y + (fc.z - pc.z) * pn.z;
                        if d.abs() > 1.0e-4 { continue; }
                        let dir = glam::dvec3(pn.x * stub_len, pn.y * stub_len, pn.z * stub_len);
                        prisms.push(cf.extrude(dir).into());
                    }
                    for p in &prisms {
                        cav = cav.union(p).into();
                    }
                }
                let cav = cav.clean();
                let result: Self = self.subtract(&cav).into();
                let post = result.faces().count();
                let cleaned = result.clean();
                eprintln!(
                    "[shell] stage2 slab route done — orig={} post_subtract={} final={} — RETURNING SUCCESS",
                    orig_face_count, post, cleaned.faces().count(),
                );
                return Ok(cleaned);
            }
        } else {
            eprintln!(
                "[shell] stage2 slab route unavailable ({}), falling to offset routes",
                slab_unsupported.as_deref().unwrap_or("?"),
            );
        }

        // Fallback offset routes:
        //   3a. offset the stub-extended punch — openings come out flush in
        //       one step;
        //   3b. if 3a's offset fails (stub geometry adds tangent junctions
        //       OCCT may refuse), offset the BARE punch — the same shape
        //       class as the body itself, OCCT's best case — and then open
        //       the cavity by extruding its inner-wall faces (the faces
        //       parallel to each pick at plane-distance ≈ thickness),
        //       sequentially so wrap-around corners between adjacent
        //       openings get covered.
        eprintln!("[shell] stage2 cavity offset (3a, stubbed): thickness={:.6}, tol={:.6}", thickness, tolerance);
        let cavity: Self = match ffi::b_rep_offset_api::try_offset_solid_inward(
            &punch_ext.inner,
            thickness,
            tolerance,
        ) {
            Ok(raw) => {
                let c = Self::from_shape(raw.as_ref().unwrap());
                eprintln!("[shell] stage2 3a OK ({} faces)", c.faces().count());
                c
            }
            Err(e3a) => {
                eprintln!("[shell] stage2 3a failed ({}), trying 3b bare-punch offset", e3a);
                let raw = ffi::b_rep_offset_api::try_offset_solid_inward(
                    &punch.inner,
                    thickness,
                    tolerance,
                ).map_err(|e| {
                    eprintln!("[shell] stage2 3b offset FAILED: {}", e);
                    format!("shell failed (direct: {stage1_err}; cavity offset: {e})")
                })?;
                let mut cav = Self::from_shape(raw.as_ref().unwrap());
                eprintln!("[shell] stage2 3b bare cavity OK ({} faces)", cav.faces().count());
                // Open the cavity: for each pick, extrude the cavity faces
                // whose outward normal matches the pick and which sit one
                // wall-thickness inside the pick plane.
                let open_len = thickness * 2.0 + 2.0;
                for face in &picked {
                    let f = face.as_ref();
                    let pc = f.center_of_mass();
                    let pn = f.normal_at(pc);
                    let cav_faces: Vec<Face> = cav.faces().collect();
                    let mut prisms: Vec<Self> = Vec::new();
                    for cf in &cav_faces {
                        let fc = cf.center_of_mass();
                        let fnm = cf.normal_at(fc);
                        let dot = fnm.x * pn.x + fnm.y * pn.y + fnm.z * pn.z;
                        if dot < 0.999 { continue; }
                        // Inner wall: thickness inside the pick plane (some
                        // slack — the wall sits at exactly `thickness` but
                        // tolerate offset wobble).
                        let d = (pc.x - fc.x) * pn.x + (pc.y - fc.y) * pn.y + (pc.z - fc.z) * pn.z;
                        if (d - thickness).abs() > thickness * 0.5 { continue; }
                        let dir = glam::dvec3(pn.x * open_len, pn.y * open_len, pn.z * open_len);
                        prisms.push(cf.extrude(dir).into());
                    }
                    eprintln!("[shell] stage2 3b opening pick: {} prism(s)", prisms.len());
                    for p in &prisms {
                        cav = cav.union(p).into();
                    }
                }
                cav.clean()
            }
        };

        // 4. Carve + clean.
        let result: Self = self.subtract(&cavity).into();
        let post_subtract_count = result.faces().count();
        let cleaned = result.clean();
        let final_count = cleaned.faces().count();
        eprintln!(
            "[shell] stage2 done — orig={} post_subtract={} final={} — RETURNING SUCCESS",
            orig_face_count, post_subtract_count, final_count,
        );
        Ok(cleaned)
    }

    /// Multi-distance chamfer — each picked edge gets its own equal-leg
    /// distance in a single MakeChamfer call. Same semantics as the
    /// per-radius fillet above.
    #[must_use]
    pub fn chamfer_edges_per<T: AsRef<Edge>>(
        &self,
        items: impl IntoIterator<Item = (f64, T)>,
    ) -> Self {
        let mut make_chamfer = ffi::b_rep_fillet_api::BRepFilletAPI_MakeChamfer_new(&self.inner);
        for (distance, edge) in items.into_iter() {
            make_chamfer.pin_mut().add_edge(distance, &edge.as_ref().inner);
        }
        Self::from_shape(make_chamfer.pin_mut().Shape())
    }

    /// Asymmetric distance-distance chamfer. Each item is
    /// `(d1, d2, edge, reference_face)` — `d1` is measured along the
    /// reference face, `d2` along the other face adjacent to the edge.
    /// The reference face must be one of the two faces topologically
    /// adjacent to the edge.
    #[must_use]
    pub fn chamfer_edges_two_distance<E: AsRef<Edge>, F: AsRef<Face>>(
        &self,
        items: impl IntoIterator<Item = (f64, f64, E, F)>,
    ) -> Self {
        let mut make_chamfer = ffi::b_rep_fillet_api::BRepFilletAPI_MakeChamfer_new(&self.inner);
        for (d1, d2, edge, face) in items.into_iter() {
            make_chamfer
                .pin_mut()
                .add_edge_two_distance(d1, d2, &edge.as_ref().inner, &face.as_ref().inner);
        }
        Self::from_shape(make_chamfer.pin_mut().Shape())
    }

    /// Distance-and-angle chamfer. Each item is
    /// `(distance, angle_radians, edge, reference_face)`. The distance
    /// is measured along the reference face; the angle is between the
    /// chamfer face and the reference face.
    #[must_use]
    pub fn chamfer_edges_distance_angle<E: AsRef<Edge>, F: AsRef<Face>>(
        &self,
        items: impl IntoIterator<Item = (f64, f64, E, F)>,
    ) -> Self {
        let mut make_chamfer = ffi::b_rep_fillet_api::BRepFilletAPI_MakeChamfer_new(&self.inner);
        for (distance, angle, edge, face) in items.into_iter() {
            make_chamfer
                .pin_mut()
                .add_edge_distance_angle(distance, angle, &edge.as_ref().inner, &face.as_ref().inner);
        }
        Self::from_shape(make_chamfer.pin_mut().Shape())
    }

    /// Translate a copy of this shape by `(dx, dy, dz)`. Used by
    /// Linear Pattern + Mirror features to produce transformed copies
    /// before they're fused. `copy = true` keeps the source unchanged.
    #[must_use]
    pub fn translate_xyz(&self, dx: f64, dy: f64, dz: f64) -> Self {
        let mut trsf = ffi::gp::new_transform();
        let from = make_point(dvec3(0.0, 0.0, 0.0));
        let to = make_point(dvec3(dx, dy, dz));
        trsf.pin_mut().SetTranslation(&from, &to);
        let mut bt = ffi::b_rep_builder_api::BRepBuilderAPI_Transform_new(
            &self.inner, trsf.as_ref().unwrap(), true,
        );
        Self::from_shape(bt.pin_mut().Shape())
    }

    /// Rotate a copy of this shape `angle` radians around the axis
    /// defined by `origin` + `direction`. Right-hand-rule positive.
    #[must_use]
    pub fn rotate_around(&self, origin: DVec3, direction: DVec3, angle: f64) -> Self {
        let mut trsf = ffi::gp::new_transform();
        let axis = make_axis_1(origin, direction);
        trsf.pin_mut().SetRotation(&axis, angle);
        let mut bt = ffi::b_rep_builder_api::BRepBuilderAPI_Transform_new(
            &self.inner, trsf.as_ref().unwrap(), true,
        );
        Self::from_shape(bt.pin_mut().Shape())
    }

    /// Reflect a copy of this shape across the plane defined by
    /// `origin` + `normal`. Used by Mirror Feature. The Ax2 variant
    /// of SetMirror is required — the Ax1 variant performs a 180°
    /// axial rotation, not plane reflection.
    #[must_use]
    pub fn mirror_plane(&self, origin: DVec3, normal: DVec3) -> Self {
        let mut trsf = ffi::gp::new_transform();
        let plane = make_axis_2(origin, normal);
        trsf.pin_mut().set_mirror_plane(&plane);
        let mut bt = ffi::b_rep_builder_api::BRepBuilderAPI_Transform_new(
            &self.inner, trsf.as_ref().unwrap(), true,
        );
        Self::from_shape(bt.pin_mut().Shape())
    }

    /// Performs fillet of `radius` on all edges of the shape
    #[must_use]
    pub fn fillet(&self, radius: f64) -> Self {
        self.fillet_edges(radius, self.edges())
    }

    /// Performs chamfer of `distance` on all edges of the shape
    #[must_use]
    pub fn chamfer(&self, distance: f64) -> Self {
        self.chamfer_edges(distance, self.edges())
    }

    #[must_use]
    pub fn subtract(&self, other: &Shape) -> BooleanShape {
        let mut cut_operation = ffi::b_rep_algo_api::BRepAlgoAPI_Cut_new(&self.inner, &other.inner);

        let edge_list = cut_operation.pin_mut().SectionEdges();
        let vec = ffi::topo_ds::shape_list_to_vector(edge_list);

        let mut new_edges = vec![];
        for shape in vec.iter() {
            let edge = ffi::topo_ds::TopoDS::Edge(shape);
            new_edges.push(Edge::from_edge(edge));
        }

        let shape = Self::from_shape(cut_operation.pin_mut().Shape());

        BooleanShape { shape, new_edges }
    }

    pub fn read_step(path: impl AsRef<Path>) -> Result<Self, Error> {
        let mut reader = ffi::step_control::STEPControl_Reader_new();

        let status = ffi::step_control::read_step(
            reader.pin_mut(),
            path.as_ref().to_string_lossy().to_string(),
        );

        if status != ffi::if_select::IFSelect_ReturnStatus::IFSelect_RetDone {
            return Err(Error::StepReadFailed);
        }

        reader.pin_mut().TransferRoots(&ffi::message::Message_ProgressRange_new());

        let inner = ffi::step_control::one_shape_step(&reader);

        Ok(Self { inner })
    }

    pub fn write_step(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        let mut writer = ffi::step_control::STEPControl_Writer_new();

        let status = ffi::step_control::transfer_shape(writer.pin_mut(), &self.inner);

        if status != ffi::if_select::IFSelect_ReturnStatus::IFSelect_RetDone {
            return Err(Error::StepWriteFailed);
        }

        let status = ffi::step_control::write_step(
            writer.pin_mut(),
            path.as_ref().to_string_lossy().to_string(),
        );

        if status != ffi::if_select::IFSelect_ReturnStatus::IFSelect_RetDone {
            return Err(Error::StepWriteFailed);
        }

        Ok(())
    }

    pub fn read_iges(path: impl AsRef<Path>) -> Result<Self, Error> {
        let mut reader = ffi::iges_control::IGESControl_Reader_new();

        let status = ffi::iges_control::read_iges(
            reader.pin_mut(),
            path.as_ref().to_string_lossy().to_string(),
        );

        reader.pin_mut().TransferRoots(&ffi::message::Message_ProgressRange_new());

        if status != ffi::if_select::IFSelect_ReturnStatus::IFSelect_RetDone {
            return Err(Error::IgesReadFailed);
        }

        let inner = ffi::iges_control::one_shape_iges(&reader);

        Ok(Self { inner })
    }

    pub fn write_iges(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        let mut writer = ffi::iges_control::IGESControl_Writer_new();

        let success =
            writer.pin_mut().AddShape(&self.inner, &ffi::message::Message_ProgressRange_new());

        if !success {
            return Err(Error::IgesWriteFailed);
        }

        writer.pin_mut().ComputeModel();
        let success = ffi::iges_control::write_iges(
            writer.pin_mut(),
            path.as_ref().to_string_lossy().to_string(),
        );

        if success {
            Ok(())
        } else {
            Err(Error::IgesWriteFailed)
        }
    }

    pub fn write_brep_text(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        let success =
            ffi::b_rep_tools::write(&self.inner, path.as_ref().to_string_lossy().to_string());

        if success {
            Ok(())
        } else {
            Err(Error::BrepWriteFailed)
        }
    }

    pub fn read_brep_text(path: impl AsRef<Path>) -> Result<Self, Error> {
        let inner = ffi::b_rep_tools::read(path.as_ref().to_string_lossy().to_string());

        if inner.is_null() {
            Err(Error::BrepReadFailed)
        } else {
            Ok(Self { inner })
        }
    }

    pub fn write_brep_bin(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        let success =
            ffi::bin_tools::write(&self.inner, path.as_ref().to_string_lossy().to_string());

        if success {
            Ok(())
        } else {
            Err(Error::BrepWriteFailed)
        }
    }

    pub fn read_brep_bin(path: impl AsRef<Path>) -> Result<Self, Error> {
        let inner = ffi::bin_tools::read(path.as_ref().to_string_lossy().to_string());

        if inner.is_null() {
            Err(Error::BrepReadFailed)
        } else {
            Ok(Self { inner })
        }
    }

    #[must_use]
    pub fn union(&self, other: &Shape) -> BooleanShape {
        let mut fuse_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Fuse_new(&self.inner, &other.inner);
        let edge_list = fuse_operation.pin_mut().SectionEdges();
        let vec = ffi::topo_ds::shape_list_to_vector(edge_list);

        let mut new_edges = vec![];
        for shape in vec.iter() {
            let edge = ffi::topo_ds::TopoDS::Edge(shape);
            new_edges.push(Edge::from_edge(edge));
        }

        let shape = Self::from_shape(fuse_operation.pin_mut().Shape());

        BooleanShape { shape, new_edges }
    }

    /// Like `union`, but with OCCT's GlueShift boolean mode: it tells the BOP
    /// that any coincident faces are EXACT shifted/mirrored copies, so they're
    /// glued rather than run through a fuzzy face-face intersection that shaves
    /// thin slivers (and under-reports volume) at pattern/mirror seams. The
    /// two-shape constructor builds without glue, so we SetGlue then re-Build —
    /// a second pass, but feature regen is not a hot path. Returns the shape
    /// directly (callers here don't need the section edges).
    #[must_use]
    pub fn union_glued(&self, other: &Shape) -> Shape {
        let mut fuse = ffi::b_rep_algo_api::BRepAlgoAPI_Fuse_new(&self.inner, &other.inner);
        fuse.pin_mut()
            .SetGlue(ffi::bop_algo::BOPAlgo_GlueEnum::BOPAlgo_GlueShift);
        fuse.pin_mut().Build(&ffi::message::Message_ProgressRange_new());
        Self::from_shape(fuse.pin_mut().Shape())
    }

    #[must_use]
    pub fn intersect(&self, other: &Shape) -> BooleanShape {
        let mut fuse_operation =
            ffi::b_rep_algo_api::BRepAlgoAPI_Common_new(&self.inner, &other.inner);
        let edge_list = fuse_operation.pin_mut().SectionEdges();
        let vec = ffi::topo_ds::shape_list_to_vector(edge_list);

        let mut new_edges = vec![];
        for shape in vec.iter() {
            let edge = ffi::topo_ds::TopoDS::Edge(shape);
            new_edges.push(Edge::from_edge(edge));
        }

        let shape = Self::from_shape(fuse_operation.pin_mut().Shape());

        BooleanShape { shape, new_edges }
    }

    pub fn write_stl<P: AsRef<Path>>(&self, path: P) -> Result<(), Error> {
        self.write_stl_with_tolerance(path, 0.001)
    }

    pub fn write_stl_with_tolerance<P: AsRef<Path>>(
        &self,
        path: P,
        triangulation_tolerance: f64,
    ) -> Result<(), Error> {
        let mut stl_writer = ffi::stl_api::StlAPI_Writer_new();
        let mesher = Mesher::try_new(self, triangulation_tolerance)?;
        let success = ffi::stl_api::write_stl(
            stl_writer.pin_mut(),
            mesher.inner.Shape(),
            path.as_ref().to_string_lossy().to_string(),
        );

        if success {
            Ok(())
        } else {
            Err(Error::StlWriteFailed)
        }
    }

    #[must_use]
    pub fn clean(&self) -> Self {
        let mut upgrader = ffi::shape_upgrade::UnifySameDomain_new(&self.inner, true, true, true);
        upgrader.pin_mut().allow_internal_edges(false);
        upgrader.pin_mut().build();

        Self::from_shape(upgrader.shape())
    }

    pub fn set_global_translation(&mut self, translation: DVec3) {
        let mut transform = ffi::gp::new_transform();
        let translation_vec = make_vec(translation);
        transform.pin_mut().set_translation_vec(&translation_vec);

        let location = ffi::top_loc::Location_from_transform(&transform);

        self.inner.pin_mut().set_global_translation(&location, false);
    }

    pub fn mesh(&self) -> Result<Mesh, Error> {
        self.mesh_with_tolerance(0.01)
    }

    pub fn mesh_with_tolerance(&self, triangulation_tolerance: f64) -> Result<Mesh, Error> {
        let mesher = Mesher::try_new(self, triangulation_tolerance)?;
        mesher.mesh()
    }

    pub fn edges(&self) -> EdgeIterator {
        let explorer = ffi::top_exp::TopExp_Explorer_new(
            &self.inner,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_EDGE,
        );
        EdgeIterator { explorer }
    }

    pub fn faces(&self) -> FaceIterator {
        let explorer = ffi::top_exp::TopExp_Explorer_new(
            &self.inner,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_FACE,
        );
        FaceIterator { explorer }
    }

    /// Iterator over the independent solids in this shape. A "single
    /// body" Shape (the common case) yields exactly one Solid. After
    /// a boolean cut that physically severs a body, the result is a
    /// TopoDS_Compound containing N Solids — this iterator walks them
    /// individually so the caller can treat each as a separate body.
    pub fn solids(&self) -> SolidIterator {
        let explorer = ffi::top_exp::TopExp_Explorer_new(
            &self.inner,
            ffi::top_abs::TopAbs_ShapeEnum::TopAbs_SOLID,
        );
        SolidIterator { explorer }
    }

    /// Compute the volume and centroid (center of mass) of this shape.
    /// `only_closed = false` so we include open shells too — callers
    /// validate solid-ness separately. Triangulation is used for the
    /// integral, matching what the tessellator already produces.
    /// Returns (volume, centroid).
    pub fn volume_centroid(&self) -> (f64, DVec3) {
        let mut props = ffi::g_prop::GProps_new();
        ffi::b_rep_g_prop::BRepGProp::VolumeProperties(
            &self.inner,
            props.pin_mut(),
            /* only_closed = */ false,
            /* skip_shared = */ false,
            /* use_triangulation = */ true,
        );
        let volume = props.Mass();
        let centroid_pnt = ffi::g_prop::GProp_GProps_CentreOfMass(&props);
        let c = dvec3(centroid_pnt.X(), centroid_pnt.Y(), centroid_pnt.Z());
        (volume, c)
    }

    /// EXACT volume + centroid: integrates the analytic faces (Gauss
    /// quadrature over the true surfaces) rather than the triangulation, so
    /// curved bodies report their true volume instead of the chord-
    /// approximated mesh volume `volume_centroid` returns. Slower — use for
    /// final reporting (mass properties), not hot per-frame paths.
    pub fn volume_centroid_exact(&self) -> (f64, DVec3) {
        // rebuild marker v2 — see cad-kernel ops/shape_io.rs body_volume.
        let mut props = ffi::g_prop::GProps_new();
        ffi::b_rep_g_prop::BRepGProp::VolumeProperties(
            &self.inner,
            props.pin_mut(),
            /* only_closed = */ false,
            /* skip_shared = */ false,
            /* use_triangulation = */ false,
        );
        let volume = props.Mass();
        let centroid_pnt = ffi::g_prop::GProp_GProps_CentreOfMass(&props);
        let c = dvec3(centroid_pnt.X(), centroid_pnt.Y(), centroid_pnt.Z());
        (volume, c)
    }

    // TODO(bschwind) - Convert the return type to an iterator.
    pub fn faces_along_line(&self, line_origin: DVec3, line_dir: DVec3) -> Vec<LineFaceHitPoint> {
        let mut intersector = ffi::b_rep_int_curve_surface::BRepIntCurveSurface_Inter_new();
        let tolerance = 0.0001;
        intersector.pin_mut().Init(
            &self.inner,
            &ffi::gp::gp_Lin_new(&make_point(line_origin), &make_dir(line_dir)),
            tolerance,
        );

        let mut results = vec![];

        while intersector.More() {
            let face = ffi::b_rep_int_curve_surface::BRepIntCurveSurface_Inter_face(&intersector);
            let face = Face::from_face(&face);
            let point = ffi::b_rep_int_curve_surface::BRepIntCurveSurface_Inter_point(&intersector);

            results.push(LineFaceHitPoint {
                face,
                t: intersector.W(),
                u: intersector.U(),
                v: intersector.V(),
                point: dvec3(point.X(), point.Y(), point.Z()),
            });

            intersector.pin_mut().Next();
        }

        results
    }

    #[must_use]
    pub fn hollow<T: AsRef<Face>>(
        &self,
        offset: f64,
        faces_to_remove: impl IntoIterator<Item = T>,
    ) -> Self {
        let mut faces_list = ffi::top_tools::new_list_of_shape();

        for face in faces_to_remove.into_iter() {
            let shape = ffi::topo_ds::cast_face_to_shape(&face.as_ref().inner);
            faces_list.pin_mut().Append(shape);
        }

        let mut solid_maker = ffi::b_rep_offset_api::BRepOffsetAPI_MakeThickSolid_new();

        let offset_mode = ffi::b_rep_offset_api::BRepOffset_Mode::BRepOffset_Skin;
        let intersection = false;
        let self_intersection = false;
        let join_type = ffi::geom_abs::GeomAbs_JoinType::GeomAbs_Arc;
        let remove_intersecting_edges = false;

        solid_maker.pin_mut().MakeThickSolidByJoin(
            &self.inner,
            &faces_list,
            offset,
            0.001,
            offset_mode,
            intersection,
            self_intersection,
            join_type,
            remove_intersecting_edges,
            &ffi::message::Message_ProgressRange_new(),
        );

        Self::from_shape(solid_maker.pin_mut().Shape())
    }

    #[must_use]
    pub fn offset_surface(&self, offset: f64) -> Self {
        let faces_to_remove: [Face; 0] = [];
        self.hollow(offset, faces_to_remove)
    }

    /// Drill a cylindrical hole along the line defined by point `p`
    /// and direction `dir`, with `radius`.
    #[must_use]
    pub fn drill_hole(&self, p: DVec3, dir: DVec3, radius: f64) -> Self {
        let hole_axis = make_axis_1(p, dir);

        let mut make_hole = ffi::b_rep_feat::BRepFeat_MakeCylindricalHole_new();
        make_hole.pin_mut().Init(&self.inner, &hole_axis);

        make_hole.pin_mut().Perform(radius);
        make_hole.pin_mut().Build();

        Self::from_shape(make_hole.pin_mut().Shape())
    }
}

/// Information about a point where a line hits (i.e. intersects) a face
pub struct LineFaceHitPoint {
    /// The face that is hit
    pub face: Face,
    /// The T parameter along the line
    pub t: f64,
    /// The U parameter on the face
    pub u: f64,
    /// The V parameter on the face
    pub v: f64,
    /// The intersection point
    pub point: DVec3,
}

pub struct ChamferMaker {
    inner: UniquePtr<ffi::b_rep_fillet_api::BRepFilletAPI_MakeChamfer>,
}

impl ChamferMaker {
    pub fn new(shape: &Shape) -> Self {
        let make_chamfer = ffi::b_rep_fillet_api::BRepFilletAPI_MakeChamfer_new(&shape.inner);

        Self { inner: make_chamfer }
    }

    pub fn add_edge(&mut self, distance: f64, edge: &Edge) {
        self.inner.pin_mut().add_edge(distance, &edge.inner);
    }

    pub fn build(mut self) -> Shape {
        Shape::from_shape(self.inner.pin_mut().Shape())
    }
}
