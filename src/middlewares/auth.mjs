import adminService from "../services/auth.mjs";
async function authMiddleware(req, res, next) {
  try {
    const authorization = req.headers.Authorization;
    const res = await adminService.VerifyToken(authorization);
    next();
    return { status: true, uid: res.uid, email: res.email };
  } catch (err) {
    res.status(401).json({ message: "Forbidden, Access Denied!" });
  }
}

export default authMiddleware;
