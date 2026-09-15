// Vinext 在 src/app 同级查找入口；与本机 Next.js 复用同一套运行模式和转发规则。
export { middleware } from "../middleware";

export const config = {
  matcher: ["/:path*"]
};
