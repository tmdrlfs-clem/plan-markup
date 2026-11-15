// Server auth API. The proxy imports proxy-session.ts and redirect.ts directly.
export {
  getAuthState,
  getAuthUser,
  getPlatformAdmin,
  readAuthState,
  requireActiveUser,
  requirePlatformAdmin,
  type AuthState,
  type AuthUser,
} from "./get-auth-user";
