import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@supabase/supabase-js";

// Only the authenticated extension API can establish this server-local scope.
const identity = new AsyncLocalStorage<User>();
export const extensionRequestUser = () => identity.getStore();
export function withExtensionUser<T>(user: User, work: () => T): T {
  return identity.run(user, work);
}
