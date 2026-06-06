#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <bindings_common.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Cylinder.hxx>

inline std::unique_ptr<gp_Pnt> BRepAdaptor_Curve_value(const BRepAdaptor_Curve &curve, const Standard_Real U) {
  return std::unique_ptr<gp_Pnt>(new gp_Pnt(curve.Value(U)));
}

// Cylinder axis location / direction / radius for a cylindrical face. Only valid
// when the surface GetType() == GeomAbs_Cylinder (caller checks first).
inline std::unique_ptr<gp_Pnt> BRepAdaptor_Surface_cyl_location(const BRepAdaptor_Surface &surface) {
  return std::unique_ptr<gp_Pnt>(new gp_Pnt(surface.Cylinder().Axis().Location()));
}

inline std::unique_ptr<gp_Dir> BRepAdaptor_Surface_cyl_direction(const BRepAdaptor_Surface &surface) {
  return std::unique_ptr<gp_Dir>(new gp_Dir(surface.Cylinder().Axis().Direction()));
}

inline double BRepAdaptor_Surface_cyl_radius(const BRepAdaptor_Surface &surface) {
  return surface.Cylinder().Radius();
}
